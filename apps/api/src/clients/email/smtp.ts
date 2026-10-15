// Minimal SMTP sender (RFC 5321) over node:net, no dependency. Plaintext
// only: no TLS/STARTTLS. AUTH PLAIN is optional — servers that relay for
// trusted source IPs need no credentials and the AUTH step is skipped.
//
// Credential safety: errors carry the phase, reply code, and server reply
// text — never the command we sent, which during AUTH embeds the password.
import { connect, type Socket } from "node:net";
import { UpstreamError } from "@/lib/errors";
import { buildMimeMessage } from "./mime";
import type { EmailMessage, EmailSender } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
// EHLO argument is the client's self-identification; servers only require a
// syntactically valid name — nothing routes on it.
const EHLO_NAME = "mockvl-api";

export interface SmtpClientOptions {
  host: string;
  port: number;
  // Envelope sender; the server may reject domains it does not relay for.
  fromAddress: string;
  // Both or neither (env.ts enforces the pair); absent = no AUTH step.
  username?: string;
  password?: string;
  // Per-reply timeout, not a whole-send budget.
  timeoutMs?: number;
}

interface SmtpReply {
  code: number;
  text: string;
}

// A reply's final line is "<3 digits><space>..." or bare "<3 digits>";
// "<3 digits>-..." lines are continuations (multi-line EHLO replies).
function takeReplyFrom(buffer: string): { reply: SmtpReply; rest: string } | undefined {
  let searchFrom = 0;
  while (true) {
    const lineEnd = buffer.indexOf("\r\n", searchFrom);
    if (lineEnd === -1) return undefined;
    const line = buffer.slice(searchFrom, lineEnd);
    if (/^\d{3}(?: |$)/.test(line)) {
      return {
        reply: { code: Number(line.slice(0, 3)), text: buffer.slice(0, lineEnd) },
        rest: buffer.slice(lineEnd + 2),
      };
    }
    searchFrom = lineEnd + 2;
  }
}

// One exchange per connection: write a command, await the (possibly
// multi-line) reply, fail the pending read on socket error/close/timeout.
function createSmtpExchange(socket: Socket, timeoutMs: number) {
  let buffer = "";
  let failure: UpstreamError | undefined;
  let pending:
    | {
        resolve: (reply: SmtpReply) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  const settle = (outcome: { reply?: SmtpReply; error?: Error }) => {
    if (!pending) return;
    const { resolve, reject, timer } = pending;
    pending = undefined;
    clearTimeout(timer);
    if (outcome.reply) resolve(outcome.reply);
    else reject(outcome.error ?? new UpstreamError("smtp exchange failed"));
  };

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    // Only drain when a reader is waiting — otherwise the reply stays
    // buffered for the next readReply() instead of being dropped.
    if (!pending) return;
    const taken = takeReplyFrom(buffer);
    if (taken) {
      buffer = taken.rest;
      settle({ reply: taken.reply });
    }
  });
  socket.on("error", (error) => {
    failure = new UpstreamError("smtp connection error", {
      provider: "smtp",
      cause: error.message,
    });
    settle({ error: failure });
  });
  socket.on("close", () => {
    failure ??= new UpstreamError("smtp connection closed unexpectedly", {
      provider: "smtp",
    });
    settle({ error: failure });
  });

  const readReply = (): Promise<SmtpReply> => {
    if (failure) return Promise.reject(failure);
    const taken = takeReplyFrom(buffer);
    if (taken) {
      buffer = taken.rest;
      return Promise.resolve(taken.reply);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        settle({
          error: new UpstreamError("smtp reply timeout", {
            provider: "smtp",
            timeoutMs,
          }),
        });
        socket.destroy();
      }, timeoutMs);
      pending = { resolve, reject, timer };
    });
  };

  const expect = async (code: number, phase: string): Promise<void> => {
    const reply = await readReply();
    if (reply.code !== code) {
      // Server reply text is safe to surface; the command we sent is not.
      throw new UpstreamError(`smtp ${phase} failed`, {
        provider: "smtp",
        phase,
        code: reply.code,
        reply: reply.text,
      });
    }
  };

  const command = (line: string, code: number, phase: string): Promise<void> => {
    socket.write(`${line}\r\n`);
    return expect(code, phase);
  };

  return { expect, command };
}

// Addresses are interpolated into raw wire commands; CR/LF/NUL or angle
// brackets would let a caller inject SMTP commands (CWE-93).
function assertSafeAddress(kind: string, address: string): string {
  if (/[\r\n\0<>\s]/.test(address)) {
    throw new UpstreamError(`smtp invalid ${kind} address`, {
      provider: "smtp",
      kind,
    });
  }
  return address;
}

export function createSmtpClient(options: SmtpClientOptions): EmailSender {
  const { host, port, fromAddress, username, password, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  return {
    // One connection per send — callers are low-volume pg-boss workers whose
    // retry policy is the error handling; no pooling.
    async send(message: EmailMessage): Promise<void> {
      // Validate addresses before opening socket to prevent command injection.
      assertSafeAddress("sender", fromAddress);
      assertSafeAddress("recipient", message.to);

      const socket = connect({ host, port });
      const smtp = createSmtpExchange(socket, timeoutMs);
      try {
        await smtp.expect(220, "greeting");
        await smtp.command(`EHLO ${EHLO_NAME}`, 250, "EHLO");
        if (username !== undefined && password !== undefined) {
          const token = Buffer.from(`\0${username}\0${password}`, "utf8").toString("base64");
          await smtp.command(`AUTH PLAIN ${token}`, 235, "AUTH PLAIN");
        }
        await smtp.command(`MAIL FROM:<${fromAddress}>`, 250, "MAIL FROM");
        await smtp.command(`RCPT TO:<${message.to}>`, 250, "RCPT TO");
        await smtp.command("DATA", 354, "DATA");
        const mime = buildMimeMessage({
          from: fromAddress,
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.text !== undefined ? { text: message.text } : {}),
        });
        // buildMimeMessage guarantees a trailing CRLF, so the terminator
        // lands on its own line; base64 bodies need no dot-stuffing.
        socket.write(mime);
        await smtp.command(".", 250, "message body");
        // Best-effort goodbye — the message is already accepted; end() also
        // flushes the write before FIN, unlike destroy().
        socket.end("QUIT\r\n");
      } finally {
        socket.destroy();
      }
    },
  };
}
