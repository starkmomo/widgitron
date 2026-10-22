export interface ArxivPaperCursor {
  key: string | null;
  index: number;
}

export function arxivPaperArrowDirection(event: {
  key: string; defaultPrevented?: boolean; repeat?: boolean; isComposing?: boolean;
  altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
}): -1 | 1 | null {
  if (event.defaultPrevented || event.repeat || event.isComposing
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : null;
}

/** Keep the displayed paper on refresh; if removed, show its next neighbour. */
export function resolveArxivPaperCursor(keys: readonly string[], cursor: ArxivPaperCursor): ArxivPaperCursor {
  if (!keys.length) return { key: null, index: 0 };
  const existing = cursor.key === null ? -1 : keys.indexOf(cursor.key);
  const index = existing >= 0 ? existing : Math.min(Math.max(0, cursor.index), keys.length - 1);
  return { key: keys[index], index };
}

/** Browsing changes only the local cursor, never a paper's reading status. */
export function moveArxivPaperCursor(keys: readonly string[], cursor: ArxivPaperCursor, direction: -1 | 1): ArxivPaperCursor {
  const current = resolveArxivPaperCursor(keys, cursor);
  return resolveArxivPaperCursor(keys, { key: null, index: current.index + direction });
}
