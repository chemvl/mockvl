import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button, TextInput } from "@/components/ds";
import { PlaceholderRows } from "@/components/Placeholder/PlaceholderRows";
import { WorkspaceTile } from "@/components/WorkspaceTile/WorkspaceTile";
import { CreateWorkspaceModal } from "@/features/workspaces/CreateWorkspaceModal";
import { canManageWorkspace, ROLE_LABELS } from "@/features/workspaces/permissions";
import type { Workspace } from "@/lib/api/types";
import { plural } from "@/lib/format";
import styles from "./WorkspaceSwitcher.module.scss";

/** Above this many workspaces the list scrolls and a search input appears. */
const SEARCH_THRESHOLD = 8;

type WorkspaceSwitcherProps = {
  workspaces: Workspace[];
  current: Workspace | null;
  status: "pending" | "error" | "success";
  onRetry: () => void;
};

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) : [];
}

export function WorkspaceSwitcher({ workspaces, current, status, onRetry }: WorkspaceSwitcherProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Set when the menu is opened from the keyboard: focus moves into it on mount.
  const focusOnOpen = useRef(false);

  const searchable = workspaces.length > SEARCH_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const visible =
    searchable && needle
      ? workspaces.filter(
          (workspace) => workspace.name.toLowerCase().includes(needle) || workspace.slug.includes(needle),
        )
      : workspaces;
  const showSettings = current !== null && canManageWorkspace(current.role);

  function show(fromKeyboard: boolean) {
    focusOnOpen.current = fromKeyboard;
    setQuery("");
    setOpen(true);
  }

  /** Closing with focus on the trigger, so modals opened next return focus there. */
  function closeToTrigger() {
    triggerRef.current?.focus();
    setOpen(false);
  }

  useLayoutEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const items = menuItems(menuRef.current);
    (items.find((item) => item.dataset.current === "true") ?? items[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    if (open) menuItems(menuRef.current)[0]?.focus();
    else show(true);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeToTrigger();
      return;
    }
    if (event.key === "Tab") {
      // Let the browser move focus on from the trigger.
      closeToTrigger();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = menuItems(menuRef.current);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // From the search input (index -1): ↓ goes to the first item, ↑ to the last.
    const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    items[next]?.focus();
  }

  let rows: ReactNode;
  if (status === "pending") rows = <PlaceholderRows count={3} />;
  else if (status === "error")
    rows = (
      <div className={styles.error}>
        Couldn't load workspaces.{" "}
        <Button variant="link" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  else if (visible.length === 0) rows = <div className={styles.error}>No matching workspaces.</div>;
  else
    rows = visible.map((workspace) => {
      const selected = workspace.id === current?.id;
      return (
        <button
          key={workspace.id}
          type="button"
          role="menuitem"
          className={`${styles.row} ${selected ? styles.rowCurrent : ""}`}
          aria-current={selected ? "true" : undefined}
          data-current={selected ? "true" : undefined}
          onClick={() => {
            closeToTrigger();
            navigate(`/${workspace.slug}`);
          }}
        >
          <WorkspaceTile name={workspace.name} size={28} />
          <span className={styles.rowText}>
            <span className={styles.rowName}>{workspace.name}</span>
            <span className={styles.rowMeta}>
              {ROLE_LABELS[workspace.role]} · {plural(workspace.mockCount, "mock")}
            </span>
          </span>
          {selected ? (
            <span className={styles.check} aria-hidden="true">
              ✓
            </span>
          ) : (
            <span />
          )}
        </button>
      );
    });

  return (
    <div ref={anchorRef} className={styles.anchor}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onTriggerKeyDown}
        // detail === 0: activated by Enter/Space rather than a pointer.
        onClick={(event) => (open ? setOpen(false) : show(event.detail === 0))}
      >
        <span className={styles.name}>{current?.name ?? "Workspaces"}</span>
        <span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Workspaces" className={styles.menu} onKeyDown={onMenuKeyDown}>
          <span className={styles.label}>Workspaces</span>
          {searchable && status === "success" && (
            <TextInput
              size="sm"
              value={query}
              placeholder="Search workspaces"
              aria-label="Search workspaces"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              style={{ width: "100%", marginBottom: 4 }}
            />
          )}
          <div className={`${styles.rows} ${searchable ? styles.rowsScroll : ""}`}>{rows}</div>
          <hr className={styles.divider} />
          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.itemStrong}`}
            onClick={() => {
              closeToTrigger();
              setCreateOpen(true);
            }}
          >
            Create workspace
          </button>
          {showSettings && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                closeToTrigger();
                navigate(`/${current.slug}/settings`);
              }}
            >
              Workspace settings
            </button>
          )}
        </div>
      )}
      {createOpen && <CreateWorkspaceModal onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
