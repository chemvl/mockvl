import "../setup";
import { describe, expect, test } from "bun:test";
import {
  isValidSlug,
  isValidWorkspaceSlug,
  RESERVED_MOCK_SLUGS,
  RESERVED_WORKSPACE_SLUGS,
  slugify,
  slugifyWorkspaceName,
  workspaceSlugProblem,
} from "@starter/schemas";

describe("slugify", () => {
  test("lowercases, replaces non-alphanumerics with one hyphen, trims hyphens", () => {
    expect(slugify("Pet Store API")).toBe("pet-store-api");
    expect(slugify("  --Hello__World!!  ")).toBe("hello-world");
    expect(slugify("john.doe+test")).toBe("john-doe-test");
    expect(slugify("Ünïcode")).toBe("n-code");
    expect(slugify("!!!")).toBe("");
  });

  test("caps at 40 characters without leaving a trailing hyphen", () => {
    const long = `${"a".repeat(39)} b`;
    expect(slugify(long)).toBe("a".repeat(39));
    expect(slugify("x".repeat(60))).toHaveLength(40);
  });
});

describe("isValidSlug", () => {
  test("accepts the spec pattern", () => {
    for (const ok of ["a", "a1", "pet-store", "x".repeat(40), "1-2-3"]) {
      expect(isValidSlug(ok)).toBe(true);
    }
  });

  test("rejects uppercase, edges, length > 40, and empty", () => {
    for (const bad of ["", "-a", "a-", "A", "a_b", "x".repeat(41), "a b"]) {
      expect(isValidSlug(bad)).toBe(false);
    }
  });
});

describe("workspace slugs", () => {
  test("WORKSPACE_SLUG_PATTERN boundaries", () => {
    for (const ok of ["a1", "ab-c", "x".repeat(32)]) {
      expect(isValidWorkspaceSlug(ok)).toBe(true);
    }
    for (const bad of ["a", "1ab", "ab--c", "ab-", "-ab", "Ab", "x".repeat(33)]) {
      expect(isValidWorkspaceSlug(bad)).toBe(false);
    }
  });

  test("workspaceSlugProblem checks the pattern before the reserved list", () => {
    expect(workspaceSlugProblem("platform")).toBeNull();
    expect(workspaceSlugProblem("api")).toBe("reserved");
    expect(workspaceSlugProblem("m")).toBe("invalid");
  });

  test("slugifyWorkspaceName", () => {
    expect(slugifyWorkspaceName("Platform Team!")).toBe("platform-team");
    expect(slugifyWorkspaceName(`${"a".repeat(31)} b`)).toBe("a".repeat(31));
  });
});

describe("reserved lists", () => {
  test("match the spec exactly", () => {
    expect([...RESERVED_MOCK_SLUGS]).toEqual(["new", "usage", "members", "settings"]);
    expect([...RESERVED_WORKSPACE_SLUGS]).toEqual([
      "api",
      "app",
      "admin",
      "login",
      "logout",
      "auth",
      "invite",
      "new",
      "settings",
      "docs",
      "static",
      "assets",
      "health",
      "www",
      "m",
      "connect",
      "svc",
    ]);
  });
});
