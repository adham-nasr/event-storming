export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HORIZONTAL_GAP = 65;
const ROW_GAP = 30;

function overlaps(first: Box, second: Box): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

/**
 * Top-left of a new sticky to the right of `source`. A spot already taken by a sibling is skipped
 * by stepping down one row, so repeated Space presses fan out instead of stacking on each other.
 */
export function findNextStickyPlacement(
  source: Box,
  size: { width: number; height: number },
  siblings: readonly Box[],
): { x: number; y: number } {
  const x = source.x + source.width + HORIZONTAL_GAP;
  for (let row = 0; ; row++) {
    const y = source.y + row * (size.height + ROW_GAP);
    const candidate = { x, y, width: size.width, height: size.height };
    if (!siblings.some((sibling) => overlaps(candidate, sibling))) return { x, y };
  }
}
