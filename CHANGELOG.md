# Changelog

## 0.1.0

First Orca release, ported from paseo-design-canvas 0.4.1 (canvas, comments, moves, text editing,
tweaks, export/import, trash), with:

- **Orca integration:** the canvas is a custom editor on `design/canvas.design.json`; a Node worker does
  all file work and pushes changes as they happen; commands, a shortcut, a status bar item and a
  **Design** home panel replace Paseo's Command Center entry, `/canvas`, pill and home screen.
- **Agent bridge:** requests are written to `.requests/` and the agent gets one line pointing at them;
  sessions are recorded per design and resumed; a bundled CLI replaces Paseo's agent tools.
- **Labels** never paint wider than their artboard; rows keep screen-sized room for them at any zoom.
- **Layout** wraps groups into rows shaped like the viewport (a 19-artboard design is a grid, not a strip).
- **Opening the side panel** keeps the zoom and centre instead of re-fitting.
- **Opening a design** from the home panel always lands on its canvas.
- **Pins** sit outside their element's corner at a fixed 20 px, so they never cover what they point at.
- **Picking** shows a breadcrumb and steps to the parent element and back.
- **Anchor text** separates an element's text pieces with " · ".
- **Send preview:** every send shows the exact request and the agent it goes to.
- Workspaces Orca opened at `design/` itself work; pages over 1 MiB load in chunks.
- **Resize** named elements from the selection's corner handle (Shift keeps the ratio), with undo.
- **Home panel** preselects the focused workspace and never defaults to an unrelated one; thumbnails no
  longer blow up narrow artboards.
- **Safer files:** exports and imports leave out `.requests/`; `design/.canvas/` and `.requests/` get a
  `.gitignore`; writes refuse folders symlinked outside `design/`; an imported copy is titled "(2)".
- **Sturdier transfers:** smaller, surrogate-safe chunks; longer timeouts for starting agents; a write
  that races an agent's edit is refused; pages render once per load and unchanged ones aren't refetched.
- Plugin icon; the design menu is sorted by title; small layout fixes in the menu and side panel.
