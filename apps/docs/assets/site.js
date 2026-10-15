// Vanilla site behavior: theme toggle, mobile sidebar, Cmd/Ctrl+K search.

(() => {
  const root = document.documentElement;

  // Theme
  const themeToggle = document.querySelector(".theme-toggle");
  themeToggle?.addEventListener("click", () => {
    const current =
      root.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    localStorage.setItem("docs-theme", next);
  });
  if (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches) {
    root.dataset.theme = "dark";
  }

  // Mobile sidebar
  const sidebarToggle = document.querySelector(".sidebar-toggle");
  sidebarToggle?.addEventListener("click", () => {
    const open = document.body.classList.toggle("sidebar-open");
    sidebarToggle.setAttribute("aria-expanded", String(open));
  });

  // Sidebar scroll position survives navigation. The document restores the
  // offset inline before paint; here we keep the stored value current.
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) {
    let savePending = false;
    sidebar.addEventListener(
      "scroll",
      () => {
        if (savePending) return;
        savePending = true;
        requestAnimationFrame(() => {
          savePending = false;
          sessionStorage.setItem("docs-sidebar-scroll", String(sidebar.scrollTop));
        });
      },
      { passive: true },
    );

    // Arriving from search, a pager link, or an external URL can land on a page
    // whose nav entry sits outside the restored window — centre it instead.
    const currentLink = sidebar.querySelector('a[aria-current="page"]');
    if (currentLink) {
      const view = sidebar.getBoundingClientRect();
      const link = currentLink.getBoundingClientRect();
      if (link.top < view.top || link.bottom > view.bottom) {
        sidebar.scrollTop += link.top - view.top - (view.height - link.height) / 2;
      }
    }
  }

  // Copy buttons on code blocks
  for (const block of document.querySelectorAll(".code-block")) {
    const button = document.createElement("button");
    button.className = "copy-button";
    button.textContent = "copy";
    button.setAttribute("aria-label", "Copy code to clipboard");
    button.addEventListener("click", async () => {
      const code = block.querySelector("code")?.textContent ?? "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "copied";
      } catch {
        button.textContent = "failed";
      }
      setTimeout(() => {
        button.textContent = "copy";
      }, 1500);
    });
    block.append(button);
  }

  // TOC scrollspy
  const tocLinks = [...document.querySelectorAll(".toc a")];
  if (tocLinks.length > 0) {
    const targets = tocLinks
      .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
      .filter(Boolean);
    const linkFor = (id) =>
      tocLinks.find((link) => link.hash === `#${CSS.escape(id)}` || link.hash === `#${id}`);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          for (const link of tocLinks) link.removeAttribute("data-active");
          linkFor(entry.target.id)?.setAttribute("data-active", "");
        }
      },
      { rootMargin: "-10% 0px -75% 0px" },
    );
    for (const target of targets) observer.observe(target);
  }

  // Search
  const modal = document.querySelector(".search-modal");
  const input = document.querySelector(".search-input");
  const results = document.querySelector(".search-results");
  if (!modal || !input || !results) return;

  let index = null;
  let selected = -1;

  async function openSearch() {
    modal.hidden = false;
    input.value = "";
    results.replaceChildren();
    selected = -1;
    input.focus();
    if (!index) {
      try {
        index = await (await fetch("/search-index.json")).json();
      } catch {
        index = [];
      }
      // The index may arrive after the user has started typing.
      renderResults(input.value);
    }
  }

  function closeSearch() {
    modal.hidden = true;
  }

  function score(doc, query) {
    const q = query.toLowerCase();
    if (doc.title.toLowerCase().includes(q)) return 3;
    if (doc.headings.some((h) => h.toLowerCase().includes(q))) return 2;
    if (doc.text.toLowerCase().includes(q)) return 1;
    return 0;
  }

  function renderResults(query) {
    selected = -1;
    if (!query.trim() || !index) {
      results.replaceChildren();
      return;
    }
    const matches = index
      .map((doc) => ({ doc, s: score(doc, query) }))
      .filter((m) => m.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 10);
    results.replaceChildren(
      ...matches.map(({ doc }) => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = doc.url;
        const section = document.createElement("span");
        section.className = "search-result-section";
        section.textContent = doc.section;
        link.append(section, doc.title);
        li.append(link);
        return li;
      }),
    );
  }

  function moveSelection(delta) {
    const items = [...results.querySelectorAll("li")];
    if (items.length === 0) return;
    selected = (selected + delta + items.length) % items.length;
    items.forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === selected));
    });
    items[selected]?.scrollIntoView({ block: "nearest" });
  }

  document.querySelector(".search-button")?.addEventListener("click", openSearch);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      modal.hidden ? openSearch() : closeSearch();
    } else if (!modal.hidden && event.key === "Escape") {
      closeSearch();
    } else if (!modal.hidden && event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (!modal.hidden && event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    } else if (!modal.hidden && event.key === "Enter") {
      const active = results.querySelector('li[aria-selected="true"] a');
      if (active) location.href = active.href;
    }
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeSearch();
  });
  input.addEventListener("input", () => renderResults(input.value));
})();
