// The home panel's requests: recent designs across workspaces, their covers, and opening one.
import type { OrcaWorkerApi } from "orca/worker";
import { z } from "../vendor/zod.js";
import { slugSchema } from "../shared/design";
import type { HomeDesign, HomeWorkspace } from "../shared/protocol";
import type { ArtboardView } from "../shared/views";
import { sliceChunk } from "./chunks";
import { openCanvas } from "./commands";
import * as store from "./store";
import { designHome, listWorkspaceRows, type HostCaller } from "./workspace";

const RECENT = 24;

export async function listHome(host: HostCaller): Promise<{ designs: HomeDesign[]; workspaces: HomeWorkspace[] }> {
  const rows = await listWorkspaceRows(host, true);
  const workspaces: HomeWorkspace[] = rows.map((row) => ({ ws: row.id, name: row.name, project: row.project ?? null }));
  const seen = new Set<string>();
  const designs: HomeDesign[] = [];
  await Promise.all(
    rows.map(async (row) => {
      const root = designHome(row.path);
      // Worktrees of one folder show its designs once.
      if (seen.has(root)) return;
      seen.add(root);
      if (!(await store.isInitialized(root).catch(() => false))) return;
      for (const slug of await store.listSlugs(root)) {
        const summary = await store.summarize(root, slug);
        designs.push({
          ws: row.id,
          workspaceName: row.name,
          project: row.project ?? null,
          slug,
          title: summary.title,
          kind: summary.kind,
          artboards: summary.artboards,
          openComments: summary.openComments,
          updatedAt: await store.designUpdatedAt(root, slug),
        });
      }
    }),
  );
  designs.sort((a, b) => b.updatedAt - a.updatedAt);
  return { designs: designs.slice(0, RECENT), workspaces };
}

/**
 * The focused workspace, as the id `workspace.list` uses. Folder workspaces can come back from
 * `workspace.readContext` under another id, so match the name and branch too; null when neither
 * names exactly one row, so the panel never guesses an unrelated workspace.
 */
export async function focusedWorkspace(host: HostCaller): Promise<string | null> {
  const context = (await host.call("workspace.readContext", {})) as { workspaceId?: string; displayName: string; branch: string } | null;
  if (!context) return null;
  const rows = await listWorkspaceRows(host, true);
  if (context.workspaceId && rows.some((row) => row.id === context.workspaceId)) return context.workspaceId;
  const matches = rows.filter((row) => row.name === context.displayName && row.branch === context.branch);
  return matches.length === 1 ? matches[0]!.id : null;
}

export function registerHome(orca: OrcaWorkerApi, handle: (name: string, schema: z.ZodType, fn: (input: any, root: string) => Promise<unknown>) => void): void {
  const host = orca.host as unknown as HostCaller;

  orca.panels.handle("dc.home" as never, (async () => listHome(host)) as never);
  orca.panels.handle("dc.focused" as never, (async () => ({ ws: await focusedWorkspace(host) })) as never);

  // Rendered once per load (offset 0) and reused for its later chunks, like dc.artboard.
  const covers = new Map<string, { view: ArtboardView; at: number }>();
  handle("dc.cover", z.object({ ws: z.string(), slug: slugSchema, offset: z.number().int().min(0) }), async ({ slug, offset }, root) => {
    const key = `${root}\0${slug}`;
    const now = Date.now();
    for (const [k, entry] of covers) if (now - entry.at > 60_000) covers.delete(k);
    let cached = covers.get(key);
    if (offset === 0 || !cached) {
      const view = await store.coverView(root, slug);
      if (!view) return { chunk: "", offset: 0, total: 0, done: true, width: 0, height: null, error: "No artboards", version: "none" };
      cached = { view, at: now };
      covers.set(key, cached);
    }
    const { view } = cached;
    const part = sliceChunk(view.html ?? "", offset);
    if (part.done) covers.delete(key);
    return { ...part, width: view.width, height: view.height ?? null, error: view.error, version: view.version };
  });

  // Fix #3: one request does the whole hop, so opening a design can't stop halfway.
  handle("dc.open", z.object({ ws: z.string(), slug: slugSchema }), async ({ ws, slug }) => {
    await host.call("workspace.open", { workspaceId: ws });
    await orca.storage.set(`open:${ws}`, slug);
    await openCanvas(host, ws);
    return {};
  });

  handle("dc.openCanvas", z.object({ ws: z.string() }), async ({ ws }) => {
    await host.call("workspace.open", { workspaceId: ws });
    await openCanvas(host, ws);
    return {};
  });

}
