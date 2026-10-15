// Pure name transforms for the schema generator. English-lite pluralization —
// enough for conventional table names (categories, statuses, posts, users);
// irregular nouns come out wrong and get fixed by hand in the generated file.

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Split an identifier (snake_case, kebab-case, or camelCase) into lowercase words. */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** categories → category, statuses → status, posts → post. Suffix-based, so it works on full identifiers. */
export function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** category → categories, status → statuses, post → posts. */
export function pluralize(word: string): string {
  const beforeY = word.charAt(word.length - 2);
  if (word.endsWith("y") && !VOWELS.has(beforeY)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** admin_users → AdminUsers */
export function pascalCase(input: string): string {
  return splitWords(input).map(capitalize).join("");
}

/** admin_users → adminUsers */
export function camelCase(input: string): string {
  const [first = "", ...rest] = splitWords(input);
  return first + rest.map(capitalize).join("");
}

/** adminUsers / admin_users → admin-users */
export function kebabCase(input: string): string {
  return splitWords(input).join("-");
}

/** post_statuses → POST_STATUSES */
export function constantCase(input: string): string {
  return splitWords(input).join("_").toUpperCase();
}

/** authorId → "Author Id" (relation labels strip the trailing " Id" separately) */
export function titleCase(input: string): string {
  return splitWords(input).map(capitalize).join(" ");
}

/** Case/punctuation-insensitive form used to match CLI model args against tables. */
export function normalizeModelArg(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The TableModel fields arg matching needs (structural, so this file never imports introspect.ts). */
export interface ModelNameSource {
  tableKey: string;
  tableName: string;
  fileBase: string;
}

/** True when a CLI model arg names this table (by export key, db name, file base, or singular). */
export function matchesArg(model: ModelNameSource, arg: string): boolean {
  const wanted = normalizeModelArg(arg);
  const candidates = [model.tableKey, model.tableName, model.fileBase, singularize(model.tableKey)];
  return candidates.some((candidate) => normalizeModelArg(candidate) === wanted);
}
