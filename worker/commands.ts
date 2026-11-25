// Palette commands and the status bar item: the Orca stand-ins for Paseo's Command Center entry,
// /canvas and the Design pill.
import path from "node:path";
import type { OrcaWorkerApi } from "orca/worker";
import { CANVAS_ENTRY, DESIGN_DIR } from "../shared/design";
import * as store from "./store";
import { resolveWorkspace, type HostCaller } from "./workspace";

export const STATUS_ITEM = "design";

async function focused(host: HostCaller): Promise<string> {
  const context = (await host.call("workspace.readContext", {})) as { workspaceId?: string } | null;
  if (!context?.workspaceId) throw new Error("Open a workspace first");
  return context.workspaceId;
}

/** Sets the workspace up for the canvas and opens its canvas entry in an editor tab. */
export async function openCanvas(host: HostCaller, workspaceId: string): Promise<void> {
  const { root, cwd } = await resolveWorkspace(host, workspaceId);
  await store.initCanvas(root);
  const entry = path.relative(cwd, path.join(root, DESIGN_DIR, CANVAS_ENTRY)).split(path.sep).join("/");
  await host.call("editor.open", { workspaceId, path: entry });
}

export function registerCommands(orca: OrcaWorkerApi): void {
  const host = orca.host as unknown as HostCaller;
  orca.commands.register("design.openCanvas", async () => {
    await openCanvas(host, await focused(host));
  });
  orca.commands.register("design.newDesign", async () => {
    const workspaceId = await focused(host);
    // The canvas reads this when it opens (or is already open) and shows its new-design card.
    await orca.storage.set(`pendingNew:${workspaceId}`, true);
    await openCanvas(host, workspaceId);
  });
  // Handlers run concurrently and can finish out of order: only the latest event's answer is shown.
  let latest = 0;
  orca.events.on("workspace.changed", async ({ context }) => {
    const mine = ++latest;
    let visible = false;
    if (context?.workspaceId) {
      try {
        visible = await store.isInitialized((await resolveWorkspace(host, context.workspaceId)).root);
      } catch (error) {
        orca.log(`status: ${(error as Error).message}`);
        visible = false;
      }
    }
    if (mine !== latest) return;
    await host.call("statusBar.update", { id: STATUS_ITEM, visible }).catch(() => {});
  });
}
