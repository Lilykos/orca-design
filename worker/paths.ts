// Ported from paseo-design-canvas 0.4.1 (MIT, © 2026 961853266hyt).
import { realpath } from "node:fs/promises";
import path from "node:path";
import { DESIGN_DIR } from "../shared/design";

export class PathError extends Error {}

export function designRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, DESIGN_DIR);
}

export function designDir(workspaceRoot: string, slug: string): string {
  return path.join(designRoot(workspaceRoot), slug);
}

function within(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves `reference` against `fromDir` and accepts it only inside `allowedRoot`, also after
 * following symlinks. Rejects absolute paths, `..` that leaves the root and links pointing out.
 */
export async function resolveInside(allowedRoot: string, fromDir: string, reference: string): Promise<string> {
  if (path.isAbsolute(reference)) throw new PathError(`Absolute paths are not allowed: ${reference}`);
  const target = path.resolve(fromDir, reference);
  if (!within(allowedRoot, target)) throw new PathError(`${reference} is outside ${allowedRoot}`);
  const [realRoot, realTarget] = await Promise.all([realpath(allowedRoot), realpath(target)]);
  if (!within(realRoot, realTarget)) throw new PathError(`${reference} links outside ${allowedRoot}`);
  return realTarget;
}

/**
 * Refuses a folder that is not inside design/ once symlinks are followed, so the worker never
 * writes through a link out of the workspace's design/. Call it after the folder exists.
 */
export async function assertInsideDesign(workspaceRoot: string, folder: string): Promise<void> {
  const [realBase, realFolder] = await Promise.all([realpath(designRoot(workspaceRoot)), realpath(folder)]);
  if (!within(realBase, realFolder)) throw new PathError(`${folder} links outside ${designRoot(workspaceRoot)}`);
}
