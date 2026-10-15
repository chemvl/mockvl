// The only manifest: site metadata + section order/labels.
// Adding a section = one folder under content/ + one line here.
// Adding a page = one .md file with frontmatter (title, description, order).

export interface SectionConfig {
  slug: string;
  label: string;
}

export const site = {
  title: "Mockyard",
  tagline: "Developer documentation for the Mockyard API",
  sections: [
    { slug: "getting-started", label: "Getting Started" },
    { slug: "architecture", label: "Architecture & Conventions" },
    { slug: "guides", label: "Backend Guides" },
    { slug: "generators", label: "Generators" },
    { slug: "admin", label: "Admin" },
    { slug: "consumers", label: "API Consumers" },
    { slug: "reference", label: "Reference" },
    { slug: "decisions", label: "Decisions & History" },
  ] satisfies SectionConfig[],
};
