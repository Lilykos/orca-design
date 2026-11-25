// Watches a workspace's design/ folder and reports changed paths in debounced bursts. Editors
// write through temporary dotfiles and fs.watch reports one save more than once, so dot segments
// are ignored and a burst becomes one call.
import { existsSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { DESIGN_DIR } from "../shared/design";

export const DEBOUNCE_MS = 150;

type Listener = (paths: string[]) => void;

interface Entry {
  listeners: Set<Listener>;
  close(): void;
}

const roots = new Map<string, Entry>();

function hidden(rel: string): boolean {
  return rel.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

function open(root: string, emit: (paths: string[]) => void): () => void {
  const design = path.join(root, DESIGN_DIR);
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let designWatcher: FSWatcher | null = null;
  let rootWatcher: FSWatcher | null = null;

  const flush = () => {
    timer = null;
    const paths = [...pending];
    pending = new Set();
    if (paths.length) emit(paths);
  };
  const note = (rel: string) => {
    if (!rel || hidden(rel)) return;
    pending.add(rel.split(path.sep).join("/"));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };
  const watchDesign = () => {
    designWatcher = watch(design, { recursive: true }, (_event, name) => note(String(name ?? "")));
    designWatcher.on("error", () => {
      designWatcher?.close();
      designWatcher = null;
      watchRoot();
    });
  };
  // Until design/ exists, watch the workspace root for it to appear.
  const watchRoot = () => {
    rootWatcher = watch(root, (_event, name) => {
      if (String(name) !== DESIGN_DIR || !existsSync(design)) return;
      rootWatcher?.close();
      rootWatcher = null;
      watchDesign();
      pending.add("");
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    });
  };
  if (existsSync(design)) watchDesign();
  else watchRoot();
  return () => {
    if (timer) clearTimeout(timer);
    designWatcher?.close();
    rootWatcher?.close();
  };
}

/** Calls `listener` with design/-relative paths after each burst of changes. Returns an unsubscribe. */
export function watchRoot(root: string, listener: Listener): () => void {
  let entry = roots.get(root);
  if (!entry) {
    const listeners = new Set<Listener>();
    const close = open(root, (paths) => listeners.forEach((each) => each(paths)));
    entry = { listeners, close };
    roots.set(root, entry);
  }
  entry.listeners.add(listener);
  return () => {
    const current = roots.get(root);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.close();
      roots.delete(root);
    }
  };
}

/** Stops every watcher (worker shutdown). */
export function closeAll(): void {
  for (const entry of roots.values()) entry.close();
  roots.clear();
}

/** Which designs a burst touched, and whether the design list may have changed. */
export function summarizePaths(paths: readonly string[]): { slugs: string[]; list: boolean } {
  const slugs = new Set<string>();
  let list = false;
  for (const rel of paths) {
    const segments = rel.split("/").filter(Boolean);
    if (segments.length === 0) list = true;
    else if (segments.length === 1) list = true; // a design folder or a top-level file (canvas entry)
    else {
      slugs.add(segments[0]!);
      if (segments.length === 2 && segments[1] === "design.json") list = true;
    }
  }
  return { slugs: [...slugs].sort(), list };
}
