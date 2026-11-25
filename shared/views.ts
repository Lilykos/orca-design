// Ported from paseo-design-canvas 0.4.1 (MIT, © 2026 961853266hyt).
// The view types the worker answers with (UP shared/rpc.ts without defineRpc).
import { z } from "../vendor/zod.js";
import {
  artboardSchema,
  commentSchema,
  designKindSchema,
  manifestSchema,
  slugSchema,
} from "./design";
import { tweakValueSchema } from "./tweaks";


export const designSummarySchema = z.object({
  slug: slugSchema,
  title: z.string(),
  kind: designKindSchema.nullable(),
  artboards: z.number().int(),
  openComments: z.number().int(),
  /** Why design.json could not be read; null when it is fine. */
  error: z.string().nullable(),
});
export type DesignSummary = z.infer<typeof designSummarySchema>;
export const artboardViewSchema = artboardSchema.extend({
  /** The page with its local CSS, images and fonts inlined; null when it could not be read. */
  html: z.string().nullable(),
  error: z.string().nullable(),
  /** Changes whenever the page or a file it uses changes. */
  version: z.string(),
  /** A hash of the page's own HTML, which an edit must match to be written. */
  source: z.string(),
});
export type ArtboardView = z.infer<typeof artboardViewSchema>;

export const designViewSchema = z.object({
  slug: slugSchema,
  manifest: manifestSchema.nullable(),
  /** Why design.json could not be used. */
  error: z.string().nullable(),
  artboards: z.array(artboardViewSchema),
  comments: z.array(commentSchema),
  /** The tweaks the user moved away from their defaults. */
  tweakValues: z.record(z.string(), tweakValueSchema),
  version: z.string(),
});
export type DesignView = z.infer<typeof designViewSchema>;

export const homeDesignSchema = designSummarySchema.extend({
  /** When a file of the design last changed, in ms since the epoch. */
  updatedAt: z.number(),
  /** The agent that created the design, when the canvas knows it. */
  agentId: z.string().nullable(),
});
export type HomeDesign = z.infer<typeof homeDesignSchema>;

export interface DesignList {
  initialized: boolean;
  designs: DesignSummary[];
  version: string;
}
