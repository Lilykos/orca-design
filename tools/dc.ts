// The design canvas agent CLI: what Paseo gave agents as tools (design_create, design_list,
// design_read, design_resolve_comments, design_set_tweaks), as commands an agent runs from its
// shell. Orca plugins cannot add agent tools yet. Bundled to assets/dc.mjs and copied to
// design/.canvas/dc.mjs by the canvas. Prints JSON; exits 0 ok, 1 usage, 2 invalid.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "../vendor/zod.js";
import { artboardSchema, designKindSchema, DESIGN_DIR, isOpen, MANIFEST_FILE, type Manifest, manifestSchema, slugSchema } from "../shared/design";
import { formatComment, formatTweaks } from "../shared/prompts";
import { tweaksListSchema } from "../shared/tweaks";
import { designDir, designRoot } from "../worker/paths";
import * as store from "../worker/store";

const USAGE = `node design/.canvas/dc.mjs <command>
  create <slug> '<json>'            {"title","kind","description"?,"artboards":[{"id","title","width","height"?,"group"?,"file"?}]}
  list                              designs with artboard and open-comment counts
  read <slug> [--all]               manifest, open comments (--all: resolved too) and tweak values
  resolve <slug> <n|id> <note> ...  mark comments resolved, one note each
  tweaks <slug> '<json>'            replace the design's tweaks (a JSON list, or @file.json)
  validate [slug]                   check manifests, comments and pages`;

class Exit extends Error {
  constructor(public code: number, public payload: unknown) {
    super("exit");
  }
}

const usage = (message: string) => new Exit(1, { ok: false, error: message, usage: USAGE });
const invalid = (message: string, extra: Record<string, unknown> = {}) => new Exit(2, { ok: false, error: message, ...extra });

/** The workspace root: the nearest folder upward from here that has design/ (else here). */
function findRoot(from: string): string {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, DESIGN_DIR)) && path.basename(dir) !== DESIGN_DIR) return dir;
    if (path.dirname(dir) === dir) return path.resolve(from);
  }
}

function parseJson(arg: string | undefined, what: string): unknown {
  if (!arg) throw usage(`Missing ${what}`);
  const text = arg.startsWith("@") ? readFileSync(arg.slice(1), "utf8") : arg;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw invalid(`${what} is not valid JSON: ${(error as Error).message}`);
  }
}

function issues(error: z.ZodError): string {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}

function slugArg(value: string | undefined): string {
  const parsed = slugSchema.safeParse(value);
  if (!parsed.success) throw usage(`Give a design slug (lowercase letters, digits, dashes): ${value ?? "(none)"}`);
  return parsed.data;
}

function placeholderPage(title: string, artboardTitle: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${artboardTitle}</title>
<style>
  :root { --bg: #f6f5f1; --ink: #1f1e1c; --muted: #6b6963; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, sans-serif; }
  p { color: var(--muted); }
</style>
</head>
<body>
  <main data-dc-id="placeholder">
    <h1>${artboardTitle}</h1>
    <p>Placeholder: write this artboard's design here.</p>
  </main>
</body>
</html>
`;
}

const createInput = z.object({
  title: z.string().min(1).max(200),
  kind: designKindSchema,
  description: z.string().max(4000).optional(),
  artboards: z.array(artboardSchema.extend({ file: artboardSchema.shape.file.optional() })).min(1).max(48),
});

async function create(root: string, args: string[]) {
  const slug = slugArg(args[0]);
  const input = createInput.safeParse(parseJson(args[1], "the design JSON"));
  if (!input.success) throw invalid(`Invalid design: ${issues(input.error)}`);
  const dir = designDir(root, slug);
  if (existsSync(dir)) throw invalid(`${DESIGN_DIR}/${slug}/ already exists. Pick another slug, or edit that design.`);
  const manifest: Manifest = {
    version: 1,
    title: input.data.title,
    kind: input.data.kind,
    ...(input.data.description ? { description: input.data.description } : {}),
    artboards: input.data.artboards.map((artboard) => ({ ...artboard, file: artboard.file ?? `${artboard.id}.html` })),
  };
  const checked = manifestSchema.safeParse(manifest);
  if (!checked.success) throw invalid(`Invalid design: ${issues(checked.error)}`);
  await store.initCanvas(root);
  await mkdir(dir, { recursive: true });
  await store.writeManifest(root, slug, checked.data);
  for (const artboard of checked.data.artboards) {
    await writeFile(path.join(dir, artboard.file), placeholderPage(checked.data.title, artboard.title), "utf8");
  }
  return {
    ok: true,
    message: `Created ${DESIGN_DIR}/${slug}/. It shows on the Design canvas now. Replace each placeholder page with the design; conventions are in ${DESIGN_DIR}/README.md.`,
    files: checked.data.artboards.map((artboard) => `${DESIGN_DIR}/${slug}/${artboard.file}`),
  };
}

async function list(root: string) {
  const slugs = await store.listSlugs(root);
  return { ok: true, designs: await Promise.all(slugs.map((slug) => store.summarize(root, slug))) };
}

async function read(root: string, args: string[]) {
  const slug = slugArg(args[0]);
  const all = args.includes("--all");
  const manifest = await store.readManifest(root, slug);
  if (!manifest.manifest) throw invalid(manifest.error);
  const comments = (await store.readComments(root, slug)).comments.filter((comment) => all || isOpen(comment));
  const values = await store.readTweakValues(root, slug).catch(() => ({}));
  return {
    ok: true,
    manifest: manifest.manifest,
    comments: comments.map((comment) => ({ id: comment.id, number: comment.number, status: comment.status, text: formatComment(comment, manifest.manifest) })),
    tweaks: manifest.manifest.tweaks?.length ? formatTweaks(manifest.manifest, values) : null,
  };
}

async function resolve(root: string, args: string[]) {
  const slug = slugArg(args[0]);
  const pairs = args.slice(1);
  if (pairs.length === 0 || pairs.length % 2 !== 0) throw usage("Give pairs of <comment number or id> <note>");
  const resolutions = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const ref = pairs[i]!;
    resolutions.push({ comment: /^\d+$/.test(ref) ? Number(ref) : ref, note: pairs[i + 1]! });
  }
  const result = await store.resolveComments(root, slug, resolutions, Date.now());
  if (result.resolved.length === 0) throw invalid(`No such comments: ${result.unknown.join(", ")}`, { result });
  return { ok: true, ...result };
}

async function tweaks(root: string, args: string[]) {
  const slug = slugArg(args[0]);
  const parsed = tweaksListSchema.safeParse(parseJson(args[1], "the tweaks JSON"));
  if (!parsed.success) throw invalid(`Invalid tweaks: ${issues(parsed.error)}`);
  const manifest = await store.readManifest(root, slug);
  if (!manifest.manifest) throw invalid(manifest.error);
  const { unused } = await store.setTweaks(root, slug, parsed.data);
  return { ok: true, message: `Set ${parsed.data.length} tweaks on ${slug}.`, unused };
}

async function validate(root: string, args: string[]) {
  const slugs = args[0] ? [slugArg(args[0])] : await store.listSlugs(root);
  const problems: string[] = [];
  for (const slug of slugs) {
    const manifest = await store.readManifest(root, slug);
    if (!manifest.manifest) {
      problems.push(manifest.error);
      continue;
    }
    try {
      await store.readComments(root, slug);
    } catch (error) {
      problems.push(`${slug}/comments.json: ${(error as Error).message}`);
    }
    for (const artboard of manifest.manifest.artboards) {
      const file = path.join(designDir(root, slug), artboard.file);
      try {
        await stat(file);
      } catch {
        problems.push(`${slug}/${artboard.file} is missing (artboard ${artboard.id})`);
        continue;
      }
      if (!/data-dc-id\s*=/.test(readFileSync(file, "utf8"))) problems.push(`${slug}/${artboard.file} has no data-dc-id, so comments can only point at positions`);
    }
  }
  if (!existsSync(designRoot(root))) problems.push(`No ${DESIGN_DIR}/ folder here`);
  if (problems.length) throw invalid(`${problems.length} problem${problems.length === 1 ? "" : "s"}`, { problems });
  return { ok: true, checked: slugs };
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const root = findRoot(process.cwd());
  try {
    let out: unknown;
    if (command === "create") out = await create(root, args);
    else if (command === "list") out = await list(root);
    else if (command === "read") out = await read(root, args);
    else if (command === "resolve") out = await resolve(root, args);
    else if (command === "tweaks") out = await tweaks(root, args);
    else if (command === "validate") out = await validate(root, args);
    else throw usage(command ? `Unknown command ${command}` : "Give a command");
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof Exit) {
      process.stdout.write(`${JSON.stringify(error.payload, null, 2)}\n`);
      return error.code;
    }
    process.stdout.write(`${JSON.stringify({ ok: false, error: (error as Error).message }, null, 2)}\n`);
    return 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
void MANIFEST_FILE;
