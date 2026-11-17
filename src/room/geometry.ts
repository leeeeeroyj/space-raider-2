import { COLORS, COLS, HUD_H, INTERIOR, ROWS, TILE, tileCenter } from '../config';
import { hex, named } from '../engine/textures';
import { SIDES, type Room, type Side } from '../vault';

export const CENTER = tileCenter(10, 6);

/** Is wall tile (col, row) an open doorway in this room? */
export function inDoor(room: Room, col: number, row: number) {
  const { top, bottom, left, right } = room.doors;
  if (row === 0 && top) return col >= top.from && col <= top.to;
  if (row === ROWS - 1 && bottom) return col >= bottom.from && col <= bottom.to;
  if (col === 0 && left) return row >= left.from && row <= left.to;
  if (col === COLS - 1 && right) return row >= right.from && row <= right.to;
  return false;
}
export const isEdge = (col: number, row: number) => row === 0 || col === 0 || row === ROWS - 1 || col === COLS - 1;
export const besideDoor = (room: Room, col: number, row: number) =>
  !inDoor(room, col, row) && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => inDoor(room, col + dc, row + dr));
export const isWall = (room: Room, col: number, row: number) => isEdge(col, row) && !inDoor(room, col, row);
export const insideInterior = (x: number, y: number) => x > INTERIOR.x0 && x < INTERIOR.x1 && y > INTERIOR.y0 && y < INTERIOR.y1;

/** Tile centres of every doorway tile in the room: where drones come in. */
export function doorTiles(room: Room) {
  const points: Array<{ x: number; y: number }> = [];
  for (const side of SIDES) {
    const d = room.doors[side];
    if (!d) continue;
    for (let i = d.from; i <= d.to; i++) {
      if (side === 'top') points.push(tileCenter(i, 0));
      if (side === 'bottom') points.push(tileCenter(i, ROWS - 1));
      if (side === 'left') points.push(tileCenter(0, i));
      if (side === 'right') points.push(tileCenter(COLS - 1, i));
    }
  }
  return points;
}

/** Just inside the doorway on `side`: where you appear after coming through it. */
export function entryPoint(room: Room, side: Side) {
  const d = room.doors[side]!;
  const mid = ((d.from + d.to + 1) / 2) * TILE;
  if (side === 'top') return { x: mid, y: HUD_H + TILE + 8 };
  if (side === 'bottom') return { x: mid, y: HUD_H + (ROWS - 2) * TILE + 8 };
  if (side === 'left') return { x: TILE + 8, y: HUD_H + mid };
  return { x: (COLS - 2) * TILE + 8, y: HUD_H + mid };
}

/**
 * Signpost arrows, as pixels on a 15×15 grid: pointing right, or down-right. The other six directions are exact
 * 90° turns of these, so no rotated (blurred) pixels.
 */
function arrowPixels(diagonal: boolean) {
  const px: Array<[number, number]> = [];
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const on = diagonal
        ? (x <= 12 && y <= 12 && x + y >= 19) || (x >= 2 && y >= 2 && x <= 10 && y <= 10 && Math.abs(x - y) <= 1)
        : (y >= 6 && y <= 8 && x >= 1 && x <= 8) || (x >= 8 && x <= 13 && Math.abs(y - 7) <= 13 - x);
      if (on) px.push([x, y]);
    }
  }
  return px;
}

/** Signpost texture for direction 0 … 7: east, then clockwise in 45° steps (matching atan2 with y pointing down). */
export function signTexture(d: number) {
  return named(`sign-${d}`, 16, 16, (ctx) => {
    let px = arrowPixels(d % 2 === 1);
    for (let turn = 0; turn < Math.floor(d / 2); turn++) px = px.map(([x, y]) => [14 - y, x]);
    ctx.fillStyle = hex(COLORS.void);
    for (const [x, y] of px) ctx.fillRect(x + 1, y + 1, 1, 1);
    ctx.fillStyle = hex(COLORS.amber);
    for (const [x, y] of px) ctx.fillRect(x, y, 1, 1);
  });
}

/** A sentry's bolt: a red square with a white core. */
export const boltTexture = () =>
  named('fx-bolt', 5, 5, (ctx) => {
    ctx.fillStyle = hex(COLORS.danger);
    ctx.fillRect(0, 0, 5, 5);
    ctx.fillStyle = '#fff';
    ctx.fillRect(1, 1, 3, 3);
  });
