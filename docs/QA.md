# QA record — 0.1.0 (2026-11-25, Orca 1.4.274, macOS)

Live = checked in the running Orca app (dev plugin, playground workspace or this repo before the move).
Unit = covered by `orca plugin test .` only.

| Check | How | Result |
|---|---|---|
| Folio designs open unchanged (3, 6 and 19 artboards) | Live | ✅ render, runtime ready, sizes reported |
| Page edited on disk reloads its board | Live | ✅ under 2 s, no full reload |
| Labels fit at 6–25% zoom; no overlap across rows | Live | ✅ |
| 19-artboard design lays out as a grid | Live | ✅ 5 per row at 10% |
| Toggling the side panel keeps zoom | Live | ✅ stayed 10% |
| Comment pick, breadcrumb, step to parent | Live | ✅ |
| Pin placement outside the element corner | Live + harness | ✅ (draws once the window is visible) |
| Anchor text with " · " | Live | ✅ |
| Send sheet: preview, no-agent → Start Claude, Cancel sends nothing | Live | ✅ |
| Agent receives pointer, edits page, resolves via CLI | Live (Claude Code) | ✅ comment resolved with note |
| Start Claude (dc.launch) outside the plugin folder | Live | ✅ prompt typed after start-up |
| Workspace opened at `design/` itself | Live | ✅ |
| Status bar item | Live | ✅ shown |
| Home panel: composer, recents, thumbnails | Live | ✅ |
| Home panel: open a design → its canvas | Unit | ✅ order workspace.open → editor.open |
| Move element / text edit + undo/redo | Unit (store) | ⚠️ not exercised live |
| Tweaks panel and hover highlighting | — | ⚠️ not exercised (no fixture with tweaks) |
| Export (save dialog) / import zip | Unit (round trip) | ⚠️ dialog not exercised live |
| Trash then restore by moving the folder back | Unit | ⚠️ not exercised live |
| Explorer click opens canvas.design.json in the canvas by default | — | ⚠️ not checked (opened via `orca plugin open`) |
| Picker preselects the focused workspace (folder workspaces) | Live | ❌ picks the first; minor, deferred |
