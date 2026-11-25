// Maps an Orca workspace id to its folder on this host, asked of Orca rather than trusted from a frame.
import { existsSync } from "node:fs";
import path from "node:path";

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

/**
 * The folder that holds design/ for a workspace folder. Orca opens a file's own folder as a
 * workspace when no workspace holds it, so a workspace can be design/ itself: then it is the parent.
 */
export function designHome(workspacePath: string): string {
  if (path.basename(workspacePath) === "design" && existsSync(path.join(workspacePath, "canvas.design.json"))) {
    return path.dirname(workspacePath);
  }
  return workspacePath;
}

/**
 * The folder holding the workspace's design/ (`root`) and the workspace's own folder, where its
 * agents run (`cwd`); `invalid_params` when Orca does not know the id.
 */
export async function resolveWorkspace(host: HostCaller, workspaceId: string): Promise<{ root: string; cwd: string }> {
  let row = (await listWorkspaceRows(host)).find((candidate) => candidate.id === workspaceId);
  if (!row) row = (await listWorkspaceRows(host, true)).find((candidate) => candidate.id === workspaceId);
  if (!row) throw new HostCodeError("invalid_params", `Unknown workspace ${workspaceId}`);
  return { root: designHome(row.path), cwd: row.path };
}

/** The folder holding the workspace's design/. */
export async function resolveRoot(host: HostCaller, workspaceId: string): Promise<string> {
  return (await resolveWorkspace(host, workspaceId)).root;
}

/** For tests: forget cached answers. */
export function resetWorkspaceCache(): void {
  cache = null;
}
