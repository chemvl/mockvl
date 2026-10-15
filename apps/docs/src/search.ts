import type { Page, Section } from "./content";
import type { TocEntry } from "./markdown";

export interface SearchDoc {
  title: string;
  section: string;
  url: string;
  headings: string[];
  /** Truncated plain-text body — enough for substring matching + preview. */
  text: string;
}

const TEXT_LIMIT = 2000;

export function buildSearchIndex(
  sections: Section[],
  rendered: Map<Page, { toc: TocEntry[]; text: string }>,
): SearchDoc[] {
  return sections.flatMap((section) =>
    section.pages.map((page) => {
      const extras = rendered.get(page);
      return {
        title: page.meta.title,
        section: section.label,
        url: page.url,
        headings: extras?.toc.map((entry) => entry.text) ?? [],
        text: (extras?.text ?? "").slice(0, TEXT_LIMIT),
      };
    }),
  );
}
