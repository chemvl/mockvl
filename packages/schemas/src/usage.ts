import { z } from "@hono/zod-openapi";

export const USAGE_RANGES = ["7d", "30d"] as const;
export const UsageRangeSchema = z.enum(USAGE_RANGES).openapi("UsageRange");
export type UsageRange = z.infer<typeof UsageRangeSchema>;

const Counts = {
  requests: z.number().int(),
  clientErrors: z.number().int(),
  serverErrors: z.number().int(),
};

export const UsageReportSchema = z
  .object({
    range: UsageRangeSchema,
    totals: z.object(Counts),
    daily: z.array(
      z.object({
        date: z.string().openapi({ example: "2026-10-07", description: "UTC day" }),
        requests: z.number().int(),
      }),
    ),
    mocks: z.array(z.object({ slug: z.string(), name: z.string(), ...Counts })),
  })
  .openapi("UsageReport");
export type UsageReport = z.infer<typeof UsageReportSchema>;
