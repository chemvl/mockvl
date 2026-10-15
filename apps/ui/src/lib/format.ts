// Pure display formatters. No imports, so throwaway `bun -e` checks can load it directly.

export type SchemaFormat = "openapi3" | "postman2";
export type VersionAction = "create" | "replace" | "resync" | "restore" | "edit";
export type VersionDiffInput = { endpointsAdded: number; endpointsRemoved: number; examplesChanged: number };
export type SchemaMetaInput = {
  format: SchemaFormat;
  specVersion: string;
  endpointCount: number;
  exampleCount: number;
  sizeBytes: number;
};
export type MockMetaInput = {
  responseMode: "static" | "dynamic";
  sourceType: "file" | "url" | "custom";
  sourceUrl: string | null;
  liveVersion: { number: number; format: SchemaFormat; specVersion: string; sourceLabel: string; createdAt: string };
};

const NUMBER = new Intl.NumberFormat("en-US");
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const DAY_MS = 86_400_000;

export function formatCount(n: number): string {
  return NUMBER.format(n);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSpec(format: SchemaFormat, specVersion: string): string {
  const [major = "", minor = "0"] = specVersion.split(".");
  return format === "openapi3" ? `OpenAPI ${major}.${minor}` : `Postman v${major}.${minor}`;
}

/** "OpenAPI 3.1 · 14 endpoints · 38 examples · 62 KB" */
export function formatSchemaMeta(input: SchemaMetaInput): string {
  return [
    formatSpec(input.format, input.specVersion),
    plural(input.endpointCount, "endpoint"),
    plural(input.exampleCount, "example"),
    formatBytes(input.sizeBytes),
  ].join(" · ");
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function calendarDaysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

function formatDay(date: Date, now: Date): string {
  return date.getFullYear() === now.getFullYear() ? MONTH_DAY.format(date) : MONTH_DAY_YEAR.format(date);
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = calendarDaysAgo(date, now);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return "Yesterday";
  return formatDay(date, now);
}

/** Mid-sentence form: "synced just now", "synced yesterday", "synced Oct 3". */
export function formatRelativeTimeInline(iso: string, now: Date = new Date()): string {
  const text = formatRelativeTime(iso, now);
  return text === "Just now" || text === "Yesterday" ? text.toLowerCase() : text;
}

/** Members table LAST ACTIVE: "Not yet", "Now", "12 min ago", "3 h ago", "Yesterday", "Sep 30". */
export function formatLastActive(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return "Not yet";
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 5) return "Now";
  if (minutes < 60) return `${minutes} min ago`;
  const days = calendarDaysAgo(date, now);
  if (days === 0) return `${Math.floor(minutes / 60)} h ago`;
  if (days === 1) return "Yesterday";
  return formatDay(date, now);
}

/** Pending invite row: "Sent today · expires Oct 14", or "Expired Oct 9". */
export function formatInviteDates(
  invite: { sentAt: string; expiresAt: string; expired: boolean },
  now: Date = new Date(),
): string {
  const expiresAt = MONTH_DAY.format(new Date(invite.expiresAt));
  if (invite.expired) return `Expired ${expiresAt}`;
  const sentAt = new Date(invite.sentAt);
  const days = calendarDaysAgo(sentAt, now);
  const sent = days <= 0 ? "today" : days === 1 ? "yesterday" : MONTH_DAY.format(sentAt);
  return `Sent ${sent} · expires ${expiresAt}`;
}

/** Access tokens table EXPIRES: "Oct 14", "Jan 3, 2027", or "Expired". */
export function formatTokenExpiry(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.getTime() <= now.getTime() ? "Expired" : formatDay(date, now);
}

export function formatVersionDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = calendarDaysAgo(date, now);
  if (days === 0) return `Today, ${CLOCK.format(date)}`;
  if (days === 1) return `Yesterday, ${CLOCK.format(date)}`;
  return formatDay(date, now);
}

export function formatVersionAction(version: { action: VersionAction; restoredFrom: number | null }): string {
  switch (version.action) {
    case "create":
      return "Created";
    case "replace":
      return "Schema replaced";
    case "resync":
      return "Re-synced from URL";
    case "restore":
      return version.restoredFrom === null ? "Restored" : `Restored from v${version.restoredFrom}`;
    case "edit":
      return "Edited endpoints";
  }
}

/** "+1 endpoint · 2 examples changed"; v1 (no diff) → "5 endpoints". */
export function formatVersionDiff(version: { diff: VersionDiffInput | null; endpointCount: number }): string {
  if (!version.diff) return plural(version.endpointCount, "endpoint");
  const parts: string[] = [];
  if (version.diff.endpointsAdded > 0) parts.push(`+${plural(version.diff.endpointsAdded, "endpoint")}`);
  if (version.diff.endpointsRemoved > 0) parts.push(`−${plural(version.diff.endpointsRemoved, "endpoint")}`);
  if (version.diff.examplesChanged > 0) parts.push(`${plural(version.diff.examplesChanged, "example")} changed`);
  return parts.length > 0 ? parts.join(" · ") : "No changes";
}

export function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return stripScheme(url);
  }
}

/** Detail header meta: "Static · OpenAPI 3.0 · from petstore3.swagger.io · v4 synced 2 h ago". */
export function formatMockMeta(mock: MockMetaInput, now: Date = new Date()): string {
  const live = mock.liveVersion;
  if (mock.sourceType === "custom") {
    return ["Custom", `v${live.number} updated ${formatRelativeTimeInline(live.createdAt, now)}`].join(" · ");
  }
  const from = mock.sourceType === "url" && mock.sourceUrl ? hostOf(mock.sourceUrl) : live.sourceLabel;
  const verb = mock.sourceType === "url" ? "synced" : "updated";
  return [
    mock.responseMode === "static" ? "Static" : "Dynamic",
    formatSpec(live.format, live.specVersion),
    `from ${from}`,
    `v${live.number} ${verb} ${formatRelativeTimeInline(live.createdAt, now)}`,
  ].join(" · ");
}

export function formatUser(user: { name: string | null; email: string } | null): string {
  if (!user) return "Deleted user";
  return user.name ?? user.email;
}

export function formatInitials(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : local.slice(0, 2);
  return letters.toUpperCase();
}

/** First letter or digit of each of the first two words: "Platform team" → "PT". */
export function formatNameInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
