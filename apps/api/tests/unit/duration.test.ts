import "../setup";
import { describe, expect, test } from "bun:test";
import { parseDuration } from "@/lib/duration";

describe("parseDuration", () => {
  test("parses seconds", () => {
    expect(parseDuration("45s")).toBe(45);
  });

  test("parses minutes", () => {
    expect(parseDuration("15m")).toBe(900);
  });

  test("parses hours", () => {
    expect(parseDuration("2h")).toBe(7200);
  });

  test("parses days", () => {
    expect(parseDuration("30d")).toBe(2_592_000);
  });

  test.each([
    "",
    "10x",
    "m5",
    "1.5h",
    "15",
    "m",
    "-5m",
    " 15m",
    "15m ",
  ])("rejects %j with a readable error", (input) => {
    expect(() => parseDuration(input)).toThrow(/duration/i);
  });
});
