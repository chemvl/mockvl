// Mocks are served by the same host under /m (spec decision 2; MOCK_PUBLIC_BASE_URL
// defaults to `${APP_URL}/m`). Used where no API-provided `url` exists yet:
// the slug prefix on New mock / Settings and the Usage table.
export function mockUrl(ws: string, slug: string): string {
  return `${window.location.origin}/m/${ws}/${slug}`;
}

export function mockUrlPrefix(ws: string): string {
  return `${window.location.host}/m/${ws}/`;
}

/** Workspace slug prefix (Create workspace, Settings): "host/m/". */
export function workspaceUrlPrefix(): string {
  return `${window.location.host}/m/`;
}
