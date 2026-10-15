import type { CallToolResult } from "@modelcontextprotocol/server";
import { McpServer } from "@modelcontextprotocol/server";
import { mockListFields, OPERATION_METHODS } from "@starter/schemas";
import { z } from "zod";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseListQuery } from "@/lib/pagination";
import type { MocksService } from "@/modules/mocks/mocks.service";
import type { McpPrincipal } from "@/modules/personal-access-tokens/personal-access-tokens.service";
import { MOCK_EDITOR_ROLES } from "@/modules/workspaces/workspaces.constants";
import { NO_PERMISSION } from "@/modules/workspaces/workspaces.errors";

export type McpCaller = McpPrincipal & { requestId: string };
export type McpMocksService = Pick<
  MocksService,
  "list" | "get" | "listOverrides" | "saveOverride" | "resetOverride"
>;

const LIST_PAGE_SIZE = 50;
const STATUS_CODE = /^\d{3}$/;

// Write tools need both the token's write scope and a current editor role.
function canWrite(caller: McpCaller): boolean {
  return caller.scope === "mocks:write" && MOCK_EDITOR_ROLES.includes(caller.workspace.role);
}

// Client errors surface as `CODE: message`; anything else is logged and hidden.
async function runTool(
  tool: string,
  caller: McpCaller,
  fn: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const out = await fn();
    return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      return { isError: true, content: [{ type: "text", text: `${err.code}: ${err.message}` }] };
    }
    logger.error(
      {
        err,
        tool,
        tokenId: caller.tokenId,
        workspaceId: caller.workspace.id,
        requestId: caller.requestId,
      },
      "mcp tool failed",
    );
    return {
      isError: true,
      content: [{ type: "text", text: "INTERNAL_ERROR: The tool failed. Try again later." }],
    };
  }
}

const mockArg = z
  .string()
  .min(1)
  .max(200)
  .describe("Mock slug, as returned by list_mocks (e.g. `pet-store`).");
const methodArg = z
  .enum(OPERATION_METHODS)
  .describe("HTTP method of the endpoint, lowercase (e.g. `get`).");
const pathArg = z
  .string()
  .min(1)
  .max(2000)
  .describe(
    "Path template exactly as listed by list_mock_endpoints (e.g. `/pets/{id}`), not a filled-in URL.",
  );
const statusCodeArg = z
  .number()
  .int()
  .min(100)
  .max(599)
  .describe("Response status code; one of the endpoint's `statusCodes`.");

const responseKeyShape = {
  mock: mockArg,
  method: methodArg,
  path: pathArg,
  statusCode: statusCodeArg,
};

const READ_ANNOTATIONS = { readOnlyHint: true, openWorldHint: false };
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

// One server per HTTP request: the tool set reflects this caller's rights
// right now, so read-only callers never see the write tools in tools/list.
export function createMockvlMcpServer(caller: McpCaller, mocks: McpMocksService): McpServer {
  const server = new McpServer({ name: "mockvl", version: "1.0.0" });
  const ws = caller.workspace;

  function logWrite(tool: string, key: z.infer<z.ZodObject<typeof responseKeyShape>>): void {
    logger.info(
      {
        tool,
        tokenId: caller.tokenId,
        userId: caller.userId,
        workspaceId: ws.id,
        mock: key.mock,
        method: key.method,
        path: key.path,
        statusCode: key.statusCode,
        requestId: caller.requestId,
      },
      "mcp write",
    );
  }

  server.registerTool(
    "list_mocks",
    {
      title: "List mocks",
      description:
        "Lists the mocks of the workspace this token belongs to, 50 per page, sorted by name. " +
        "Use a mock's `slug` as the `mock` argument of the other tools. " +
        "`url` is the public base URL the mock serves requests on.",
      inputSchema: z.object({
        search: z
          .string()
          .max(200)
          .optional()
          .describe("Only mocks whose name or slug contains this text."),
        page: z.number().int().min(1).max(1000).optional().describe("Page number, from 1."),
      }),
      annotations: READ_ANNOTATIONS,
    },
    ({ search, page }) =>
      runTool("list_mocks", caller, async () => {
        const query = parseListQuery(
          { page: String(page ?? 1), pageSize: String(LIST_PAGE_SIZE), sort: "name:asc" },
          mockListFields,
        );
        const { rows, total } = await mocks.list(ws, caller.userId, query, search);
        return {
          workspace: ws.slug,
          page: query.page,
          pageSize: LIST_PAGE_SIZE,
          total,
          mocks: rows.map((row) => ({
            slug: row.slug,
            name: row.name,
            status: row.status,
            url: row.url,
            endpointCount: row.endpointCount,
          })),
        };
      }),
  );

  server.registerTool(
    "list_mock_endpoints",
    {
      title: "List mock endpoints",
      description:
        "Lists the endpoints of one mock. `statusCodes` are the status codes update_mock_response " +
        "accepts for that endpoint; `customResponseCodes` are the ones that already have a saved " +
        "custom response. To see the response an endpoint currently returns, send a request with " +
        "the endpoint's method to the mock `url` + `path` (path parameters filled in) with the " +
        "header `Prefer: code=<status>`.",
      inputSchema: z.object({ mock: mockArg }),
      annotations: READ_ANNOTATIONS,
    },
    ({ mock }) =>
      runTool("list_mock_endpoints", caller, async () => {
        const detail = await mocks.get(ws, mock);
        const overrides = await mocks.listOverrides(ws, mock);
        return {
          mock: detail.slug,
          url: detail.url,
          endpoints: detail.operations.map((op) => ({
            method: op.method,
            path: op.path,
            summary: op.summary,
            statusCodes: op.codes.filter((code) => STATUS_CODE.test(code)).map(Number),
            customResponseCodes: overrides
              .filter((o) => o.method === op.method && o.path === op.path)
              .map((o) => o.code)
              .sort((a, b) => a - b),
          })),
        };
      }),
  );

  if (!canWrite(caller)) return server;

  server.registerTool(
    "update_mock_response",
    {
      title: "Update mock response",
      description:
        "Saves a custom response for one endpoint and status code of a mock. The mock then serves " +
        "`body` verbatim for every request to that endpoint and status until reset_mock_response " +
        "is called. `path` must be the template exactly as listed by list_mock_endpoints " +
        "(e.g. `/pets/{id}`); `method` is lowercase. `body` is the complete response as JSON " +
        "text, max 256 KB. The body is not validated against the schema.",
      inputSchema: z.object({
        ...responseKeyShape,
        body: z
          .string()
          .describe('The complete response body as JSON text, e.g. `{"id":7}`. Max 256 KB.'),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    ({ body, ...key }) =>
      runTool("update_mock_response", caller, async () => {
        // Defense in depth: write tools are only registered for writers.
        if (!canWrite(caller)) throw new ForbiddenError(NO_PERMISSION);
        logWrite("update_mock_response", key);
        const saved = await mocks.saveOverride(ws, caller.userId, key.mock, {
          method: key.method,
          path: key.path,
          code: key.statusCode,
          body,
        });
        return {
          mock: key.mock,
          method: saved.method,
          path: saved.path,
          statusCode: saved.code,
          updatedAt: saved.updatedAt,
        };
      }),
  );

  server.registerTool(
    "reset_mock_response",
    {
      title: "Reset mock response",
      description:
        "Deletes the custom response of one endpoint and status code, restoring the default " +
        "response: generated from the schema for imported mocks, or the endpoint's saved default " +
        "for custom mocks. Idempotent: resetting a response that has no custom response succeeds.",
      inputSchema: z.object(responseKeyShape),
      annotations: WRITE_ANNOTATIONS,
    },
    (key) =>
      runTool("reset_mock_response", caller, async () => {
        if (!canWrite(caller)) throw new ForbiddenError(NO_PERMISSION);
        logWrite("reset_mock_response", key);
        await mocks.resetOverride(ws, key.mock, {
          method: key.method,
          path: key.path,
          code: key.statusCode,
        });
        return {
          mock: key.mock,
          method: key.method,
          path: key.path,
          statusCode: key.statusCode,
          reset: true,
        };
      }),
  );

  return server;
}
