import {
  SIDEBAR_TILE_GAP,
  type SidebarInsertionGuide,
  type SidebarSectionKey,
  type SidebarTileRect,
} from "./sidebarTileLayout";

export const SIDEBAR_CARD_MIN_WIDTH = 240;
export const SIDEBAR_CARD_DEFAULT_WIDTH = 340;

export function sidebarCardWidth(width?: number) {
  return Number.isFinite(width)
    ? Math.max(SIDEBAR_CARD_MIN_WIDTH, Math.round(width!))
    : SIDEBAR_CARD_DEFAULT_WIDTH;
}

/** Keep saved heights and horizontal widths independent of the current dock edge. */
export function layoutDockedSidebar(
  source: Record<SidebarSectionKey, SidebarTileRect>,
  keys: SidebarSectionKey[],
  horizontal: boolean,
  viewportWidth: number,
  viewportHeight: number,
  widths: Partial<Record<SidebarSectionKey, number>> = {},
) {
  const layout = { ...source };
  const width = horizontal
    ? Math.max(viewportWidth, keys.reduce((sum, key) => sum + sidebarCardWidth(widths[key]) + SIDEBAR_TILE_GAP, 0))
    : viewportWidth;
  let offset = 0;
  for (const key of keys) {
    if (horizontal) {
      const span = sidebarCardWidth(widths[key]) + SIDEBAR_TILE_GAP;
      layout[key] = { x: offset / width, y: 0, w: span / width, h: viewportHeight };
      offset += span;
    } else {
      layout[key] = { ...source[key], x: 0, y: offset, w: 1 };
      offset += source[key].h + SIDEBAR_TILE_GAP;
    }
  }
  return { layout, width, height: horizontal ? viewportHeight : Math.max(viewportHeight, offset) };
}

/** A docked board reorders along its long axis; it never creates extra rows/columns. */
export function findDockedSidebarInsertion(
  pointer: number,
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  keys: SidebarSectionKey[],
  moving: SidebarSectionKey,
  horizontal: boolean,
  boardWidth: number,
): SidebarInsertionGuide | null {
  let target: SidebarSectionKey | undefined;
  let distance = Infinity;
  for (const key of keys) {
    if (key === moving) continue;
    const rect = layout[key];
    const center = horizontal ? (rect.x + rect.w / 2) * boardWidth : rect.y + rect.h / 2;
    if (Math.abs(pointer - center) < distance) {
      target = key;
      distance = Math.abs(pointer - center);
    }
  }
  if (!target) return null;
  const rect = layout[target];
  const center = horizontal ? (rect.x + rect.w / 2) * boardWidth : rect.y + rect.h / 2;
  return { targetKey: target, placement: horizontal
    ? (pointer < center ? "left" : "right")
    : (pointer < center ? "above" : "below") };
}

export function reorderDockedSidebar(keys: SidebarSectionKey[], moving: SidebarSectionKey, guide: SidebarInsertionGuide) {
  const next = keys.filter(key => key !== moving);
  const target = next.indexOf(guide.targetKey);
  if (target < 0) return keys;
  next.splice(target + (guide.placement === "right" || guide.placement === "below" ? 1 : 0), 0, moving);
  return next;
}
