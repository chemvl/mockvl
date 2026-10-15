import "../setup";
import { describe, expect, test } from "bun:test";
import { AppError } from "@/lib/errors";
import {
  type FetchFn,
  fetchSchemaUrl,
  isBlockedAddress,
  type LookupFn,
} from "@/modules/mocks/import/fetch-url";

async function errorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

function lookupFrom(table: Record<string, string[]>): LookupFn {
  return async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
}

function fetchFrom(
  routes: Record<string, () => Response>,
  calls: { url: string; init: RequestInit }[],
): FetchFn {
  return async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  };
}

const PUBLIC = ["93.184.216.34"];

describe("isBlockedAddress", () => {
  test.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "febf::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "0:0:0:0:0:ffff:c0a8:0101",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  test.each([
    "93.184.216.34",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "192.169.0.1",
    "2606:4700:4700::1111",
    "::ffff:93.184.216.34",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("fetchSchemaUrl", () => {
  test("downloads a public https URL with redirect: manual", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const text = await fetchSchemaUrl("https://specs.test/openapi.json", {
      lookup: lookupFrom({ "specs.test": PUBLIC }),
      fetch: fetchFrom({ "https://specs.test/openapi.json": () => new Response("{}") }, calls),
    });
    expect(text).toBe("{}");
    expect(calls[0]?.init.redirect).toBe("manual");
  });

  test.each([
    "http://specs.test/a.json",
    "ftp://specs.test/a",
    "specs.test/a.json",
    "not a url",
  ])("rejects %s as SCHEMA_URL_INVALID without fetching", async (url) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const error = await errorOf(
      fetchSchemaUrl(url, { lookup: lookupFrom({}), fetch: fetchFrom({}, calls) }),
    );
    expect(error.code).toBe("SCHEMA_URL_INVALID");
    expect(error.message).toBe("Enter a full URL starting with https://.");
    expect(calls).toEqual([]);
  });

  test("blocks a host if ANY resolved address is private", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const error = await errorOf(
      fetchSchemaUrl("https://mixed.test/a.json", {
        lookup: lookupFrom({ "mixed.test": ["93.184.216.34", "10.0.0.5"] }),
        fetch: fetchFrom({}, calls),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_BLOCKED");
    expect(error.message).toBe(
      "This URL points to a private network. Use a publicly reachable URL.",
    );
    expect(calls).toEqual([]);
  });

  test.each([
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://[::ffff:10.0.0.1]/a",
    "https://2130706433/a",
  ])("blocks IP-literal URL %s without DNS", async (url) => {
    const error = await errorOf(
      fetchSchemaUrl(url, { lookup: lookupFrom({}), fetch: fetchFrom({}, []) }),
    );
    expect(error.code).toBe("SCHEMA_URL_BLOCKED");
  });

  test("re-validates every redirect hop", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const error = await errorOf(
      fetchSchemaUrl("https://public.test/a.json", {
        lookup: lookupFrom({ "public.test": PUBLIC, "internal.test": ["192.168.0.10"] }),
        fetch: fetchFrom(
          {
            "https://public.test/a.json": () =>
              new Response(null, { status: 302, headers: { location: "https://internal.test/x" } }),
          },
          calls,
        ),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_BLOCKED");
    expect(calls.map((call) => call.url)).toEqual(["https://public.test/a.json"]);
  });

  test("follows relative redirects to a public host", async () => {
    const text = await fetchSchemaUrl("https://public.test/a.json", {
      lookup: lookupFrom({ "public.test": PUBLIC }),
      fetch: fetchFrom(
        {
          "https://public.test/a.json": () =>
            new Response(null, { status: 301, headers: { location: "/v2/a.json" } }),
          "https://public.test/v2/a.json": () => new Response("openapi: 3.0.0"),
        },
        [],
      ),
    });
    expect(text).toBe("openapi: 3.0.0");
  });

  test("a redirect to http:// is SCHEMA_URL_INVALID", async () => {
    const error = await errorOf(
      fetchSchemaUrl("https://public.test/a.json", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        fetch: fetchFrom(
          {
            "https://public.test/a.json": () =>
              new Response(null, { status: 302, headers: { location: "http://public.test/a" } }),
          },
          [],
        ),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_INVALID");
  });

  test("stops after 3 redirects", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const loop = () =>
      new Response(null, { status: 302, headers: { location: "https://public.test/loop" } });
    const error = await errorOf(
      fetchSchemaUrl("https://public.test/loop", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        fetch: fetchFrom({ "https://public.test/loop": loop }, calls),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_UNREACHABLE");
    expect(error.message).toBe(
      "Couldn't download the schema (HTTP 302). Check the URL and try again.",
    );
    expect(calls).toHaveLength(4);
  });

  test("non-2xx is SCHEMA_URL_UNREACHABLE with the status", async () => {
    const error = await errorOf(
      fetchSchemaUrl("https://public.test/missing.json", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        fetch: fetchFrom(
          { "https://public.test/missing.json": () => new Response("nope", { status: 404 }) },
          [],
        ),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_UNREACHABLE");
    expect(error.message).toBe(
      "Couldn't download the schema (HTTP 404). Check the URL and try again.",
    );
  });

  test("DNS and network failures name the host", async () => {
    const dns = await errorOf(
      fetchSchemaUrl("https://nowhere.test/a", {
        lookup: lookupFrom({}),
        fetch: fetchFrom({}, []),
      }),
    );
    expect(dns.message).toBe("Couldn't reach nowhere.test. Check the URL and try again.");
    const network = await errorOf(
      fetchSchemaUrl("https://public.test/a", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );
    expect(network.code).toBe("SCHEMA_URL_UNREACHABLE");
    expect(network.message).toBe("Couldn't reach public.test. Check the URL and try again.");
  });

  test("times out", async () => {
    const error = await errorOf(
      fetchSchemaUrl("https://slow.test/a", {
        lookup: lookupFrom({ "slow.test": PUBLIC }),
        timeoutMs: 20,
        fetch: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      }),
    );
    expect(error.code).toBe("SCHEMA_URL_UNREACHABLE");
    expect(error.message).toBe("Couldn't reach slow.test. Check the URL and try again.");
  });

  test("caps the streamed body and the declared content-length", async () => {
    const streamed = await errorOf(
      fetchSchemaUrl("https://public.test/big", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        maxBytes: 10,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("123456"));
                controller.enqueue(new TextEncoder().encode("789012"));
                controller.close();
              },
            }),
          ),
      }),
    );
    expect(streamed.code).toBe("SCHEMA_TOO_LARGE");
    expect(streamed.message).toBe("https://public.test/big is larger than 5 MB.");

    const declared = await errorOf(
      fetchSchemaUrl("https://public.test/big", {
        lookup: lookupFrom({ "public.test": PUBLIC }),
        maxBytes: 10,
        fetch: async () => new Response("x", { headers: { "content-length": "11" } }),
      }),
    );
    expect(declared.code).toBe("SCHEMA_TOO_LARGE");
  });
});
