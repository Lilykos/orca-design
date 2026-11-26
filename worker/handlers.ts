// Every dc.* request the editor and the home panel make. Inputs come from plugin frames; they are
// validated here because this side writes files.
import type { OrcaWorkerApi } from "orca/worker";
import { z } from "../vendor/zod.js";
import {
  anchorSchema,
  commentStatusSchema,
  editTextSchema,
  moveStyleSchema,
  slugSchema,
  textTargetSchema,
} from "../shared/design";
import { tweakValueSchema } from "../shared/tweaks";
import type { ArtboardView } from "../shared/views";
import * as agents from "./agents";
import { registerHome } from "./home";
import { sliceChunk, UploadBuffer } from "./chunks";
import { newDesignPrompt } from "../shared/prompts";
import { designKindSchema } from "../shared/design";
import { PathError } from "./paths";
import * as store from "./store";
import { summarizePaths, watchRoot } from "./watch";
import { designHome, HostCodeError, listWorkspaceRows, resolveRoot, resolveWorkspace, type HostCaller } from "./workspace";

const ws = z.object({ ws: z.string().min(1).max(500) });
const design = ws.extend({ slug: slugSchema });
const offset = z.number().int().min(0);

/** An error that reaches the frame with this code (Orca passes `code` through). */
function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function translate(error: unknown): unknown {
  if (error instanceof store.ConflictError) return coded("conflict", error.message);
  if (error instanceof PathError) return coded("invalid_params", error.message);
  if (error instanceof HostCodeError) return coded(error.code, error.message);
  if (error instanceof z.ZodError) return coded("invalid_params", error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return error;
}

function entryId(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export interface HandlerDeps {
  now(): number;
}

/** Rendered pages and exports kept between the chunk requests of one load. */
const CACHE_TTL_MS = 60_000;
/** A page rendered this recently, of the same design version, is served from its render at offset 0. */
const FRESH_MS = 5_000;

interface CachedRender {
  view: ArtboardView;
  /** The design's version when the page was rendered (store.designVersion). */
  version: string;
  at: number;
}

/** Drops the entries made more than CACHE_TTL_MS ago. */
function forget(cache: Map<string, { at: number }>, now: number): void {
  for (const [key, entry] of cache) if (now - entry.at > CACHE_TTL_MS) cache.delete(key);
}

function renderKey(root: string, slug: string, artboardId: string): string {
  return `${root}\0${slug}\0${artboardId}`;
}

export function registerHandlers(orca: OrcaWorkerApi, deps: HandlerDeps = { now: Date.now }): () => void {
  const host = orca.host as unknown as HostCaller;
  const renders = new Map<string, CachedRender>();
  const exports = new Map<string, { fileName: string; base64: string; at: number }>();
  const uploads = new UploadBuffer();
  const unwatch = new Map<string, () => void>();

  function handle<S extends z.ZodType, R>(name: string, schema: S, fn: (input: z.infer<S>, root: string) => Promise<R>): void {
    orca.panels.handle(name as never, (async (raw: unknown) => {
      try {
        const input = schema.parse(raw) as z.infer<S> & { ws: string };
        return await fn(input, await resolveRoot(host, input.ws));
      } catch (error) {
        const failure = translate(error) as { code?: string; message?: string };
        orca.log(`${name} failed: ${failure.code ?? "error"} ${failure.message ?? String(failure)}`);
        throw failure;
      }
    }) as never);
  }

  // Orca never tells an editor its file's path: the canvas entry names itself by its id (or, for
  // one written by hand, its text), and worktrees of one repo that share it go to the focused one.
  orca.panels.handle("dc.locate" as never, (async (raw: unknown) => {
    try {
      const { text } = z.object({ text: z.string().max(100_000) }).parse(raw);
      let id: string | null = null;
      try {
        const parsed = JSON.parse(text) as { id?: unknown };
        if (typeof parsed.id === "string" && parsed.id) id = parsed.id;
      } catch {
        // Not JSON: match by text.
      }
      const rows = await listWorkspaceRows(host, true);
      const matches: string[] = [];
      await Promise.all(
        rows.map(async (row) => {
          const entry = await store.readCanvasEntry(designHome(row.path));
          if (entry === null) return;
          if (id ? entryId(entry) === id : entry === text) matches.push(row.id);
        }),
      );
      if (matches.length <= 1) return { ws: matches[0] ?? null };
      // Worktrees of one repo share the committed entry: only the focused one is a safe guess.
      const focused = ((await host.call("workspace.readContext", {})) as { workspaceId?: string } | null)?.workspaceId;
      const chosen = matches.find((candidate) => candidate === focused);
      return chosen ? { ws: chosen } : { ws: null, candidates: matches.sort() };
    } catch (error) {
      throw translate(error);
    }
  }) as never);

  handle("dc.context", ws, async (_input, root) => ({ root, initialized: await store.isInitialized(root) }));

  handle("dc.init", ws, async (_input, root) => ({ created: await store.initCanvas(root) }));

  handle("dc.list", ws, async (_input, root) => {
    const [initialized, slugs, version] = await Promise.all([store.isInitialized(root), store.listSlugs(root), store.listVersion(root)]);
    const designs = await Promise.all(slugs.map((slug) => store.summarize(root, slug)));
    if (initialized) await store.refreshGuide(root).catch(() => {});
    return { initialized, designs, version };
  });

  // The pages dc.design renders are the ones the editor asks for next, so they are kept for dc.artboard.
  handle("dc.design", design, async ({ slug }, root) => {
    const at = deps.now();
    return store.viewDesignMeta(root, slug, (page, version) => {
      renders.set(renderKey(root, slug, page.id), { view: page, version, at });
    });
  });

  handle("dc.version", design, async ({ slug }, root) => ({ version: await store.designVersion(root, slug) }));

  handle("dc.artboard", design.extend({ artboardId: slugSchema, offset }), async ({ slug, artboardId, offset: at }, root) => {
    const now = deps.now();
    forget(renders, now);
    forget(exports, now);
    const key = renderKey(root, slug, artboardId);
    let entry = renders.get(key);
    const version = at === 0 || !entry ? await store.designVersion(root, slug) : entry.version;
    // A load starts at offset 0: a render of this version made a moment ago (by dc.design, say) serves it.
    if (!entry || entry.version !== version || (at === 0 && now - entry.at >= FRESH_MS)) {
      entry = { view: await store.viewArtboard(root, slug, artboardId), version, at: now };
      renders.set(key, entry);
    }
    const { view } = entry;
    const part = sliceChunk(view.html ?? "", at);
    if (part.done) renders.delete(key);
    return { ...part, version: view.version, source: view.source, error: view.error };
  });

  handle("dc.comment.add", design.extend({ body: z.string().trim().min(1).max(4000), anchor: anchorSchema }), async ({ slug, body, anchor }, root) => ({
    comment: await store.addComment(root, slug, body, anchor, deps.now()),
  }));

  handle(
    "dc.comment.update",
    design.extend({ id: z.string(), body: z.string().trim().min(1).max(4000).optional(), status: commentStatusSchema.optional() }),
    async ({ slug, id, body, status }, root) => ({ comment: await store.editComment(root, slug, id, { body, status }, deps.now()) }),
  );

  handle("dc.comment.delete", design.extend({ id: z.string() }), async ({ slug, id }, root) => {
    await store.deleteComment(root, slug, id);
    return {};
  });

  handle("dc.comment.markSent", design.extend({ ids: z.array(z.string()).min(1) }), async ({ slug, ids }, root) => {
    await store.markSent(root, slug, ids, deps.now());
    return {};
  });

  handle(
    "dc.moveElement",
    design.extend({ artboardId: slugSchema, dcId: z.string().min(1).max(120), style: moveStyleSchema, expected: z.string() }),
    async ({ slug, artboardId, dcId, style, expected }, root) => store.moveElement(root, slug, artboardId, dcId, style, expected),
  );

  handle(
    "dc.editText",
    design.extend({ artboardId: slugSchema, target: textTargetSchema, before: editTextSchema, after: editTextSchema, expected: z.string() }),
    async ({ slug, artboardId, target, before, after, expected }, root) => store.editText(root, slug, artboardId, target, before, after, expected),
  );

  handle(
    "dc.moveArtboard",
    design.extend({ artboardId: slugSchema, position: z.object({ x: z.number().int(), y: z.number().int() }).nullable() }),
    async ({ slug, artboardId, position }, root) => {
      await store.moveArtboard(root, slug, artboardId, position);
      return {};
    },
  );

  handle("dc.saveTweaks", design.extend({ values: z.record(z.string(), tweakValueSchema) }), async ({ slug, values }, root) =>
    store.saveTweaks(root, slug, values),
  );

  handle("dc.rename", design.extend({ title: z.string().trim().min(1).max(200) }), async ({ slug, title }, root) =>
    store.renameDesign(root, slug, title),
  );

  handle("dc.trash", design, async ({ slug }, root) => store.trashDesign(root, slug, deps.now()));

  handle("dc.export", design.extend({ offset }), async ({ slug, offset: at }, root) => {
    const now = deps.now();
    forget(renders, now);
    forget(exports, now);
    const key = `${root}\0${slug}`;
    let cached = exports.get(key);
    if (at === 0 || !cached) {
      const { fileName, zip } = await store.exportDesign(root, slug);
      cached = { fileName, base64: zip.toString("base64"), at: now };
      exports.set(key, cached);
    }
    const part = sliceChunk(cached.base64, at);
    if (part.done) exports.delete(key);
    return { ...part, fileName: cached.fileName };
  });

  handle("dc.import.begin", ws, async () => ({ id: uploads.begin() }));
  handle("dc.import.part", ws.extend({ id: z.string(), part: z.string() }), async ({ id, part }) => {
    uploads.append(id, part);
    return {};
  });
  handle("dc.import.commit", ws.extend({ id: z.string() }), async ({ id }, root) =>
    store.importDesign(root, Buffer.from(uploads.take(id), "base64")),
  );

  handle("dc.watch", ws, async ({ ws: workspaceId }, root) => {
    if (!unwatch.has(workspaceId)) {
      unwatch.set(
        workspaceId,
        watchRoot(root, (paths) => {
          const { slugs, list } = summarizePaths(paths);
          orca.panels.post("dc.changed", { ws: workspaceId, slugs, list });
        }),
      );
    }
    return {};
  });

  handle("dc.agents", ws.extend({ slug: slugSchema.optional() }), async ({ ws: workspaceId, slug }, root) => ({
    rows: (await agents.listAgents(host, workspaceId)).filter((row) => row.agent !== null && row.terminalId !== null),
    preferred: slug ? ((await store.readDesignAgents(root))[slug] ?? null) : null,
  }));

  handle(
    "dc.send",
    ws.extend({
      slug: slugSchema.optional(),
      kind: z.enum(["comments", "tweaks", "apply-tweaks", "new"]),
      text: z.string().min(1).max(200_000),
      terminalId: z.string().min(1).optional(),
    }),
    async ({ ws: workspaceId, slug, kind, text, terminalId }, root) =>
      agents.send(host, { workspaceId, root, cwd: (await resolveWorkspace(host, workspaceId)).cwd, slug: slug ?? null, kind, text, terminalId }, deps.now()),
  );

  handle(
    "dc.launch",
    design.extend({
      kind: z.enum(["comments", "tweaks", "apply-tweaks", "new"]),
      text: z.string().min(1).max(200_000),
      agent: z.string().min(1).max(40),
    }),
    async ({ ws: workspaceId, slug, kind, text, agent }, root) =>
      agents.launch(host, { workspaceId, root, cwd: (await resolveWorkspace(host, workspaceId)).cwd, agent, slug, kind, text }, deps.now()),
  );

  handle(
    "dc.start",
    ws.extend({ brief: z.string().trim().min(1).max(20_000), kind: designKindSchema.optional(), agent: z.string().min(1).max(40) }),
    async ({ ws: workspaceId, brief, kind, agent }, root) =>
      agents.start(host, { workspaceId, root, cwd: (await resolveWorkspace(host, workspaceId)).cwd, agent, text: newDesignPrompt(brief, kind) }, deps.now()),
  );

  registerHome(orca, handle as never);

  return () => {
    for (const stop of unwatch.values()) stop();
    unwatch.clear();
  };
}
