// The Design home panel (Paseo's home screen, in Orca's right sidebar): start a design, import one,
// and open recent designs from every workspace with a live thumbnail of their first artboard.
import "../shared/protocol";
import type { HomeDesign, HomeWorkspace } from "../shared/protocol";
import { CHUNK } from "../shared/protocol";
import { buildSrcdoc } from "../editor/runtime";
import { readChunks } from "../editor/api";

const request = (name: string, input: unknown, options?: { timeoutMs: number }) => orca.plugin.request(name as never, input as never, options) as Promise<any>;

const css = `
:root { color-scheme: light dark; }
body { margin: 0; padding: 12px; font: 13px/1.45 var(--orca-font-sans, system-ui); color: var(--orca-foreground); background: var(--orca-background); }
h2 { margin: 16px 0 8px; font-size: 12px; font-weight: 600; color: var(--orca-muted-foreground); text-transform: uppercase; letter-spacing: .04em; }
.card { border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 8px); background: var(--orca-card); padding: 10px; }
.seg { display: flex; gap: 2px; padding: 2px; border-radius: 7px; background: var(--orca-muted); margin-bottom: 8px; }
.seg button { flex: 1; border: 0; border-radius: 5px; padding: 4px 6px; background: transparent; color: var(--orca-muted-foreground); font: inherit; cursor: pointer; }
.seg button.on { background: var(--orca-background); color: var(--orca-foreground); box-shadow: 0 0 0 1px var(--orca-border); }
textarea { box-sizing: border-box; width: 100%; min-height: 84px; resize: vertical; border: 1px solid var(--orca-input); border-radius: 6px; padding: 8px;
  background: var(--orca-background); color: var(--orca-foreground); font: inherit; }
textarea:focus, select:focus, button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
.row { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
select { min-width: 0; flex: 1; height: 28px; border: 1px solid var(--orca-input); border-radius: 6px; background: var(--orca-background); color: var(--orca-foreground); font: inherit; }
.btn { height: 28px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--orca-border); background: var(--orca-secondary); color: var(--orca-secondary-foreground); font: inherit; cursor: pointer; white-space: nowrap; }
.btn.primary { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; }
.btn:disabled { opacity: .5; cursor: default; }
.hint { color: var(--orca-muted-foreground); font-size: 12px; }
.error { color: var(--orca-destructive); font-size: 12px; margin-top: 6px; }
.list { display: grid; gap: 10px; }
.design { display: block; width: 100%; text-align: left; padding: 0; border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 8px); overflow: hidden;
  background: var(--orca-card); color: inherit; font: inherit; cursor: pointer; }
.design:hover { border-color: var(--orca-ring); }
.thumb { position: relative; overflow: hidden; background: var(--orca-muted); height: 150px; pointer-events: none; }
.thumb iframe { position: absolute; left: 0; top: 0; border: 0; transform-origin: 0 0; }
.meta { padding: 8px 10px; }
.meta b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.drop { outline: 2px dashed var(--orca-ring); outline-offset: -6px; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

function fileToBase64(file: Blob): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  });
}

let workspaces: HomeWorkspace[] = [];
let designs: HomeDesign[] = [];
let kind: "wireframe" | "prototype" | "other" = "prototype";
let chosenWs: string | null = null;

const style = el("style");
style.textContent = css;
document.head.append(style);

// ---- Start a design ----
const startCard = el("div", "card");
const tabs = el("div", "seg");
const sub = el("div", "seg");
const brief = el("textarea");
brief.placeholder = "What do you want to design?";
const wsSelect = el("select");
wsSelect.title = "Workspace";
const agentSelect = el("select");
agentSelect.title = "Agent";
for (const agent of ["claude", "codex", "gemini", "opencode"]) agentSelect.append(new Option(agent, agent));
const create = el("button", "btn primary", "Create");
const importButton = el("button", "btn", "Import…");
const message = el("div", "error");

function renderTabs(): void {
  tabs.textContent = "";
  sub.textContent = "";
  const tab = (label: string, on: boolean, pick: () => void, into: HTMLElement) => {
    const b = el("button", on ? "on" : "", label);
    b.type = "button";
    b.addEventListener("click", () => {
      pick();
      renderTabs();
    });
    into.append(b);
  };
  tab("Prototype", kind !== "other", () => (kind = kind === "other" ? "prototype" : kind), tabs);
  tab("Other", kind === "other", () => (kind = "other"), tabs);
  if (kind !== "other") {
    tab("Wireframe", kind === "wireframe", () => (kind = "wireframe"), sub);
    tab("High fidelity", kind === "prototype", () => (kind = "prototype"), sub);
  }
  sub.style.display = kind === "other" ? "none" : "";
}

// Fix #11: no workspace is ever picked for the person. Until one is chosen, Create and Import stay disabled.
let starting = false;
function syncActions(): void {
  create.disabled = starting || !wsSelect.value;
  importButton.disabled = !wsSelect.value;
}

function renderWorkspaces(): void {
  const keep = wsSelect.value || chosenWs;
  wsSelect.textContent = "";
  const placeholder = new Option("Choose a workspace…", "");
  placeholder.disabled = true;
  wsSelect.append(placeholder);
  for (const ws of workspaces) wsSelect.append(new Option(ws.project && ws.project !== ws.name ? `${ws.project} · ${ws.name}` : ws.name, ws.ws));
  wsSelect.selectedIndex = 0;
  if (keep && workspaces.some((ws) => ws.ws === keep)) wsSelect.value = keep;
  chosenWs = wsSelect.value || null;
  syncActions();
}
wsSelect.addEventListener("change", () => {
  chosenWs = wsSelect.value || null;
  syncActions();
});

async function startDesign(): Promise<void> {
  const text = brief.value.trim();
  const ws = wsSelect.value;
  if (!text || !ws) return;
  starting = true;
  syncActions();
  message.textContent = "";
  try {
    await orca.storage.set("home:lastWs", ws);
    const known = designs.filter((design) => design.ws === ws).map((design) => design.slug);
    await orca.storage.set(`expectNew:${ws}`, known);
    await request("dc.start", { ws, brief: text, ...(kind === "other" ? {} : { kind }), agent: agentSelect.value }, { timeoutMs: 120000 });
    await request("dc.openCanvas", { ws });
    brief.value = "";
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    starting = false;
    syncActions();
  }
}
create.addEventListener("click", () => void startDesign());
brief.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void startDesign();
  }
});

async function importZip(file: File | null): Promise<void> {
  const ws = wsSelect.value;
  if (!file) return;
  if (!ws) {
    message.textContent = "Choose a workspace first.";
    return;
  }
  message.textContent = "";
  try {
    await orca.storage.set("home:lastWs", ws);
    const base64 = await fileToBase64(file);
    const { id } = await request("dc.import.begin", { ws });
    for (let at = 0; at < base64.length; at += CHUNK) await request("dc.import.part", { ws, id, part: base64.slice(at, at + CHUNK) });
    const result = await request("dc.import.commit", { ws, id }, { timeoutMs: 120000 });
    await request("dc.open", { ws, slug: result.slug });
    await refresh();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
}
const picker = el("input");
picker.type = "file";
picker.accept = ".zip,application/zip";
picker.style.display = "none";
picker.addEventListener("change", () => void importZip(picker.files?.[0] ?? null));
importButton.addEventListener("click", () => picker.click());
document.body.addEventListener("dragover", (event) => {
  if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return;
  event.preventDefault();
  document.body.classList.add("drop");
});
document.body.addEventListener("dragleave", () => document.body.classList.remove("drop"));
document.body.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("drop");
  const file = Array.from(event.dataTransfer?.files ?? []).find((f) => /\.zip$/i.test(f.name)) ?? null;
  void importZip(file);
});

const optionsRow = el("div", "row");
optionsRow.append(wsSelect, agentSelect);
const actionsRow = el("div", "row");
actionsRow.append(el("span", "hint", "⌘/Ctrl+Enter"), el("span", ""), importButton, create);
actionsRow.children[1]!.setAttribute("style", "flex:1");
startCard.append(tabs, sub, brief, optionsRow, actionsRow, message, picker);

// ---- Recent designs ----
const list = el("div", "list");
const empty = el("div", "hint", "No designs yet. Describe one above, or open a workspace's canvas with Design: Open canvas.");

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    // A hidden thumbnail has no width to scale to: it stays observed and is tried again when it shows.
    if ((entry.target as HTMLElement).clientWidth === 0) continue;
    observer.unobserve(entry.target);
    void loadCover(entry.target as HTMLElement);
  }
});

async function loadCover(thumb: HTMLElement): Promise<void> {
  const { ws, slug } = thumb.dataset;
  if (!ws || !slug) return;
  // Hidden: observe it again and load the cover when it shows, before any download.
  if (thumb.clientWidth === 0) {
    observer.observe(thumb);
    return;
  }
  try {
    const { text, last } = await readChunks((offset) => request("dc.cover", { ws, slug, offset }));
    if (!text || !last.width) return;
    if (thumb.clientWidth === 0) {
      // Hidden while the cover loaded: observe it again and build the frame when it shows.
      observer.observe(thumb);
      return;
    }
    const frame = el("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("scrolling", "no");
    frame.tabIndex = -1;
    // Fix #21: a narrow artboard is never scaled up; it is centred on the muted thumbnail background.
    const scale = Math.min(1, thumb.clientWidth / last.width);
    frame.style.width = `${last.width}px`;
    frame.style.height = `${Math.ceil(150 / scale)}px`;
    frame.style.left = `${Math.max(0, (thumb.clientWidth - last.width * scale) / 2)}px`;
    frame.style.transform = `scale(${scale})`;
    // A thumbnail never scrolls.
    frame.srcdoc = buildSrcdoc(text).replace(/<\/head>/i, "<style>html,body{overflow:hidden!important}</style></head>");
    thumb.append(frame);
  } catch {
    // A design whose cover can't be read still opens.
  }
}

function renderList(): void {
  list.textContent = "";
  if (designs.length === 0) list.append(empty);
  for (const design of designs) {
    const card = el("button", "design");
    card.type = "button";
    const thumb = el("div", "thumb");
    thumb.dataset.ws = design.ws;
    thumb.dataset.slug = design.slug;
    const meta = el("div", "meta");
    meta.append(el("b", "", design.title), el("span", "hint", `${design.project ?? design.workspaceName} · ${ago(design.updatedAt)}${design.openComments ? ` · ${design.openComments} open` : ""}`));
    card.append(thumb, meta);
    card.addEventListener("click", () => void request("dc.open", { ws: design.ws, slug: design.slug }).catch((error) => (message.textContent = String(error))));
    list.append(card);
    observer.observe(thumb);
  }
}

// Fix #10: a refresh asked for while one runs queues exactly one more, so no change is dropped.
let refreshing = false;
let refreshAgain = false;
async function refresh(): Promise<void> {
  if (refreshing) {
    refreshAgain = true;
    return;
  }
  refreshing = true;
  try {
    do {
      refreshAgain = false;
      await loadHome();
    } while (refreshAgain);
  } finally {
    refreshing = false;
  }
}

async function loadHome(): Promise<void> {
  const home = await request("dc.home", {});
  workspaces = home.workspaces;
  const changed = JSON.stringify(home.designs.map((d: HomeDesign) => [d.ws, d.slug, d.updatedAt])) !== JSON.stringify(designs.map((d) => [d.ws, d.slug, d.updatedAt]));
  designs = home.designs;
  renderWorkspaces();
  if (changed) renderList();
}

/** Fix #11: the focused workspace, else the one the panel last used; null otherwise. */
async function initialWorkspace(): Promise<string | null> {
  try {
    const { ws } = await request("dc.focused", {});
    if (ws) return ws;
  } catch {
    // Fall back to the last workspace used.
  }
  const last = await orca.storage.get("home:lastWs").catch(() => null);
  return typeof last === "string" ? last : null;
}

document.body.append(startCard, el("h2", "", "Recent"), list);
renderTabs();
syncActions();
chosenWs = await initialWorkspace();
await refresh();
orca.plugin.on("dc.changed", () => void refresh());
orca.on("workspace.created", () => void refresh());
orca.on("workspace.removed", () => void refresh());
