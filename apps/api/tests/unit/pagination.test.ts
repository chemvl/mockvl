import "../setup";

import { describe, expect, test } from "bun:test";
import type { ResourceField } from "@starter/schemas";
import { ValidationError } from "@/lib/errors";
import { parseListQuery } from "@/lib/pagination";

// Fixture with every flag combination the parser cares about. The parser is
// strictly allow-list driven: a query may only touch declared fields, with
// ops their flags permit — undeclared columns are unreachable by design.
const fields: ResourceField[] = [
  { name: "title", type: "string", label: "Title", searchable: true, sortable: true },
  {
    name: "status",
    type: "enum",
    label: "Status",
    options: ["draft", "published"],
    filterable: true,
  },
  { name: "views", type: "number", label: "Views", filterable: true, sortable: true },
  { name: "featured", type: "boolean", label: "Featured", filterable: true },
  { name: "createdAt", type: "date", label: "Created", filterable: true, sortable: true },
  {
    name: "authorId",
    type: "relation",
    label: "Author",
    resource: "users",
    displayField: "email",
    filterable: true,
  },
];

const UUID = "3d0f8a9e-1b2c-4d5e-8f6a-7b8c9d0e1f2a";
const UUID2 = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";

function parse(query: Record<string, string>) {
  return parseListQuery(query, fields);
}

describe("parseListQuery pagination", () => {
  test("defaults to page 1, pageSize 20, no sort, no filters", () => {
    expect(parse({})).toEqual({ page: 1, pageSize: 20, sort: [], filters: [] });
  });

  test("parses page and pageSize", () => {
    const parsed = parse({ page: "3", pageSize: "50" });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(50);
  });

  test("rejects pageSize above 100", () => {
    expect(() => parse({ pageSize: "101" })).toThrow(ValidationError);
  });

  test("rejects non-positive or non-numeric page/pageSize", () => {
    expect(() => parse({ page: "0" })).toThrow(ValidationError);
    expect(() => parse({ page: "abc" })).toThrow(ValidationError);
    expect(() => parse({ pageSize: "0" })).toThrow(ValidationError);
    expect(() => parse({ page: "1.5" })).toThrow(ValidationError);
  });
});

describe("parseListQuery sort", () => {
  test("parses comma-separated multi-sort", () => {
    expect(parse({ sort: "createdAt:desc,title:asc" }).sort).toEqual([
      { field: "createdAt", dir: "desc" },
      { field: "title", dir: "asc" },
    ]);
  });

  test("direction defaults to asc", () => {
    expect(parse({ sort: "title" }).sort).toEqual([{ field: "title", dir: "asc" }]);
  });

  test("rejects an invalid direction", () => {
    expect(() => parse({ sort: "title:up" })).toThrow(ValidationError);
  });

  test("rejects sorting on a field not marked sortable", () => {
    expect(() => parse({ sort: "status:asc" })).toThrow(ValidationError);
  });

  test("rejects sorting on an undeclared field", () => {
    expect(() => parse({ sort: "passwordHash:asc" })).toThrow(ValidationError);
  });
});

describe("parseListQuery filters", () => {
  test("bare filter[field] means eq", () => {
    expect(parse({ "filter[status]": "published" }).filters).toEqual([
      { field: "status", op: "eq", value: "published" },
    ]);
  });

  test("in splits the comma list", () => {
    expect(parse({ "filter[status][in]": "draft,published" }).filters).toEqual([
      { field: "status", op: "in", value: ["draft", "published"] },
    ]);
  });

  test("like requires a searchable field", () => {
    expect(parse({ "filter[title][like]": "hello" }).filters).toEqual([
      { field: "title", op: "like", value: "hello" },
    ]);
    expect(() => parse({ "filter[status][like]": "pub" })).toThrow(ValidationError);
  });

  test("non-like ops require a filterable field", () => {
    // title is searchable but not filterable: like only.
    expect(() => parse({ "filter[title]": "hello" })).toThrow(ValidationError);
  });

  test("rejects an unknown op", () => {
    expect(() => parse({ "filter[views][between]": "1,2" })).toThrow(ValidationError);
  });

  test("rejects an undeclared field", () => {
    expect(() => parse({ "filter[passwordHash]": "x" })).toThrow(ValidationError);
  });

  test("rejects a malformed filter key", () => {
    expect(() => parse({ "filter[views][gte][extra]": "1" })).toThrow(ValidationError);
  });

  test("id is implicitly filterable with eq/in (Refine getMany contract)", () => {
    expect(parse({ "filter[id][in]": `${UUID},${UUID2}` }).filters).toEqual([
      { field: "id", op: "in", value: [UUID, UUID2] },
    ]);
    expect(() => parse({ "filter[id][gte]": UUID })).toThrow(ValidationError);
  });

  test("values are validated against the field type", () => {
    // enum: member of options
    expect(() => parse({ "filter[status]": "archived" })).toThrow(ValidationError);
    // number: numeric
    expect(parse({ "filter[views][gte]": "10" }).filters[0]?.value).toBe("10");
    expect(() => parse({ "filter[views][gte]": "abc" })).toThrow(ValidationError);
    // date: parseable timestamp
    expect(parse({ "filter[createdAt][lte]": "2026-07-06T00:00:00.000Z" }).filters).toHaveLength(1);
    expect(() => parse({ "filter[createdAt][lte]": "not-a-date" })).toThrow(ValidationError);
    // relation/id: uuid
    expect(parse({ "filter[authorId]": UUID }).filters).toHaveLength(1);
    expect(() => parse({ "filter[authorId]": "abc" })).toThrow(ValidationError);
    expect(() => parse({ "filter[id]": "abc" })).toThrow(ValidationError);
  });

  test("boolean values must be literal true/false (anything else would be a Postgres cast error)", () => {
    expect(parse({ "filter[featured]": "true" }).filters).toEqual([
      { field: "featured", op: "eq", value: "true" },
    ]);
    expect(parse({ "filter[featured]": "false" }).filters).toHaveLength(1);
    expect(() => parse({ "filter[featured]": "notabool" })).toThrow(ValidationError);
    expect(() => parse({ "filter[featured]": "1" })).toThrow(ValidationError);
  });

  test("rejects an empty in list", () => {
    expect(() => parse({ "filter[status][in]": "" })).toThrow(ValidationError);
  });

  test("every in member is validated", () => {
    expect(() => parse({ "filter[status][in]": "draft,archived" })).toThrow(ValidationError);
  });

  test("unrelated query keys are ignored", () => {
    expect(parse({ foo: "bar" }).filters).toEqual([]);
  });
});
