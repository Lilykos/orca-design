# Spike findings (2026-11-25, Orca 1.4.274)

Plugin `local.dc-spike`: a trusted-worker plugin with a custom editor on `.design.json`.

| Question | Result |
|---|---|
| Sandboxed `srcdoc` iframe (`allow-scripts`) inside an isolated editor frame | Works. The editor frame has no CSP meta, so the iframe's own CSP applies |
| Inline `<script>`, inline `<style>`, `onclick=""`, `data:` images in the artboard | All run or load |
| `postMessage` iframe → editor | Works |
| `workspace.readContext` from the editor | Returns the focused workspace id (an `identity:…` id) |
| Worker `workspace.list` → workspace path, then `node:fs` reads | Works |
| `plugin.request` answer size | 900 000 chars OK; 1 100 000 → `too_large` ("more than 1 MiB"). Chunk at ≤ 768 KiB |
| `fs.watch(dir, {recursive:true})` → `panels.post` → editor `plugin.on` | Delivered in about 20 ms. Fires twice per save, plus editor temp files (`.!16214!a.html`): debounce, and ignore dotfiles |
| Editor origin | `orca-plugin-frame://<hash>` |
