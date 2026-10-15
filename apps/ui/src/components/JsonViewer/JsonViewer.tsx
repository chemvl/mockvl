import { useState } from "react";
import styles from "./JsonViewer.module.scss";

// Levels open on first render; deeper containers start collapsed.
const OPEN_DEPTH = 2;

type Expansion = "default" | "all" | "none";

type NodeProps = {
  name: string | null;
  value: unknown;
  depth: number;
  last: boolean;
  expansion: Expansion;
};

function Key({ name }: { name: string | null }) {
  if (name === null) return null;
  return (
    <>
      <span className={styles.key}>{JSON.stringify(name)}</span>
      <span className={styles.punct}>: </span>
    </>
  );
}

function Primitive({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className={styles.string}>{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className={styles.number}>{String(value)}</span>;
  if (typeof value === "boolean") return <span className={styles.literal}>{String(value)}</span>;
  return <span className={styles.literal}>null</span>;
}

function JsonNode({ name, value, depth, last, expansion }: NodeProps) {
  const isContainer = typeof value === "object" && value !== null;
  const [open, setOpen] = useState(expansion === "all" || (expansion === "default" && depth < OPEN_DEPTH));
  const comma = last ? null : <span className={styles.punct}>,</span>;

  if (!isContainer) {
    return (
      <div className={styles.line}>
        <span className={styles.gutter} />
        <Key name={name} />
        <Primitive value={value} />
        {comma}
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string | null, unknown][] = isArray
    ? value.map((item) => [null, item])
    : Object.entries(value as Record<string, unknown>);
  const [openBrace, closeBrace] = isArray ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div className={styles.line}>
        <span className={styles.gutter} />
        <Key name={name} />
        <span className={styles.punct}>{`${openBrace}${closeBrace}`}</span>
        {comma}
      </div>
    );
  }

  const noun = isArray ? "item" : "key";
  const count = `${entries.length} ${noun}${entries.length === 1 ? "" : "s"}`;
  return (
    <div>
      <div className={styles.line}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          onClick={() => setOpen(!open)}
        >
          {open ? "▾" : "▸"}
        </button>
        <Key name={name} />
        <span className={styles.punct}>{openBrace}</span>
        {!open && (
          <>
            <button type="button" className={styles.summary} onClick={() => setOpen(true)}>
              {count}
            </button>
            <span className={styles.punct}>{closeBrace}</span>
            {comma}
          </>
        )}
      </div>
      {open && (
        <>
          <div className={styles.children}>
            {entries.map(([key, item], index) => (
              <JsonNode
                key={key ?? index}
                name={key}
                value={item}
                depth={depth + 1}
                last={index === entries.length - 1}
                expansion={expansion}
              />
            ))}
          </div>
          <div className={styles.line}>
            <span className={styles.gutter} />
            <span className={styles.punct}>{closeBrace}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
}

/** Collapsible, syntax-colored view of a parsed JSON value. */
export function JsonViewer({ value }: { value: unknown }) {
  // Bumping the round remounts the tree so every node re-reads `expansion`.
  const [view, setView] = useState<{ expansion: Expansion; round: number }>({ expansion: "default", round: 0 });
  const expandable = typeof value === "object" && value !== null;
  return (
    <div className={styles.viewer}>
      {expandable && (
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.tool}
            onClick={() => setView({ expansion: "all", round: view.round + 1 })}
          >
            Expand all
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={() => setView({ expansion: "none", round: view.round + 1 })}
          >
            Collapse all
          </button>
        </div>
      )}
      <div className={styles.tree}>
        <JsonNode key={view.round} name={null} value={value} depth={0} last expansion={view.expansion} />
      </div>
    </div>
  );
}
