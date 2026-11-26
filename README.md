# Design canvas for Orca

Where you and your agents design together, in [Orca](https://github.com/stablyai/orca). Your agent draws
designs as HTML artboards in `design/`; you look at them side by side on a canvas, point at what should
change, move things, fix text and tune values, and the agent revises. The designs are files in your repo,
so the agent that drew them can build them too.

A port of the MIT-licensed Paseo plugin
[paseo-design-canvas](https://github.com/961853266hyt/paseo-plugins/tree/main/plugins/design-canvas)
0.4.1, with fixes for what got in the way in real use (see [CHANGELOG](CHANGELOG.md)). Designs made with
the Paseo plugin open unchanged.

## Use it

- **Design: Open canvas** (`Cmd/Ctrl+Alt+D`, the command palette, or **Design** in the status bar) opens
  the focused workspace's canvas in an editor tab. It creates `design/canvas.design.json` the first time.
- **Design: New design…** opens the canvas on its new-design card. The **Design** panel in the right
  sidebar also starts designs (prototype — wireframe or high fidelity — or other, a workspace and an agent),
  imports exported zips, and lists recent designs from every workspace with live thumbnails.
- On the canvas: **Move** (V), **Hand** (H, or hold Space), **Comment** (C), **Preview** (P); scroll to pan,
  `Cmd/Ctrl`+scroll to zoom, `Cmd/Ctrl+0` to fit, `Shift+G` for the layout grid; `Cmd/Ctrl+Z` undoes moves
  and text edits.
- **Comment** picks the nearest named element (Alt+click: the exact one). The popover's breadcrumb steps
  to the parent (↑, or Alt+↑) and back (↓). Comments wait as numbered pins until **Send to the agent**,
  which shows the exact request and lets you pick the agent — or start Claude when none is running.
- **Tweaks** shows the controls the agent declared (colors, sliders, switches, choices); every artboard
  follows as you drag, and the values are saved to the design's `tweaks.css`.

## How the agent hears you

Orca plugins can't add agent tools yet, so the canvas writes each request to
`design/<slug>/.requests/<time>-<kind>.md` and types one line into the agent's terminal:
`Read design/<slug>/.requests/… and do what it asks.` It goes to the agent that drew the design (resumed if
it was closed), else the only agent in the workspace, else the one you pick.

Agents work with a small CLI the canvas installs at `design/.canvas/dc.mjs` (guide:
`design/.canvas/GUIDE.md`):

```bash
node design/.canvas/dc.mjs create <slug> '<json>'      # set a design up
node design/.canvas/dc.mjs list | read <slug> [--all]  # what's there, open comments, tweak values
node design/.canvas/dc.mjs resolve <slug> 1 "what changed" 2 "what changed"
node design/.canvas/dc.mjs tweaks <slug> '<json list>'
node design/.canvas/dc.mjs validate [slug]
```

## Files

Everything lives under `design/`: `<slug>/design.json` (artboards, tweaks), one `<artboard>.html` per
artboard, `comments.json`, `tweaks.json`/`tweaks.css`, and `.requests/`; `canvas.design.json` opens the
canvas and remembers which agent session drew each design; `.canvas/` holds the CLI and guide. A
`design/README.md` you (or Paseo) wrote is left alone.

## Security

The plugin runs a Node worker with your user's access (`trusted-worker`) and asks for: `workspace:read`,
`workspace:write`, `agent:read`, `agent:launch`, `terminal:send` (only to type the one-line pointer into an
agent), `storage:own`, `notifications:show`. The worker reads and writes only under each workspace's
`design/`, refusing paths and symlinks that lead outside it. Artboards run in sandboxed iframes with a
content security policy that blocks network loads; a design's own script can still navigate its frame,
so open only designs you trust.

## Develop

```bash
npm install && npm run vendor      # installs the dev and test dependencies (happy-dom too); bundles vendor/zod.js and assets/dc.mjs
orca plugin types .                # once in a fresh checkout: writes the .orca/types that tsconfig.json extends
orca plugin test . && npx tsc -p . && orca plugin check .
orca plugin dev load .             # asks for approval
```

Keep test designs **outside** this folder (e.g. `../orca-design-playground/`): files written into a dev
plugin's folder hot-reload it, which interrupts requests in flight.

Licensed MIT; see [LICENSE](LICENSE) for both copyright lines.
