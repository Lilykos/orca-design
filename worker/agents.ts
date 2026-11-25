// Talks to the agents in a workspace. A prompt is written to a request file and the agent gets one
// line pointing at it: multi-line text typed into an agent's terminal is unreliable, and the file
// keeps a record of what was asked.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DESIGN_DIR, REQUESTS_DIR } from "../shared/design";
import type { AgentRow, RequestKind } from "../shared/protocol";
import * as store from "./store";
import { watchRoot } from "./watch";
import type { HostCaller } from "./workspace";

export type Target = { kind: "one"; row: AgentRow } | { kind: "choose"; rows: AgentRow[] } | { kind: "none" };

/** A recorded agent is `<agent>:<sessionId>`; Paseo recorded bare agent ids, which never match. */
export function parseRecorded(recorded: string | null): { agent: string; sessionId: string } | null {
  if (!recorded) return null;
  const at = recorded.indexOf(":");
  if (at <= 0 || at === recorded.length - 1) return null;
  return { agent: recorded.slice(0, at), sessionId: recorded.slice(at + 1) };
}

export function recordOf(row: AgentRow): string | null {
  return row.agent && row.sessionId ? `${row.agent}:${row.sessionId}` : null;
}

/** Which agent a message goes to. Rows without an agent or a terminal (plain shells) never qualify. */
export function pickTarget(rows: readonly AgentRow[], preferred: string | null): Target {
  const agents = rows.filter((row) => row.agent !== null && row.terminalId !== null);
  const wanted = parseRecorded(preferred);
  const match = wanted && agents.find((row) => row.sessionId === wanted.sessionId);
  if (match) return { kind: "one", row: match };
  if (agents.length === 1) return { kind: "one", row: agents[0]! };
  if (agents.length === 0) return { kind: "none" };
  return { kind: "choose", rows: agents };
}

function stamp(now: number): string {
  return new Date(now).toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

/** Writes the prompt to design/[<slug>/].requests/<stamp>-<kind>.md; returns the workspace-relative path. */
export async function writeRequest(root: string, slug: string | null, kind: RequestKind, text: string, now = Date.now()): Promise<string> {
  const dir = slug ? path.join(DESIGN_DIR, slug, REQUESTS_DIR) : path.join(DESIGN_DIR, REQUESTS_DIR);
  await mkdir(path.join(root, dir), { recursive: true });
  let rel = path.join(dir, `${stamp(now)}-${kind}.md`);
  for (let n = 2; await exists(path.join(root, rel)); n++) rel = path.join(dir, `${stamp(now)}-${kind}-${n}.md`);
  await store.writeFileAtomic(path.join(root, rel), text.endsWith("\n") ? text : `${text}\n`);
  return rel.split(path.sep).join("/");
}

async function exists(file: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).stat(file);
    return true;
  } catch {
    return false;
  }
}

export function pointerLine(rel: string): string {
  return `Read ${rel} and do what it asks.`;
}

export async function listAgents(host: HostCaller, workspaceId: string): Promise<AgentRow[]> {
  const answer = (await host.call("agents.list", { workspaceId })) as { agents: (AgentRow & { sessionId?: string | null })[] };
  return answer.agents.map((row) => ({
    terminalId: row.terminalId,
    title: row.title,
    agent: row.agent,
    state: row.state,
    sessionId: row.sessionId ?? null,
  }));
}

const RESUME_POLL_MS = 500;
const RESUME_WAIT_MS = 20_000;

/** Resumes a recorded session and waits until Orca lists it, idle, in that terminal. */
async function resume(host: HostCaller, workspaceId: string, recorded: { agent: string; sessionId: string }): Promise<string> {
  const { terminalId } = (await host.call("agent.resume", { workspaceId, ...recorded })) as { terminalId: string };
  const end = Date.now() + RESUME_WAIT_MS;
  for (;;) {
    const rows = await listAgents(host, workspaceId);
    const row = rows.find((candidate) => candidate.terminalId === terminalId);
    if (row && row.state !== "working") return terminalId;
    if (Date.now() > end) return terminalId;
    await new Promise((resolve) => setTimeout(resolve, RESUME_POLL_MS));
  }
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export interface SendInput {
  workspaceId: string;
  root: string;
  slug: string;
  kind: RequestKind;
  text: string;
  terminalId?: string;
}

/** Writes the request and types its pointer into the chosen, recorded, resumed or only agent. */
export async function send(host: HostCaller, input: SendInput, now = Date.now()): Promise<{ terminalId: string; request: string }> {
  const rows = await listAgents(host, input.workspaceId);
  const recorded = (await store.readDesignAgents(input.root))[input.slug] ?? null;
  let terminalId = input.terminalId ?? null;
  if (terminalId && !rows.some((row) => row.terminalId === terminalId && row.agent)) {
    throw coded("invalid_params", "choose-agent: that terminal is not running an agent");
  }
  if (!terminalId) {
    const target = pickTarget(rows, recorded);
    const wanted = parseRecorded(recorded);
    if (target.kind === "one" && (!wanted || target.row.sessionId === wanted.sessionId)) terminalId = target.row.terminalId;
    else if (wanted) terminalId = await resume(host, input.workspaceId, wanted);
    else if (target.kind === "one") terminalId = target.row.terminalId;
    else throw coded("invalid_params", target.kind === "none" ? "no-agent: no agent is running in this workspace" : "choose-agent: several agents are running");
  }
  const chosen = rows.find((row) => row.terminalId === terminalId);
  if (!recorded && chosen && recordOf(chosen)) await store.rememberDesignAgent(input.root, input.slug, recordOf(chosen)!);
  const request = await writeRequest(input.root, input.slug, input.kind, input.text, now);
  await host.call("terminal.sendText", { terminalId: terminalId!, text: pointerLine(request), enter: true });
  return { terminalId: terminalId!, request };
}

const TRACK_MS = 30 * 60_000;

/**
 * Starts an agent on a brief. When a new design folder appears afterwards, it is recorded as that
 * agent's, so the canvas sends its comments back to the same session.
 */
export async function start(
  host: HostCaller,
  input: { workspaceId: string; root: string; agent: string; text: string },
  now = Date.now(),
): Promise<{ terminalId: string; request: string }> {
  await store.initCanvas(input.root);
  const request = await writeRequest(input.root, null, "new", input.text, now);
  const known = new Set(await store.listSlugs(input.root));
  const { terminalId } = (await host.call("agent.launch", { workspaceId: input.workspaceId, agent: input.agent, prompt: pointerLine(request) })) as { terminalId: string };
  const stop = watchRoot(input.root, () => {
    void (async () => {
      const fresh = (await store.listSlugs(input.root)).filter((slug) => !known.has(slug));
      if (fresh.length === 0) return;
      const row = (await listAgents(host, input.workspaceId)).find((candidate) => candidate.terminalId === terminalId);
      const record = row && recordOf(row);
      if (!record) return;
      for (const slug of fresh) await store.rememberDesignAgent(input.root, slug, record);
      stop();
      clearTimeout(timer);
    })().catch(() => {});
  });
  const timer = setTimeout(stop, TRACK_MS);
  timer.unref?.();
  return { terminalId, request };
}
