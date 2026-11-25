// The editor/panel ↔ worker contract. Frames may import only shared code, so constants both
// sides need live here.

/** Largest piece of text one request answer carries; Orca refuses answers over 1 MiB. */
export const CHUNK = 786_432;

import type { Anchor, Comment, CommentStatus, MoveStyle, TextTarget } from "./design";
import type { TweakValues } from "./tweaks";
import type { DesignList, DesignView } from "./views";

/** Every request names the Orca workspace it acts on. */
export interface WsInput {
  ws: string;
}
export interface DesignInput extends WsInput {
  slug: string;
}
export interface ChunkOut {
  chunk: string;
  offset: number;
  total: number;
  done: boolean;
}
export interface ImportResult {
  slug: string;
  title: string;
  kept: string[];
}

declare module "orca" {
  interface PluginRequests {
    "dc.context": { input: WsInput; output: { root: string | null; initialized: boolean } };
    "dc.init": { input: WsInput; output: { created: boolean } };
    "dc.list": { input: WsInput; output: DesignList };
    "dc.design": { input: DesignInput; output: DesignView };
    "dc.artboard": {
      input: DesignInput & { artboardId: string; offset: number };
      output: ChunkOut & { version: string; source: string; error: string | null };
    };
    "dc.comment.add": { input: DesignInput & { body: string; anchor: Anchor }; output: { comment: Comment } };
    "dc.comment.update": {
      input: DesignInput & { id: string; body?: string; status?: CommentStatus };
      output: { comment: Comment };
    };
    "dc.comment.delete": { input: DesignInput & { id: string }; output: Record<string, never> };
    "dc.comment.markSent": { input: DesignInput & { ids: string[] }; output: Record<string, never> };
    "dc.moveElement": {
      input: DesignInput & { artboardId: string; dcId: string; style: MoveStyle; expected: string };
      output: { source: string; version: string };
    };
    "dc.editText": {
      input: DesignInput & { artboardId: string; target: TextTarget; before: string; after: string; expected: string };
      output: { source: string; version: string };
    };
    "dc.moveArtboard": {
      input: DesignInput & { artboardId: string; position: { x: number; y: number } | null };
      output: Record<string, never>;
    };
    "dc.saveTweaks": {
      input: DesignInput & { values: TweakValues };
      output: { values: TweakValues; versions: Record<string, string> };
    };
    "dc.rename": { input: DesignInput & { title: string }; output: { title: string } };
    "dc.trash": { input: DesignInput; output: { trashedTo: string } };
    "dc.export": { input: DesignInput & { offset: number }; output: ChunkOut & { fileName: string } };
    "dc.import.begin": { input: WsInput; output: { id: string } };
    "dc.import.part": { input: WsInput & { id: string; part: string }; output: Record<string, never> };
    "dc.import.commit": { input: WsInput & { id: string }; output: ImportResult };
    "dc.watch": { input: WsInput; output: Record<string, never> };
  }
  interface PluginPanelEvents {
    /** Files under design/ changed: which designs, and whether the list of designs may have. */
    "dc.changed": { ws: string; slugs: string[]; list: boolean };
  }
}
