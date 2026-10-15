/**
 * Legacy token refresh is parked: the regenerated client (src/client, now
 * targeting apps/api) has no token endpoint. Refreshing degrades to clearing
 * any leftover tokens — the admin realm's cookie session owns auth.
 */
import { clearTokens } from './tokenStorage';

export async function refreshAccessToken(): Promise<string | undefined> {
  clearTokens();
  return undefined;
}
