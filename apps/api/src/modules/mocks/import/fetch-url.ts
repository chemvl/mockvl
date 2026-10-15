// Step 1 of the import pipeline: download a user-supplied schema URL without
// letting it reach our own network (SSRF). https only; every address the host
// resolves to must be public; redirects are followed manually (≤ 3) and each
// hop is re-validated; 10 s total budget; the body is streamed and cut at
// MAX_SCHEMA_BYTES. Residual risk (accepted for v1, documented in the spec):
// DNS rebinding between this check and fetch's own resolution.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";
import {
  MAX_SCHEMA_BYTES,
  SCHEMA_URL_MAX_REDIRECTS,
  SCHEMA_URL_TIMEOUT_MS,
} from "../mocks.constants";
import { mockErrors } from "../mocks.errors";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type LookupFn = (hostname: string) => Promise<ResolvedAddress[]>;
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchSchemaUrlDeps {
  lookup?: LookupFn;
  fetch?: FetchFn;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });
const defaultFetch: FetchFn = (url, init) => fetch(url, init);

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

// Loopback, private, link-local, CGNAT, unspecified ("this network"),
// multicast, and the reserved/broadcast block above it.
function isBlockedIPv4(octets: readonly number[]): boolean {
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

// Eight 16-bit groups, or null if malformed. Handles "::" compression, zone
// ids, and a dotted IPv4 tail (::ffff:1.2.3.4).
function parseIPv6(ip: string): number[] | null {
  let address = (ip.split("%")[0] ?? ip).toLowerCase();
  const lastColon = address.lastIndexOf(":");
  const tail = address.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const high = (((v4[0] ?? 0) << 8) | (v4[1] ?? 0)).toString(16);
    const low = (((v4[2] ?? 0) << 8) | (v4[3] ?? 0)).toString(16);
    address = `${address.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string) =>
    part === ""
      ? []
      : part
          .split(":")
          .map((group) =>
            /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
          );
  const head = groups(halves[0] ?? "");
  const rest = halves.length === 2 ? groups(halves[1] ?? "") : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function isBlockedIPv6(groups: readonly number[]): boolean {
  const first = groups[0] ?? 0;
  const zeroPrefix = (count: number) => groups.slice(0, count).every((group) => group === 0);
  const g5 = groups[5] ?? 0;
  const g6 = groups[6] ?? 0;
  const g7 = groups[7] ?? 0;
  if (zeroPrefix(5) && g5 === 0xffff) {
    // IPv4-mapped: judge the embedded IPv4 address.
    return isBlockedIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  return (
    zeroPrefix(6) || // ::, ::1 and deprecated IPv4-compatible ::a.b.c.d
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xfe00) === 0xfc00 || // unique-local fc00::/7
    (first & 0xff00) === 0xff00 // multicast ff00::/8
  );
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address.split("%")[0] ?? address);
  if (version === 4) {
    const octets = parseIPv4(address);
    return octets === null || isBlockedIPv4(octets);
  }
  if (version === 6) {
    const groups = parseIPv6(address);
    return groups === null || isBlockedIPv6(groups);
  }
  // Not an IP at all — never connect to something we cannot classify.
  return true;
}

function parseHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw mockErrors.schemaUrlInvalid();
  }
  if (url.protocol !== "https:") throw mockErrors.schemaUrlInvalid();
  return url;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function assertPublicHost(url: URL, lookup: LookupFn, signal: AbortSignal): Promise<void> {
  // URL keeps IPv6 literals bracketed and normalizes decimal/hex IPv4 forms.
  const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
  let addresses: ResolvedAddress[];
  if (isIP(host)) {
    addresses = [{ address: host, family: isIP(host) }];
  } else {
    try {
      addresses = await abortable(lookup(host), signal);
    } catch {
      throw mockErrors.schemaUrlUnreachable(host);
    }
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw mockErrors.schemaUrlBlocked();
  }
}

async function readCapped(response: Response, maxBytes: number, url: URL): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw mockErrors.schemaTooLarge(url.href);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw mockErrors.schemaTooLarge(url.href);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Mid-body abort (timeout) or connection reset.
    throw mockErrors.schemaUrlUnreachable(url.hostname);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchSchemaUrl(
  rawUrl: string,
  deps: FetchSchemaUrlDeps = {},
): Promise<string> {
  const {
    lookup = defaultLookup,
    fetch: doFetch = defaultFetch,
    timeoutMs = SCHEMA_URL_TIMEOUT_MS,
    maxBytes = MAX_SCHEMA_BYTES,
    maxRedirects = SCHEMA_URL_MAX_REDIRECTS,
  } = deps;
  let url = parseHttpsUrl(rawUrl);
  // One budget for the whole chain: DNS, every hop, and the body. Owned timer
  // rather than AbortSignal.timeout(): Bun 1.3 cancels that signal's timer once
  // its last abort listener is removed (abortable() does exactly that after
  // DNS), so a slow server would never time out.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    timeoutMs,
  );
  const { signal } = controller;

  try {
    for (let hop = 0; ; hop++) {
      await assertPublicHost(url, lookup, signal);
      let response: Response;
      try {
        response = await doFetch(url.href, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: { accept: "application/json, application/yaml, text/yaml, */*;q=0.5" },
        });
      } catch {
        throw mockErrors.schemaUrlUnreachable(url.hostname);
      }

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        if (hop >= maxRedirects) throw mockErrors.schemaUrlHttpStatus(response.status);
        url = parseHttpsUrl(new URL(location, url).href);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw mockErrors.schemaUrlHttpStatus(response.status);
      }
      return await readCapped(response, maxBytes, url);
    }
  } finally {
    clearTimeout(timer);
  }
}
