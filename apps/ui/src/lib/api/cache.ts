import type { QueryClient } from "@tanstack/react-query";
import {
  getMockQueryKey,
  listCustomEndpointsQueryKey,
  listMockOperationsQueryKey,
  listMockOverridesQueryKey,
  listWorkspacesQueryKey,
} from "@/client/@tanstack/react-query.gen";
import type { ListWorkspacesResponse } from "@/client/types.gen";
import type { MockDetail, Workspace } from "./types";

const LIST_QUERY_IDS: Readonly<Partial<Record<string, true>>> = {
  listMocks: true,
  listMockVersions: true,
  getWorkspaceUsage: true,
};

// hey-api query keys are [{ _id: operationId, path, query, … }].
function queryId(key: readonly unknown[]): string {
  const first = key[0];
  return typeof first === "object" && first !== null && "_id" in first && typeof first._id === "string" ? first._id : "";
}

function queryWs(key: readonly unknown[]): unknown {
  const first = key[0];
  if (typeof first !== "object" || first === null || !("path" in first)) return undefined;
  const path = first.path;
  return typeof path === "object" && path !== null && "ws" in path ? path.ws : undefined;
}

const WORKSPACE_SCOPED_QUERY_IDS: Readonly<Partial<Record<string, true>>> = {
  listMocks: true,
  getMock: true,
  listMockVersions: true,
  listMockOperations: true,
  listMockOverrides: true,
  getWorkspaceUsage: true,
  listWorkspaceMembers: true,
  listWorkspaceInvites: true,
  listPersonalAccessTokens: true,
  listCustomEndpoints: true,
  getCustomEndpoint: true,
  getMockSchema: true,
};

/** On workspace switch: drop cached data that belongs to any other workspace. */
export function forgetOtherWorkspaces(queryClient: QueryClient, slug: string): void {
  queryClient.removeQueries({
    predicate: (query) =>
      WORKSPACE_SCOPED_QUERY_IDS[queryId(query.queryKey)] === true && queryWs(query.queryKey) !== slug,
  });
}

/** After leaving or deleting a workspace: drop everything cached for it. */
export function forgetWorkspace(queryClient: QueryClient, slug: string): void {
  queryClient.removeQueries({
    predicate: (query) =>
      WORKSPACE_SCOPED_QUERY_IDS[queryId(query.queryKey)] === true && queryWs(query.queryKey) === slug,
  });
}

/** Store a fresh Workspace (mutation result) in the list by id, then refetch the list. */
export function applyWorkspace(queryClient: QueryClient, workspace: Workspace): void {
  queryClient.setQueryData<ListWorkspacesResponse>(listWorkspacesQueryKey(), (old) =>
    old ? { data: old.data.map((item) => (item.id === workspace.id ? workspace : item)) } : old,
  );
  void queryClient.invalidateQueries({ queryKey: listWorkspacesQueryKey() });
}

export function invalidateMockLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (query) => LIST_QUERY_IDS[queryId(query.queryKey)] === true });
}

function dropCustomEndpointQueries(queryClient: QueryClient, ws: string, slug: string): void {
  queryClient.removeQueries({ queryKey: listCustomEndpointsQueryKey({ path: { ws, slug } }) });
  queryClient.removeQueries({
    predicate: (query) => queryId(query.queryKey) === "getCustomEndpoint" && queryWs(query.queryKey) === ws,
  });
}

/** Store a fresh MockDetail (mutation result) and refresh every list that shows it. */
export function applyMock(queryClient: QueryClient, ws: string, mock: MockDetail): void {
  queryClient.setQueryData(getMockQueryKey({ path: { ws, slug: mock.slug } }), { data: mock });
  // The live version may have changed (replace / resync / restore).
  void queryClient.invalidateQueries({ queryKey: listMockOperationsQueryKey({ path: { ws, slug: mock.slug } }) });
  dropCustomEndpointQueries(queryClient, ws, mock.slug);
  void invalidateMockLists(queryClient);
}

/** Drop a mock that no longer exists at (ws, slug). */
export function forgetMock(queryClient: QueryClient, ws: string, slug: string): void {
  queryClient.removeQueries({ queryKey: getMockQueryKey({ path: { ws, slug } }) });
  queryClient.removeQueries({ queryKey: listMockOperationsQueryKey({ path: { ws, slug } }) });
  queryClient.removeQueries({ queryKey: listMockOverridesQueryKey({ path: { ws, slug } }) });
  dropCustomEndpointQueries(queryClient, ws, slug);
  void invalidateMockLists(queryClient);
}

/** A custom-endpoint save or delete made a new live version of (ws, slug). */
export async function refreshCustomMock(queryClient: QueryClient, ws: string, slug: string): Promise<void> {
  const path = { ws, slug };
  dropCustomEndpointQueries(queryClient, ws, slug);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getMockQueryKey({ path }) }),
    queryClient.invalidateQueries({ queryKey: listMockOperationsQueryKey({ path }) }),
    queryClient.invalidateQueries({ queryKey: listMockOverridesQueryKey({ path }) }),
    invalidateMockLists(queryClient),
  ]);
}
