import sanitizeHtml from "sanitize-html";
import type { ResourceRow } from "@/admin/registry/registry";

// Server-side sanitizer for "richtext" fields (HTML strings produced by the
// admin tiptap editor). This is THE security boundary — the editor's own
// normalization is UX only, and its raw-HTML source mode accepts anything.
//
// The allowlist mirrors exactly what the editor can emit. If the editor gains
// an extension (apps/admin src/components/RichTextEditor/RichTextEditorContent.tsx),
// extend this list in the same change — and nothing more: no style attributes,
// no event handlers, no data:/javascript: URLs.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "strong",
    "b",
    "em",
    "i",
    "s",
    "del",
    "u",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "colgroup",
    "col",
    // Syntax-highlight token wrappers inside code blocks.
    "span",
  ],
  allowedAttributes: {
    a: ["href", "rel", "target"],
    img: ["src", "alt", "title", "width", "height"],
    th: ["colspan", "rowspan", "colwidth"],
    td: ["colspan", "rowspan", "colwidth"],
    col: ["span"],
    code: ["class"],
    span: ["class"],
  },
  // Class allowlists keep code/span from becoming a styling side channel.
  allowedClasses: {
    code: [/^language-[\w-]+$/],
    span: [/^hljs[\w-]*$/],
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Images must be plain web URLs — blocks data: and javascript: sources.
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    // Stored links may be rendered on public surfaces later — harden them
    // now: force rel, and allow no target other than _blank.
    a: (tagName, attribs) => {
      const { target, ...rest } = attribs;
      return {
        tagName,
        attribs: {
          ...rest,
          rel: "noopener noreferrer nofollow",
          ...(target === "_blank" ? { target } : {}),
        },
      };
    },
  },
};

export function sanitizeRichTextHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/**
 * Returns a copy of `input` with the named fields sanitized. Skips fields
 * that are absent (partial updates) or non-strings (null clears a nullable
 * column and must pass through untouched).
 */
export function sanitizeRichTextFields(
  input: ResourceRow,
  fieldNames: readonly string[],
): ResourceRow {
  const output = { ...input };
  for (const name of fieldNames) {
    const value = output[name];
    if (typeof value === "string") output[name] = sanitizeRichTextHtml(value);
  }
  return output;
}
