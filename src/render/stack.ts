import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { STACK, type StackMode } from '../config';
import { tex } from '../engine/textures';

/**
 * Sprite stacking: an object is a pile of horizontal slices, each drawn `STACK.step` pixels above the one under it.
 * Seen from above at an angle, the pile reads as a solid you can turn. Every slice 
 * is baked once into a single atlas (with the shadows), so a room draws in a few batches.
 */

interface Slice {
  tex: Texture;
  white: Texture;
}

interface Model {
  /** Bottom to top; undefined where a row of the sprite is empty (the slice is skipped, its height kept). */
  slices: Array<Slice | undefined>;
  /** Brightness of each slice, 0..1: lower slices are darker. */
  shade: number[];
}

const models: Record<string, Model> = {};
const shadows: Record<number, Texture> = {};

const SIZE = 16;
const ATLAS_W = 512;

/** Places cells left to right in shelves, with a clear pixel round each so turned slices don't pick up neighbours. */
class Packer {
  x = 1;
  y = 1;
  shelf = 0;
  readonly cells: Array<{ x: number; y: number; img: ImageData }> = [];
  add(img: ImageData) {
    if (this.x + img.width + 1 > ATLAS_W) {
      this.x = 1;
      this.y += this.shelf + 1;
      this.shelf = 0;
    }
    const cell = { x: this.x, y: this.y, img };
    this.cells.push(cell);
    this.x += img.width + 1;
    this.shelf = Math.max(this.shelf, img.height);
    return cell;
  }
}

/** The RGBA pixels of a 16 × 16 sprite. */
function pixels(key: string): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(tex[key].source.resource as CanvasImageSource, 0, 0);
  return ctx.getImageData(0, 0, SIZE, SIZE);
}

const alphaAt = (d: ImageData, r: number, c: number) => d.data[(r * SIZE + c) * 4 + 3];

/** A slice image (and its all-white twin) where each pixel copies the sprite pixel `from(x, y)` returns, if any. */
function slice(src: ImageData, w: number, h: number, from: (x: number, y: number) => [number, number] | undefined) {
  const img = new ImageData(w, h), white = new ImageData(w, h);
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = from(x, y);
      if (!at || !alphaAt(src, at[0], at[1])) continue;
      const i = (at[0] * SIZE + at[1]) * 4, o = (y * w + x) * 4;
      img.data.set(src.data.subarray(i, i + 4), o);
      white.data.set([255, 255, 255, src.data[i + 3]], o);
      any = true;
    }
  }
  return any ? { img, white } : undefined;
}

/**
 * One row of a front-view sprite spun into a disc, the same all the way round so it can turn: each ring takes the
 * row's colour that far from the middle. The dark outline at the row's ends would make a dark rim on every slice, so
 * it takes the colour just inside it, and the disc darkens a little toward its edge instead.
 */
function ring(src: ImageData, r: number) {
  const mid = SIZE / 2;
  const at = (c: number) => (c >= 0 && c < SIZE && alphaAt(src, r, c) ? (r * SIZE + c) * 4 : -1);
  // profile[k]: the pixel k steps out from the middle, from the right half or else the left.
  const profile: number[] = [];
  for (let k = 0; k < mid; k++) {
    const i = at(mid + k) >= 0 ? at(mid + k) : at(mid - 1 - k);
    profile.push(i);
  }
  const last = profile.reduce((m, i, k) => (i >= 0 ? k : m), -1);
  if (last < 0) return undefined;
  const d = src.data;
  const lum = (i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
  for (let k = last; k > 0 && profile[k] >= 0 && lum(profile[k]) < 48; k--) {
    const inner = profile.slice(0, k).reverse().find((i) => i >= 0 && lum(i) >= 48);
    if (inner === undefined) break;
    profile[k] = inner;
  }
  const img = new ImageData(SIZE, SIZE), white = new ImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const rad = Math.hypot(x + 0.5 - mid, y + 0.5 - mid);
      const k = Math.floor(rad);
      if (k > last) continue;
      const i = profile[k] >= 0 ? profile[k] : profile.slice(0, k).reverse().find((j) => j >= 0)!;
      if (i === undefined) continue;
      const shade = 1 - 0.2 * (rad / (last + 1)) ** 2;
      const o = (y * SIZE + x) * 4;
      img.data.set([d[i] * shade, d[i + 1] * shade, d[i + 2] * shade, d[i + 3]], o);
      white.data.set([255, 255, 255, d[i + 3]], o);
    }
  }
  return { img, white };
}

/** Slices of one sprite, bottom to top, as images. */
function cut(key: string, mode: StackMode) {
  const src = pixels(key);
  if (mode.kind === 'flat') {
    const s = slice(src, SIZE, SIZE, (x, y) => [y, x])!;
    return {
      images: Array.from({ length: mode.layers + 1 }, () => s),
      shade: Array.from({ length: mode.layers + 1 }, (_, i) => (i === mode.layers ? 1 : 0.45 + (0.25 * i) / mode.layers)),
    };
  }
  // Front-view sprites: the bottom row is the bottom slice. Empty rows under the sprite are dropped so it stands on
  // the ground; empty rows inside it keep their height.
  const cols = Array.from({ length: SIZE }, (_, c) => c);
  const rows = cols.filter((r) => cols.some((c) => alphaAt(src, r, c)));
  let top = rows[0], bottom = rows[rows.length - 1];
  if (mode.kind === 'lathe') {
    // A row that is all outline would cap the disc pile with a dark lid (or base): drop it.
    const d = src.data;
    const dark = (r: number) => cols.every((c) => !alphaAt(src, r, c) || 0.3 * d[(r * SIZE + c) * 4] + 0.59 * d[(r * SIZE + c) * 4 + 1] + 0.11 * d[(r * SIZE + c) * 4 + 2] < 48);
    while (top < bottom && dark(top)) top++;
    while (bottom > top && dark(bottom)) bottom--;
  }
  const images = [];
  for (let r = bottom; r >= top; r--) {
    if (mode.kind === 'card') {
      // A strip `depth` deep, every line a copy of the row: a thick cut-out.
      images.push(slice(src, SIZE, mode.depth, (x) => [r, x]));
    } else {
      images.push(ring(src, r));
    }
  }
  const n = images.length;
  return { images, shade: images.map((_, i) => 0.75 + (0.25 * i) / Math.max(1, n - 1)) };
}

/** A hard-edged dark oval for under things. */
function shadow(r: number) {
  const w = r * 2, h = Math.max(3, Math.round(r * 1.1));
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
      if (dx * dx + dy * dy <= 1) img.data.set([0, 0, 8, 255], (y * w + x) * 4);
    }
  }
  return img;
}

/** Bakes every model and shadow into the atlas. Call once, after the sprites load. */
export function bakeStacks() {
  const packer = new Packer();
  const pending: Array<() => void> = [];
  const frame = (cell: { x: number; y: number; img: ImageData }) => () =>
    new Texture({ source: atlas.source, frame: new Rectangle(cell.x, cell.y, cell.img.width, cell.img.height) });

  for (const [key, mode] of Object.entries(STACK.models) as Array<[string, StackMode]>) {
    const { images, shade } = cut(key, mode);
    // Flat models repeat one slice: pack it once.
    const packed = new Map<object, { tex: () => Texture; white: () => Texture }>();
    const parts = images.map((s) => {
      if (!s) return undefined;
      let p = packed.get(s);
      if (!p) packed.set(s, (p = { tex: frame(packer.add(s.img)), white: frame(packer.add(s.white)) }));
      return p;
    });
    pending.push(() => {
      const made = new Map<object, Slice>();
      models[key] = {
        shade,
        slices: parts.map((p) => {
          if (!p) return undefined;
          let s = made.get(p);
          if (!s) made.set(p, (s = { tex: p.tex(), white: p.white() }));
          return s;
        }),
      };
    });
  }
  for (const r of new Set(Object.values(STACK.shadow))) {
    const make = frame(packer.add(shadow(r)));
    pending.push(() => (shadows[r] = make()));
  }

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = packer.y + packer.shelf + 1;
  const ctx = canvas.getContext('2d')!;
  for (const cell of packer.cells) ctx.putImageData(cell.img, cell.x, cell.y);
  const atlas = Texture.from(canvas);
  for (const make of pending) make();
}

/** One stacked object. Its position is where it stands on the floor; the slices rise from there. */
export class Stack extends Container {
  /** The slices, lifted by `lift`. */
  readonly body = new Container();
  private readonly parts: Array<{ sprite: Sprite; slice: Slice; tint: number }> = [];
  private _spin = 0;
  private _white = false;

  /** `kind` names the model; `shadow` (a radius from STACK.shadow) puts a shadow under it. */
  constructor(kind: string, shadow?: number) {
    super();
    if (shadow) {
      const s = this.addChild(new Sprite(shadows[shadow]));
      s.anchor.set(0.5);
      s.alpha = 0.4;
    }
    this.addChild(this.body);
    // Slices turn first, then the body squashes their depth; their heights are divided back out so they stay a step apart.
    this.body.scale.y = STACK.squash;
    const m = models[kind];
    m.slices.forEach((slice, i) => {
      if (!slice) return;
      const sprite = this.body.addChild(new Sprite(slice.tex));
      sprite.anchor.set(0.5);
      sprite.y = (-i * STACK.step) / STACK.squash;
      const v = Math.round(255 * m.shade[i]);
      const tint = (v << 16) | (v << 8) | v;
      sprite.tint = tint;
      this.parts.push({ sprite, slice, tint });
    });
    this.lift = STACK.hover[kind] ?? 0;
  }

  /** How high the slices float above the floor (and the shadow). */
  get lift() {
    return -this.body.y;
  }

  set lift(z: number) {
    this.body.y = -z;
  }

  /** Turn about the upright axis, in radians. */
  get spin() {
    return this._spin;
  }

  set spin(a: number) {
    this._spin = a;
    for (const p of this.parts) p.sprite.rotation = a;
  }

  /** Solid white: the flash under the beam. */
  set white(on: boolean) {
    if (on === this._white) return;
    this._white = on;
    // The slices keep their shading, so a flashing hostile keeps its shape.
    for (const p of this.parts) p.sprite.texture = on ? p.slice.white : p.slice.tex;
  }

  /** Height of the top slice above the floor. */
  get top() {
    return this.lift + (this.parts.length ? -this.parts[this.parts.length - 1].sprite.y * STACK.squash : 0);
  }
}
