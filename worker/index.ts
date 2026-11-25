// The design canvas worker: owns every file read and write under <workspace>/design/.
import type { OrcaWorkerApi } from "orca/worker";
import "../shared/protocol";
import { registerHandlers } from "./handlers";
import { closeAll } from "./watch";

let stop: (() => void) | null = null;

export default function activate(orca: OrcaWorkerApi): void {
  stop = registerHandlers(orca);
}

export function deactivate(): void {
  stop?.();
  stop = null;
  closeAll();
}
