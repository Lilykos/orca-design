// Orca: before anything reaches an agent, the person sees the exact request and who gets it.
// UP sent straight to the panel's own agent; Orca editors have none, and a workspace may run
// several agents, or none.
import type { AgentRow } from "../shared/protocol";
import { button, el } from "./dom";
import { t } from "./i18n";

/** The option value that resumes the design's recorded agent session (the worker does the resume). */
export const RESUME = "__resume__";

export interface SheetModel {
  options: { terminalId: string; label: string }[];
  selected: string | null;
  canSend: boolean;
  offerLaunch: boolean;
  /** The agent kind to resume when the design's recorded session is not running; else null. */
  resume: string | null;
}

/**
 * Which agents to offer and which one is chosen at first: the recorded session (resumed when it is
 * not running, spec fix 9), else a lone agent.
 */
export function sheetModel(rows: readonly AgentRow[], preferred: string | null): SheetModel {
  const agents = rows.filter((row) => row.agent && row.terminalId);
  const at = preferred ? preferred.indexOf(":") : -1;
  const recordedAgent = at > 0 ? preferred!.slice(0, at) : null;
  const session = at > 0 ? preferred!.slice(at + 1) : null;
  const options = agents.map((row) => ({
    terminalId: row.terminalId!,
    label: `${row.title ?? row.agent}${row.state === "working" ? " (working)" : ""}`,
  }));
  const running = agents.find((row) => session && row.sessionId === session);
  const resume = !running && recordedAgent && session ? recordedAgent : null;
  if (resume) options.unshift({ terminalId: RESUME, label: `Resume this design's ${resume} session` });
  const selected = running?.terminalId ?? (resume ? RESUME : agents.length === 1 ? agents[0]!.terminalId : null);
  return { options, selected, canSend: selected !== null, offerLaunch: options.length === 0, resume };
}

/** Whether the sheet may close: not while it is sending or starting an agent (that would lose track of it). */
export function sheetState(): { busy: boolean; requestClose(): boolean } {
  return {
    busy: false,
    requestClose() {
      return !this.busy;
    },
  };
}

export interface SheetOptions {
  host: HTMLElement;
  text: string;
  rows: readonly AgentRow[];
  preferred: string | null;
  onSend(terminalId: string): Promise<void>;
  onLaunch(agent: string): Promise<void>;
}

/** Shows the sheet; resolves true once sent or launched, false when cancelled. */
export function openSendSheet(options: SheetOptions): Promise<boolean> {
  const model = sheetModel(options.rows, options.preferred);
  const state = sheetState();
  return new Promise((resolve) => {
    const veil = el("div", "dc-sheet-veil");
    const sheet = el("div", "dc-sheet");
    veil.append(sheet);
    const finish = (done: boolean) => {
      veil.remove();
      resolve(done);
    };
    const close = (done: boolean) => {
      if (done || state.requestClose()) finish(done);
    };
    sheet.append(el("h3", "", t("sendSheetTitle")), el("pre", "", options.text), el("div", "dc-hint", t("sendSheetHint")));
    const row = el("div", "dc-row");
    const run = async (action: () => Promise<void>, control: HTMLButtonElement) => {
      control.disabled = true;
      cancel.disabled = true;
      state.busy = true;
      try {
        await action();
        state.busy = false;
        close(true);
      } catch (error) {
        state.busy = false;
        control.disabled = false;
        cancel.disabled = false;
        sheet.append(el("div", "dc-error", error instanceof Error ? error.message : String(error)));
      }
    };
    const cancel = button(t("cancel"), null, () => close(false));
    if (model.offerLaunch) {
      row.append(el("span", "dc-hint", t("sendSheetNoAgent")), el("span", "dc-spacer"), cancel);
      const launch = button(t("sendSheetLaunch"), "sparkles", () => void run(() => options.onLaunch("claude"), launch), "dc-btn dc-primary");
      row.append(launch);
    } else {
      const select = el("select");
      if (!model.selected) select.append(new Option(t("sendSheetChoose"), "", true, true));
      for (const option of model.options) select.append(new Option(option.label, option.terminalId, false, option.terminalId === model.selected));
      const send = button(t("sendSheetSend"), "send", () => void run(() => options.onSend(select.value), send), "dc-btn dc-primary");
      send.disabled = !model.canSend;
      select.addEventListener("change", () => {
        send.disabled = !select.value;
      });
      row.append(el("span", "dc-hint", t("sendSheetTo")), select, cancel, send);
    }
    sheet.append(row);
    veil.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") close(false);
    });
    options.host.append(veil);
    (sheet.querySelector("select, .dc-primary") as HTMLElement | null)?.focus();
  });
}
