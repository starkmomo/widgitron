import {
  SIDEBAR_TILE_GAP,
  type SidebarInsertionGuide,
  type SidebarSectionKey,
  type SidebarTileRect,
} from "./sidebarTileLayout.ts";

export const SIDEBAR_CARD_MIN_WIDTH = 240;
export const SIDEBAR_CARD_DEFAULT_WIDTH = 340;
const SIDEBAR_SCROLL_BOTTOM_GAP = 12;

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
    ? Math.max(viewportWidth, keys.reduce((sum, key) => sum + sidebarCardWidth(widths[key]), 0)
      + Math.max(0, keys.length - 1) * SIDEBAR_TILE_GAP)
    : viewportWidth;
  let offset = 0;
  for (const key of keys) {
    if (horizontal) {
      const cardWidth = sidebarCardWidth(widths[key]);
      layout[key] = { x: offset / width, y: 0, w: cardWidth / width, h: viewportHeight };
      offset += cardWidth + SIDEBAR_TILE_GAP;
    } else {
      layout[key] = { ...source[key], x: 0, y: offset, w: 1 };
      offset += source[key].h + SIDEBAR_TILE_GAP;
    }
  }
  // End spacing belongs to the actual cards, not to the viewport's minimum
  // height. Otherwise even an almost empty sidebar has a real scroll offset.
  const contentHeight = keys.length ? offset - SIDEBAR_TILE_GAP + SIDEBAR_SCROLL_BOTTOM_GAP : 0;
  return { layout, width, height: horizontal ? viewportHeight : Math.max(viewportHeight, contentHeight) };
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
