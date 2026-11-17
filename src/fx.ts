import { Container, Sprite } from 'pixi.js';
import { COLORS } from './config';
import { EASE, type Clock } from './engine/clock';
import { rand } from './engine/rng';
import { glowTexture, hex, named } from './engine/textures';

/**
 * A pulsing glow behind `obj`'s sprite: a soft halo added to `obj` itself, so it moves and goes with it.
 * `size` is the halo's diameter in design pixels.
 */
export function addGlow<T extends Container>(clock: Clock, obj: T, color: number, size = 26): T {
  const halo = new Sprite(glowTexture());
  halo.anchor.set(0.5);
  halo.tint = color;
  halo.blendMode = 'add';
  halo.width = halo.height = size;
  halo.alpha = 0.45;
  obj.addChildAt(halo, 0);
  clock.tween(halo, { alpha: 0.9 }, { ms: 700 + Math.random() * 300, yoyo: true, repeat: -1, ease: EASE.sineInOut });
  return obj;
}

/** Marks an object as loot with a gold glow, so treasure reads differently from hostiles. */
export const addTreasureGlow = <T extends Container>(clock: Clock, obj: T) => addGlow(clock, obj, COLORS.loot);

/** Every `everyMs`, puts a short-lived glint in `layer` on one of the objects `targets()` returns. */
export function startSparkles(clock: Clock, layer: Container, targets: () => Array<{ x: number; y: number }>, everyMs = 450) {
  const texture = named('fx-sparkle', 5, 5, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, 0, 1, 5);
    ctx.fillRect(0, 2, 5, 1);
    ctx.fillStyle = hex(COLORS.loot);
    ctx.fillRect(2, 2, 1, 1);
  });
  return clock.every(everyMs, () => {
    const list = targets();
    if (!list.length) return;
    const t = rand.pick(list);
    const s = new Sprite(texture);
    s.anchor.set(0.5);
    s.position.set(t.x + rand.between(-6, 6), t.y + rand.between(-6, 4));
    s.scale.set(0.4);
    layer.addChild(s);
    const k = { scale: 0.4, alpha: 1 };
    clock.tween(k, { scale: 1, alpha: 0 }, {
      ms: 450, ease: EASE.quadOut,
      onUpdate: () => {
        if (s.destroyed) return;
        s.scale.set(k.scale);
        s.alpha = k.alpha;
      },
      onComplete: () => {
        if (!s.destroyed) s.destroy();
      },
    });
  }, layer);
}
