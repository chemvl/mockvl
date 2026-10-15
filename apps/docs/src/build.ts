import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { flattenPages, loadContent, type Page } from "./content";
import { renderHome, renderPage } from "./layout";
import { renderMarkdown, type TocEntry } from "./markdown";
import { buildSearchIndex } from "./search";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

/** Site-absolute paths that are valid link targets besides content pages. */
const EXTRA_LINK_TARGETS = new Set(["/", "/search-index.json"]);

function collectDeadLinks(pageUrl: string, html: string, validUrls: Set<string>): string[] {
  const dead: string[] = [];
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1] ?? "";
    if (!href.startsWith("/")) continue; // external, mailto, #anchor
    const path = href.split("#")[0] ?? "";
    if (path === "" || path.startsWith("/assets/")) continue;
    const normalized = path.endsWith("/") || path.includes(".") ? path : `${path}/`;
    if (!validUrls.has(normalized) && !EXTRA_LINK_TARGETS.has(normalized)) {
      dead.push(`${pageUrl} → ${href}`);
    }
  }
  return dead;
}

export async function build(options: { dev?: boolean } = {}): Promise<void> {
  const dev = options.dev ?? false;
  const started = performance.now();

  const sections = await loadContent();
  const pages = flattenPages(sections);
  if (pages.length === 0) throw new Error("No content pages found under content/");

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const validUrls = new Set(pages.map((page) => page.url));
  const deadLinks: string[] = [];
  const rendered = new Map<Page, { toc: TocEntry[]; text: string }>();
  for (const [index, page] of pages.entries()) {
    const { html, toc, text } = await renderMarkdown(page.body);
    rendered.set(page, { toc, text });
    deadLinks.push(...collectDeadLinks(page.url, html, validUrls));
    const pageHtml = renderPage({
      sections,
      page,
      contentHtml: html,
      toc,
      prev: pages[index - 1],
      next: pages[index + 1],
      dev,
    });
    const outDir = join(DIST, page.sectionSlug, page.slug);
    await mkdir(outDir, { recursive: true });
    await Bun.write(join(outDir, "index.html"), pageHtml);
  }

  if (deadLinks.length > 0) {
    throw new Error(`Dead internal links:\n  ${deadLinks.join("\n  ")}`);
  }

  await Bun.write(join(DIST, "index.html"), renderHome(sections, dev));
  await Bun.write(
    join(DIST, "search-index.json"),
    JSON.stringify(buildSearchIndex(sections, rendered)),
  );
  await cp(join(ROOT, "assets"), join(DIST, "assets"), { recursive: true });

  const ms = Math.round(performance.now() - started);
  console.log(`[docs] built ${pages.length} pages in ${ms}ms`);
}

if (import.meta.main) {
  await build();
}
