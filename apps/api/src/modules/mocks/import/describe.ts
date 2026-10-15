import type { OperationParameter, OperationRequest, OperationRequestBody } from "@starter/schemas";
import type { IHttpOperation, IHttpParam, IMediaTypeContent } from "@stoplight/types";
import { isPlainObject } from "./parse";
import { isOperationMethod } from "./summarize";

type JsonSchema = Record<string, unknown>;
type ExampleLike = NonNullable<IHttpParam["examples"]>[number];

// Prism stamps every schema with these; they mean nothing to a client.
function cleanSchema(schema: unknown): JsonSchema | null {
  if (!isPlainObject(schema)) return null;
  const { $schema: _draft, "x-stoplight": _stoplight, ...rest } = schema;
  return rest;
}

// External examples (`externalValue`) are URLs, not values — skipped.
function exampleValues(examples: readonly ExampleLike[] | undefined): unknown[] {
  return (examples ?? []).flatMap((example) => ("value" in example ? [example.value] : []));
}

function describeParameter(param: IHttpParam): OperationParameter {
  return {
    name: param.name,
    required: param.required === true,
    description: param.description ?? null,
    schema: cleanSchema(param.schema),
    examples: exampleValues(param.examples),
  };
}

const JSON_MEDIA_TYPE = /^application\/(?:[\w.+-]+\+)?json\b/i;

// The preview sends one body, so it describes one media type: JSON when the
// operation accepts it, else the first one listed.
function describeBody(operation: IHttpOperation): OperationRequestBody | null {
  const body = operation.request?.body;
  const contents: readonly IMediaTypeContent[] = body?.contents ?? [];
  const content = contents.find((item) => JSON_MEDIA_TYPE.test(item.mediaType)) ?? contents[0];
  if (!body || !content) return null;
  return {
    required: body.required === true,
    mediaType: content.mediaType,
    schema: cleanSchema(content.schema),
    examples: exampleValues(content.examples),
  };
}

// Request inputs per operation for the endpoint preview, in the same order
// as summarizeOperations (path, then method).
export function describeOperations(ops: readonly IHttpOperation[]): OperationRequest[] {
  const described = ops.map((op): OperationRequest => {
    const method = op.method.toLowerCase();
    if (!isOperationMethod(method)) {
      throw new Error(`Unexpected HTTP method from Prism: ${op.method}`);
    }
    return {
      method,
      path: op.path,
      parameters: {
        path: (op.request?.path ?? []).map(describeParameter),
        query: (op.request?.query ?? []).map(describeParameter),
        header: (op.request?.headers ?? []).map(describeParameter),
      },
      body: describeBody(op),
    };
  });
  return described.sort((a, b) =>
    a.path === b.path ? a.method.localeCompare(b.method) : a.path < b.path ? -1 : 1,
  );
}
