# Orca Design Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Paseo design canvas (paseo-design-canvas 0.4.1) to an Orca trusted-worker plugin with a full-tab canvas editor, an agent bridge, an agent CLI and a home panel, and fix the ten problems listed in the spec.

**Architecture:** The plugin lives at the repo root. A Node **worker** (`worker/`) owns every file read and write under `<workspace>/design/`, watches it, and talks to agents. A **custom editor** (`editor/`) on `*.design.json` runs Paseo's DOM canvas, nearly verbatim, behind a `CanvasApi` adapter built on `orca.plugin.request`. **Shared** schemas and prompts (`shared/`) are used by both, with zod bundled into `vendor/zod.js` because frames cannot import npm packages. An HTML **sidebar panel** (`panel/`) is the home screen.

**Tech Stack:** TypeScript (no build step; Orca transpiles), zod 4 (vendored via esbuild), Node `fs`/`zlib`, Orca plugin API 1.10 (Orca ≥ 1.4.259), `orca plugin test` (node:test).

**Spec:** `docs/spec.md`. Feasibility evidence: `docs/spike-findings.md`. Upstream source to port from: `~/.paseo/plugins/design-canvas/*/node_modules/paseo-design-canvas/` (called **UP** below; e.g. `UP/server/store.ts`).

## Global Constraints

- `engines.orca`: `>=1.4.259` (`agent.resume`, `workspace.create`-era APIs); `pluginApi: 1`; `execution: "trusted-worker"`; plugin id `design-canvas`, name `Design canvas`.
- Capabilities: exactly `workspace:read`, `workspace:write`, `agent:read`, `agent:launch`, `terminal:send`, `storage:own`, `notifications:show`.
- Frames and panels import only `orca`, `orca/*` and relative files. No bare npm imports anywhere at runtime (the worker too: everything is bundled or vendored). `node_modules/` is never committed.
- `plugin.request` answers and inputs: ≤ 1 MiB. Chunk anything that can be larger at **768 KiB** (`CHUNK = 786_432` chars). `panels.post`: ≤ 256 KiB and 200 per 10 s, so posts carry paths, never content.
- The worker touches only `realpath(<workspace>/design)` and below (UP `server/paths.ts` rules, symlinks checked).
- Artboard iframes: `sandbox="allow-scripts"` and UP's `DESIGN_CSP`, unchanged.
- Keep Paseo's file format byte-compatible (spec "Files"): Paseo-made designs must open unchanged.
- Keep UP's MIT notice: `LICENSE` lists both copyrights, and each ported file starts with `// Ported from paseo-design-canvas 0.4.1 (MIT, © 2026 961853266hyt).`
- Style from `--orca-*` CSS variables only (no fixed colours in the chrome) and re-theme on `orca.on('theme')`.
- English UI only. Port `en.json` and drop `zh-CN`.

## Review Focus

1. **A page over 1 MiB after inlining** (real identity designs inline JPGs): it must load through chunks, not fail with `too_large`. Test: Task 5 `artboard chunks reassemble a 2 MiB page`.
2. **The agent rewrites a page while the person drags or edits text:** the write must be refused with `conflict` and the board reloaded, never a silent overwrite. Test: Task 3 `moveElement refuses a stale version`.
3. **A half-written `design.json` caught by the watcher:** show the parse error in place of the design, then recover on the next write without a reload. Test: Task 5 `design view reports a broken manifest and recovers`.
4. **A workspace with no `design/` folder, or a non-workspace file:** the canvas shows the empty-canvas brief and creates `design/` only when asked. Test: Task 5 `context reports uninitialized without creating files`.
5. **No agent, or several agents, in the workspace when sending:** never type into a non-agent terminal. Zero agents means offer to launch one; several means the picker. Test: Task 6 `pickTarget never chooses a shell terminal`.

---

## File Structure

```
orca-plugin.json            manifest (Task 1, grows in 7, 11, 12)
package.json, tsconfig.json dev only: typescript, zod@4, esbuild
scripts/vendor.mjs          bundles vendor/zod.js and assets/dc.mjs
vendor/zod.js, zod.d.ts     vendored zod (generated, committed)
LICENSE, README.md, CHANGELOG.md
shared/
  design.ts                 UP/shared/design.ts (+ CANVAS_ENTRY, REQUESTS_DIR)
  tweaks.ts                 UP/shared/tweaks.ts
  prompts.ts                UP/shared/prompts.ts, retargeted at the CLI (Task 10)
  runtime-protocol.ts       UP/shared/runtime-protocol.ts
  views.ts                  DesignSummary/ArtboardView/DesignView types (from UP/shared/rpc.ts, no defineRpc)
  protocol.ts               `declare module 'orca'` PluginRequests + PluginPanelEvents
worker/
  index.ts                  activate(): registers handlers, owns watchers
  paths.ts                  UP/server/paths.ts
  store.ts                  UP/server/store.ts (minus agent-tool code)
  inline.ts                 UP/server/inline.ts
  html-patch.ts             UP/server/html-patch.ts
  zip.ts                    UP/server/zip.ts
  guide.ts                  UP/server/guide.ts, rewritten for the CLI (Task 10)
  workspace.ts              workspaceId → root, via workspace.list
  chunks.ts                 chunked transfer helpers
  watch.ts                  debounced recursive watcher per root
  agents.ts                 target choice, request files, send, launch, resume
  handlers.ts               every dc.* handler
editor/
  main.ts                   bootstraps: context, api, theme, mountCanvas
  api.ts                    CanvasApi over orca.plugin.request
  canvas.ts runtime.ts layout.ts styles.ts icons.ts files.ts cursors.ts i18n.ts locales/en.json  (UP/client/*)
  send-sheet.ts             Task 9: the preview and agent picker
panel/
  home.html, home.ts        Task 12
tools/dc.ts                 agent CLI source, bundled to assets/dc.mjs (Task 10)
tests/fixtures/             small synthetic designs
**/*.test.ts                next to the code they test
```

---

## Phase 0: Foundation

### Task 1: Plugin scaffold, vendored zod, shared schemas

**Files:**
- Create: `orca-plugin.json`, `package.json`, `tsconfig.json`, `.gitignore`, `scripts/vendor.mjs`, `vendor/zod.js`, `vendor/zod.d.ts`, `LICENSE`, `shared/design.ts`, `shared/tweaks.ts`, `shared/prompts.ts`, `shared/runtime-protocol.ts`, `shared/views.ts`, `worker/index.ts` (empty activate)
- Create: `tests/fixtures/sample-alternatives/` (a synthetic 6-artboard design; originally a real Paseo design), `tests/fixtures/minimal/design.json`, `a.html`
- Test: `shared/design.test.ts`

**Interfaces:**
- Produces: `shared/design.ts` exports everything UP exports, plus `CANVAS_ENTRY = "canvas.design.json"`, `REQUESTS_DIR = ".requests"` and `CLI_FILE = ".canvas/dc.mjs"`. Every zod import becomes `import { z } from "../vendor/zod.js"`.
- Produces: `shared/views.ts`: `DesignSummary`, `ArtboardView` (`{ id, title, file, width, height?, group?, x?, y?, html: string | null, error: string | null, version: string, source: string }`), `DesignView`, as the zod schemas from UP/shared/rpc.ts lines 1–66, without `defineRpc`.

- [ ] **Step 1:** `scripts/vendor.mjs` bundles `zod` with esbuild (`format: "esm"`, `platform: "neutral"`, `minify: true`) to `vendor/zod.js`. `vendor/zod.d.ts` is `export * from "zod";`. Run `npm i -D typescript zod@^4.4.3 esbuild && node scripts/vendor.mjs`. Expected: `vendor/zod.js` exists and is under 1 MiB.
- [ ] **Step 2:** Write `orca-plugin.json` with the Global Constraints values, `main: "worker/index.ts"` and no contributions yet. `tsconfig.json` extends `./.orca/types/tsconfig.json`, includes `shared worker editor panel tools`, and maps `zod` types through `vendor/zod.d.ts`. Run `orca plugin types . --json`.
- [ ] **Step 3: Failing test** `shared/design.test.ts`:
  ```ts
  test('parses the sample manifest', () => {
    const m = manifestSchema.parse(JSON.parse(readFileSync('tests/fixtures/sample-alternatives/design.json', 'utf8')))
    assert.equal(m.artboards.length, 6)
  })
  test('rejects duplicate artboard ids', () => {
    assert.equal(manifestSchema.safeParse({ version: 1, title: 't', kind: 'other', artboards: [a('x'), a('x')] }).success, false)
  })
  ```
  Run `orca plugin test . --json`. Expected: FAIL (module missing).
- [ ] **Step 4:** Copy the UP shared files and add the port header. Change only the zod import path and the new constants.
- [ ] **Step 5:** `orca plugin test . --json` → PASS. `npx tsc -p .` → 0 errors. `orca plugin validate . --json` → `valid: true`.
- [ ] **Step 6:** Write `LICENSE` (MIT, two copyright lines: UP's and `2026 Lilykos`). Commit `feat: plugin scaffold with vendored zod and shared schemas`.

### Task 2: Worker store, reads (paths, manifests, comments, inline)

**Files:**
- Create: `worker/paths.ts`, `worker/inline.ts`, `worker/store.ts` (read half), `worker/workspace.ts`
- Test: `worker/store.read.test.ts`, `worker/inline.test.ts`, `worker/paths.test.ts`

**Interfaces:**
- Produces (store, same signatures as UP): `isInitialized(root)`, `listSlugs(root)`, `readManifest(root, slug): ManifestRead`, `readComments(root, slug)`, `summarize(root, slug): DesignSummary`, `designVersion(root, slug): string`, `listVersion(root)`, `readDesignAgents(root): Record<string,string>` (reads `canvas.design.json`, then falls back to Paseo's `canvas.json`), and `viewArtboard(root, slug, artboardId): ArtboardView` (new, split out of UP `viewDesign`).
- Produces: `viewDesignMeta(root, slug): DesignView` with every `artboards[i].html = null` (new). The editor fetches the HTML through chunks (Task 5).
- Produces (workspace.ts): `resolveRoot(host, workspaceId: string): Promise<string>`. Throws `HostError('invalid_params')` for an unknown id. It caches the answer for 10 s.
- Fix #6 lives in `UP/client/runtime.ts` (Task 9), not here.

- [ ] **Step 1: Failing tests:** `listSlugs` on a tmp copy of the fixtures returns `['sample-alternatives','minimal']` and ignores `.trash` and dotfolders. `readManifest` on a file holding `{"version":1,` returns `{ manifest: null, error: /JSON/ }`. `resolveInside(root, dir, '../../etc/passwd')` rejects with `PathError`. A symlink from `design/x/a.css` to `/tmp` is refused by `inlineHtml`. `inlineHtml` turns `<img src="assets/p.png">` into a `data:image/png;base64,` URL.
- [ ] **Step 2:** Run `orca plugin test . --json` → FAIL.
- [ ] **Step 3:** Port UP paths/inline/store reads. `resolveRoot` calls `host.call('workspace.list', {})` and matches `id`.
- [ ] **Step 4:** Tests PASS, then commit `feat(worker): design store reads`.

### Task 3: Worker store, writes (comments, moves, text, tweaks, trash, rename)

**Files:**
- Create: `worker/html-patch.ts`. Modify: `worker/store.ts` (write half)
- Test: `worker/html-patch.test.ts`, `worker/store.write.test.ts`

**Interfaces:**
- Produces (as UP): `writeFileAtomic`, `initCanvas(root)` (now also writes `canvas.design.json` when missing and copies `assets/dc.mjs` to `design/.canvas/dc.mjs` once Task 10 exists; until then it skips the copy when the asset is absent), `addComment`, `editComment`, `deleteComment`, `markSent`, `resolveComments`, `moveElement(root, slug, artboardId, dcId, style, expected)`, `editText(...)`, `moveArtboard(...)`, `readTweakValues`, `saveTweaks`, `setTweaks`, `trashDesign`, `renameDesign`, `rememberDesignAgent(root, slug, sessionId)` (writes `canvas.design.json`, never `canvas.json`), and `ConflictError`.

- [ ] **Step 1: Failing tests:**
  - `moveElement refuses a stale version`: call `moveElement` with `expected: 'old'` after changing the file, and it rejects with `ConflictError`; the file is unchanged.
  - `editText keeps entities`: `<p data-dc-id="p">Tom &amp; Jerry</p>`, editing `Tom` → `Tim`, gives `Tim &amp; Jerry`.
  - `comment numbers never repeat`: add, delete, add → numbers 1 and then 2.
  - `trash moves to .trash`: the folder now exists under `design/.trash/<slug>-<ts>`.
  - `initCanvas is idempotent and keeps a hand-written README`.
- [ ] **Step 2:** FAIL. **Step 3:** Port UP html-patch and the store writes. **Step 4:** PASS. **Step 5:** Commit `feat(worker): design store writes`.

### Task 4: Zip export and import (chunked)

**Files:**
- Create: `worker/zip.ts`, `worker/chunks.ts`. Modify: `worker/store.ts` (`exportDesign`, `importDesign`)
- Test: `worker/zip.test.ts`, `worker/chunks.test.ts`

**Interfaces:**
- Produces (chunks.ts): `CHUNK = 786_432`; `sliceChunk(text: string, offset: number): { chunk: string; offset: number; total: number; done: boolean }`; and an `UploadBuffer` class with `begin(): string` (returns an id), `append(id: string, part: string)`, `take(id: string): string`, which drops buffers left idle for 60 s and caps an upload at 70 MB of base64.

- [ ] **Step 1: Failing tests:** an export→import round trip of the minimal fixture into a second root gives the same files, and the slug becomes `minimal-2` when it's taken. A zip entry `../evil` is refused. `sliceChunk` over a 2 MB string reassembles exactly. `UploadBuffer.take` of an unknown id throws.
- [ ] **Step 2:** FAIL. **Step 3:** Port UP zip/export/import. **Step 4:** PASS. **Step 5:** Commit `feat(worker): zip export/import with chunking`.

### Task 5: Worker handlers, protocol and watcher

**Files:**
- Create: `shared/protocol.ts`, `worker/watch.ts`, `worker/handlers.ts`. Modify: `worker/index.ts`
- Test: `worker/handlers.test.ts` (with `mountWorker` and `mockHost`)

**Interfaces:**
- Produces (`shared/protocol.ts`, `declare module 'orca'`). Every input includes `ws: string` (the workspaceId):

  | Request | Input (besides `ws`) | Output |
  |---|---|---|
  | `dc.context` | – | `{ root: string \| null; initialized: boolean; displayName: string }` |
  | `dc.init` | – | `{ created: boolean }` |
  | `dc.list` | – | `DesignList` (UP canvas.ts) |
  | `dc.design` | `slug` | `DesignView` with `html: null` |
  | `dc.artboard` | `slug, artboardId, offset` | `{ chunk, offset, total, done, version, error: string \| null }` |
  | `dc.comment.add` / `.update` / `.delete` / `.markSent` | as UP `CanvasApi` | as UP |
  | `dc.moveElement` / `dc.editText` / `dc.moveArtboard` / `dc.saveTweaks` / `dc.rename` / `dc.trash` | as UP `CanvasApi` | as UP; a `ConflictError` throws code `conflict` |
  | `dc.export` | `slug, offset` | `{ fileName, chunk, offset, total, done }` (base64) |
  | `dc.import.begin` / `dc.import.part` / `dc.import.commit` | – / `id, part` / `id` | `{ id }` / `{}` / `ImportResult` |
  | `dc.watch` | – | `{}`; afterwards posts `dc.changed` |

  Events: `dc.changed: { ws: string; slugs: string[]; list: boolean }`, where `list` is true when a design folder was added or removed.
- Produces (`watch.ts`): `watchRoot(root: string, onChange: (paths: string[]) => void): () => void`. Recursive `fs.watch` on `design/`, ignoring any path segment that starts with `.`, debounced 150 ms, one watcher per root shared by all editors (reference-counted).

- [ ] **Step 1: Failing tests** (`mockHost({ results: { 'workspace.list': { workspaces: [{ id: 'w1', path: tmp, ... }] } } })`):
  - `context reports uninitialized without creating files`: `dc.context` gives `initialized: false`, and `design/` doesn't exist afterwards.
  - `artboard chunks reassemble a 2 MiB page`: the fixture page embeds a 1.5 MB PNG. Loop `dc.artboard` until `done`; the joined chunks equal `inlineHtml(...)`, and every answer's `JSON.stringify` length is under 1 MiB.
  - `design view reports a broken manifest and recovers`: write `{"version":1,`, and `dc.design` gives `error` and `manifest: null`. Write the valid file, and the next call gives `manifest`.
  - `watch posts once per burst`: three writes within 50 ms produce one `dc.changed` post with the slug.
  - `unknown workspace is invalid_params`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Every handler calls `resolveRoot` first. **Step 4:** PASS, then `orca plugin dev request . dc.list --data '{"ws":"<real id>"}'` on this repo's workspace answers. **Step 5:** Commit `feat(worker): dc.* handlers and watcher`.

### Task 6: Agent bridge

**Files:**
- Create: `worker/agents.ts`. Modify: `shared/protocol.ts`, `worker/handlers.ts`
- Test: `worker/agents.test.ts`

**Interfaces:**
- Produces: `type AgentRow = { terminalId: string | null; title: string | null; agent: string | null; state: string; sessionId: string | null }` (the `agents.list` row shape).
- Produces: `pickTarget(rows: AgentRow[], preferredSession: string | null): { kind: 'one'; row: AgentRow } | { kind: 'choose'; rows: AgentRow[] } | { kind: 'none' }`. It drops rows with `agent === null` or `terminalId === null`. A row matching `preferredSession` wins; a single remaining row wins.
- Produces: `writeRequest(root, slug | null, kind: 'comments'|'tweaks'|'apply-tweaks'|'new', text): Promise<string>`, which returns the workspace-relative path `design/<slug>/.requests/<yyyymmdd-hhmmss>-<kind>.md` (or `design/.requests/…` when `slug` is null).
- Produces: `pointerLine(relPath) = \`Read ${relPath} and do what it asks.\``
- Requests: `dc.agents { ws, slug? } → { rows: AgentRow[]; preferred: string | null }`; `dc.send { ws, slug, kind, text, terminalId? } → { terminalId: string; request: string }`; `dc.start { ws, brief, kind?, agent }`, which calls `agent.launch` with `prompt: pointerLine(...)` and returns `{ terminalId }`.
- `dc.send`, when `terminalId` is absent, uses `pickTarget`. On `choose` or `none` it throws code `invalid_params` with message `choose-agent` or `no-agent` (the editor opens the picker). When the preferred session exists but isn't running, it uses `agent.resume({ workspaceId, agent, sessionId })` and waits for the agent to show in `agents.list` (polling 500 ms, 20 s max) before typing.
- `dc.start` records the new agent's session (from `agents.list` once it appears) with `rememberDesignAgent` when the design shows up.

- [ ] **Step 1: Failing tests:** `pickTarget never chooses a shell terminal` (rows with `agent: null` are ignored, so the result is `none`); preferred session wins over two rows; the request file contains the text exactly; `dc.send` calls `terminal.sendText` with `{ text: pointerLine(path), enter: true }` (assert on `host.calls`).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Manual check:** in a scratch workspace with Claude Code running, run `orca plugin dev request . dc.send --data '{"ws":"…","slug":"minimal","kind":"comments","text":"Say hi"}'`. Claude receives one line and reads the file. Commit `feat(worker): agent bridge via request files`.

## Phase 1: Canvas

### Task 7: Editor shell and canvas port

**Files:**
- Create: `editor/main.ts`, `editor/api.ts`, plus `editor/canvas.ts runtime.ts layout.ts styles.ts icons.ts files.ts cursors.ts i18n.ts locales/en.json` (copied from UP/client)
- Modify: `orca-plugin.json` (`customEditors: [{ id: "canvas", title: "Design canvas", extensions: [".design.json"], entry: "editor/main.ts", frame: "isolated", priority: "default" }]`)
- Test: `editor/api.test.ts`

**Interfaces:**
- Consumes: Task 5/6 requests.
- Produces: `createApi(ws: string, request: typeof orca.plugin.request): CanvasApi` (UP canvas.ts `CanvasApi`, unchanged). `getDesign` = `dc.design`, then `dc.artboard` chunks per board in parallel (at most 3 at once). `getDesignVersion` = `dc.design`'s `version`. `exportDesign` assembles `dc.export` chunks. `importDesign(base64)` goes begin/part/commit. `sendToAgent(text)` = `dc.send`, and on `choose-agent`/`no-agent` defers to the send sheet (Task 9; until then, an error toast). `startDesign(brief)` = `dc.init`, then `sendToAgent(newDesignPrompt(brief))` (an editor has no agent of its own, so it goes through the same target choice; on `no-agent` the sheet offers Launch, which is `dc.start`).
- Changes to `canvas.ts`: drop `PluginClientContext` and React; `pollMs` defaults to `0` (off). New `CanvasHandle.refresh(slugs: string[], list: boolean)`, called from `dc.changed`, does what one poll tick did. `ThemeColors` comes from `getComputedStyle(document.documentElement)` `--orca-*` vars and is re-read on `orca.on('theme')`.
- `main.ts`: `readContext` → `ws` → `dc.context` → `dc.watch` → `mountCanvas({ host: document.body, api, theme, t, initialSlug: storage 'last:<ws>' ?? null, onSlugChange })`. The document content (canvas.design.json) is only read, never edited, by the canvas.

- [ ] **Step 1: Failing test** `editor/api.test.ts`: with a fake `request` answering `dc.artboard` in three chunks, `getDesign('x')` gives `artboards[0].html` equal to the concatenation, and the fake saw `offset` values `0, CHUNK, 2*CHUNK`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement `api.ts` and port the client files, with the port header and the changes above. **Step 4:** PASS, `npx tsc -p .` clean.
- [ ] **Step 5: Visual check.** Copy the fixtures into this repo's `design/`, `orca plugin dev load . --json` (show the approval to the person, approve only with their yes), then `orca plugin shot design-canvas --editor design/canvas.design.json --width 1400 --height 900`. Expected: six artboards render, with Mac and iPhone rows. Read the PNG.
- [ ] **Step 6: Default-open check.** Click `design/canvas.design.json` in Orca's explorer: it opens in "Design canvas", not Source. If not, rename the entry to `design/canvas.dcanvas` (and update `CANVAS_ENTRY` and the manifest `extensions`), then re-check.
- [ ] **Step 7:** Live check: edit an artboard's HTML on disk, and the board reloads within 1 s with no full canvas reload. Commit `feat(editor): canvas in an Orca custom editor`.

### Task 8: Layout fixes (#1 labels, #2 no re-fit, #8 packing)

**Files:**
- Modify: `editor/layout.ts`, `editor/canvas.ts`
- Test: `editor/layout.test.ts`

**Interfaces:**
- Produces: `layoutBoards(boards: readonly BoardSize[], maxRowWidth?: number): Placed[]`. Groups stay together; a group wider than `maxRowWidth = max(3 × widest, 4000)` wraps onto continuation rows; small consecutive groups share a row when they fit.
- Produces: `fitLabel(parts: { title: string; size: string; group?: string }, maxPx: number, measure: (s: string) => number): string`. It drops `group`, then `size`, then ellipsizes `title`; the result never measures more than `maxPx`.

- [ ] **Step 1: Failing tests:** 19 artboards of 1440 px in one group occupy ≥ 5 rows and no row is wider than `maxRowWidth`; two groups of 3 × 390 px share one row; `fitLabel({title:'01 · Reading Desk · iPhone', size:'390 × 844', group:'iPhone companions'}, 97, monoMeasure)` measures ≤ 97 and starts with `01 · Rea`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. In `canvas.ts`, labels call `fitLabel` with `artboardWidth × zoom` on every zoom change (rAF-throttled). Opening or closing the side panel calls `zoomAt` around the old centre instead of `fitView`.
- [ ] **Step 4:** PASS. Shot at 19% shows no overlapping labels (compare with `docs/reference/paseo-screens/04-panel.png`). Commit `fix(canvas): labels fit, panel keeps zoom, rows wrap`.

### Task 9: Comment fixes (#4 pins, #5 picking, #6 anchor text, #7 send preview)

**Files:**
- Modify: `editor/runtime.ts`, `editor/canvas.ts`, `editor/styles.ts`. Create: `editor/send-sheet.ts`, `editor/runtime-helpers.ts`
- Test: `editor/runtime.test.ts` (pure helpers exported from the runtime source), `editor/send-sheet.test.ts`

**Interfaces:**
- Produces (pure functions in `editor/runtime-helpers.ts`, also inlined into `RUNTIME_SOURCE` by `String(fn)`): `anchorText(el: Element): string` (joins the text of block and inline children with ` · `, collapses whitespace, cuts at 200 characters); `pinPosition(rect: Rect, page: { width: number }, zoom: number): { x: number; y: number }` (20/zoom px pin, just outside the top-right corner, clamped inside the page).
- Runtime messages: new `ToRuntime` `{ type: 'pick-step'; dir: 'parent' | 'child' }` and a `pick` reply carrying `crumbs: string[]` (at most 3 labels: `dcId ?? tag`).
- Produces: `openSendSheet(opts: { text: string; rows: AgentRow[]; preferred: string | null; onSend(terminalId: string): Promise<void>; onLaunch(agent: string): Promise<void> }): void`. It shows the exact text (read-only, monospace), an agent `<select>` (or "No agent running: Launch Claude" when the list is empty), and Send/Cancel.

- [ ] **Step 1: Failing tests:** `anchorText` of a book card gives `An Ordinary Wonder · A COLLECTION · IRIS BELL · An Ordinary Wonder · Iris Bell`; `pinPosition` at zoom 0.25 gives a pin of 80 page px (20 on screen) clamped inside the page width; the send sheet with zero rows shows the Launch button and no Send.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. In the comment popover, ↑/↓ send `pick-step` and the breadcrumb renders above the textarea. "Send N to the agent" first calls `dc.agents`, then opens the sheet with `commentsPrompt(...)`.
- [ ] **Step 4:** PASS. Manual check: pin a comment at 25%; the pin doesn't cover the element; ↑ selects the grid; Send shows the preview. Commit `fix(canvas): pins, parent picking, anchor text, send preview`.

## Phase 2: Agent CLI

### Task 10: `dc.mjs` CLI and the agent guide

**Files:**
- Create: `tools/dc.ts`, `assets/dc.mjs` (bundled by `scripts/vendor.mjs`)
- Modify: `worker/guide.ts`, `shared/prompts.ts`, `worker/store.ts` (`initCanvas` copies the CLI and refreshes it when the plugin's copy is newer)
- Test: `tools/dc.test.ts` (runs `node assets/dc.mjs` in a tmp root with `execFileSync`)

**Interfaces:**
- Commands, run from the workspace root, printing JSON on stdout, exit 0 ok / 1 usage / 2 invalid:
  - `create <slug> --title T --kind K [--artboard id:file:width[:height][:group]]…`: as UP `design_create`; writes placeholder pages.
  - `list` and `read <slug>`: as UP `design_list` and `design_read` (comments, tweaks, values).
  - `resolve <slug> <commentId> <note> [<commentId> <note>]…`: as UP `design_resolve_comments`.
  - `tweaks <slug> <json-file>`: as UP `design_set_tweaks`.
  - `validate [slug]`: schema-checks every manifest and comments file, and checks that each page exists and has at least one `data-dc-id`.
- The prompts replace every `design_*` tool mention with the matching `node design/.canvas/dc.mjs …` line. The guide (README) documents the commands and keeps UP's conventions text.

- [ ] **Step 1: Failing tests:** `create demo --title Demo --kind wireframe --artboard home:home.html:390` makes a valid manifest and page; `resolve` marks the comment `resolved` with the note; `validate` on a manifest with duplicate ids exits 2 and names the id.
- [ ] **Step 2:** FAIL. **Step 3:** Implement and bundle (`esbuild tools/dc.ts --bundle --platform=node --format=esm`). **Step 4:** PASS.
- [ ] **Step 5:** End-to-end check: from the canvas, send a real comment to Claude in a scratch workspace; the agent edits the page and runs `resolve`; the pin turns green without a reload. Commit `feat: agent CLI replaces Paseo agent tools`.

## Phase 3: Home and commands

### Task 11: Commands, status bar item, keybinding

**Files:**
- Modify: `orca-plugin.json`, `worker/index.ts`, `worker/handlers.ts`
- Test: `worker/commands.test.ts`

**Interfaces:**
- Commands: `design.openCanvas` ("Design: Open canvas", key `Mod+Shift+D`) runs `initCanvas` on the focused workspace, then `editor.open({ workspaceId, path: 'design/canvas.design.json' })`. `design.newDesign` ("Design: New design…") opens the canvas with `?new=1` stored in storage `pendingNew:<ws>`, which the editor reads to focus the brief box.
- Status bar item `design` (icon `layers`, text `Design`, command `design.openCanvas`), hidden by the worker while the focused workspace has no `design/` (`workspace.changed` event).

- [ ] **Step 1: Failing test:** running `design.openCanvas` with a mock host whose `workspace.readContext` gives `w1` creates `design/canvas.design.json` and calls `editor.open` with that path.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, `orca plugin validate` clean. Commit `feat: open-canvas command, status bar item`.

### Task 12: Home panel (#3)

**Files:**
- Create: `panel/home.html`, `panel/home.ts`. Modify: `orca-plugin.json` (`panels: [{ id: "home", title: "Design", icon: "layers", entry: "panel/home.html" }]`), `worker/handlers.ts`
- Test: `worker/home.test.ts`

**Interfaces:**
- Requests: `dc.home → { designs: { ws, workspaceName, project, slug, title, updatedAt }[] }` across `workspace.list`, newest 24; `dc.cover { ws, slug, offset }` gives the first artboard's HTML through chunks (thumbnail); `dc.open { ws, slug }` calls `workspace.open`, sets storage `last:<ws> = slug`, then `editor.open` on the canvas entry (fix #3: one request does all of it, so navigation can't half-happen).
- Composer: kind tabs (prototype → wireframe or high fidelity, other), brief textarea, project picker (`project.list`), and agent select (default `claude`). Create runs `dc.start`. Import takes a zip by drop or button through `dc.import.*` into the chosen workspace.
- Thumbnails: sandboxed iframes scaled with CSS `transform`, lazy-loaded with `IntersectionObserver`.

- [ ] **Step 1: Failing test:** `dc.home` over two mock workspaces, one with two designs, gives 2 rows sorted by `updatedAt` descending; `dc.open` calls `workspace.open`, then `editor.open`, in that order.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. `orca plugin shot design-canvas --panel home` shows the designs. Click one, and the canvas opens on it. Commit `feat: home panel with recents and composer`.

## Phase 4: Ship

### Task 13: QA, docs, local install

**Files:**
- Create: `README.md` (install, usage, CLI, security; adapted from UP README), `CHANGELOG.md` (0.1.0), `docs/QA.md`
- Modify: `orca-plugin.json` (`version: "0.1.0"`, icon `assets/icon.png` drawn fresh, not UP's)

- [ ] **Step 1:** `docs/QA.md` lists the manual checks from Tasks 7–12 plus: open three Paseo-made designs (19-board identity design included) unchanged; undo and redo of a move and a text edit; tweaks hover highlighting on a fixture with tweaks; export, then import into another workspace; trash, then restore.
- [ ] **Step 2:** Run every QA item and tick it in the file. Fix failures under the owning task's tests first.
- [ ] **Step 3:** `orca plugin test . --json`, `orca plugin check . --json`, `npx tsc -p .` and `orca plugin validate . --json`: all clean. Show `orca plugin inspect . --json` to the person.
- [ ] **Step 4:** With the person's approval, `orca plugin install` from the folder. Commit `chore: 0.1.0`.
