import type { TabItem } from "@/components/ds";
import type { SchemaInspection, SchemaSource } from "@/lib/api/types";

export type SourceTab = "file" | "url";

export type FileState =
  | { status: "empty" }
  | { status: "parsing"; filename: string }
  | { status: "ready"; filename: string; content: string; inspection: SchemaInspection };

// Mirrors the API's MAX_SCHEMA_BYTES; checked before upload for a fast error.
export const MAX_SCHEMA_BYTES = 5 * 1024 * 1024;

export const SOURCE_TABS: ReadonlyArray<TabItem<SourceTab>> = [
  { value: "file", label: "Upload file" },
  { value: "url", label: "From URL" },
];

/** File/URL plus the New mock page's blank (custom) option. */
export type PickerTab = SourceTab | "blank";

export const BLANK_TAB: TabItem<PickerTab> = { value: "blank", label: "Start blank" };

export const URL_INVALID_MESSAGE = "Enter a full URL starting with https://.";

export function pickSource(tab: SourceTab, file: FileState, url: string): { source: SchemaSource } | { error: string } {
  if (tab === "file") {
    if (file.status === "ready") return { source: { type: "file", filename: file.filename, content: file.content } };
    return { error: file.status === "parsing" ? "Wait until the schema finishes parsing." : "Add a schema file." };
  }
  const trimmed = url.trim();
  if (!/^https:\/\/[^\s/]+/.test(trimmed)) return { error: URL_INVALID_MESSAGE };
  return { source: { type: "url", url: trimmed } };
}
