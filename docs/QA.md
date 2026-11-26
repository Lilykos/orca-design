# QA record — 0.1.0 (2026-11-25, Orca 1.4.274, macOS)

Live = checked in the running Orca app (dev plugin, with Paseo-made designs in a separate workspace).
Unit = covered by `orca plugin test .` only.

| Check | How | Result |
|---|---|---|
| Paseo-made designs open unchanged (3, 6 and 19 artboards) | Live | ✅ render, runtime ready, sizes reported |
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
| Home panel: open a design → its canvas | Live (dc.open) | ✅ canvas switched to the design |
| Move element (arrow nudges and a mouse drag) + undo/redo | Live (2026-11-26) | ✅ `translate` written; each nudge is one undo step; undoing all leaves no `style` |
| Text edit in place (Enter, type, Enter) + undo | Live (2026-11-26) | ✅ written and restored |
| Tweaks: color, range, toggle; live apply; tweaks.json/tweaks.css; Reset; hover outlines | Live (2026-11-26) | ✅ ("Write into design" and "Ask the agent for tweaks" not run: they message an agent, same path as comments) |
| Export via Orca's save dialog | Live (2026-11-26) | ✅ dialog appears after chunked download; zip correct, but includes `.requests/` (#19) |
| Import zip from the canvas menu | Live (2026-11-26) | ✅ imported as `minimal-2`; same title as the original (#20) |
| Delete to `.trash/`, restore by moving the folder back | Live (2026-11-26) | ✅ (confirm buttons clipped, #22) |
| Explorer click opens canvas.design.json in the canvas by default | Live (2026-11-26) | ✅ |
| Home panel picker preselects the focused workspace | Live | ❌ picks the first (#11) |
| Home panel thumbnails of narrow artboards | Live | ❌ upscaled (#21) |
| Side panel footer vs Orca's floating button | Live | ❌ overlaps (#23) |
| Design menu order | Live | ⚠️ by folder, not title (#24) |
