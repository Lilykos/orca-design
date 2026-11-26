// CanvasApi (UP canvas.ts) over the worker's dc.* requests. Pages and exports arrive in chunks
// because one answer is capped at 1 MiB.
import type { Anchor, CommentStatus, MoveStyle, TextTarget } from "../shared/design";
import { CHUNK, type RequestKind } from "../shared/protocol";
import type { TweakValues } from "../shared/tweaks";
import type { ArtboardView, DesignView } from "../shared/views";
import type { CanvasApi } from "./canvas";
import { newDesignPrompt } from "../shared/prompts";

export type Requester = (name: string, input: unknown) => Promise<any>;

export interface SendRequest {
  text: string;
  kind: RequestKind;
  /** null for a new design's brief. */
  slug: string | null;
  /** The person's own words, for a new design. */
  brief?: string;
}

/** The person closed the send sheet: nothing was sent, and nothing should be marked sent. */
export function cancelled(): Error {
  return Object.assign(new Error("cancelled"), { cancelled: true });
}

export interface ApiHooks {
  /** The design the canvas shows, for messages to the agent. */
  currentSlug(): string | null;
  /**
   * Shows the person the exact request and lets them pick (or start) the agent; resolves true once
   * it was sent, false when they cancelled. Without it, requests go straight to dc.send.
   */
  confirm?(request: SendRequest): Promise<boolean>;
  /** Saves a file the person exported. */
  saveFile?(fileName: string, bytes: Uint8Array): Promise<void>;
  pickZip?(): Promise<Blob | null>;
}

const PARALLEL_PAGES = 3;

/**
 * Reads a chunked answer. When the pieces carry a `version` and it changes mid-read (the file was
 * written meanwhile, or another load re-rendered it), the read starts over, so pieces of two
 * versions are never joined.
 */
export async function readChunks<T extends { chunk: string; offset: number; done: boolean; version?: string }>(
  fetch: (offset: number) => Promise<T>,
  attempts = 4,
): Promise<{ text: string; last: T }> {
  for (let attempt = 1; ; attempt++) {
    let offset = 0;
    const parts: string[] = [];
    let first: string | undefined;
    let mixed = false;
    for (;;) {
      const part = await fetch(offset);
      if (offset === 0) first = part.version;
      else if (part.version !== first) mixed = true;
      parts.push(part.chunk);
      if (part.done || mixed) {
        if (!mixed || attempt >= attempts) return { text: parts.join(""), last: part };
        break;
      }
      offset = part.offset;
    }
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

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createApi(ws: string, request: Requester, hooks: ApiHooks = { currentSlug: () => null }): CanvasApi {
  const call = (name: string, input: Record<string, unknown> = {}) => request(name, { ws, ...input });
  /** Each board's page as it last came whole, by its version: a page whose version has not changed is not fetched again. */
  const pages = new Map<string, { version: string; html: string }>();

  async function deliver(request: SendRequest): Promise<void> {
    if (hooks.confirm) {
      if (!(await hooks.confirm(request))) throw cancelled();
      return;
    }
    await call("dc.send", { ...(request.slug ? { slug: request.slug } : {}), kind: request.kind, text: request.text });
  }

  async function sendToAgent(text: string, kind: RequestKind = "comments"): Promise<void> {
    await deliver({ text, kind, slug: kind === "new" ? null : hooks.currentSlug() });
  }

  return {
    listDesigns: () => call("dc.list"),
    async getDesign(slug) {
      const meta: DesignView = await call("dc.design", { slug });
      const artboards = await inBatches(meta.artboards, PARALLEL_PAGES, async (board): Promise<ArtboardView> => {
        const key = `${slug}\0${board.id}`;
        const known = pages.get(key);
        if (known && known.version === board.version) return { ...board, html: known.html };
        const { text, last } = await readChunks((offset) => call("dc.artboard", { slug, artboardId: board.id, offset }));
        const html = last.error ? null : text;
        if (html !== null) pages.set(key, { version: last.version, html });
        return { ...board, html, error: last.error, version: last.version, source: last.source };
      });
      // Pages of artboards this design no longer has are dropped; other designs' pages stay.
      const live = new Set(meta.artboards.map((board) => `${slug}\0${board.id}`));
      for (const key of pages.keys()) if (key.startsWith(`${slug}\0`) && !live.has(key)) pages.delete(key);
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
      await deliver({ text: newDesignPrompt(brief), kind: "new", slug: null, brief });
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
