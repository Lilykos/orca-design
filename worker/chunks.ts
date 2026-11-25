// Text bigger than one request answer travels in pieces: the reader asks again with the
// returned offset until `done`.
import { randomBytes } from "node:crypto";
import { CHUNK } from "../shared/protocol";

export { CHUNK };

export interface Chunk {
  chunk: string;
  /** Where the next piece starts. */
  offset: number;
  total: number;
  done: boolean;
}

export function sliceChunk(text: string, offset: number): Chunk {
  const start = Math.max(0, Math.min(offset, text.length));
  const end = Math.min(text.length, start + CHUNK);
  return { chunk: text.slice(start, end), offset: end, total: text.length, done: end >= text.length };
}

const IDLE_MS = 60_000;
/** Base64 of a 50 MB zip, with room to spare. */
const DEFAULT_CAP = 70 * 1024 * 1024;

/** Collects an upload sent in parts (e.g. an imported zip as base64). */
export class UploadBuffer {
  private buffers = new Map<string, { parts: string[]; size: number; at: number }>();

  constructor(private readonly cap = DEFAULT_CAP) {}

  begin(): string {
    this.sweep();
    const id = randomBytes(8).toString("hex");
    this.buffers.set(id, { parts: [], size: 0, at: Date.now() });
    return id;
  }

  append(id: string, part: string): void {
    const buffer = this.get(id);
    if (buffer.size + part.length > this.cap) {
      this.buffers.delete(id);
      throw new Error("The upload is too big");
    }
    buffer.parts.push(part);
    buffer.size += part.length;
    buffer.at = Date.now();
  }

  take(id: string): string {
    const buffer = this.get(id);
    this.buffers.delete(id);
    return buffer.parts.join("");
  }

  private get(id: string) {
    const buffer = this.buffers.get(id);
    if (!buffer) throw new Error(`No upload ${id}`);
    return buffer;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, buffer] of this.buffers) if (now - buffer.at > IDLE_MS) this.buffers.delete(id);
  }
}
