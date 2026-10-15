import { useQuery } from "@tanstack/react-query";
import { checkWorkspaceSlugOptions } from "@/client/@tanstack/react-query.gen";
import type { SlugCheck } from "@/features/mocks/use-slug-availability";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { workspaceSlugProblem } from "@/lib/workspace-slug";

/**
 * Debounced checkWorkspaceSlug. `currentSlug` (Settings) counts as unchanged → idle,
 * even when it is a grandfathered slug the new rules would reject.
 */
export function useWorkspaceSlugAvailability(slug: string, currentSlug?: string): SlugCheck {
  const debounced = useDebouncedValue(slug, 300);
  const problem = workspaceSlugProblem(slug);
  const settled = debounced === slug;
  const query = useQuery({
    ...checkWorkspaceSlugOptions({ query: { slug: debounced, ws: currentSlug } }),
    enabled: problem === null && settled && slug !== currentSlug,
    staleTime: 5_000,
  });

  if (slug === "" || slug === currentSlug) return { state: "idle", slug };
  if (problem) return { state: problem, slug };
  if (!settled || query.isPending) return { state: "checking", slug };
  if (query.isError) return { state: "idle", slug };
  const result = query.data.data;
  if (result.available) return { state: "available", slug };
  if (result.reason === "reserved") return { state: "reserved", slug };
  if (result.reason === "invalid") return { state: "invalid", slug };
  return { state: "taken", slug };
}
