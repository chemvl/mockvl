import { Marked } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

export interface TocEntry {
  depth: 2 | 3;
  id: string;
  text: string;
}

export interface RenderedPage {
  html: string;
  toc: TocEntry[];
  /** Plain-text body used for the search index. */
  text: string;
}

const SHIKI_LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "bash",
  "json",
  "sql",
  "yaml",
  "http",
  "dart",
  "diff",
];
const FALLBACK_LANG = "text";

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: SHIKI_LANGS,
  });
  return highlighterPromise;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Render one markdown body to HTML plus its table of contents and plain text. */
export async function renderMarkdown(body: string): Promise<RenderedPage> {
  const highlighter = await getHighlighter();
  const toc: TocEntry[] = [];
  const usedIds = new Set<string>();

  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        let id = slugify(inner);
        while (usedIds.has(id)) id = `${id}-x`;
        usedIds.add(id);
        if (depth === 2 || depth === 3) {
          toc.push({ depth, id, text: stripHtml(inner) });
        }
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-label="Link to this section">#</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language =
          lang && highlighter.getLoadedLanguages().includes(lang) ? lang : FALLBACK_LANG;
        const highlighted = highlighter.codeToHtml(text, {
          lang: language,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
        return `<div class="code-block" data-lang="${lang ?? ""}">${highlighted}</div>\n`;
      },
    },
  });

  const html = await marked.parse(body);
  const searchableHtml = html.replace(/<a class="anchor"[^>]*>#<\/a>/g, "");
  return { html, toc, text: stripHtml(searchableHtml) };
}
