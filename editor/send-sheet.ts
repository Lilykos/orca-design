// Orca: before anything reaches an agent, the person sees the exact request and who gets it.
// UP sent straight to the panel's own agent; Orca editors have none, and a workspace may run
// several agents, or none.
import type { AgentRow } from "../shared/protocol";
import { button, el } from "./dom";
import { t } from "./i18n";

export interface SheetModel {
  options: { terminalId: string; label: string }[];
  selected: string | null;
  canSend: boolean;
  offerLaunch: boolean;
}

/** Which agents to offer and which one is chosen at first: the recorded session, else a lone agent. */
export function sheetModel(rows: readonly AgentRow[], preferred: string | null): SheetModel {
  const agents = rows.filter((row) => row.agent && row.terminalId);
  const session = preferred && preferred.includes(":") ? preferred.slice(preferred.indexOf(":") + 1) : null;
  const options = agents.map((row) => ({
    terminalId: row.terminalId!,
    label: `${row.title ?? row.agent}${row.state === "working" ? " (working)" : ""}`,
  }));
  const recorded = agents.find((row) => session && row.sessionId === session);
  const selected = recorded?.terminalId ?? (agents.length === 1 ? agents[0]!.terminalId : null);
  return { options, selected, canSend: selected !== null, offerLaunch: agents.length === 0 };
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
  return new Promise((resolve) => {
    const veil = el("div", "dc-sheet-veil");
    const sheet = el("div", "dc-sheet");
    veil.append(sheet);
    const close = (done: boolean) => {
      veil.remove();
      resolve(done);
    };
    sheet.append(el("h3", "", t("sendSheetTitle")), el("pre", "", options.text), el("div", "dc-hint", t("sendSheetHint")));
    const row = el("div", "dc-row");
    const run = async (action: () => Promise<void>, control: HTMLButtonElement) => {
      control.disabled = true;
      try {
        await action();
        close(true);
      } catch (error) {
        control.disabled = false;
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
