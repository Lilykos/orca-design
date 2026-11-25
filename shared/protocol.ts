// The editor/panel ↔ worker contract. Frames may import only shared code, so constants both
// sides need live here.

/** Largest piece of text one request answer carries; Orca refuses answers over 1 MiB. */
export const CHUNK = 786_432;
