import { ColorMatrixFilter, Container, Graphics, Rectangle, RenderTexture, Sprite, type Filter } from 'pixi.js';
import { AdvancedBloomFilter, BulgePinchFilter } from 'pixi-filters';
import { COLS, FX, HEIGHT, HUD_H, RENDER_SCALE, ROWS, TILE, WIDTH } from './config';
import { EASE, type Clock } from './engine/clock';
import { clamp, rand } from './engine/rng';
import { game } from './engine/screens';
import { named } from './engine/textures';

const WHITE = 0xffffff;

/** HSV (each 0..1) to a 0xRRGGBB colour. */
function hsv(h: number, s: number, v: number) {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

/**
 * A springy grid over the room floor. Explosions push it outward, spawns pull it in, and the ripples settle.
 * Each point stores only its offset from rest; the border is pinned to the walls.
 */
class WarpGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly x0 = TILE;
  private readonly y0 = HUD_H + TILE;
  private readonly dx: Float32Array;
  private readonly dy: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  readonly g = new Graphics();
  /** Grows with every disturbance and fades as the grid settles; brightens the lines. */
  private energy = 0;
  private hue = Math.random();

  constructor() {
    const s = FX.grid.spacing;
    this.cols = ((COLS - 2) * TILE) / s + 1;
    this.rows = ((ROWS - 2) * TILE) / s + 1;
    const n = this.cols * this.rows;
    this.dx = new Float32Array(n);
    this.dy = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.g.blendMode = 'add';
  }

  /** Pushes points within `radius` away from (x, y); a negative strength pulls them in. */
  push(x: number, y: number, strength: number, radius: number) {
    const s = FX.grid.spacing;
    const c0 = Math.max(1, Math.floor((x - radius - this.x0) / s)), c1 = Math.min(this.cols - 2, Math.ceil((x + radius - this.x0) / s));
    const r0 = Math.max(1, Math.floor((y - radius - this.y0) / s)), r1 = Math.min(this.rows - 2, Math.ceil((y + radius - this.y0) / s));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        const px = this.x0 + c * s + this.dx[i] - x, py = this.y0 + r * s + this.dy[i] - y;
        const d = Math.hypot(px, py);
        if (d >= radius || d < 0.001) continue;
        const f = (strength * (1 - d / radius)) / d;
        this.vx[i] += px * f;
        this.vy[i] += py * f;
      }
    }
    this.energy = Math.min(1, this.energy + Math.abs(strength) / 400);
  }

  reset() {
    this.dx.fill(0); this.dy.fill(0); this.vx.fill(0); this.vy.fill(0);
    this.energy = 0;
  }

  update(dt: number) {
    const { stiffness, coupling, damping, maxOffset } = FX.grid;
    const { cols, rows, dx, dy, vx, vy } = this;
    // Small fixed steps keep the springs stable however long the frame was.
    for (let left = Math.min(dt, 0.1); left > 0; left -= 1 / 120) {
      const h = Math.min(left, 1 / 120);
      for (let r = 1; r < rows - 1; r++) {
        for (let c = 1; c < cols - 1; c++) {
          const i = r * cols + c;
          const lx = dx[i - 1] + dx[i + 1] + dx[i - cols] + dx[i + cols] - 4 * dx[i];
          const ly = dy[i - 1] + dy[i + 1] + dy[i - cols] + dy[i + cols] - 4 * dy[i];
          vx[i] += (coupling * lx - stiffness * dx[i] - damping * vx[i]) * h;
          vy[i] += (coupling * ly - stiffness * dy[i] - damping * vy[i]) * h;
        }
      }
      for (let i = 0; i < dx.length; i++) {
        dx[i] = clamp(dx[i] + vx[i] * h, -maxOffset, maxOffset);
        dy[i] = clamp(dy[i] + vy[i] * h, -maxOffset, maxOffset);
      }
    }
    this.energy *= Math.exp(-1.5 * dt);
    this.hue = (this.hue + dt / FX.grid.hueCycleSeconds) % 1;
    this.draw();
  }

  private draw() {
    const { cols, rows, dx, dy, x0, y0 } = this;
    const s = FX.grid.spacing;
    const g = this.g.clear();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c === 0) g.moveTo(x0 + c * s + dx[i], y0 + r * s + dy[i]);
        else g.lineTo(x0 + c * s + dx[i], y0 + r * s + dy[i]);
      }
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const i = r * cols + c;
        if (r === 0) g.moveTo(x0 + c * s + dx[i], y0 + r * s + dy[i]);
        else g.lineTo(x0 + c * s + dx[i], y0 + r * s + dy[i]);
      }
    }
    g.stroke({ width: FX.grid.lineWidth, color: hsv(this.hue, 0.7, 1), alpha: FX.grid.alpha + this.energy * FX.grid.flashAlpha });
  }
}

interface Spark {
  s: Sprite;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** Streaks that fly out, slow down (drag) and fade. Sprites are pooled, so bursts don't allocate. */
class Sparks {
  readonly layer = new Container();
  private live: Spark[] = [];
  private pool: Sprite[] = [];

  emit(x: number, y: number, count: number, palette: number[], speed: number, life: number, from = 0, range = 360) {
    const texture = named('fx-streak', 4, 1, (ctx) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 4, 1);
    });
    for (let i = 0; i < count; i++) {
      const s = this.pool.pop() ?? new Sprite(texture);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      const a = ((from + Math.random() * range) * Math.PI) / 180;
      const v = speed * (0.25 + Math.random() * 0.75);
      s.position.set(x, y);
      s.rotation = a;
      s.tint = rand.pick(palette);
      s.visible = true;
      this.layer.addChild(s);
      this.live.push({ s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: (life * (0.5 + Math.random() * 0.5)) / 1000 });
    }
  }

  update(dt: number) {
    const k = Math.exp(-4 * dt);
    this.live = this.live.filter((p) => {
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        this.recycle(p.s);
        return false;
      }
      p.vx *= k;
      p.vy *= k;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.scale.set(1.6 + (0.3 - 1.6) * t, 1);
      p.s.alpha = 1 - t;
      return true;
    });
  }

  clear() {
    for (const p of this.live) this.recycle(p.s);
    this.live = [];
  }

  private recycle(s: Sprite) {
    s.visible = false;
    this.layer.removeChild(s);
    this.pool.push(s);
  }
}

/**
 * GPU-side things every room uses: made once and kept, because filters and render textures hold GPU resources that
 * building new ones per room would pile up.
 */
let shared: ReturnType<typeof makeShared> | undefined;
function makeShared() {
  const b = FX.bloom;
  const scene = RenderTexture.create({ width: WIDTH, height: HEIGHT, scaleMode: 'linear' });
  const source = new Sprite(scene);
  source.filters = [new AdvancedBloomFilter({ threshold: b.threshold, bloomScale: b.scale, brightness: 0, blur: b.blur, quality: b.quality })];
  return {
    scene, source,
    glow: RenderTexture.create({ width: WIDTH, height: HEIGHT, scaleMode: 'linear' }),
    bulge: new BulgePinchFilter({ center: { x: 0.5, y: 0.5 }, radius: WIDTH * RENDER_SCALE * 0.6, strength: 0 }),
    hue: new ColorMatrixFilter(),
  };
}

/**
 * Soft halos round everything bright. The room is drawn a second time at design size (1/16 of the canvas's pixels),
 * the bright parts are pulled out and blurred there, and the result is laid over the room with additive blending.
 * Far cheaper than filtering the full-size canvas, and the glow is blurry anyway.
 */
class Bloom {
  readonly overlay: Sprite;

  constructor(private readonly gpu: NonNullable<typeof shared>) {
    this.overlay = new Sprite(gpu.glow);
    this.overlay.scale.set(RENDER_SCALE);
    this.overlay.blendMode = 'add';
  }

  /** Redraws the glow from the world as it is now. The world is drawn unscaled for this, then put back. */
  update(world: Container) {
    const renderer = game.app.renderer;
    const { x, y } = world.position, k = world.scale.x;
    world.position.set(x / k, y / k);
    world.scale.set(1);
    renderer.render({ container: world, target: this.gpu.scene, clear: true });
    world.position.set(x, y);
    world.scale.set(k);
    renderer.render({ container: this.gpu.source, target: this.gpu.glow, clear: true });
  }
}

export type BurstSize = 'small' | 'big' | 'huge';

/** `shake` is in design pixels. */
const BURSTS: Record<BurstSize, { sparks: number; speed: number; life: number; ring: number; push: number; reach: number; shake: number }> = {
  small: { sparks: 28, speed: 150, life: 450, ring: 14, push: 260, reach: 36, shake: 0.8 },
  big: { sparks: 70, speed: 210, life: 650, ring: 26, push: 480, reach: 60, shake: 1.8 },
  huge: { sparks: 160, speed: 260, life: 900, ring: 44, push: 900, reach: 110, shake: 3.5 },
};

/**
 * The room's eye candy: neon spark bursts, shockwave rings, the warping floor grid, bloom on everything bright,
 * and screen wobble (lens bulge, hue swing, roll, shake). One per room; call update() every frame.
 * `world` is the container the room is drawn in (scaled to the canvas): shake and roll apply to it. Add `view` to the
 * screen in its place: it holds the world and its glow, and the lens bulge and hue swing apply to both.
 * Add `floor` just above the floor tiles and `top` above the sprites.
 */
export class Effects {
  readonly view = new Container();
  readonly floor = new Container();
  readonly top = new Container();
  private readonly grid: WarpGrid | undefined;
  private readonly sparks = new Sparks();
  private readonly rings = new Container();
  private readonly bloom: Bloom | undefined;
  private readonly bulge: BulgePinchFilter;
  private readonly hue: ColorMatrixFilter;
  private filtersOn = '-';
  /** Lens bulge, hue swing and roll all ease back to rest from these. */
  private wobble = { bulge: 0, hue: 0, roll: 0, rollPhase: 0, shake: 0 };

  constructor(private readonly clock: Clock, private readonly world: Container) {
    const gpu = (shared ??= makeShared());
    this.bulge = gpu.bulge;
    this.hue = gpu.hue;
    if (FX.grid.enabled) {
      this.grid = new WarpGrid();
      this.floor.addChild(this.grid.g);
    }
    this.top.addChild(this.rings, this.sparks.layer);
    // The world rolls round the middle of the screen.
    world.pivot.set(WIDTH / 2, HEIGHT / 2);
    world.position.set((WIDTH / 2) * RENDER_SCALE, (HEIGHT / 2) * RENDER_SCALE);
    this.view.addChild(world);
    this.view.filterArea = new Rectangle(0, 0, WIDTH * RENDER_SCALE, HEIGHT * RENDER_SCALE);
    if (FX.bloom.enabled) {
      this.bloom = new Bloom(gpu);
      this.view.addChild(this.bloom.overlay);
    }
  }

  /** An explosion: sparks in the given colours, a shockwave ring, a dent in the grid and a shake. */
  burst(x: number, y: number, colors: number[], size: BurstSize = 'small') {
    const b = BURSTS[size];
    this.sparks.emit(x, y, b.sparks, [...colors, ...colors, WHITE], b.speed, b.life);
    this.ring(x, y, colors[0], b.ring, b.life * 0.7);
    if (size !== 'small') this.ring(x, y, WHITE, b.ring * 0.6, b.life * 0.5);
    this.grid?.push(x, y, b.push, b.reach);
    this.wobble.shake = Math.max(this.wobble.shake, b.shake);
    if (size === 'big') this.kick(0.05, 25, 0);
    if (size === 'huge') this.kick(0.12, 45, 0.03);
  }

  /** Something is taking beam damage at (x, y): sparks spray back along the beam and the grid ripples. */
  hit(x: number, y: number, beamAngle: number, color: number) {
    this.sparks.emit(x, y, 2, [color, WHITE], 110, 260, (beamAngle * 180) / Math.PI + 180 - 50, 100);
    this.grid?.push(x, y, 40, 18);
  }

  /** Something arriving: a ring that closes in and the grid sucked toward it. */
  implode(x: number, y: number, color: number) {
    this.ring(x, y, color, 18, 380, true);
    this.grid?.push(x, y, -220, 34);
  }

  /** A celebration or a puff: sparks and a ring, with no shake or grid dent. */
  pop(x: number, y: number, colors: number[], sparks: number) {
    this.sparks.emit(x, y, sparks, [...colors, WHITE], 120, 520);
    this.ring(x, y, colors[0], 10 + sparks / 6, 420);
  }

  /** Called on room change: nothing from the last room carries over. */
  clear() {
    this.sparks.clear();
    for (const r of [...this.rings.children]) r.destroy();
    this.grid?.reset();
  }

  update(dt: number) {
    this.grid?.update(dt);
    this.sparks.update(dt);
    const w = this.wobble;
    const ease = Math.exp(-4 * dt);
    w.bulge *= ease;
    w.hue *= ease;
    w.roll *= Math.exp(-3 * dt);
    w.rollPhase += dt * 22;
    w.shake = w.shake * Math.exp(-7 * dt);
    if (w.shake < 0.05) w.shake = 0;
    this.bulge.strength = w.bulge * 2.5 * Math.cos(w.rollPhase * 0.7);
    this.hue.hue(w.hue, false);
    this.applyFilters();
    this.world.rotation = w.roll > 0.0005 ? w.roll * Math.sin(w.rollPhase) : 0;
    this.world.pivot.set(WIDTH / 2 + (Math.random() * 2 - 1) * w.shake, HEIGHT / 2 + (Math.random() * 2 - 1) * w.shake);
    this.bloom?.update(this.world);
  }

  /** The bulge and hue swing only while they're doing something: each is a full-screen pass. */
  private applyFilters() {
    const list: Filter[] = [];
    if (this.wobble.bulge > 0.002) list.push(this.bulge);
    if (this.wobble.hue > 0.5) list.push(this.hue);
    const key = list.map((f) => (f === this.bulge ? 'p' : 'h')).join('');
    if (key === this.filtersOn) return;
    this.filtersOn = key;
    this.view.filters = list.length ? list : null;
  }

  /** Screen wobble: lens bulge, a hue swing in degrees and a roll in radians. */
  private kick(bulge: number, hue: number, roll: number) {
    const w = this.wobble;
    w.bulge = Math.max(w.bulge, bulge);
    w.hue = Math.max(w.hue, hue);
    if (roll > w.roll) {
      w.roll = roll;
      w.rollPhase = 0;
    }
  }

  private ring(x: number, y: number, color: number, radius: number, ms: number, inward = false) {
    const g = new Graphics();
    g.blendMode = 'add';
    this.rings.addChild(g);
    const t = { p: 0 };
    this.clock.tween(t, { p: 1 }, {
      ms, ease: inward ? EASE.quadIn : EASE.quadOut,
      onUpdate: () => {
        if (g.destroyed) return;
        const r = inward ? radius * (1 - t.p) + 1 : 2 + radius * t.p;
        g.clear().circle(x, y, r).stroke({ width: inward ? 1 : 2 - t.p, color, alpha: 1 - t.p * (inward ? 0.3 : 1) });
      },
      onComplete: () => {
        if (!g.destroyed) g.destroy();
      },
    });
  }
}
