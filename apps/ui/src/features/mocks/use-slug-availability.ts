import { useQuery } from "@tanstack/react-query";
import { checkMockSlugOptions } from "@/client/@tanstack/react-query.gen";
import { isValidSlug, RESERVED_MOCK_SLUGS } from "@/lib/slug";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export type SlugCheck = {
  state: "idle" | "checking" | "available" | "taken" | "invalid" | "reserved";
  slug: string;
};

/** Debounced checkMockSlug. `currentSlug` (Settings) counts as unchanged → idle. */
export function useSlugAvailability(ws: string, slug: string, currentSlug?: string): SlugCheck {
  const debounced = useDebouncedValue(slug, 300);
  const valid = isValidSlug(slug);
  const reserved = RESERVED_MOCK_SLUGS.has(slug);
  const settled = debounced === slug;
  const query = useQuery({
    ...checkMockSlugOptions({ path: { ws }, query: { slug: debounced } }),
    enabled: valid && !reserved && settled && slug !== currentSlug,
    staleTime: 5_000,
  });

  if (slug === "" || slug === currentSlug) return { state: "idle", slug };
  if (!valid) return { state: "invalid", slug };
  if (reserved) return { state: "reserved", slug };
  if (!settled || query.isPending) return { state: "checking", slug };
  if (query.isError) return { state: "idle", slug };
  const result = query.data.data;
  if (result.available) return { state: "available", slug };
  if (result.reason === "reserved") return { state: "reserved", slug };
  if (result.reason === "invalid") return { state: "invalid", slug };
  return { state: "taken", slug };
}

/** True when the slug must not be submitted. */
export function slugCheckBlocks(check: SlugCheck): boolean {
  return check.state === "taken" || check.state === "reserved" || check.state === "invalid";
}
