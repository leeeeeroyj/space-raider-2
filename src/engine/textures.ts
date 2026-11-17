import { Assets, Texture, TextureStyle } from 'pixi.js';
import { SPRITES } from '../config';

// Pixel art: every texture scales with nearest-neighbour unless it says otherwise.
TextureStyle.defaultOptions.scaleMode = 'nearest';

/** Every texture by name: the sprites (and a white silhouette of each, `<name>-white`) plus ones drawn in code. */
export const tex: Record<string, Texture> = {};

/** Loads the sprites from assets/sprites. Call once before any screen starts. */
export async function loadSprites() {
  await Promise.all(
    SPRITES.map(async (key) => {
      const t = await Assets.load<Texture>(`sprites/${key}.png`);
      tex[key] = t;
      tex[`${key}-white`] = silhouette(t);
    }),
  );
}

/** A texture drawn on a canvas. `smooth` keeps linear filtering (for soft glows). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, smooth = false): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = Texture.from(canvas);
  if (smooth) t.source.scaleMode = 'linear';
  return t;
}

/** Draws once, the first time a name is asked for. */
export function named(name: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, smooth = false) {
  return (tex[name] ??= canvasTexture(w, h, draw, smooth));
}

export const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The same shape in solid white: what a hostile flashes to under the beam. */
function silhouette(t: Texture) {
  const { width, height } = t.frame;
  return canvasTexture(width, height, (ctx) => {
    ctx.drawImage(t.source.resource as CanvasImageSource, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  });
}

/** A soft round glow, white in the middle and fading to nothing; tint it. */
export const glowTexture = () =>
  named('glow', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }, true);
