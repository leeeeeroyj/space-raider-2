import { Container, Rectangle, Text, TextStyle } from 'pixi.js';
import { FONT } from '../config';

export interface LabelOptions {
  /** Anchor, 0..1 on each axis (Phaser's origin). */
  ax?: number;
  ay?: number;
  align?: 'left' | 'center' | 'right';
  /** Extra pixels between lines. */
  lineSpacing?: number;
  /** Rasterising scale: the scale the text is drawn at on the canvas, so the pixel font stays sharp. */
  res: number;
}

type Look = { size: number; align: 'left' | 'center' | 'right'; lineSpacing: number };

/**
 * One TextStyle per look, shared by every text that has it. Pixi keeps recent text measurements (and their styles)
 * in a cache, so a style per text would pile up as rooms come and go. Change a text's colour with `setText`, never by
 * editing its style, which other texts share.
 */
const styles = new Map<string, TextStyle>();
const looks = new WeakMap<Text, Look>();

function styleFor(look: Look, color: string) {
  const key = `${look.size}|${look.align}|${look.lineSpacing}|${color}`;
  let s = styles.get(key);
  if (!s) {
    s = new TextStyle({
      fontFamily: FONT, fontSize: look.size, fill: color, align: look.align,
      // Silkscreen's own line height at 8 px is 9 px (what Phaser used); lineSpacing adds to that.
      lineHeight: look.size + look.size / 8 + look.lineSpacing,
    });
    styles.set(key, s);
  }
  return s;
}

/** Text in the pixel font. Silkscreen is drawn on an 8 px grid, so sizes should be multiples of 8. */
export function label(text: string, x: number, y: number, size: number, color: string, o: LabelOptions): Text {
  const look: Look = { size, align: o.align ?? 'left', lineSpacing: o.lineSpacing ?? 0 };
  const t = new Text({ text, resolution: o.res, style: styleFor(look, color) });
  looks.set(t, look);
  t.anchor.set(o.ax ?? 0, o.ay ?? 0);
  t.position.set(x, y);
  return t;
}

/** Changes a label's words and (optionally) colour, only when they differ: every change re-rasterises it. */
export function setText(t: Text, s: string, color?: string) {
  if (t.text !== s) t.text = s;
  const look = looks.get(t);
  if (color === undefined || !look) return;
  const style = styleFor(look, color);
  if (t.style !== style) t.style = style;
}

/** An invisible rectangle that calls `fn` when tapped or clicked. */
export function zone(x: number, y: number, w: number, h: number, fn: () => void): Container {
  const z = new Container();
  z.position.set(x, y);
  z.hitArea = new Rectangle(0, 0, w, h);
  z.eventMode = 'static';
  z.cursor = 'pointer';
  z.on('pointerdown', fn);
  return z;
}
