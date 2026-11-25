// The design canvas worker: owns every file read and write under <workspace>/design/.
import type { OrcaWorkerApi } from "orca/worker";
import "../shared/protocol";
import { registerCommands } from "./commands";
import { registerHandlers } from "./handlers";
import { closeAll } from "./watch";

let stop: (() => void) | null = null;

export default function activate(orca: OrcaWorkerApi): void {
  stop = registerHandlers(orca);
  registerCommands(orca);
}

export function deactivate(): void {
  stop?.();
  stop = null;
  closeAll();
}
