// Builds the RFC 5322 message written during the SMTP DATA phase
// (clients/email/smtp.ts). Bodies and the subject are base64-encoded:
// the base64 alphabet contains no "." and lines wrap at 76 chars, which
// sidesteps SMTP dot-stuffing and the 998-octet line limit without a
// transform pass over user content.
export interface MimeMessageInput {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const BASE64_LINE_WIDTH = 76;
// 11 code points ≤ 44 UTF-8 bytes → base64 ≤ 60 chars → encoded word ≤ 72
// chars, under RFC 2047's 75-char limit even for 4-byte code points.
const SUBJECT_CHUNK_CODE_POINTS = 11;

function encodeBase64Wrapped(value: string): string {
  const encoded = Buffer.from(value, "utf8").toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < encoded.length; i += BASE64_LINE_WIDTH) {
    lines.push(encoded.slice(i, i + BASE64_LINE_WIDTH));
  }
  return lines.join("\r\n");
}

// RFC 2047: chunk by code points (an encoded word must hold whole
// characters); adjacent encoded words joined by folding whitespace decode
// back with the whitespace removed, so multi-word subjects round-trip.
function encodeSubject(subject: string): string {
  const codePoints = Array.from(subject);
  const words: string[] = [];
  for (let i = 0; i < codePoints.length; i += SUBJECT_CHUNK_CODE_POINTS) {
    const chunk = codePoints.slice(i, i + SUBJECT_CHUNK_CODE_POINTS).join("");
    words.push(`=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`);
  }
  return words.join("\r\n ");
}

// "-" is not in the base64 alphabet, so a boundary containing it can never
// collide with an encoded body line.
function makeBoundary(): string {
  return `----=_mockyard-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

// From/To are the only header values interpolated raw; a CR/LF/NUL here
// would let a caller inject headers or terminate the SMTP DATA phase.
function assertSafeHeaderValue(name: string, value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`invalid ${name} header value: contains CR, LF, or NUL`);
  }
  return value;
}

export function buildMimeMessage(input: MimeMessageInput): string {
  const headers = [
    `From: ${assertSafeHeaderValue("From", input.from)}`,
    `To: ${assertSafeHeaderValue("To", input.to)}`,
    `Subject: ${encodeSubject(input.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
  ];

  if (input.text === undefined) {
    return [
      ...headers,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      encodeBase64Wrapped(input.html),
      "",
    ].join("\r\n");
  }

  const boundary = makeBoundary();
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    // text/plain first, text/html last: RFC 2046 orders alternatives from
    // least to most preferred.
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Wrapped(input.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBase64Wrapped(input.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}
