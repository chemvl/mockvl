import type { ResourceField } from "@starter/schemas";
import { ValidationError } from "./errors";

// Parses the PLAN §4.2 list query convention into a normalized ListQuery:
//   ?page=1&pageSize=20
//   ?sort=createdAt:desc,title:asc
//   ?filter[status]=published&filter[title][like]=hello
//
// Strictly allow-list driven off the resource's fields metadata — a request
// can only sort/filter what a field's flags declare, so undeclared columns
// (passwordHash, tokenHash, ...) are unreachable no matter what the URL says.
// Values are validated against the field type here, at the boundary, so a
// garbage value becomes a 400 instead of a Postgres cast error deep in a repo.

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const FILTER_OPS = ["eq", "like", "in", "gte", "lte"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface ListSort {
  field: string;
  dir: "asc" | "desc";
}

export interface ListFilter {
  field: string;
  op: FilterOp;
  // `in` carries the split comma list; every other op a single raw string.
  value: string | string[];
}

export interface ListQuery {
  page: number;
  pageSize: number;
  sort: ListSort[];
  filters: ListFilter[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTER_KEY_RE = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/;

function isFilterOp(op: string): op is FilterOp {
  return (FILTER_OPS as readonly string[]).includes(op);
}

function invalid(message: string): never {
  throw new ValidationError(message);
}

function parsePositiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) invalid(`${name} must be a positive integer`);
  return value;
}

function parseSort(raw: string | undefined, fields: ResourceField[]): ListSort[] {
  if (raw === undefined || raw === "") return [];
  return raw.split(",").map((entry) => {
    const [field, dir = "asc", ...rest] = entry.split(":");
    if (!field || rest.length > 0 || (dir !== "asc" && dir !== "desc")) {
      invalid(`Invalid sort entry: ${entry}`);
    }
    const declared = fields.find((candidate) => candidate.name === field);
    if (!declared?.sortable) invalid(`Field is not sortable: ${field}`);
    return { field, dir };
  });
}

function validateValue(
  field: string,
  type: ResourceField["type"] | "id",
  raw: string,
  options?: string[],
): void {
  switch (type) {
    case "enum":
      if (!options?.includes(raw)) invalid(`Invalid value for ${field}: ${raw}`);
      return;
    case "number":
      if (raw === "" || Number.isNaN(Number(raw))) invalid(`Invalid number for ${field}: ${raw}`);
      return;
    case "date":
      if (Number.isNaN(Date.parse(raw))) invalid(`Invalid date for ${field}: ${raw}`);
      return;
    case "id":
    case "relation":
      if (!UUID_RE.test(raw)) invalid(`Invalid id for ${field}: ${raw}`);
      return;
    case "boolean":
      if (raw !== "true" && raw !== "false") invalid(`Invalid boolean for ${field}: ${raw}`);
      return;
    default:
      // string/text values stay raw; the column comparison decides.
      return;
  }
}

function parseFilterEntry(key: string, raw: string, fields: ResourceField[]): ListFilter {
  const match = key.match(FILTER_KEY_RE);
  if (!match?.[1]) invalid(`Malformed filter key: ${key}`);
  const field = match[1];
  const op = match[2] ?? "eq";
  if (!isFilterOp(op)) invalid(`Unknown filter op: ${op}`);

  // `id` is implicitly filterable with eq/in — the Refine data provider's
  // getMany contract (PLAN Phase 10) — without appearing in fields metadata.
  const fromFields = fields.find((candidate) => candidate.name === field);
  const declared =
    field === "id"
      ? { type: "id" as const, filterable: true, searchable: false, options: undefined }
      : fromFields && {
          type: fromFields.type,
          filterable: fromFields.filterable ?? false,
          searchable: fromFields.searchable ?? false,
          options: fromFields.type === "enum" ? fromFields.options : undefined,
        };
  if (!declared) invalid(`Field is not filterable: ${field}`);

  // `like` is the search box's op (searchable fields); everything else is a
  // structured filter (filterable fields). id allows eq/in only.
  const allowed =
    op === "like"
      ? declared.searchable
      : declared.filterable && (declared.type !== "id" || op === "eq" || op === "in");
  if (!allowed) invalid(`Op ${op} is not allowed on field: ${field}`);

  if (op === "in") {
    const values = raw === "" ? [] : raw.split(",");
    if (values.length === 0) invalid(`Empty in list for field: ${field}`);
    for (const value of values) validateValue(field, declared.type, value, declared.options);
    return { field, op, value: values };
  }

  if (op !== "like") validateValue(field, declared.type, raw, declared.options);
  return { field, op, value: raw };
}

export function parseListQuery(query: Record<string, string>, fields: ResourceField[]): ListQuery {
  const pageSize = parsePositiveInt(query.pageSize, "pageSize", DEFAULT_PAGE_SIZE);
  if (pageSize > MAX_PAGE_SIZE) invalid(`pageSize must be at most ${MAX_PAGE_SIZE}`);

  const filters = Object.entries(query)
    .filter(([key]) => key.startsWith("filter["))
    .map(([key, raw]) => parseFilterEntry(key, raw, fields));

  return {
    page: parsePositiveInt(query.page, "page", 1),
    pageSize,
    sort: parseSort(query.sort, fields),
    filters,
  };
}
