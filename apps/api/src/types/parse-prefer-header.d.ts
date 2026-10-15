// parse-prefer-header@1.0.0 ships no types. Preference names come back
// camelCased; a bare token (no "=value") parses as `true`.
declare module "parse-prefer-header" {
  function parsePreferHeader(
    prefer: string | string[] | null | undefined,
  ): Record<string, string | true>;
  export default parsePreferHeader;
}
