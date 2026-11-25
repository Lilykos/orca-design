// Maps an Orca workspace id to its folder on this host, asked of Orca rather than trusted from a frame.

export interface WorkspaceRow {
  id: string;
  kind: "worktree" | "folder";
  name: string;
  project?: string | null;
  projectId?: string | null;
  path: string;
  branch: string | null;
  hostId: string | null;
}

/** The slice of the worker host API this module needs, so tests can pass a fake. */
export interface HostCaller {
  call(method: string, params?: unknown): Promise<unknown>;
}

const TTL_MS = 10_000;
let cache: { at: number; rows: WorkspaceRow[] } | null = null;

export class HostCodeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function listWorkspaceRows(host: HostCaller, fresh = false): Promise<WorkspaceRow[]> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const answer = (await host.call("workspace.list", {})) as { workspaces: WorkspaceRow[] };
  cache = { at: Date.now(), rows: answer.workspaces };
  return answer.workspaces;
}

/** The workspace's folder; `invalid_params` when Orca does not know the id. */
export async function resolveRoot(host: HostCaller, workspaceId: string): Promise<string> {
  let row = (await listWorkspaceRows(host)).find((candidate) => candidate.id === workspaceId);
  if (!row) row = (await listWorkspaceRows(host, true)).find((candidate) => candidate.id === workspaceId);
  if (!row) throw new HostCodeError("invalid_params", `Unknown workspace ${workspaceId}`);
  return row.path;
}

/** For tests: forget cached answers. */
export function resetWorkspaceCache(): void {
  cache = null;
}
