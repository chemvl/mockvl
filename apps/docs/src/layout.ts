import { site } from "../site.config";
import type { Page, Section } from "./content";
import type { TocEntry } from "./markdown";

export interface LayoutInput {
  sections: Section[];
  page: Page;
  contentHtml: string;
  toc: TocEntry[];
  prev: Page | undefined;
  next: Page | undefined;
  dev: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSidebar(sections: Section[], current: Page): string {
  return sections
    .map(({ slug, label, pages }) => {
      const items = pages
        .map((page) => {
          const active = page.url === current.url ? ' aria-current="page"' : "";
          return `<li><a href="${page.url}"${active}>${escapeHtml(page.meta.title)}</a></li>`;
        })
        .join("\n");
      return `<section class="nav-section">\n<h2 title="content/${slug}/">${escapeHtml(label)}</h2>\n<ul>\n${items}\n</ul>\n</section>`;
    })
    .join("\n");
}

function renderToc(toc: TocEntry[]): string {
  if (toc.length === 0) return "";
  const items = toc
    .map(
      (entry) =>
        `<li class="toc-depth-${entry.depth}"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`,
    )
    .join("\n");
  return `<nav class="toc" aria-label="On this page">\n<h2>On this page</h2>\n<ul>\n${items}\n</ul>\n</nav>`;
}

function renderPagerLink(page: Page | undefined, rel: "prev" | "next"): string {
  if (!page) return "<span></span>";
  const label = rel === "prev" ? "Previous" : "Next";
  return `<a class="pager-${rel}" href="${page.url}" rel="${rel}"><span class="pager-label">${label}</span><span class="pager-title">${escapeHtml(page.meta.title)}</span></a>`;
}

// Runs inline, right after the sidebar markup, so the offset is applied before
// the first paint. Deferred scripts can land after paint, which shows a jump.
const SIDEBAR_SCROLL_RESTORE_SCRIPT = `<script>
(() => {
  const stored = sessionStorage.getItem("docs-sidebar-scroll");
  const sidebar = document.querySelector(".sidebar");
  if (stored && sidebar) sidebar.scrollTop = Number(stored);
})();
</script>`;

const DEV_RELOAD_SCRIPT = `<script>
new EventSource("/__reload").addEventListener("reload", () => location.reload());
</script>`;

export function renderPage(input: LayoutInput): string {
  const { sections, page, contentHtml, toc, prev, next, dev } = input;
  const sectionLabel = sections.find((s) => s.slug === page.sectionSlug)?.label ?? page.sectionSlug;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.meta.title)} — ${escapeHtml(site.title)}</title>
<meta name="description" content="${escapeHtml(page.meta.description)}" />
<link rel="stylesheet" href="/assets/site.css" />
<script>
(() => {
  const stored = localStorage.getItem("docs-theme");
  if (stored) document.documentElement.dataset.theme = stored;
})();
</script>
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<header class="topbar">
  <button class="sidebar-toggle" aria-label="Toggle navigation" aria-expanded="false">☰</button>
  <a class="brand" href="/">${escapeHtml(site.title)}</a>
  <div class="topbar-actions">
    <button class="search-button" aria-label="Search documentation"><span>Search</span><kbd>⌘K</kbd></button>
    <button class="theme-toggle" aria-label="Toggle color theme"></button>
  </div>
</header>
<div class="shell">
  <nav class="sidebar" aria-label="Documentation">
${renderSidebar(sections, page)}
  </nav>
  ${SIDEBAR_SCROLL_RESTORE_SCRIPT}
  <main id="content">
    <article class="doc">
      <p class="doc-path"><span class="doc-path-section">${escapeHtml(sectionLabel)}</span><code>/${page.sectionSlug}/${page.slug}/</code></p>
      <h1>${escapeHtml(page.meta.title)}</h1>
${contentHtml}
      <nav class="pager" aria-label="Adjacent pages">
${renderPagerLink(prev, "prev")}
${renderPagerLink(next, "next")}
      </nav>
    </article>
  </main>
${renderToc(toc)}
</div>
<div class="search-modal" hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search">
    <input class="search-input" type="search" placeholder="Search docs…" autocomplete="off" />
    <ul class="search-results"></ul>
  </div>
</div>
<script src="/assets/site.js" defer></script>
${dev ? DEV_RELOAD_SCRIPT : ""}
</body>
</html>
`;
}

export function renderHome(sections: Section[], dev: boolean): string {
  const cards = sections
    .map((section) => {
      const first = section.pages[0];
      if (!first) return "";
      const links = section.pages
        .slice(0, 4)
        .map((page) => `<li><a href="${page.url}">${escapeHtml(page.meta.title)}</a></li>`)
        .join("\n");
      return `<section class="home-card">
<h2><a href="${first.url}">${escapeHtml(section.label)}</a></h2>
<ul>${links}</ul>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(site.title)} — Documentation</title>
<meta name="description" content="${escapeHtml(site.tagline)}" />
<link rel="stylesheet" href="/assets/site.css" />
<script>
(() => {
  const stored = localStorage.getItem("docs-theme");
  if (stored) document.documentElement.dataset.theme = stored;
})();
</script>
</head>
<body class="home">
<header class="topbar">
  <a class="brand" href="/">${escapeHtml(site.title)}</a>
  <div class="topbar-actions">
    <button class="search-button" aria-label="Search documentation"><span>Search</span><kbd>⌘K</kbd></button>
    <button class="theme-toggle" aria-label="Toggle color theme"></button>
  </div>
</header>
<main class="home-main">
  <section class="hero">
    <div class="hero-copy">
      <h1>${escapeHtml(site.title)}</h1>
      <p class="hero-tagline">${escapeHtml(site.tagline)}</p>
      <div class="hero-actions">
        <a class="hero-cta" href="/getting-started/introduction/">Get started</a>
        <a class="hero-alt" href="/architecture/conventions/">Read the conventions</a>
      </div>
    </div>
    <figure class="hero-envelope" aria-label="The response envelope contract">
      <figcaption>Every response, one contract</figcaption>
      <pre><code>{
  <span class="tok-key">"data"</span>: [ <span class="tok-comment">/* your resources */</span> ],
  <span class="tok-key">"meta"</span>: { <span class="tok-key">"page"</span>: <span class="tok-num">1</span>, <span class="tok-key">"pageSize"</span>: <span class="tok-num">20</span>, <span class="tok-key">"total"</span>: <span class="tok-num">124</span> }
}</code></pre>
    </figure>
  </section>
  <div class="home-grid">
${cards}
  </div>
</main>
<div class="search-modal" hidden>
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search">
    <input class="search-input" type="search" placeholder="Search docs…" autocomplete="off" />
    <ul class="search-results"></ul>
  </div>
</div>
<script src="/assets/site.js" defer></script>
${dev ? DEV_RELOAD_SCRIPT : ""}
</body>
</html>
`;
}
