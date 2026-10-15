import "../setup";

import { describe, expect, test } from "bun:test";
import type { CrudRepo } from "@/admin/registry/crud.repo";
import { createCrudService } from "@/admin/registry/crud.service";
import type { ResourceRow } from "@/admin/registry/registry";
import { postsResource } from "@/admin/registry/resources/posts.resource";

const TARGET_ID = "9c1d3f7a-2b4e-4c6d-8e0f-1a2b3c4d5e6f";
const XSS = '<p onclick="alert(1)">hi</p><script>alert(1)</script>';

// Captures what the service hands to the repo — the hooks run before insert/
// update, so the captured values prove sanitization happened on the way in.
function fakeRepo(captured: { values?: ResourceRow }): CrudRepo {
  return {
    insert: async (values: ResourceRow) => {
      captured.values = values;
      return { id: TARGET_ID, ...values };
    },
    update: async (_id: string, values: ResourceRow) => {
      captured.values = values;
      return { id: TARGET_ID, ...values };
    },
  } as unknown as CrudRepo;
}

describe("posts resource sanitization hooks", () => {
  test("create sanitizes content before it reaches the repo", async () => {
    const captured: { values?: ResourceRow } = {};
    const service = createCrudService({ repo: fakeRepo(captured), hooks: postsResource.hooks });

    await service.create({ title: "t", content: XSS });
    expect(captured.values?.content).toBe("<p>hi</p>");
    expect(captured.values?.title).toBe("t");
  });

  test("update sanitizes content on partial payloads", async () => {
    const captured: { values?: ResourceRow } = {};
    const service = createCrudService({ repo: fakeRepo(captured), hooks: postsResource.hooks });

    await service.update(TARGET_ID, { content: XSS });
    expect(captured.values?.content).toBe("<p>hi</p>");
  });

  test("update passes a null content through untouched", async () => {
    const captured: { values?: ResourceRow } = {};
    const service = createCrudService({ repo: fakeRepo(captured), hooks: postsResource.hooks });

    await service.update(TARGET_ID, { content: null });
    expect(captured.values?.content).toBeNull();
  });

  test("content is declared richtext so the hooks actually target it", () => {
    const contentField = postsResource.fields.find((field) => field.name === "content");
    expect(contentField?.type).toBe("richtext");
  });
});
