const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

const UNIT_SECONDS = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
} as const;

type DurationUnit = keyof typeof UNIT_SECONDS;

function isDurationUnit(value: string): value is DurationUnit {
  return value in UNIT_SECONDS;
}

/** Parses duration strings like "15m" or "30d" (units: s, m, h, d) into seconds. */
export function parseDuration(input: string): number {
  const [, amount, unit] = DURATION_PATTERN.exec(input) ?? [];
  if (!amount || !unit || !isDurationUnit(unit)) {
    throw new Error(
      `Invalid duration "${input}": expected "<number><unit>" with unit s, m, h or d (e.g. "15m", "30d")`,
    );
  }
  return Number(amount) * UNIT_SECONDS[unit];
}
