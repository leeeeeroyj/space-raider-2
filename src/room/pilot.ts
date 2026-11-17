import type { ControlState, Vec } from '../engine/input';
import { dist } from '../engine/rng';
import { SIDES, neighbor, type Room, type Side } from '../vault';
import { CENTER, entryPoint } from './geometry';
import type { RoomScreen } from '../screens/room';

/**
 * Attract mode's pilot: the beam always on the nearest hostile; flies to the room's loot, then room by room
 * (through the doors, by the vault's own map) to the nearest room with loot, or the exit once it holds two pieces.
 * Hostiles and bolts close by push it away, and if it hasn't moved for a second it's nudged sideways.
 */
export class Pilot {
  /** The anti-stuck check: where it was a second ago, and a sideways push while it's stuck. */
  private check = { x: 0, y: 0, t: 0 };
  private nudge = { x: 0, y: 0, t: 0 };
  private aim = -Math.PI / 2;

  steer(r: RoomScreen, dt: number): ControlState {
    const p = r.player, move: Vec = { x: 0, y: 0 };
    const out: ControlState = { move, aim: this.aim, fire: false, toggleAim: false, confirm: false, back: false, mute: false, pause: false, device: 'kbm' };
    if (r.dead || r.over || r.banking) return out;
    const foes = [...r.enemies, ...(r.scavenger && !r.scavenger.fleeing ? [r.scavenger] : [])];
    let nearest: { x: number; y: number } | undefined, nd = Infinity;
    for (const e of foes) {
      const d = dist(p.x, p.y, e.x, e.y);
      if (d < nd) {
        nd = d;
        nearest = e;
      }
    }
    if (nearest) {
      this.aim = out.aim = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      out.fire = true;
    }

    const goal = this.goal(r);
    move.x = goal.x - p.x;
    move.y = goal.y - p.y;
    clampLength(move);
    // Keep clear of hostiles (the big slow ones get a wider berth) and step out of a bolt's path.
    for (const e of foes) {
      const reach = e.kind === 'warden' || e.kind === 'brood' || e.kind === 'sentry' ? 40 : 34;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d < reach && d > 0) {
        move.x += (dx / d) * 2.2 * (1 - d / reach);
        move.y += (dy / d) * 2.2 * (1 - d / reach);
      }
    }
    for (const b of r.bolts) {
      const speed = Math.hypot(b.vx, b.vy);
      const dx = p.x - b.x, dy = p.y - b.y;
      if (!speed || Math.hypot(dx, dy) > 48 || dx * b.vx + dy * b.vy < 0) continue;
      // Sideways off the line the bolt is travelling.
      const nx = -b.vy / speed, ny = b.vx / speed, side = Math.sign(dx * nx + dy * ny) || 1;
      move.x += nx * side * 1.6;
      move.y += ny * side * 1.6;
    }
    // Stuck against a wall or between two pushes: shove sideways for a moment.
    this.check.t += dt;
    if (this.check.t > 1) {
      if (dist(p.x, p.y, this.check.x, this.check.y) < 6 && Math.hypot(move.x, move.y) > 0.3) {
        const a = Math.atan2(move.y, move.x) + ((Math.random() < 0.5 ? 1 : -1) * Math.PI) / 2;
        this.nudge = { x: Math.cos(a), y: Math.sin(a), t: 0.6 };
      }
      this.check = { x: p.x, y: p.y, t: 0 };
    }
    if (this.nudge.t > 0) {
      this.nudge.t -= dt;
      move.x += this.nudge.x * 1.5;
      move.y += this.nudge.y * 1.5;
    }
    clampLength(move);
    return out;
  }

  /** Where the pilot is heading in this room: loot, the extraction pad, or through the door toward its next room. */
  private goal(r: RoomScreen): { x: number; y: number } {
    const p = r.player, room = r.room, vault = r.vault, cargo = r.cargo.length, full = cargo >= r.slots;
    if (room.crates.length) return room.crates.reduce((a, b) => (dist(p.x, p.y, a.x, a.y) <= dist(p.x, p.y, b.x, b.y) ? a : b));
    if (room.loot.length && !full) {
      return room.loot.reduce((a, b) => (dist(p.x, p.y, a.x, a.y) <= dist(p.x, p.y, b.x, b.y) ? a : b));
    }
    if (room === vault.exit && cargo) return CENTER;
    // Breadth-first through the doors: the first step toward the nearest room with loot, or the exit.
    const want = (n: Room) => (full ? n === vault.exit : n.loot.length > 0 || (n === vault.exit && cargo > 0));
    const first = new Map<Room, Side>([[room, 'top']]);
    const queue: Room[] = [room];
    let side: Side | undefined;
    while (queue.length && !side) {
      const at = queue.shift()!;
      for (const s of SIDES) {
        const n = at.doors[s] && neighbor(vault, at, s);
        if (!n || first.has(n)) continue;
        first.set(n, at === room ? s : first.get(at)!);
        if (want(n)) {
          side = first.get(n);
          break;
        }
        queue.push(n);
      }
    }
    // Nothing left to want: wander toward the exit anyway, or sit in the middle on the pad.
    if (!side) {
      if (room === vault.exit) return CENTER;
      side = SIDES.find((s) => room.doors[s] && neighbor(vault, room, s)) ?? 'top';
    }
    const at = entryPoint(room, side);
    const out = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
    // Line up just inside the doorway, then fly straight out through it.
    const lined = side === 'top' || side === 'bottom' ? Math.abs(p.x - at.x) < 4 : Math.abs(p.y - at.y) < 4;
    return lined ? { x: at.x + out[0] * 40, y: at.y + out[1] * 40 } : at;
  }
}

function clampLength(v: Vec) {
  const l = Math.hypot(v.x, v.y);
  if (l > 1) {
    v.x /= l;
    v.y /= l;
  }
}
