import "../setup";
import { describe, expect, test } from "bun:test";
import { createSmtpClient } from "@/clients/email/smtp";
import { UpstreamError } from "@/lib/errors";
import { startFakeSmtpServer } from "../helpers/fake-smtp-server";

const FROM = "noreply@yourdomain.com";
const PASSWORD = "smtp_secret_password_value";

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email address",
  html: "<p>hi</p>",
  text: "hi",
};

function clientFor(port: number, extra: Partial<Parameters<typeof createSmtpClient>[0]> = {}) {
  return createSmtpClient({ host: "127.0.0.1", port, fromAddress: FROM, ...extra });
}

describe("createSmtpClient", () => {
  test("no-auth happy path: EHLO → MAIL FROM → RCPT TO → DATA, no AUTH command", async () => {
    const server = await startFakeSmtpServer();
    try {
      await clientFor(server.port).send(MESSAGE);

      const verbs = server.commands.map((c) => c.split(/[ :]/)[0]);
      expect(verbs.slice(0, 4)).toEqual(["EHLO", "MAIL", "RCPT", "DATA"]);
      expect(verbs).not.toContain("AUTH");
      expect(server.commands[1]).toBe(`MAIL FROM:<${FROM}>`);
      expect(server.commands[2]).toBe(`RCPT TO:<${MESSAGE.to}>`);
      expect(server.data).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  test("with credentials, sends AUTH PLAIN before MAIL FROM with the RFC 4616 payload", async () => {
    const server = await startFakeSmtpServer();
    try {
      await clientFor(server.port, { username: "tenant-user", password: PASSWORD }).send(MESSAGE);

      const expected = Buffer.from(`\0tenant-user\0${PASSWORD}`, "utf8").toString("base64");
      const verbs = server.commands.map((c) => c.split(/[ :]/)[0]);
      expect(verbs.slice(0, 5)).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
      expect(server.commands[1]).toBe(`AUTH PLAIN ${expected}`);
    } finally {
      await server.close();
    }
  });

  test("transmits the MIME message: encoded subject, multipart body, no oversized lines", async () => {
    const server = await startFakeSmtpServer();
    try {
      await clientFor(server.port).send(MESSAGE);

      const payload = server.data[0] ?? "";
      expect(payload).toContain("Subject: =?UTF-8?B?");
      expect(payload).toContain("multipart/alternative");
      expect(payload).toContain(`From: ${FROM}`);
      for (const line of payload.split("\r\n")) {
        expect(line.startsWith(".")).toBe(false);
      }
    } finally {
      await server.close();
    }
  });

  test("html-only message transmits a single-part body", async () => {
    const server = await startFakeSmtpServer();
    try {
      await clientFor(server.port).send({
        to: MESSAGE.to,
        subject: MESSAGE.subject,
        html: MESSAGE.html,
      });
      expect(server.data[0]).toContain("Content-Type: text/html; charset=utf-8");
      expect(server.data[0]).not.toContain("multipart/alternative");
    } finally {
      await server.close();
    }
  });

  test("a 535 AUTH reject throws UpstreamError without the password anywhere in it", async () => {
    const server = await startFakeSmtpServer({
      replies: { AUTH: "535 5.7.8 authentication credentials invalid" },
    });
    try {
      const error = await clientFor(server.port, { username: "tenant-user", password: PASSWORD })
        .send(MESSAGE)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UpstreamError);
      const serialized = JSON.stringify({
        message: (error as Error).message,
        details: (error as UpstreamError).details,
      });
      expect(serialized).not.toContain(PASSWORD);
      // The base64 AUTH payload embeds the password too — it must not leak either.
      expect(serialized).not.toContain(
        Buffer.from(`\0tenant-user\0${PASSWORD}`).toString("base64"),
      );
      expect((error as UpstreamError).details).toMatchObject({
        provider: "smtp",
        code: 535,
      });
    } finally {
      await server.close();
    }
  });

  test("a 550 on MAIL FROM throws UpstreamError with the phase and reply code", async () => {
    const server = await startFakeSmtpServer({ replies: { MAIL: "550 5.1.0 sender rejected" } });
    try {
      const error = await clientFor(server.port)
        .send(MESSAGE)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).details).toMatchObject({
        provider: "smtp",
        phase: "MAIL FROM",
        code: 550,
      });
    } finally {
      await server.close();
    }
  });

  test("connection refused throws UpstreamError", async () => {
    const server = await startFakeSmtpServer();
    const port = server.port;
    await server.close();

    const error = await clientFor(port)
      .send(MESSAGE)
      .catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamError);
  });

  test("a stalled server reply times out with UpstreamError", async () => {
    const server = await startFakeSmtpServer({ stallOn: "MAIL" });
    try {
      const error = await clientFor(server.port, { timeoutMs: 250 })
        .send(MESSAGE)
        .catch((e) => e);
      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as Error).message).toMatch(/timeout/i);
    } finally {
      await server.close();
    }
  }, 10_000);

  test("recipient address with CR/LF injection is rejected without connecting", async () => {
    const server = await startFakeSmtpServer();
    try {
      const error = await clientFor(server.port)
        .send({ ...MESSAGE, to: "user@example.com\r\nRCPT TO:<evil@example.com>" })
        .catch((e) => e);

      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).details).toMatchObject({
        provider: "smtp",
        kind: "recipient",
      });
      // No connection was made; the error was caught before socket.connect()
      expect(server.commands).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  test("sender address with CR/LF injection is rejected without connecting", async () => {
    const server = await startFakeSmtpServer();
    try {
      const error = await clientFor(server.port, { fromAddress: "a@b.com\r\nX" })
        .send(MESSAGE)
        .catch((e) => e);

      expect(error).toBeInstanceOf(UpstreamError);
      expect((error as UpstreamError).details).toMatchObject({
        provider: "smtp",
        kind: "sender",
      });
      // No connection was made; the error was caught before socket.connect()
      expect(server.commands).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});
