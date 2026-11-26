// The design canvas as an Orca custom editor on design/canvas.design.json. The document itself is
// only a marker: everything the canvas shows comes from the worker, for the workspace the file is in.
import "../shared/protocol";
import type { AgentRow } from "../shared/protocol";
import { createApi, type SendRequest } from "./api";
import { openSendSheet, RESUME } from "./send-sheet";
import { type AgentStatus, mountCanvas } from "./canvas";
import { pickZip } from "./files";
import { t } from "./i18n";
import type { ThemeColors } from "./styles";

const request = (name: string, input: unknown, options?: { timeoutMs: number }) =>
  orca.plugin.request(name as never, input as never, options) as Promise<any>;
/** A send starts an agent or waits for its terminal: longer than the default 30 s. */
const SEND_TIMEOUT = { timeoutMs: 120_000 };

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Orca's theme as the canvas's colors. Orca has no success/warning tokens, so those are fixed. */
export function readTheme(): ThemeColors {
  const dark = document.documentElement.classList.contains("dark");
  return {
    surface0: css("--orca-background", dark ? "#1b1b1b" : "#ffffff"),
    surface1: css("--orca-card", dark ? "#222222" : "#f7f7f7"),
    surface2: css("--orca-muted", dark ? "#2a2a2a" : "#efefef"),
    border: css("--orca-border", dark ? "#333333" : "#e2e2e2"),
    foreground: css("--orca-foreground", dark ? "#eeeeee" : "#111111"),
    foregroundMuted: css("--orca-muted-foreground", dark ? "#a0a0a0" : "#666666"),
    accent: css("--orca-primary", "#2563eb"),
    accentForeground: css("--orca-primary-foreground", "#ffffff"),
    statusSuccess: dark ? "#3fb27f" : "#1f8a5b",
    statusWarning: dark ? "#d8a23a" : "#b7791f",
    statusDanger: css("--orca-destructive", "#dc2626"),
  };
}

function notice(text: string): void {
  document.body.textContent = "";
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText = "margin:24px;font:13px/1.5 var(--orca-font-sans,system-ui);color:var(--orca-muted-foreground)";
  document.body.append(p);
}

async function storageGet(key: string): Promise<string | null> {
  try {
    const value = await orca.storage.get(key);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

async function boot(): Promise<void> {
  document.documentElement.style.height = "100%";
  document.body.style.cssText = "margin:0;height:100%;position:relative;overflow:hidden;background:var(--orca-background)";
  // The document only marks where the canvas lives: its id names the workspace (Orca never tells an
  // editor its file's path). Without a document text, the focused workspace is the fallback.
  const doc = await orca.document?.get();
  const text = doc?.content.kind === "text" ? doc.content.text : "";
  let ws: string | undefined;
  if (text) {
    const located = (await request("dc.locate", { text })) as { ws: string | null; candidates?: string[] };
    if (!located.ws && located.candidates?.length) {
      notice(
        `This canvas file is in ${located.candidates.length} worktrees and none of them is focused. ` +
          "Focus the worktree you want in the sidebar, then reopen this tab.",
      );
      return;
    }
    if (!located.ws) {
      notice("This file isn't a design canvas entry. Use Design: Open canvas to open a workspace's canvas.");
      return;
    }
    ws = located.ws;
  }
  if (!ws) ws = ((await orca.host.call("workspace.readContext", {})) as { workspaceId?: string } | null)?.workspaceId;
  if (!ws) {
    notice("Open this file from a workspace to see its designs.");
    return;
  }

  let currentSlug: string | null = await storageGet(`last:${ws}`);
  const api = createApi(ws, request, {
    currentSlug: () => currentSlug,
    async confirm(req: SendRequest) {
      const { rows, preferred } = (await request("dc.agents", { ws, ...(req.slug ? { slug: req.slug } : {}) })) as {
        rows: AgentRow[];
        preferred: string | null;
      };
      return openSendSheet({
        host: document.querySelector(".dc-root") ?? document.body,
        text: req.text,
        rows,
        preferred,
        async onSend(terminalId) {
          // RESUME: no terminal, so the worker resumes the design's recorded session first.
          const target = terminalId === RESUME ? {} : { terminalId };
          await request("dc.send", { ws, ...(req.slug ? { slug: req.slug } : {}), kind: req.kind, text: req.text, ...target }, SEND_TIMEOUT);
        },
        async onLaunch(agent) {
          if (req.slug) await request("dc.launch", { ws, slug: req.slug, kind: req.kind, text: req.text, agent }, SEND_TIMEOUT);
          else await request("dc.start", { ws, brief: req.brief ?? req.text, agent }, SEND_TIMEOUT);
        },
      });
    },
    async saveFile(fileName, bytes) {
      await orca.files?.saveAs({ suggestedName: fileName, mimeType: "application/zip", data: bytes.slice().buffer });
    },
    pickZip,
  });

  const handle = mountCanvas({
    host: document.body,
    t,
    api,
    theme: readTheme(),
    initialSlug: currentSlug,
    onSlugChange(slug) {
      currentSlug = slug;
      void orca.storage.set(`last:${ws}`, slug ?? null).catch(() => {});
    },
  });

  orca.on("theme", () => handle.setTheme(readTheme()));
  // "Design: New design…" leaves a note in storage; it may arrive before or after the canvas opens.
  const pendingKey = `pendingNew:${ws}`;
  const takePending = async () => {
    try {
      if ((await orca.storage.get(pendingKey)) !== true) return;
      await orca.storage.delete(pendingKey);
      handle.startNew();
    } catch {
      // Storage unavailable: the command still opened the canvas.
    }
  };
  // The home panel names a design to show (open:<ws>), or the designs that existed before it
  // started a new one (expectNew:<ws>), so the canvas can jump to the new one when it appears.
  const openKey = `open:${ws}`;
  const expectKey = `expectNew:${ws}`;
  const takeHandoff = async () => {
    try {
      const slug = await orca.storage.get(openKey);
      if (typeof slug === "string" && slug) {
        await orca.storage.delete(openKey);
        handle.select(slug);
      }
      const known = await orca.storage.get(expectKey);
      if (Array.isArray(known)) {
        await orca.storage.delete(expectKey);
        handle.expectNew(known.filter((item): item is string => typeof item === "string"));
      }
    } catch {
      // Storage unavailable: the canvas shows its last design.
    }
  };
  orca.storage.onDidChange(({ key }) => {
    if (key === pendingKey) void takePending();
    if (key === openKey || key === expectKey) void takeHandoff();
  });
  void takePending();
  void takeHandoff();
  orca.plugin.on("dc.changed", (change) => {
    if (change.ws === ws) handle.refresh(change.slugs, change.list);
  });
  await request("dc.watch", { ws });

  // The agent's state drives the canvas's "Agent is working…" hint.
  const updateStatus = async () => {
    try {
      const { rows, preferred } = (await request("dc.agents", { ws, ...(currentSlug ? { slug: currentSlug } : {}) })) as {
        rows: AgentRow[];
        preferred: string | null;
      };
      const session = preferred?.slice(preferred.indexOf(":") + 1);
      const row = rows.find((candidate) => candidate.sessionId === session) ?? (rows.length === 1 ? rows[0] : undefined);
      const status: AgentStatus = !row ? null : row.state === "working" ? "running" : "idle";
      handle.setAgentStatus(status);
    } catch {
      handle.setAgentStatus(null);
    }
  };
  orca.on("agent.status.changed", () => void updateStatus());
  void updateStatus();
}

void boot().catch((error: unknown) => notice(`The design canvas could not start: ${error instanceof Error ? error.message : String(error)}`));
