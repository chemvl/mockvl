import "../setup";

import { describe, expect, test } from "bun:test";
import { sanitizeRichTextFields, sanitizeRichTextHtml } from "@/lib/sanitize";

describe("sanitizeRichTextHtml — attack vectors", () => {
  test("strips script tags entirely", () => {
    expect(sanitizeRichTextHtml("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
  });

  test("drops event handler attributes", () => {
    expect(sanitizeRichTextHtml('<p onclick="alert(1)">x</p>')).toBe("<p>x</p>");
    expect(sanitizeRichTextHtml('<img src="https://a.example/x.png" onerror="alert(1)">')).toBe(
      '<img src="https://a.example/x.png" />',
    );
  });

  test("drops javascript: hrefs but keeps the link text", () => {
    const output = sanitizeRichTextHtml('<a href="javascript:alert(1)">y</a>');
    expect(output).not.toContain("javascript:");
    expect(output).toContain("y");
  });

  test("drops data: image sources", () => {
    const output = sanitizeRichTextHtml('<img src="data:image/png;base64,AAAA">');
    expect(output).not.toContain("data:");
  });

  test("drops style attributes and iframes", () => {
    expect(sanitizeRichTextHtml('<p style="color:red">x</p>')).toBe("<p>x</p>");
    expect(sanitizeRichTextHtml('<iframe src="https://evil.example"></iframe>')).toBe("");
  });

  test("drops protocol-relative URLs", () => {
    expect(sanitizeRichTextHtml('<img src="//evil.example/x.png">')).toBe("<img />");
  });

  test("drops classes outside the language-*/hljs allowlists", () => {
    const output = sanitizeRichTextHtml(
      '<pre><code class="language-ts evil">const</code></pre><span class="sneaky">x</span>',
    );
    expect(output).toContain('class="language-ts"');
    expect(output).not.toContain("evil");
    expect(output).not.toContain("sneaky");
  });
});

describe("sanitizeRichTextHtml — legitimate editor output survives", () => {
  test("headings, lists, blockquote, hr", () => {
    const input =
      "<h2>Title</h2><ul><li>a</li></ul><ol><li>b</li></ol><blockquote><p>q</p></blockquote><hr />";
    expect(sanitizeRichTextHtml(input)).toBe(input);
  });

  test("inline marks and code blocks with hljs spans", () => {
    const input =
      "<p><strong>b</strong> <em>i</em> <s>s</s> <u>u</u> <code>c</code></p>" +
      '<pre><code class="language-ts"><span class="hljs-keyword">const</span></code></pre>';
    expect(sanitizeRichTextHtml(input)).toBe(input);
  });

  test("tables with structural attributes", () => {
    const input =
      '<table><tbody><tr><th colspan="2" colwidth="120">h</th></tr><tr><td rowspan="2">d</td></tr></tbody></table>';
    expect(sanitizeRichTextHtml(input)).toBe(input);
  });

  test("images keep src/alt/title/dimensions", () => {
    const input = '<img src="https://a.example/x.png" alt="x" title="t" width="10" height="20" />';
    expect(sanitizeRichTextHtml(input)).toBe(input);
  });

  test("links are hardened with rel and keep an explicit _blank target", () => {
    expect(sanitizeRichTextHtml('<a href="https://a.example">x</a>')).toBe(
      '<a href="https://a.example" rel="noopener noreferrer nofollow">x</a>',
    );
    expect(sanitizeRichTextHtml('<a href="https://a.example" target="_blank">x</a>')).toContain(
      'target="_blank"',
    );
    // A non-_blank target does not survive.
    expect(sanitizeRichTextHtml('<a href="https://a.example" target="parent">x</a>')).not.toContain(
      "target=",
    );
  });

  test("mailto links survive", () => {
    expect(sanitizeRichTextHtml('<a href="mailto:a@b.example">m</a>')).toContain(
      'href="mailto:a@b.example"',
    );
  });
});

describe("sanitizeRichTextFields", () => {
  test("sanitizes only the named string fields and returns a copy", () => {
    const input = {
      title: "<script>x</script>keep",
      content: "<p onclick='x'>hi</p>",
    };
    const output = sanitizeRichTextFields(input, ["content"]);
    expect(output).not.toBe(input);
    expect(output.title).toBe("<script>x</script>keep");
    expect(output.content).toBe("<p>hi</p>");
    expect(input.content).toBe("<p onclick='x'>hi</p>");
  });

  test("passes null through untouched (clearing a nullable column)", () => {
    expect(sanitizeRichTextFields({ content: null }, ["content"])).toEqual({ content: null });
  });

  test("skips absent fields (partial updates)", () => {
    expect(sanitizeRichTextFields({ title: "t" }, ["content"])).toEqual({ title: "t" });
  });
});
