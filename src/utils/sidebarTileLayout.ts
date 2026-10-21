export type SidebarSectionKey = "quota" | "gpu" | "deadlines" | "arxiv";

export type SidebarTileRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SidebarCollisionAxis = "horizontal" | "vertical";
export type SidebarResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type SidebarInsertionPlacement = "left" | "right" | "above" | "below";

export type SidebarInsertionGuide = {
  targetKey: SidebarSectionKey;
  placement: SidebarInsertionPlacement;
};

export type SidebarLayoutRow = {
  keys: SidebarSectionKey[];
  top: number;
  bottom: number;
};

export const SIDEBAR_TILE_GAP = 6;
export const SIDEBAR_TILE_MIN_WIDTH_RATIO = 0.01;
export const SIDEBAR_TILE_RESIZE_MIN_WIDTH = 84;
export const SIDEBAR_TILE_MIN_HEIGHT = 128;

export type SidebarTileHeightLimits = { min: number; max: number };
export type SidebarTileHeightLimitMap = Record<SidebarSectionKey, SidebarTileHeightLimits>;

const MIN_CONTENT_HEIGHT: Record<SidebarSectionKey, number> = {
  quota: 148,
  gpu: 160,
  deadlines: 176,
  arxiv: 300,
};

export function sidebarTileHeightLimits(
  key: SidebarSectionKey,
  viewportHeight: number,
  naturalHeight?: number,
  firstCardHeight?: number,
): SidebarTileHeightLimits {
  // The measured first card includes the title strip and outer framing. Keep
  // the initial fallback until real card geometry is available; later cards
  // enlarge only the natural maximum, never the minimum.
  const min = key !== "arxiv" && firstCardHeight !== undefined
    && Number.isFinite(firstCardHeight) && firstCardHeight > 0
      ? Math.max(SIDEBAR_TILE_MIN_HEIGHT, Math.ceil(firstCardHeight))
      : MIN_CONTENT_HEIGHT[key];
  const viewport = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : 800;
  const cap = Math.max(min, Math.min(key === "arxiv" ? 560 : 640, Math.floor(viewport * 0.75)));
  // arXiv is a reading viewport. Lists may grow to show all of their content,
  // including beyond one screen, but cannot be stretched into empty space.
  const contentMax = key === "arxiv" ? cap
    : naturalHeight !== undefined && Number.isFinite(naturalHeight)
      ? Math.ceil(Math.max(0, naturalHeight))
      : min;
  return { min, max: Math.max(min, contentMax) };
}

export function constrainSidebarTileHeights(
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  keys: SidebarSectionKey[],
  limits: SidebarTileHeightLimitMap,
  contentGrowth: Partial<Record<SidebarSectionKey, number>> = {},
) {
  const bounded = { ...layout };
  for (const key of keys) {
    const requested = layout[key].h + Math.max(0, contentGrowth[key] ?? 0);
    bounded[key] = { ...layout[key], h: Math.round(Math.min(limits[key].max, Math.max(limits[key].min, requested))) };
  }
  return compactSidebarTileLayout(bounded, keys);
}

export function sidebarRectsOverlap(a: SidebarTileRect, b: SidebarTileRect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function sidebarTileWithinBounds(rect: SidebarTileRect) {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.w < SIDEBAR_TILE_MIN_WIDTH_RATIO ||
    rect.h < SIDEBAR_TILE_MIN_HEIGHT
  ) {
    return false;
  }
  return rect.x + rect.w <= 1;
}

export function sidebarRowsFromLayout(
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  keys: SidebarSectionKey[]
): SidebarLayoutRow[] {
  const rows: SidebarLayoutRow[] = [];
  const sortedKeys = [...keys].sort(
    (a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x
  );

  for (const key of sortedKeys) {
    const rect = layout[key];
    let bestRow: SidebarLayoutRow | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const distance = Math.abs(rect.y - row.top);
      const rowHeight = Math.max(1, row.bottom - row.top);
      const tolerance = Math.max(18, Math.min(56, Math.min(rect.h, rowHeight) * 0.28));
      if (distance <= tolerance && distance < bestDistance) {
        bestRow = row;
        bestDistance = distance;
      }
    }

    if (bestRow) {
      bestRow.keys.push(key);
      bestRow.top = Math.min(bestRow.top, rect.y);
      bestRow.bottom = Math.max(bestRow.bottom, rect.y + rect.h);
    } else {
      rows.push({ keys: [key], top: rect.y, bottom: rect.y + rect.h });
    }
  }

  rows.sort((a, b) => a.top - b.top);
  rows.forEach((row) => row.keys.sort((a, b) => layout[a].x - layout[b].x));
  return rows;
}

/**
 * Keeps the layout visually dense without discarding the user's column widths.
 * Multi-tile rows are made contiguous, then every tile is allowed to fall up to
 * the first non-overlapping position in its column/span. This means changing a
 * tile's height immediately pulls following tiles up or pushes them down.
 */
export function compactSidebarTileLayout(
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  keys: SidebarSectionKey[],
  fixedKey?: SidebarSectionKey
) {
  const result = { ...layout };
  const normalizedKeys = [...new Set(keys)];

  for (const key of normalizedKeys) {
    const source = result[key];
    const width = Math.min(1, Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, source.w));
    result[key] = {
      ...source,
      x: Math.round(Math.min(1 - width, Math.max(0, source.x)) * 1000) / 1000,
      y: Math.round(Math.max(0, source.y)),
      w: Math.round(width * 1000) / 1000,
      h: Math.round(Math.max(SIDEBAR_TILE_MIN_HEIGHT, source.h)),
    };
  }

  // Retain relative column widths, but remove horizontal holes in every shared row.
  for (const row of sidebarRowsFromLayout(result, normalizedKeys)) {
    if (row.keys.length < 2) continue;
    const rowHasOverlap = row.keys.some((leftKey, leftIndex) =>
      row.keys
        .slice(leftIndex + 1)
        .some((rightKey) => sidebarRectsOverlap(result[leftKey], result[rightKey]))
    );

    // A tile being resized owns its new bounds. Any tile that now overlaps it
    // is reflowed below during the packing pass instead of being squeezed into
    // the same row and making the resized tile appear to disappear.
    if (fixedKey && row.keys.includes(fixedKey) && rowHasOverlap) continue;

    const weights = row.keys.map((key) =>
      Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, result[key].w)
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let nextX = 0;
    row.keys.forEach((key, index) => {
      const width =
        index === row.keys.length - 1
          ? 1 - nextX
          : weights[index] / Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, totalWeight);
      result[key] = {
        ...result[key],
        x: Math.round(nextX * 1000) / 1000,
        w: Math.round(width * 1000) / 1000,
      };
      nextX += width;
    });
  }

  const placedKeys: SidebarSectionKey[] = [];
  const placementOrder = [...normalizedKeys].sort((a, b) => {
    const topDelta = result[a].y - result[b].y;
    if (Math.abs(topDelta) > 0.5) return topDelta;
    if (a === fixedKey) return -1;
    if (b === fixedKey) return 1;
    return result[a].x - result[b].x;
  });

  for (const key of placementOrder) {
    const source = result[key];
    const candidateYs = [
      0,
      ...placedKeys.map((placedKey) => result[placedKey].y + result[placedKey].h + SIDEBAR_TILE_GAP),
    ]
      .map((value) => Math.round(Math.max(0, value)))
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((a, b) => a - b);

    const y =
      candidateYs.find((candidateY) => {
        const candidate = { ...source, y: candidateY };
        return !placedKeys.some((placedKey) => sidebarRectsOverlap(candidate, result[placedKey]));
      }) ??
      Math.max(
        0,
        ...placedKeys.map((placedKey) => result[placedKey].y + result[placedKey].h + SIDEBAR_TILE_GAP)
      );

    result[key] = { ...source, y: Math.round(y) };
    placedKeys.push(key);
  }

  return result;
}

/**
 * Reflows the board after a visibility toggle. This deliberately uses the
 * current visual rows instead of the generic collision packer: every surviving
 * row is rebuilt directly below the previous one, so hiding a tile always makes
 * all following rows slide upward without leaving a masonry-style hole.
 */
export function reconcileSidebarTileVisibility(
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  currentVisibleKeys: SidebarSectionKey[],
  nextVisibleKeys: SidebarSectionKey[]
) {
  const current = [...new Set(currentVisibleKeys)];
  const next = [...new Set(nextVisibleKeys)];
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  const result = { ...layout };
  let nextY = 0;

  for (const row of sidebarRowsFromLayout(layout, current)) {
    const surviving = row.keys.filter((key) => nextSet.has(key));
    if (surviving.length === 0) continue;

    const rowHeight = Math.max(...surviving.map((key) => result[key].h));
    const weights = surviving.map((key) =>
      Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, result[key].w)
    );
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let nextX = 0;

    surviving.forEach((key, index) => {
      const width =
        surviving.length === 1 || index === surviving.length - 1
          ? 1 - nextX
          : weights[index] / Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, totalWeight);
      result[key] = {
        ...result[key],
        x: Math.round(nextX * 1000) / 1000,
        y: Math.round(nextY),
        w: Math.round(width * 1000) / 1000,
      };
      nextX += width;
    });
    nextY += rowHeight + SIDEBAR_TILE_GAP;
  }

  // A tile that was hidden should never reuse its old x/y slot: append a
  // full-width row after all currently visible content instead.
  for (const key of next.filter((candidate) => !currentSet.has(candidate))) {
    result[key] = { ...result[key], x: 0, y: Math.round(nextY), w: 1 };
    nextY += result[key].h + SIDEBAR_TILE_GAP;
  }

  return result;
}

export function findSidebarInsertionGuide(
  pointerX: number,
  pointerY: number,
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  visibleKeys: SidebarSectionKey[],
  movingKey: SidebarSectionKey,
  boardWidth: number
): SidebarInsertionGuide | null {
  const candidates = visibleKeys.filter((key) => key !== movingKey);
  if (candidates.length === 0) return null;

  let nearestKey = candidates[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const key of candidates) {
    const rect = layout[key];
    const left = rect.x * boardWidth;
    const right = (rect.x + rect.w) * boardWidth;
    const top = rect.y;
    const bottom = rect.y + rect.h;
    const dx = pointerX < left ? left - pointerX : pointerX > right ? pointerX - right : 0;
    const dy = pointerY < top ? top - pointerY : pointerY > bottom ? pointerY - bottom : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearestKey = key;
      nearestDistance = distance;
    }
  }

  const target = layout[nearestKey];
  const left = target.x * boardWidth;
  const right = (target.x + target.w) * boardWidth;
  const top = target.y;
  const bottom = target.y + target.h;
  const insideX = pointerX >= left && pointerX <= right;
  const insideY = pointerY >= top && pointerY <= bottom;

  let placement: SidebarInsertionPlacement;
  if (insideX && insideY) {
    const normalizedX = (pointerX - left) / Math.max(1, right - left);
    const normalizedY = (pointerY - top) / Math.max(1, bottom - top);
    if (normalizedX < 0.24) placement = "left";
    else if (normalizedX > 0.76) placement = "right";
    else placement = normalizedY < 0.5 ? "above" : "below";
  } else {
    const dx = insideX ? 0 : Math.min(Math.abs(pointerX - left), Math.abs(pointerX - right));
    const dy = insideY ? 0 : Math.min(Math.abs(pointerY - top), Math.abs(pointerY - bottom));
    if (dx > dy) placement = pointerX < left ? "left" : "right";
    else placement = pointerY < top ? "above" : "below";
  }

  return { targetKey: nearestKey, placement };
}

export function insertSidebarTileAtGuide(
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  visibleKeys: SidebarSectionKey[],
  movingKey: SidebarSectionKey,
  guide: SidebarInsertionGuide,
  previewRect: SidebarTileRect
) {
  const insertedAsOwnRow = guide.placement === "above" || guide.placement === "below";
  const sourceLayout = {
    ...layout,
    [movingKey]: insertedAsOwnRow ? { ...previewRect, x: 0, w: 1 } : previewRect,
  };
  const originalRows = sidebarRowsFromLayout(layout, visibleKeys);
  const rows = originalRows
    .map((row) => ({
      keys: row.keys.filter((key) => key !== movingKey),
      fill: row.keys.length > 1,
    }))
    .filter((row) => row.keys.length > 0);
  const targetRowIndex = rows.findIndex((row) => row.keys.includes(guide.targetKey));
  if (targetRowIndex < 0) return { layout, order: visibleKeys };

  if (guide.placement === "left" || guide.placement === "right") {
    const targetRow = rows[targetRowIndex];
    const targetIndex = targetRow.keys.indexOf(guide.targetKey);
    targetRow.keys.splice(
      guide.placement === "left" ? targetIndex : targetIndex + 1,
      0,
      movingKey
    );
    targetRow.fill = true;
  } else {
    rows.splice(
      guide.placement === "above" ? targetRowIndex : targetRowIndex + 1,
      0,
      { keys: [movingKey], fill: false }
    );
  }

  const nextLayout = { ...sourceLayout };
  const order: SidebarSectionKey[] = [];
  let nextY = 0;
  for (const row of rows) {
    const rowHeight = Math.max(...row.keys.map((key) => sourceLayout[key].h));
    if (row.fill || row.keys.length > 1) {
      const existingWeights = row.keys
        .filter((key) => key !== movingKey)
        .map((key) => Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, sourceLayout[key].w));
      const movingWeight =
        existingWeights.reduce((sum, weight) => sum + weight, 0) /
          Math.max(1, existingWeights.length) || 1;
      const weights = row.keys.map((key) =>
        key === movingKey
          ? movingWeight
          : Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, sourceLayout[key].w)
      );
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      let nextX = 0;
      row.keys.forEach((key, index) => {
        const width =
          index === row.keys.length - 1
            ? 1 - nextX
            : weights[index] / Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, totalWeight);
        nextLayout[key] = {
          ...sourceLayout[key],
          x: Math.round(nextX * 1000) / 1000,
          y: Math.round(nextY),
          w: Math.round(width * 1000) / 1000,
        };
        nextX += width;
      });
    } else {
      const key = row.keys[0];
      const width = Math.min(1, Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, sourceLayout[key].w));
      nextLayout[key] = {
        ...sourceLayout[key],
        x: Math.round(Math.min(1 - width, Math.max(0, sourceLayout[key].x)) * 1000) / 1000,
        y: Math.round(nextY),
        w: Math.round(width * 1000) / 1000,
      };
    }
    order.push(...row.keys);
    nextY += rowHeight + SIDEBAR_TILE_GAP;
  }

  // Ensure rounding never lets the final slot extend past the board edge.
  for (const row of sidebarRowsFromLayout(nextLayout, order)) {
    const lastKey = row.keys[row.keys.length - 1];
    const rect = nextLayout[lastKey];
    if (rect.x + rect.w > 1) {
      nextLayout[lastKey] = { ...rect, w: Math.max(0.001, 1 - rect.x) };
    }
  }

  return { layout: compactSidebarTileLayout(nextLayout, order), order };
}

export function resizeSidebarTileRect(
  startRect: SidebarTileRect,
  direction: SidebarResizeDirection,
  deltaXPixels: number,
  deltaYPixels: number,
  boardWidth: number,
  heightLimits: SidebarTileHeightLimits = { min: SIDEBAR_TILE_MIN_HEIGHT, max: Number.POSITIVE_INFINITY },
) {
  const minWidthRatio = Math.min(
    0.95,
    Math.max(SIDEBAR_TILE_MIN_WIDTH_RATIO, SIDEBAR_TILE_RESIZE_MIN_WIDTH / Math.max(1, boardWidth))
  );
  const deltaX = deltaXPixels / Math.max(1, boardWidth);
  const nextRect = { ...startRect };

  if (direction.includes("e")) {
    const desiredRight = startRect.x + startRect.w + deltaX;
    const snapRatio = 12 / Math.max(1, boardWidth);
    const horizontalIntent =
      direction === "e" || Math.abs(deltaXPixels) > Math.abs(deltaYPixels) * 0.35;
    if (horizontalIntent && desiredRight >= 1 - snapRatio) {
      nextRect.x = 0;
      nextRect.w = 1;
    } else {
      nextRect.w = Math.min(
        1 - startRect.x,
        Math.max(minWidthRatio, startRect.w + deltaX)
      );
    }
  }
  if (direction.includes("w")) {
    const right = startRect.x + startRect.w;
    nextRect.x = Math.min(
      right - minWidthRatio,
      Math.max(0, startRect.x + deltaX)
    );
    nextRect.w = right - nextRect.x;
  }
  if (direction.includes("s")) {
    nextRect.h = Math.min(heightLimits.max, Math.max(heightLimits.min, startRect.h + deltaYPixels));
  }
  if (direction.includes("n")) {
    const bottom = startRect.y + startRect.h;
    nextRect.h = Math.min(bottom, heightLimits.max, Math.max(heightLimits.min, startRect.h - deltaYPixels));
    nextRect.y = bottom - nextRect.h;
  }

  return {
    x: Math.round(nextRect.x * 1000) / 1000,
    y: Math.round(nextRect.y),
    w: Math.round(nextRect.w * 1000) / 1000,
    h: Math.round(nextRect.h),
  };
}

export function resolveSidebarTileCollisions(
  key: SidebarSectionKey,
  rect: SidebarTileRect,
  layout: Record<SidebarSectionKey, SidebarTileRect>,
  visibleKeys: SidebarSectionKey[],
  _boardWidth: number,
  _preferredAxis: SidebarCollisionAxis
) {
  return compactSidebarTileLayout(
    {
      ...layout,
      [key]: rect,
    },
    visibleKeys,
    key
  );
}
