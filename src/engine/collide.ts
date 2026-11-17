import { INTERIOR } from '../config';
import { clamp } from './rng';

/** Something round that moves: position and velocity in design pixels (per second). */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < (a.r + b.r) ** 2;

/**
 * Pushes the body out of the rectangle. Returns the push direction (unit vector), or undefined if they didn't touch.
 * Velocity is left alone: the caller decides between stopping and bouncing.
 */
export function pushOut(b: Body, r: Rect): { nx: number; ny: number } | undefined {
  const cx = clamp(b.x, r.x, r.x + r.w), cy = clamp(b.y, r.y, r.y + r.h);
  const dx = b.x - cx, dy = b.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r) return undefined;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    b.x += nx * (b.r - d);
    b.y += ny * (b.r - d);
    return { nx, ny };
  }
  // The centre is inside the rectangle: out through the nearest side.
  const exits = [
    { d: b.x - r.x, nx: -1, ny: 0 }, { d: r.x + r.w - b.x, nx: 1, ny: 0 },
    { d: b.y - r.y, nx: 0, ny: -1 }, { d: r.y + r.h - b.y, nx: 0, ny: 1 },
  ];
  const e = exits.reduce((a, c) => (c.d < a.d ? c : a));
  b.x += e.nx * (e.d + b.r);
  b.y += e.ny * (e.d + b.r);
  return { nx: e.nx, ny: e.ny };
}

/** Takes the part of the velocity heading into a surface away (stop), or flips it (bounce). */
export function hitSurface(b: Body, nx: number, ny: number, bounce: boolean) {
  const into = b.vx * nx + b.vy * ny;
  if (into >= 0) return;
  const k = bounce ? 2 : 1;
  b.vx -= k * into * nx;
  b.vy -= k * into * ny;
}

/** Pushes two overlapping bodies apart; a `fixed` one doesn't move. Returns the normal from a to b, if they touched. */
export function separate(a: Body, b: Body, aFixed: boolean, bFixed: boolean) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), overlap = a.r + b.r - d;
  if (overlap <= 0 || (aFixed && bFixed)) return undefined;
  const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
  const shareA = aFixed ? 0 : bFixed ? 1 : 0.5, shareB = 1 - shareA;
  a.x -= nx * overlap * shareA;
  a.y -= ny * overlap * shareA;
  b.x += nx * overlap * shareB;
  b.y += ny * overlap * shareB;
  return { nx, ny };
}

/** Distance along a unit ray from (ox, oy) to the circle, or Infinity on a miss. */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number) {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  if (-b - s >= 0) return -b - s;
  return -b + s >= 0 ? 0 : Infinity;
}

/** Distance along a unit ray to the inner edge of the wall ring. */
export function rayToWall(ox: number, oy: number, dx: number, dy: number) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (INTERIOR.x1 - ox) / dx);
  if (dx < 0) t = Math.min(t, (INTERIOR.x0 - ox) / dx);
  if (dy > 0) t = Math.min(t, (INTERIOR.y1 - oy) / dy);
  if (dy < 0) t = Math.min(t, (INTERIOR.y0 - oy) / dy);
  return Math.max(0, t);
}

/** Sets the velocity to `speed` toward (x, y) (Phaser's moveTo). */
export function moveToward(b: Body, x: number, y: number, speed: number) {
  const a = Math.atan2(y - b.y, x - b.x);
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
}
