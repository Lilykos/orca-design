// Ported from paseo-design-canvas 0.4.1 (MIT, © 2026 961853266hyt).
import type { Rect } from "../shared/design";

export const ROW_GAP = 160;
export const COLUMN_GAP = 96;
/** Room above each artboard for its title. */
export const LABEL_HEIGHT = 32;
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
/** Shown until the page reports its own height. */
export const DEFAULT_PAGE_HEIGHT = 900;
export const MAX_PAGE_HEIGHT = 20_000;

export interface BoardSize {
  id: string;
  width: number;
  /** The fixed height, or the page's measured height. */
  height: number;
  group?: string;
  /** Where the user dragged it; such boards keep their spot and take no room in the rows. */
  x?: number;
  y?: number;
}

export interface Placed extends Rect {
  id: string;
}

/**
 * The widest a row of the automatic layout gets: three of the widest artboards, or 4000 px; with
 * the viewport's aspect (width / height), wider when that makes the layout's shape match it.
 */
export function maxRowWidth(boards: readonly BoardSize[], aspect?: number): number {
  const widest = Math.max(0, ...boards.map((board) => board.width));
  const base = Math.max(3 * widest + 2 * COLUMN_GAP, 4000);
  if (!aspect || boards.length === 0) return base;
  const cellW = widest + COLUMN_GAP;
  const cellH = Math.max(...boards.map((board) => board.height)) + ROW_GAP + LABEL_HEIGHT;
  const columns = Math.ceil(Math.sqrt((boards.length * aspect * cellH) / cellW));
  return Math.max(base, columns * cellW - COLUMN_GAP);
}

/** Space between two groups that share a row, so they still read as separate. */
const GROUP_GAP = COLUMN_GAP * 2;

/**
 * Lays artboards out in rows. A group's variants sit side by side and wrap onto further rows when
 * they would pass `maxRow`; small groups that fit share a row. Ungrouped artboards form one group.
 * Groups keep the order in which their first artboard appears in the manifest. (Orca: UP put each
 * group in one unbounded row, which made a 19-artboard design one very long strip.)
 */
export function layoutBoards(boards: readonly BoardSize[], maxRow = maxRowWidth(boards), labelSpace = LABEL_HEIGHT): Placed[] {
  const groups = new Map<string, BoardSize[]>();
  const pinned: Placed[] = [];
  for (const board of boards) {
    if (board.x !== undefined && board.y !== undefined) {
      pinned.push({ id: board.id, x: board.x, y: board.y, width: board.width, height: board.height });
      continue;
    }
    const key = board.group === undefined ? "\u0000ungrouped" : `group:${board.group}`;
    const group = groups.get(key);
    if (group) group.push(board);
    else groups.set(key, [board]);
  }
  const placed: Placed[] = [];
  let y = labelSpace;
  let x = 0;
  let tallest = 0;
  const newRow = () => {
    y += tallest + ROW_GAP + labelSpace;
    x = 0;
    tallest = 0;
  };
  const widthOf = (group: readonly BoardSize[]) =>
    group.reduce((sum, board) => sum + board.width, 0) + COLUMN_GAP * Math.max(0, group.length - 1);
  for (const group of groups.values()) {
    // A group joins the current row only when all of it fits there.
    if (x > 0 && x + GROUP_GAP + widthOf(group) > maxRow) newRow();
    else if (x > 0) x += GROUP_GAP;
    let first = true;
    for (const board of group) {
      if (!first && x + board.width > maxRow) newRow();
      placed.push({ id: board.id, x, y, width: board.width, height: board.height });
      x += board.width + COLUMN_GAP;
      tallest = Math.max(tallest, board.height);
      first = false;
    }
    x -= COLUMN_GAP;
  }
  return [...placed, ...pinned];
}

/** A label's height on screen, with its padding. */
export const LABEL_SCREEN_PX = 24;

/**
 * World px to keep above each row so its labels (drawn at a constant size on screen) never sit on
 * the row above, however far out the canvas is zoomed.
 */
export function labelSpaceFor(zoom: number): number {
  return Math.max(LABEL_HEIGHT, Math.ceil(LABEL_SCREEN_PX / Math.max(zoom, MIN_ZOOM)));
}

export interface LabelParts {
  title: string;
  size: string;
  group?: string;
}

export interface FittedLabel {
  title: string;
  size: boolean;
  group: boolean;
}

/** Space between a label's parts, in screen px (UP's CSS gap). */
export const LABEL_GAP = 8;

/**
 * Which parts of an artboard's label fit in `maxPx` (its width on screen): the group goes first,
 * then the size, then the title is cut with an ellipsis. (Orca: UP's labels ran into each other
 * when zoomed out.)
 */
export function fitLabel(parts: LabelParts, maxPx: number, measure: (text: string) => number): FittedLabel {
  const title = measure(parts.title);
  const size = LABEL_GAP + measure(parts.size);
  const group = parts.group ? LABEL_GAP + measure(parts.group) : 0;
  if (title + size + group <= maxPx) return { title: parts.title, size: true, group: Boolean(parts.group) };
  if (title + size <= maxPx) return { title: parts.title, size: true, group: false };
  if (title <= maxPx) return { title: parts.title, size: false, group: false };
  let cut = parts.title;
  while (cut.length > 1 && measure(`${cut}…`) > maxPx) cut = cut.slice(0, -1);
  return { title: `${cut.trimEnd()}…`, size: false, group: false };
}

export function bounds(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y - LABEL_HEIGHT));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Zooms to `zoom` keeping the world point under the viewport point (px, py) in place. */
export function zoomAt(view: View, zoom: number, px: number, py: number): View {
  const next = clampZoom(zoom);
  const worldX = (px - view.x) / view.zoom;
  const worldY = (py - view.y) / view.zoom;
  return { zoom: next, x: px - worldX * next, y: py - worldY * next };
}

/** Fits `content` in a viewport of the given size, never above 100%. */
export function fitView(content: Rect | null, width: number, height: number, padding = 48): View {
  if (!content || width <= 0 || height <= 0) return { x: padding, y: padding, zoom: 1 };
  const zoom = clampZoom(
    Math.min(1, (width - padding * 2) / Math.max(content.width, 1), (height - padding * 2) / Math.max(content.height, 1)),
  );
  return {
    zoom,
    x: (width - content.width * zoom) / 2 - content.x * zoom,
    y: Math.max(padding, (height - content.height * zoom) / 2) - content.y * zoom,
  };
}

/** Centers `rect` (an element in world space) without changing the zoom. */
export function centerOn(view: View, rect: Rect, width: number, height: number): View {
  return {
    zoom: view.zoom,
    x: width / 2 - (rect.x + rect.width / 2) * view.zoom,
    y: height / 2 - (rect.y + rect.height / 2) * view.zoom,
  };
}

/** Zoom steps for the + and − buttons, as in most design tools. */
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > zoom + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.001) ?? MIN_ZOOM;
}

/** The view after the viewport resized: same zoom, same world point under the centre. */
export function keepCenter(view: View, before: { width: number; height: number }, after: { width: number; height: number }): View {
  return { zoom: view.zoom, x: view.x + (after.width - before.width) / 2, y: view.y + (after.height - before.height) / 2 };
}
