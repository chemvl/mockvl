// Pure HTML helpers shared by the editor and the generic list cells. No
// tiptap imports — keep this file cheap to import and trivial to unit test.

const MEDIA_TAG_RE = /<(img|table|hr|pre|video|iframe)\b/i;
const TAG_RE = /<[^>]*>/g;

const DEFAULT_EXCERPT_LENGTH = 80;

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

// The single definition of "empty" rich text: tiptap always keeps at least an
// empty paragraph ('<p></p>'), which must count as no content so required
// validation and the ''→null submit conversion behave like a plain textarea.
export function normalizeEditorHtml(html: string): string {
  if (!html) return '';
  if (MEDIA_TAG_RE.test(html)) return html;
  const text = decodeBasicEntities(html.replace(TAG_RE, '')).trim();
  return text === '' ? '' : html;
}

// Plain-text preview for table cells. Display-only over already-sanitized
// HTML, so regex stripping is fine here — it is never a security measure.
export function htmlToExcerpt(
  html: string,
  maxLength = DEFAULT_EXCERPT_LENGTH,
): string {
  const text = decodeBasicEntities(html.replace(TAG_RE, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
