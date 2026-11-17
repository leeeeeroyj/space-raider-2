import { Graphics } from 'pixi.js';
import { COLORS, COLS, HUD_H, ROOM_W, ROWS, STACK, TILE, WALL } from '../config';
import { besideDoor, inDoor, isEdge, isWall } from '../room/geometry';
import type { Room } from '../vault';

/**
 * The room, drawn in code as voxels: each wall tile is 2 × 2 blocks, each a little taller or shorter than the wall,
 * so the walls look built from the same chunky slices as the hostiles. Door frames are brass with amber lights.
 */

const VOXEL = TILE / 2;
const hash = (c: number, r: number) => ((((c * 73856093) ^ (r * 19349663)) >>> 0) % 997);

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The floor inside the walls: 8 px plates in slightly different shades, with dark seams and the odd rivet. */
export function buildFloor() {
  const g = new Graphics();
  const x0 = TILE, x1 = ROOM_W - TILE, y0 = HUD_H + TILE, y1 = HUD_H + (ROWS - 1) * TILE;
  for (let y = y0; y < y1; y += VOXEL) {
    for (let x = x0; x < x1; x += VOXEL) {
      const h = hash(x, y);
      g.rect(x, y, VOXEL, VOXEL).fill(mix(WALL.floor[0], WALL.floor[1], (h % 5) / 4));
      g.rect(x, y + VOXEL - 0.5, VOXEL, 0.5).rect(x + VOXEL - 0.5, y, 0.5, VOXEL).fill(WALL.floorSeam);
      if (h % 7 === 0) g.rect(x + 2, y + 3, 1, 1).fill(WALL.rivet);
    }
  }
  return g;
}

/** One wall tile's four voxels, back row first, around the wall's `height`. Door frames are brass. */
function drawTile(g: Graphics, c: number, r: number, height: number, frame: boolean) {
  const tx = c * TILE, ty = HUD_H + r * TILE;
  for (const vr of [0, 1]) {
    for (const vc of [0, 1]) {
      const k = hash(c * 2 + vc, r * 2 + vr);
      const h = Math.max(2, height + ((k % 5) - 2));
      const base = frame ? WALL.frame[k % WALL.frame.length] : WALL.stone[k % WALL.stone.length];
      const x = tx + vc * VOXEL, ground = ty + vr * VOXEL, top = ground - h;
      // Top, with a lit back and left edge.
      g.rect(x, top, VOXEL, VOXEL).fill(mix(base, 0xffffff, 0.12));
      g.rect(x, top, VOXEL, 0.5).rect(x, top, 0.5, VOXEL).fill(mix(base, 0xffffff, 0.3));
      if (frame && k % 3 === 0) g.rect(x + 3, top + 3, 2, 2).fill(COLORS.amber);
      // Front, darkening toward the floor, with a shadow on its right edge.
      const faceTop = top + VOXEL, faceBottom = ground + VOXEL;
      for (let fy = faceTop; fy < faceBottom; fy++) g.rect(x, fy, VOXEL, 1).fill(mix(base, COLORS.void, 0.35 + (0.4 * (fy - faceTop)) / Math.max(1, faceBottom - faceTop)));
      g.rect(x + VOXEL - 0.5, faceTop, 0.5, faceBottom - faceTop).fill({ color: COLORS.void, alpha: 0.5 });
    }
  }
}

/**
 * The walls as Graphics to add to the depth-sorted actors: the top and bottom rows are one piece each; side-wall
 * tiles are one each, so a ship beside a wall sorts in front of the blocks behind it and behind the ones in front.
 */
export function buildWalls(room: Room): Graphics[] {
  const top = new Graphics(), bottom = new Graphics();
  const pieces = [top, bottom];
  top.zIndex = HUD_H + TILE;
  bottom.zIndex = HUD_H + ROWS * TILE;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isEdge(c, r) || inDoor(room, c, r) || !isWall(room, c, r)) continue;
      let g = r === 0 ? top : r === ROWS - 1 ? bottom : undefined;
      if (!g) {
        g = new Graphics();
        g.zIndex = HUD_H + (r + 1) * TILE;
        pieces.push(g);
      }
      drawTile(g, c, r, r === ROWS - 1 ? STACK.nearWall : STACK.wall, besideDoor(room, c, r));
    }
  }
  return pieces;
}

/** Soft shade on the floor along the walls, where they block the light. */
export function drawWallShade() {
  const g = new Graphics();
  const x0 = TILE, x1 = ROOM_W - TILE, y0 = HUD_H + TILE, y1 = HUD_H + (ROWS - 1) * TILE;
  for (let i = 0; i < 6; i++) {
    const a = 0.32 * (1 - i / 6);
    g.rect(x0, y0 + i, x1 - x0, 1).fill({ color: 0x000000, alpha: a });
    if (i < 4) {
      g.rect(x0 + i, y0, 1, y1 - y0).fill({ color: 0x000000, alpha: a * 0.8 });
      g.rect(x1 - 1 - i, y0, 1, y1 - y0).fill({ color: 0x000000, alpha: a * 0.8 });
    }
  }
  return g;
}
