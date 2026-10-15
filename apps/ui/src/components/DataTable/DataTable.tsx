import type { CSSProperties, ReactNode } from "react";
import styles from "./DataTable.module.scss";

export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  /** CSS grid track, e.g. "minmax(0,2.4fr)" or "96px". */
  width: string;
  render: (row: T) => ReactNode;
  /** Hidden below 900px (§6). */
  hideNarrow?: boolean;
  align?: "start" | "end";
};

type DataTableProps<T> = {
  columns: DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  showHeader?: boolean;
};

type GridVars = CSSProperties & Record<`--${string}`, string>;

function cellClass(column: { hideNarrow?: boolean; align?: "start" | "end" }): string {
  return [styles.cell, column.hideNarrow ? styles.hideNarrow : "", column.align === "end" ? styles.end : ""].join(" ");
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, showHeader = true }: DataTableProps<T>) {
  const vars: GridVars = {
    "--cols": columns.map((c) => c.width).join(" "),
    "--cols-narrow": columns
      .filter((c) => !c.hideNarrow)
      .map((c) => c.width)
      .join(" "),
  };
  return (
    <div className={styles.table} style={vars}>
      {showHeader && (
        <div className={styles.head}>
          {columns.map((column) => (
            <span key={column.key} className={cellClass(column)}>
              {column.header}
            </span>
          ))}
        </div>
      )}
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          className={`${styles.row} ${onRowClick ? styles.clickable : ""}`}
          role={onRowClick ? "button" : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          onKeyDown={
            onRowClick
              ? (event) => {
                  if (event.key === "Enter") onRowClick(row);
                }
              : undefined
          }
        >
          {columns.map((column) => (
            <div key={column.key} className={cellClass(column)}>
              {column.render(row)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
