// PROTOTYPE: five ways to draw the room, picked with ?room=1..5, for choosing a look. Not wired into anything else.
import { Container, Graphics } from 'pixi.js';
import { COLORS, COLS, HUD_H, ROOM_W, ROWS, STACK, TILE } from '../config';
import { besideDoor, inDoor, isEdge, isWall } from '../room/geometry';
import type { Room } from '../vault';

export const ROOM_STYLE = Number(new URLSearchParams(location.search).get('room') ?? 0);

const hash = (c: number, r: number, k = 0) => ((((c + k * 31) * 73856093) ^ ((r + k * 17) * 19349663)) >>> 0) % 997;
function mix(a: number, b: number, t: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

interface Block {
  c: number;
  r: number;
  /** Tile's top-left. */
  tx: number;
  ty: number;
  height: number;
  /** Visible front-face height (0 when hidden by the block in front). */
  face: number;
  frame: boolean;
  /** Is the neighbour at (dc, dr) open floor or a doorway (not wall, not outside)? */
  open: (dc: number, dr: number) => boolean;
  wall: (dc: number, dr: number) => boolean;
}

/** Calls `draw` for every wall tile, grouped into pieces that sort like the code-drawn walls. */
function pieces(room: Room, heights: { back: number; near: number }, draw: (g: Graphics, b: Block) => void): Graphics[] {
  const top = new Graphics(), bottom = new Graphics();
  const out: Graphics[] = [top, bottom];
  top.zIndex = HUD_H + TILE;
  bottom.zIndex = HUD_H + ROWS * TILE;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isEdge(c, r) || inDoor(room, c, r)) continue;
      let g = r === 0 ? top : r === ROWS - 1 ? bottom : undefined;
      if (!g) {
        g = new Graphics();
        g.zIndex = HUD_H + (r + 1) * TILE;
        out.push(g);
      }
      const height = r === ROWS - 1 ? heights.near : heights.back;
      const wall = (dc: number, dr: number) => isWall(room, c + dc, r + dr);
      const open = (dc: number, dr: number) => {
        const cc = c + dc, rr = r + dr;
        return cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && !wall(dc, dr);
      };
      const below = r + 1 === ROWS - 1 ? heights.near : heights.back;
      const face = wall(0, 1) && r < ROWS - 1 ? height - below : height;
      draw(g, { c, r, tx: c * TILE, ty: HUD_H + r * TILE, height, face: Math.max(0, face), frame: besideDoor(room, c, r), open, wall });
    }
  }
  return out;
}

const interior = { x0: TILE, y0: HUD_H + TILE, x1: ROOM_W - TILE, y1: HUD_H + (ROWS - 1) * TILE };

// ---- 1. Neon wireframe: a black room, every edge a glowing line ----

function neonFloor() {
  const g = new Graphics();
  g.rect(0, HUD_H, ROOM_W, ROWS * TILE).fill(0x020309);
  for (let x = interior.x0; x <= interior.x1; x += TILE) for (let y = interior.y0; y <= interior.y1; y += TILE) g.rect(x - 0.5, y - 0.5, 1, 1).fill({ color: 0x46d8ff, alpha: 0.25 });
  return g;
}

function neonWalls(room: Room) {
  return pieces(room, { back: 12, near: 4 }, (g, b) => {
    const color = b.frame ? 0xff3df0 : 0x46d8ff;
    const x = b.tx, y = b.ty - b.height;
    g.rect(x, y, TILE, TILE).fill(0x04050c);
    const line = (lx: number, ly: number, w: number, h: number) => {
      g.rect(lx, ly, w, h).fill({ color, alpha: 1 });
      // A soft second line for a glow.
      g.rect(lx - (h > w ? 0.75 : 0), ly - (w > h ? 0.75 : 0), w + (h > w ? 1.5 : 0), h + (w > h ? 1.5 : 0)).fill({ color, alpha: 0.18 });
    };
    if (!b.wall(0, -1)) line(x, y, TILE, 0.5);
    if (!b.wall(0, 1)) line(x, y + TILE - 0.5, TILE, 0.5);
    if (!b.wall(-1, 0)) line(x, y, 0.5, TILE);
    if (!b.wall(1, 0)) line(x + TILE - 0.5, y, 0.5, TILE);
    if (b.face > 0) {
      const fy = y + TILE;
      g.rect(x, fy, TILE, b.face).fill(0x02030a);
      if (!b.wall(-1, 0)) line(x, fy, 0.5, b.face);
      if (!b.wall(1, 0)) line(x + TILE - 0.5, fy, 0.5, b.face);
      line(x, fy + b.face - 0.5, TILE, 0.5);
      // Faint horizontal scan lines on the face.
      for (let i = 2; i < b.face - 1; i += 3) g.rect(x, fy + i, TILE, 0.5).fill({ color, alpha: 0.12 });
    }
  });
}

// ---- 2. Voxel blocks: chunky cubes of uneven height, like the stacked hostiles ----

const STONE = [0x2b3048, 0x30364f, 0x282c42, 0x343a55];

function voxelFloor() {
  const g = new Graphics();
  for (let y = interior.y0; y < interior.y1; y += 8) {
    for (let x = interior.x0; x < interior.x1; x += 8) {
      const h = hash(x, y);
      g.rect(x, y, 8, 8).fill(mix(0x131628, 0x1b1f36, (h % 5) / 4));
      g.rect(x, y + 7.5, 8, 0.5).rect(x + 7.5, y, 0.5, 8).fill(0x0b0d18);
      if (h % 7 === 0) g.rect(x + 2, y + 3, 1, 1).fill(0x262b46);
    }
  }
  return g;
}

function voxelWalls(room: Room) {
  return pieces(room, { back: STACK.wall, near: STACK.nearWall }, (g, b) => {
    // 2 × 2 voxels a tile, back row first, each a little taller or shorter than the wall.
    for (const vr of [0, 1]) {
      for (const vc of [0, 1]) {
        const k = hash(b.c * 2 + vc, b.r * 2 + vr);
        const h = Math.max(2, b.height + ((k % 5) - 2));
        const base = b.frame ? [0x4a3a28, 0x564230][k % 2] : STONE[k % STONE.length];
        const x = b.tx + vc * 8, gy = b.ty + vr * 8, top = gy - h;
        g.rect(x, top, 8, 8).fill(mix(base, 0xffffff, 0.12));
        g.rect(x, top, 8, 0.5).rect(x, top, 0.5, 8).fill(mix(base, 0xffffff, 0.3));
        if (b.frame && (k % 3 === 0)) g.rect(x + 3, top + 3, 2, 2).fill(COLORS.amber);
        const faceTop = top + 8, faceBottom = gy + 8;
        for (let fy = faceTop; fy < faceBottom; fy += 1) g.rect(x, fy, 8, 1).fill(mix(base, 0x05060d, 0.35 + (0.4 * (fy - faceTop)) / Math.max(1, faceBottom - faceTop)));
        g.rect(x + 7.5, faceTop, 0.5, faceBottom - faceTop).fill({ color: 0x05060d, alpha: 0.5 });
      }
    }
  });
}

// ---- 3. Force field: rails along the floor edge, energy walls rising from them ----

function fieldFloor() {
  const g = new Graphics();
  g.rect(0, HUD_H, ROOM_W, ROWS * TILE).fill(0x05060d);
  g.rect(interior.x0, interior.y0, interior.x1 - interior.x0, interior.y1 - interior.y0).fill(0x0a0d1b);
  // Hex plates.
  const r = 6, w = Math.sqrt(3) * r;
  for (let row = 0, y = interior.y0; y < interior.y1 + r; row++, y += r * 1.5) {
    for (let x = interior.x0 + (row % 2 ? w / 2 : 0); x < interior.x1 + w; x += w) {
      const pts: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        pts.push(Math.min(interior.x1, Math.max(interior.x0, x + Math.cos(a) * (r - 0.5))), Math.min(interior.y1, Math.max(interior.y0, y + Math.sin(a) * (r - 0.5))));
      }
      g.poly(pts).stroke({ width: 0.5, color: 0x1c2446, alpha: 1 });
    }
  }
  return g;
}

function fieldWalls(room: Room) {
  const FIELD = 0x46d8ff;
  return pieces(room, { back: 14, near: 6 }, (g, b) => {
    const color = b.frame ? COLORS.amber : FIELD;
    const { tx, ty } = b;
    const side = b.c === 0 ? 'left' : b.c === COLS - 1 ? 'right' : b.r === 0 ? 'top' : 'bottom';
    if (side === 'top' || side === 'bottom') {
      // Rail on the floor edge, the field rising from it.
      const railY = side === 'top' ? ty + TILE - 4 : ty;
      g.rect(tx, railY, TILE, 4).fill(0x1b2036);
      g.rect(tx, railY, TILE, 0.5).fill(0x55608f);
      if (b.c % 2 === 0) g.rect(tx + 7, railY + 1.5, 2, 1).fill(color);
      const h = b.height, fy = railY - h;
      g.rect(tx, fy, TILE, h).fill({ color, alpha: 0.1 });
      for (let i = 0; i < h; i += 2) g.rect(tx, fy + i, TILE, 0.5).fill({ color, alpha: 0.22 });
      g.rect(tx, fy, TILE, 0.75).fill({ color, alpha: 0.9 });
    } else {
      // Seen edge-on: a rail along the inside edge and a bright band above it.
      const railX = side === 'left' ? tx + TILE - 4 : tx;
      g.rect(railX, ty, 4, TILE).fill(0x1b2036);
      g.rect(side === 'left' ? railX + 3.5 : railX, ty, 0.5, TILE).fill(0x55608f);
      g.rect(railX, ty - b.height, 4, TILE).fill({ color, alpha: 0.14 });
      g.rect(railX + 1.5, ty - b.height, 1, TILE).fill({ color, alpha: 0.8 });
    }
  });
}

// ---- 4. Industrial bulkhead: gunmetal, pipes, hazard stripes, grating ----

function industrialFloor() {
  const g = new Graphics();
  g.rect(interior.x0, interior.y0, interior.x1 - interior.x0, interior.y1 - interior.y0).fill(0x0e1016);
  for (let y = interior.y0; y < interior.y1; y += 4) g.rect(interior.x0, y, interior.x1 - interior.x0, 1).fill(0x171a23);
  for (let x = interior.x0; x < interior.x1; x += 4) g.rect(x, interior.y0, 1, interior.y1 - interior.y0).fill(0x171a23);
  // Under-floor lights showing through the grating.
  for (let i = 0; i < 6; i++) {
    const x = interior.x0 + 40 + i * 45, y = interior.y0 + (i % 2 ? 110 : 50);
    for (let k = 4; k > 0; k--) g.circle(x, y, k * 6).fill({ color: 0xff8a2a, alpha: 0.025 });
  }
  // Hazard stripes round the edge of the floor.
  const stripe = (x: number, y: number, w: number, h: number) => {
    g.rect(x, y, w, h).fill(0x161616);
    const long = Math.max(w, h);
    for (let i = 0; i < long; i += 4) {
      if (w > h) g.poly([x + i, y + h, x + i + 2, y + h, x + i + 2 + h, y, x + i + h, y]).fill(0xd8a021);
      else g.poly([x, y + i, x, y + i + 2, x + w, y + i + 2 + w, x + w, y + i + w]).fill(0xd8a021);
    }
  };
  stripe(interior.x0, interior.y0, interior.x1 - interior.x0, 2);
  stripe(interior.x0, interior.y1 - 2, interior.x1 - interior.x0, 2);
  stripe(interior.x0, interior.y0, 2, interior.y1 - interior.y0);
  stripe(interior.x1 - 2, interior.y0, 2, interior.y1 - interior.y0);
  return g;
}

function industrialWalls(room: Room) {
  return pieces(room, { back: 12, near: 4 }, (g, b) => {
    const x = b.tx, y = b.ty - b.height;
    g.rect(x, y, TILE, TILE).fill(b.frame ? 0x3a3326 : 0x2a2d34);
    g.rect(x, y, TILE, 0.5).fill(0x4a4f5a);
    if (b.c % 3 === 0) g.rect(x + 0.5, y + 1, 0.5, TILE - 2).fill(0x1c1e24);
    if (b.face <= 0) return;
    const fy = y + TILE;
    for (let i = 0; i < b.face; i++) g.rect(x, fy + i, TILE, 1).fill(mix(0x3e424b, 0x17191e, i / Math.max(1, b.face - 1)));
    g.rect(x, fy, TILE, 0.5).fill(0x8a909c);
    if (b.frame) {
      for (let i = 0; i < TILE; i += 4) g.poly([x + i, fy + b.face, x + i + 2, fy + b.face, x + i + 2 + b.face, fy, x + i + b.face, fy]).fill(0xd8a021);
      return;
    }
    if (b.face >= 8) {
      // Two pipes along the face, with a flange now and then.
      for (const py of [fy + 3, fy + 7]) {
        g.rect(x, py, TILE, 2).fill(0x5a606c);
        g.rect(x, py, TILE, 0.5).fill(0x9aa1ad);
        g.rect(x, py + 1.5, TILE, 0.5).fill(0x24262c);
      }
      if (b.c % 4 === 1) g.rect(x + 7, fy + 2, 2, 8).fill(0x6c7280);
      if (hash(b.c, b.r) % 5 === 0) g.rect(x + 12, fy + 1, 2, 1).fill(0xff8a2a);
    }
  });
}

// ---- 5. Floating deck: a platform in open space, no walls ----

function deckFloor() {
  const g = new Graphics();
  g.rect(0, HUD_H, ROOM_W, ROWS * TILE).fill(0x02030a);
  // Stars and a faint nebula beyond the deck.
  for (let i = 0; i < 6; i++) g.circle(40 + i * 60, HUD_H + (i % 2 ? 30 : 170), 50).fill({ color: i % 2 ? 0x3a1d5c : 0x15305c, alpha: 0.12 });
  for (let i = 0; i < 260; i++) {
    const h = hash(i, i * 7, 3);
    g.rect((h * 13) % ROOM_W, HUD_H + ((h * 7 + i * 3) % (ROWS * TILE)), 0.5 + (h % 3 === 0 ? 0.5 : 0), 0.5 + (h % 3 === 0 ? 0.5 : 0)).fill({ color: 0xffffff, alpha: 0.3 + (h % 5) / 8 });
  }
  // The deck: plates, then its thickness along the near edge, then a rim light.
  const { x0, y0, x1, y1 } = interior;
  g.rect(x0, y1, x1 - x0, 6).fill(0x0d1020);
  g.rect(x0, y1 + 5.5, x1 - x0, 0.5).fill({ color: 0x46d8ff, alpha: 0.5 });
  for (let y = y0; y < y1; y += TILE) {
    for (let x = x0; x < x1; x += TILE) {
      g.rect(x, y, TILE, TILE).fill(mix(0x1a1f36, 0x20263f, (hash(x, y) % 4) / 3));
      g.rect(x, y, TILE, 0.5).rect(x, y, 0.5, TILE).fill(0x2b3253);
    }
  }
  g.rect(x0 - 0.5, y0 - 0.5, x1 - x0 + 1, y1 - y0 + 1).stroke({ width: 0.75, color: 0x46d8ff, alpha: 0.9 });
  return g;
}

function deckWalls(room: Room) {
  // Bridges out through the doorways, drawn under everything.
  const g = new Graphics();
  g.zIndex = -1e6;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isEdge(c, r) || !inDoor(room, c, r)) continue;
      const x = c * TILE, y = HUD_H + r * TILE;
      g.rect(x, y, TILE, TILE).fill(0x1a1f36);
      const vertical = r === 0 || r === ROWS - 1;
      if (vertical) {
        if (!inDoor(room, c - 1, r)) g.rect(x, y, 0.75, TILE).fill(COLORS.amber);
        if (!inDoor(room, c + 1, r)) g.rect(x + TILE - 0.75, y, 0.75, TILE).fill(COLORS.amber);
      } else {
        if (!inDoor(room, c, r - 1)) g.rect(x, y, TILE, 0.75).fill(COLORS.amber);
        if (!inDoor(room, c, r + 1)) g.rect(x, y + TILE - 0.75, TILE, 0.75).fill(COLORS.amber);
      }
      if ((c + r) % 2 === 0) g.rect(x + 7, y + 7, 2, 2).fill({ color: COLORS.amber, alpha: 0.8 });
    }
  }
  return [g];
}

/** The prototype styles: floor (drawn once), walls (per room), and whether to keep the shade and door glow. */
export const STYLES: Record<number, { floor: () => Container; walls: (room: Room) => Graphics[]; shade: boolean; doorGlow: boolean }> = {
  1: { floor: neonFloor, walls: neonWalls, shade: false, doorGlow: true },
  2: { floor: voxelFloor, walls: voxelWalls, shade: true, doorGlow: true },
  3: { floor: fieldFloor, walls: fieldWalls, shade: false, doorGlow: true },
  4: { floor: industrialFloor, walls: industrialWalls, shade: true, doorGlow: true },
  5: { floor: deckFloor, walls: deckWalls, shade: false, doorGlow: false },
};
