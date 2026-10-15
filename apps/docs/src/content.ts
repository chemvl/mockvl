import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { site } from "../site.config";

export interface PageMeta {
  title: string;
  description: string;
  order: number;
}

export interface Page {
  sectionSlug: string;
  slug: string;
  /** Site-absolute URL with trailing slash, e.g. /getting-started/setup/ */
  url: string;
  meta: PageMeta;
  /** Raw markdown body (frontmatter stripped). */
  body: string;
}

export interface Section {
  slug: string;
  label: string;
  pages: Page[];
}

const CONTENT_DIR = join(import.meta.dir, "..", "content");

/**
 * Frontmatter is deliberately flat `key: value` lines between `---` fences —
 * no YAML nesting, no quoting rules. Keep authoring friction at zero.
 */
export function parseFrontmatter(raw: string, file: string): { meta: PageMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error(`${file}: missing frontmatter block (--- title/description/order ---)`);
  }
  const fields: Record<string, string> = {};
  for (const line of match[1]?.split(/\r?\n/) ?? []) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      throw new Error(`${file}: frontmatter line is not "key: value": ${line}`);
    }
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  const title = fields.title;
  if (!title) throw new Error(`${file}: frontmatter must include a title`);
  const order = Number(fields.order ?? "0");
  if (Number.isNaN(order)) throw new Error(`${file}: frontmatter order must be a number`);
  return {
    meta: { title, description: fields.description ?? "", order },
    body: raw.slice(match[0].length),
  };
}

/** Scan content/, returning only sections (in config order) that have pages. */
export async function loadContent(): Promise<Section[]> {
  const sections: Section[] = [];
  const folders = new Set(
    (await readdir(CONTENT_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );

  for (const folder of folders) {
    if (!site.sections.some((section) => section.slug === folder)) {
      console.warn(`[docs] content/${folder}/ is not listed in site.config.ts — skipped`);
    }
  }

  for (const { slug, label } of site.sections) {
    if (!folders.has(slug)) continue;
    const files = (await readdir(join(CONTENT_DIR, slug))).filter((name) => name.endsWith(".md"));
    const pages: Page[] = [];
    for (const file of files) {
      const raw = await Bun.file(join(CONTENT_DIR, slug, file)).text();
      const { meta, body } = parseFrontmatter(raw, `content/${slug}/${file}`);
      const pageSlug = file.replace(/\.md$/, "");
      pages.push({ sectionSlug: slug, slug: pageSlug, url: `/${slug}/${pageSlug}/`, meta, body });
    }
    pages.sort((a, b) => a.meta.order - b.meta.order || a.meta.title.localeCompare(b.meta.title));
    if (pages.length > 0) sections.push({ slug, label, pages });
  }
  return sections;
}

/** Flat reading order across sections — used for prev/next links. */
export function flattenPages(sections: Section[]): Page[] {
  return sections.flatMap((section) => section.pages);
}
