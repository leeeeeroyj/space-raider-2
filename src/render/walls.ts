import { Graphics } from 'pixi.js';
import { COLORS, COLS, HUD_H, ROOM_W, ROWS, STACK, TILE, WALL } from '../config';
import { besideDoor, inDoor, isEdge, isWall } from '../room/geometry';
import type { Room } from '../vault';

/** Mixes two colours, t = 0..1. */
function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const hash = (c: number, r: number) => (((c * 73856093) ^ (r * 19349663)) >>> 0) % 97;

/**
 * Draws one wall tile as a block: its top face raised `height` above the tile, and its front face (only if nothing
 * stands in front of it) filling the gap down to the floor. Drawn in design pixels; the world's scale makes the half
 * pixel lines crisp on screen.
 */
function drawBlock(g: Graphics, room: Room, c: number, r: number) {
  const height = r === ROWS - 1 ? STACK.nearWall : STACK.wall;
  const x = c * TILE, y = HUD_H + r * TILE - height;
  const frame = besideDoor(room, c, r);
  const piece = (dc: number, dr: number) => isWall(room, c + dc, r + dr);
  const inside = (dc: number, dr: number) => {
    const cc = c + dc, rr = r + dr;
    return cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && !piece(dc, dr);
  };

  // Top face: plating, with a slightly lighter inset panel.
  g.rect(x, y, TILE, TILE).fill(frame ? WALL.frameTop : WALL.top);
  g.rect(x + 2, y + 2, TILE - 4, TILE - 4).fill(mix(frame ? WALL.frameTop : WALL.top, 0xffffff, 0.05));
  if (!frame && hash(c, r) % 3 === 0) {
    // A vent.
    for (let i = 0; i < 3; i++) g.rect(x + 5, y + 5 + i * 2, 6, 0.5).fill(WALL.seam);
  }
  if (frame) {
    // Hazard stripes along the face toward the doorway.
    const toward = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dc, dr]) => inDoor(room, c + dc, r + dr))!;
    const vertical = toward[0] !== 0;
    for (let i = 0; i < 4; i++) {
      const o = i * 4;
      if (vertical) g.rect(toward[0] > 0 ? x + TILE - 3 : x, y + o, 3, 2).fill(COLORS.amber);
      else g.rect(x + o, toward[1] > 0 ? y + TILE - 3 : y, 2, 3).fill(COLORS.amber);
    }
    g.rect(x + 7, y + 7, 2, 2).fill(COLORS.amber);
  }
  // Neon trim on every top edge that faces into the room or a doorway.
  const trim = frame ? COLORS.amber : WALL.trim;
  if (inside(0, 1)) g.rect(x, y + TILE - 1, TILE, 0.5).fill({ color: trim, alpha: 0.9 });
  if (inside(0, -1)) g.rect(x, y + 0.5, TILE, 0.5).fill({ color: trim, alpha: 0.9 });
  if (inside(1, 0)) g.rect(x + TILE - 1, y, 0.5, TILE).fill({ color: trim, alpha: 0.9 });
  if (inside(-1, 0)) g.rect(x + 0.5, y, 0.5, TILE).fill({ color: trim, alpha: 0.9 });

  // Front face: all of it, or as much as shows over a lower block in front.
  const below = r + 1 === ROWS - 1 ? STACK.nearWall : STACK.wall;
  const face = piece(0, 1) && r < ROWS - 1 ? height - below : height;
  if (face <= 0) return;
  const fy = y + TILE;
  const bands = face * 2;
  for (let i = 0; i < bands; i++) g.rect(x, fy + i / 2, TILE, 0.5).fill(mix(WALL.faceTop, WALL.faceBottom, i / (bands - 1)));
  // The lit edge where top meets front, seams between panels, and the glow strip at the floor.
  g.rect(x, fy, TILE, 0.5).fill(WALL.edge);
  if (c % 2 === 0) g.rect(x, fy + 0.5, 0.5, face - 0.5).fill(WALL.seam);
  if (face < height) return;
  if (frame) g.rect(x + 6, fy + 1.5, 4, face - 3).fill({ color: COLORS.amber, alpha: 0.75 });
  else if (face > 6 && hash(c, r) % 4 === 0) g.rect(x + 11, fy + 3, 1, 1).fill(hash(c, r) % 8 === 0 ? COLORS.danger : COLORS.beam);
  g.rect(x, fy + face - 0.5, TILE, 0.5).fill({ color: frame ? COLORS.amber : WALL.trim, alpha: 0.6 });
}

/**
 * The room's walls as pieces to sort in with everything else: the back and near walls as one piece each (everything
 * in them is the same depth), the side walls a tile at a time.
 */
export function buildWalls(room: Room): Graphics[] {
  const top = new Graphics(), bottom = new Graphics();
  const pieces: Graphics[] = [top, bottom];
  top.zIndex = HUD_H + TILE;
  bottom.zIndex = HUD_H + ROWS * TILE;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isEdge(c, r) || inDoor(room, c, r)) continue;
      let g = r === 0 ? top : r === ROWS - 1 ? bottom : undefined;
      if (!g) {
        g = new Graphics();
        g.zIndex = HUD_H + (r + 1) * TILE;
        pieces.push(g);
      }
      drawBlock(g, room, c, r);
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
