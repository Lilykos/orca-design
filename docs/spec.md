# Orca Design Canvas: spec

A port of the MIT-licensed Paseo plugin `paseo-design-canvas` 0.4.1
(github.com/961853266hyt/paseo-plugins, `plugins/design-canvas`, © 2026 961853266hyt) to an
**Orca plugin**, with fixes for problems seen in real use. Reference screenshots of the original
are in `docs/reference/paseo-screens/`. Feasibility is proven in `spikes/canvas-host/FINDINGS.md`.

## What it does

An agent draws designs as self-contained HTML pages ("artboards") under `design/` in a workspace.
A canvas shows them side by side. The person can point at what should change, move elements, fix
text and tune values. The agent then revises the files. The designs stay in the repo, so the agent
can build them afterwards.

## Files (format compatible with Paseo 0.4.1)

Everything lives under `design/` in the workspace:

| Path | Meaning |
|---|---|
| `design/canvas.design.json` | **New.** Opens the canvas: Orca's custom editor takes `.design.json`. Holds `{ "version": 1, "agents": { <slug>: <sessionId> } }` |
| `design/canvas.json` | Paseo's marker. Read for `agents` if present, and never written |
| `design/README.md` | The conventions for agents. Rewritten when it is an older copy of our guide; a README the person wrote is left alone |
| `design/.canvas/dc.mjs` | **New.** The agent CLI (replaces Paseo's agent tools) |
| `design/<slug>/design.json` | Manifest: `version`, `title`, `kind`, `description?`, `artboards[]` (`id`, `title`, `file`, `width`, `height?`, `group?`, `x?`, `y?`), `tweaks?` |
| `design/<slug>/<artboard>.html` | One page per artboard, with local CSS, images and fonts only |
| `design/<slug>/comments.json` | `{ version: 1, nextNumber, comments[] }`, with anchors as in Paseo |
| `design/<slug>/tweaks.json`, `tweaks.css` | Tweak values set on the canvas |
| `design/<slug>/.requests/<ts>-<kind>.md` | **New.** Each prompt the canvas sends to an agent, kept as a record |
| `design/.trash/<slug>-<ts>/` | Deleted designs |

The existing designs in `~/orca/projects/folio/design/` must open unchanged.

## Surfaces in Orca

| Paseo | Orca |
|---|---|
| A Design tab per agent | Custom editor `canvas` on `.design.json` (`frame: "isolated"`): the full canvas in an editor tab |
| Server RPC | The worker's `orca.panels.handle("dc.*")` |
| Polling for changes | `fs.watch` in the worker, then `panels.post("dc.changed")`, debounced 150 ms, ignoring dotfiles |
| Send message to the agent | Write `.requests/<ts>-<kind>.md`, then `terminal.sendText` with one line: `Read design/<slug>/.requests/<file> and do what it asks.` and Enter |
| Agent tools (`design_create`, …) | `node design/.canvas/dc.mjs <cmd>`, described in the README |
| Home screen (sidebar) | HTML sidebar panel `home`: recent designs from all workspaces with live thumbnails, and a new-design composer |
| Command Center, `/canvas` | Palette commands `Design: Open canvas` and `Design: New design…`, plus a keybinding |
| Design pill above the composer | None (Orca has no composer pills). The status bar item `Design` opens the canvas |

## Features to keep (the Paseo 0.4.1 feature set)

Design picker; zoom, pan, fit and grid; tools Move (V), Hand (H/Space), Comment (C), Preview (P);
comment pins with send, resolve and reopen; text editing in place; element and artboard moves with
undo and redo; Tweaks panel with hover highlighting; rename, trash, export and import as zip; an
empty-canvas brief; the same CSP and sandbox for artboards.

## Fixes and improvements (from real use, see screenshots)

1. **Labels:** an artboard label never paints wider than its artboard on screen. It drops the size,
   then the group, then truncates the title with an ellipsis.
2. **No re-fit:** opening or closing the side panel keeps the zoom and the point under the centre.
3. **Home → canvas:** opening a design from the home panel always opens its workspace and the canvas
   on that design.
4. **Pins:** a fixed 20 px on screen at any zoom, anchored outside the element's top-right corner and
   kept inside the artboard.
5. **Picking:** in the comment popover, ↑ selects the parent element and ↓ the previous child, and a
   breadcrumb shows `parent › element`.
6. **Anchor text:** the text of separate elements is joined with ` · `, whitespace collapsed, and cut
   at 200 characters.
7. **Send preview:** "Send N to the agent" opens a sheet with the exact request text and the target
   agent (a picker when there are several), then Send.
8. **Layout:** groups are packed into rows no wider than `max(3 × widest artboard, 4000 px)`, and a
   group wider than that wraps onto continuation rows.
9. **Agent target:** prefer the agent session recorded for the design; else the only agent in the
   workspace; else ask. If the recorded session isn't running, resume it (`agent.resume`).
10. **CLI validation:** `dc.mjs validate` checks the manifests, comments and pages. The canvas shows
    a broken manifest's error in place of the design.

## Non-goals

Resizing elements; phone and browser clients (the editor needs the desktop app); real-time
multi-user editing; a design-system library; network fonts and CDNs (blocked by the CSP, as in Paseo).

## Security

As in Paseo: artboards run in a `sandbox="allow-scripts"` iframe with the design CSP. The worker
reads and writes only under `<workspace>/design/` (real paths, symlinks checked). The plugin is
`trusted-worker` with the capabilities `workspace:read`, `workspace:write`, `agent:read`,
`agent:launch`, `terminal:send`, `storage:own` and `notifications:show`, which the person approves
at install.
