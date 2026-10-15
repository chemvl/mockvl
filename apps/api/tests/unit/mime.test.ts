import "../setup";
import { describe, expect, test } from "bun:test";
import { buildMimeMessage } from "@/clients/email/mime";

// Decodes every RFC 2047 encoded word in a folded Subject header back to text.
function decodeSubjectHeader(raw: string): string {
  return [...raw.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)]
    .map((match) => Buffer.from(match[1] ?? "", "base64").toString("utf8"))
    .join("");
}

function headerValue(message: string, name: string): string {
  // Header value plus any folded continuation lines (lines starting with WSP).
  const lines = message.split("\r\n");
  const start = lines.findIndex((line) => line.startsWith(`${name}: `));
  expect(start).toBeGreaterThanOrEqual(0);
  let value = (lines[start] ?? "").slice(name.length + 2);
  for (let i = start + 1; i < lines.length && /^[ \t]/.test(lines[i] ?? ""); i += 1) {
    // Unfold with a single space so encoded words stay whitespace-separated.
    value += ` ${(lines[i] ?? "").trim()}`;
  }
  return value;
}

const INPUT = {
  from: "noreply@yourdomain.com",
  to: "user@example.com",
  subject: "Xác minh địa chỉ email của bạn",
  html: "<p>Xin chào</p>",
};

describe("buildMimeMessage", () => {
  test("uses CRLF endings and always ends with CRLF", () => {
    const message = buildMimeMessage(INPUT);
    expect(message.endsWith("\r\n")).toBe(true);
    // No bare LF anywhere: every \n is preceded by \r.
    expect(message.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("emits the required headers", () => {
    const message = buildMimeMessage(INPUT);
    expect(headerValue(message, "From")).toBe(INPUT.from);
    expect(headerValue(message, "To")).toBe(INPUT.to);
    expect(message).toContain("MIME-Version: 1.0");
    expect(message).toContain("Date: ");
  });

  test("encodes a UTF-8 subject as RFC 2047 base64 words that decode back", () => {
    const message = buildMimeMessage(INPUT);
    expect(decodeSubjectHeader(headerValue(message, "Subject"))).toBe(INPUT.subject);
  });

  test("folds long subjects into encoded words of at most 75 chars each", () => {
    const long = "Thông báo xác minh tài khoản dịch vụ trực tuyến của bạn ngay hôm nay";
    const message = buildMimeMessage({ ...INPUT, subject: long });
    const words = headerValue(message, "Subject").split(/\s+/);
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    expect(decodeSubjectHeader(headerValue(message, "Subject"))).toBe(long);
  });

  test("html-only input produces a single-part base64 text/html body that decodes back", () => {
    const message = buildMimeMessage(INPUT);
    expect(message).toContain("Content-Type: text/html; charset=utf-8");
    expect(message).toContain("Content-Transfer-Encoding: base64");
    expect(message).not.toContain("multipart/alternative");
    const body = message.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    expect(Buffer.from(body.replaceAll("\r\n", ""), "base64").toString("utf8")).toBe(INPUT.html);
  });

  test("html + text produces multipart/alternative with text first, html last", () => {
    const message = buildMimeMessage({ ...INPUT, text: "Xin chào" });
    const boundaryMatch = message.match(/boundary="([^"]+)"/);
    expect(boundaryMatch).not.toBeNull();
    const boundary = boundaryMatch?.[1] ?? "";
    const parts = message.split(`--${boundary}`);
    // preamble, text part, html part, closing "--"
    expect(parts).toHaveLength(4);
    expect(parts[1]).toContain("Content-Type: text/plain; charset=utf-8");
    expect(parts[2]).toContain("Content-Type: text/html; charset=utf-8");
    expect(message).toContain(`--${boundary}--`);
    const textBody = (parts[1] ?? "").split("\r\n\r\n").slice(1).join("");
    expect(Buffer.from(textBody.replaceAll("\r\n", ""), "base64").toString("utf8")).toBe(
      "Xin chào",
    );
  });

  test("base64 body lines wrap at 76 chars (dot-stuffing-proof)", () => {
    const message = buildMimeMessage({ ...INPUT, html: `<p>${"x".repeat(500)}</p>` });
    const body = message.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    for (const line of body.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
      expect(line.startsWith(".")).toBe(false);
    }
  });

  test("rejects to header value containing CRLF injection", () => {
    expect(() => {
      buildMimeMessage({
        ...INPUT,
        to: "user@example.com\r\nBcc: evil@example.com",
      });
    }).toThrow();
  });

  test("rejects from header value containing CRLF injection", () => {
    expect(() => {
      buildMimeMessage({
        ...INPUT,
        from: "noreply@yourdomain.com\r\nBcc: evil@example.com",
      });
    }).toThrow();
  });
});
