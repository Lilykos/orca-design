// CanvasApi (UP canvas.ts) over the worker's dc.* requests. Pages and exports arrive in chunks
// because one answer is capped at 1 MiB.
import type { Anchor, CommentStatus, MoveStyle, TextTarget } from "../shared/design";
import { CHUNK, type RequestKind } from "../shared/protocol";
import type { TweakValues } from "../shared/tweaks";
import type { ArtboardView, DesignView } from "../shared/views";
import type { CanvasApi } from "./canvas";
import { newDesignPrompt } from "../shared/prompts";

export type Requester = (name: string, input: unknown) => Promise<any>;

export interface ApiHooks {
  /** The design the canvas shows, for messages to the agent. */
  currentSlug(): string | null;
  /** Called when the worker needs the person to choose or launch an agent; resolves once sent. */
  needAgent?(text: string, kind: RequestKind, reason: "choose-agent" | "no-agent"): Promise<void>;
  /** Saves a file the person exported. */
  saveFile?(fileName: string, bytes: Uint8Array): Promise<void>;
  pickZip?(): Promise<Blob | null>;
}

const PARALLEL_PAGES = 3;

async function readChunks<T extends { chunk: string; offset: number; done: boolean }>(fetch: (offset: number) => Promise<T>): Promise<{ text: string; last: T }> {
  let offset = 0;
  const parts: string[] = [];
  for (;;) {
    const part = await fetch(offset);
    parts.push(part.chunk);
    if (part.done) return { text: parts.join(""), last: part };
    offset = part.offset;
  }
}

async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index]!);
      }
    }),
  );
  return out;
}

function reasonOf(error: unknown): "choose-agent" | "no-agent" | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("choose-agent")) return "choose-agent";
  if (message.includes("no-agent")) return "no-agent";
  return null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createApi(ws: string, request: Requester, hooks: ApiHooks = { currentSlug: () => null }): CanvasApi {
  const call = (name: string, input: Record<string, unknown> = {}) => request(name, { ws, ...input });

  async function sendToAgent(text: string, kind: RequestKind = "comments"): Promise<void> {
    const slug = kind === "new" ? null : hooks.currentSlug();
    try {
      await call("dc.send", { ...(slug ? { slug } : {}), kind, text });
    } catch (error) {
      const reason = reasonOf(error);
      if (!reason || !hooks.needAgent) throw error;
      await hooks.needAgent(text, kind, reason);
    }
  }

  return {
    listDesigns: () => call("dc.list"),
    async getDesign(slug) {
      const meta: DesignView = await call("dc.design", { slug });
      const artboards = await inBatches(meta.artboards, PARALLEL_PAGES, async (board): Promise<ArtboardView> => {
        const { text, last } = await readChunks((offset) => call("dc.artboard", { slug, artboardId: board.id, offset }));
        return { ...board, html: last.error ? null : text, error: last.error, version: last.version, source: last.source };
      });
      return { ...meta, artboards };
    },
    getDesignVersion: async (slug) => (await call("dc.version", { slug })).version,
    addComment: async (slug, body, anchor: Anchor) => (await call("dc.comment.add", { slug, body, anchor })).comment,
    updateComment: async (slug, id, patch: { body?: string; status?: CommentStatus }) =>
      (await call("dc.comment.update", { slug, id, ...patch })).comment,
    deleteComment: async (slug, id) => {
      await call("dc.comment.delete", { slug, id });
    },
    markSent: async (slug, ids) => {
      await call("dc.comment.markSent", { slug, ids });
    },
    moveElement: (slug, artboardId, dcId, style: MoveStyle, expected) => call("dc.moveElement", { slug, artboardId, dcId, style, expected }),
    editText: (slug, artboardId, target: TextTarget, before, after, expected) =>
      call("dc.editText", { slug, artboardId, target, before, after, expected }),
    saveTweaks: (slug, values: TweakValues) => call("dc.saveTweaks", { slug, values }),
    moveArtboard: async (slug, artboardId, position) => {
      await call("dc.moveArtboard", { slug, artboardId, position });
    },
    sendToAgent,
    async startDesign(brief) {
      await call("dc.init");
      await sendToAgent(newDesignPrompt(brief), "new");
    },
    renameDesign: async (slug, title) => {
      await call("dc.rename", { slug, title });
    },
    deleteDesign: async (slug) => (await call("dc.trash", { slug })).trashedTo,
    async exportDesign(slug) {
      const { text, last } = await readChunks((offset) => call("dc.export", { slug, offset }));
      if (hooks.saveFile) await hooks.saveFile(last.fileName, base64ToBytes(text));
      return { fileName: last.fileName, base64: text };
    },
    async importDesign(base64) {
      const { id } = await call("dc.import.begin");
      for (let at = 0; at < base64.length; at += CHUNK) await call("dc.import.part", { id, part: base64.slice(at, at + CHUNK) });
      return call("dc.import.commit", { id });
    },
    pickZip: () => (hooks.pickZip ? hooks.pickZip() : Promise.resolve(null)),
  };
}
