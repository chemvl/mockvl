import { createServer, type Socket } from "node:net";

// Scripted in-process SMTP server: records every command line and DATA
// payload, replies from a table keyed by command verb ("." keys the
// end-of-data acknowledgement). `replies` overrides individual entries to
// script failures; `stallOn` swallows the reply for one verb to exercise
// client timeouts. Listens on 127.0.0.1:0 (ephemeral port) — safe in CI.
export interface FakeSmtpOptions {
  replies?: Partial<Record<string, string>>;
  stallOn?: string;
}

export interface FakeSmtpServer {
  port: number;
  commands: string[];
  data: string[];
  close(): Promise<void>;
}

const DEFAULT_REPLIES: Record<string, string> = {
  // Multi-line EHLO reply on purpose — it exercises the client's
  // "250-...continuation" parsing on every test.
  EHLO: "250-fake.local\r\n250 AUTH PLAIN",
  AUTH: "235 2.7.0 authentication successful",
  MAIL: "250 2.1.0 ok",
  RCPT: "250 2.1.5 ok",
  DATA: "354 end data with <CRLF>.<CRLF>",
  ".": "250 2.0.0 queued",
  QUIT: "221 2.0.0 bye",
};

export async function startFakeSmtpServer(options: FakeSmtpOptions = {}): Promise<FakeSmtpServer> {
  const commands: string[] = [];
  const data: string[] = [];
  const sockets = new Set<Socket>();
  const replies = { ...DEFAULT_REPLIES, ...options.replies };

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let buffer = "";
    let inData = false;
    socket.write("220 fake.local ESMTP\r\n");

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          data.push(buffer.slice(0, end + 2)); // keep the body's final CRLF
          buffer = buffer.slice(end + 5);
          inData = false;
          if (options.stallOn === ".") return;
          socket.write(`${replies["."]}\r\n`);
          continue;
        }
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd === -1) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        commands.push(line);
        const verb = line.split(/[ :]/)[0]?.toUpperCase() ?? "";
        if (options.stallOn === verb) return;
        if (verb === "DATA") inData = true;
        socket.write(`${replies[verb] ?? "500 unrecognized"}\r\n`);
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake SMTP server did not bind a port");
  }
  return {
    port: address.port,
    commands,
    data,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
