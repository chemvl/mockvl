// Postgres unique_violation (SQLSTATE 23505). Drizzle wraps the driver
// error; the postgres.js error carrying the code is the cause.
export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { cause } = error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23505";
}

// Postgres foreign_key_violation (SQLSTATE 23503), e.g. a usage row for a
// mock deleted between counting and flushing.
export function isForeignKeyViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { cause } = error;
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "23503";
}
