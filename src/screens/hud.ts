import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import { COLORS, HEIGHT, HUD_H, HUD_SCALE, RENDER_SCALE, ROOM_H, ROOM_W, TEXT, TREASURE, WIDTH, type TreasureKind } from '../config';
import type { Clock } from '../engine/clock';
import type { Device } from '../engine/input';
import { label, setText as set, zone } from '../engine/text';
import { tex } from '../engine/textures';
import { isMuted, toggleMute } from '../sfx';
import { GRID, type MapCell } from '../vault';

export interface HudState {
  score: number;
  lives: number;
  cargo: TreasureKind[];
  device: Device;
  level: number;
  /** Hostiles left in the current room. */
  hostiles: number;
  /** Room indexes are row * GRID + col; wreck is -1 when there's no marked drop. */
  map: { cells: MapCell[]; current: number; exit: number; wreck: number };
  paused: boolean;
  /** Attract mode: no hints, pause or sound toggle. */
  attract: boolean;
  over: boolean;
}

/** What the HUD's buttons do. */
export interface HudActions {
  pause(on: boolean): void;
  toTitle(): void;
}

const CELL_COLOR: Record<MapCell, number> = {
  unvisited: COLORS.mapUnvisited, loot: COLORS.mapLoot, hostile: COLORS.mapHostile, clear: COLORS.mapClear,
};

// HUD space is the design size × HUD_SCALE (832×456): sprites drawn here at native 16px come out
// half the size of room sprites, with no resampling.
const S = HUD_SCALE;
const W = WIDTH * S, H = HEIGHT * S, BAR = HUD_H * S, RW = ROOM_W * S, RB = (HUD_H + ROOM_H) * S;
const MAP = { x: 675, y: BAR + 36, cell: 20, gap: 2 };
const MAP_BOTTOM = MAP.y + GRID * (MAP.cell + MAP.gap) - MAP.gap;
const LEGEND: Array<[MapCell, string]> = [['loot', 'LOOT'], ['clear', 'CLEAR'], ['hostile', 'ENEMY'], ['unvisited', 'UNSEEN']];
const PANEL = { x: 660, right: 820, y: MAP_BOTTOM + 52 };
const TIERS = Object.keys(TREASURE) as TreasureKind[];
const ROW_H = 24;
/** Pause on touch: two bars between the score and SHIPS, with a thumb-sized tap zone. */
const PAUSE = { x: 178, y: 11 };
const PAUSE_HINTS: Record<Device, string> = { kbm: 'P OR ENTER RESUME  ·  ESC TITLE', pad: 'START OR A RESUME  ·  B TITLE', touch: 'TAP RESUME' };
const HINTS: Record<Device, string> = {
  pad: 'L-STICK MOVE  ·  R-STICK AIM + FIRE  ·  START PAUSE  ·  Y SOUND',
  touch: 'LEFT CIRCLE MOVE  ·  RIGHT CIRCLE AIM + FIRE',
  kbm: 'WASD MOVE  ·  MOUSE AIM  ·  CLICK FIRE  ·  P PAUSE  ·  M SOUND',
};
/** Reserve ships shown as icons before the top bar switches to "icon x N". */
const MAX_SHIP_ICONS = 5;

const pts = (n: number) => n.toLocaleString('en-US');
type TierRow = { icon: Sprite; count: Text; value: Text };

/** Top bar, vault map, cargo tally and hint strip, drawn over the room at twice the room's resolution. */
export class Hud {
  readonly root = new Container();
  private readonly score: Text;
  private readonly cargoValue: Text;
  private readonly cargoTotal: Text;
  private readonly shipCount: Text;
  private readonly level: Text;
  private readonly hostiles: Text;
  private readonly hint: Text;
  private readonly soundToggle: Text;
  private readonly soundZone: Container;
  private readonly mapCells = new Graphics();
  private readonly currentCell = new Graphics();
  private readonly tiers: Record<TreasureKind, TierRow>;
  private readonly shipIcons = new Container();
  private shownLives = -1;
  private shownCargo: string | undefined;
  private readonly pauseBars: Graphics;
  private readonly pauseTap: Container;
  /** The pause panel (RESUME and TITLE). Public for the tests. */
  readonly pauseMenu = new Container();
  private readonly pauseHint: Text;

  constructor(clock: Clock, actions: HudActions) {
    this.root.scale.set(RENDER_SCALE / S);
    const add = <T extends Container>(o: T) => this.root.addChild(o);
    const text = (x: number, y: number, s: string, color: string = TEXT.dim, ax = 0, ay = 0) =>
      add(label(s, x, y, 16, color, { res: 2, ax, ay }));

    const g = add(new Graphics());
    g.rect(0, 0, W, BAR).fill(COLORS.void);
    g.rect(0, BAR - 2, W, 2).fill(COLORS.line);
    g.rect(RW, BAR, W - RW, H - BAR).fill(COLORS.void);
    g.rect(RW, BAR, 2, H - BAR).fill(COLORS.line);
    g.rect(0, RB, RW, H - RB).fill(COLORS.void);

    text(8, 10, 'SCORE');
    this.score = text(76, 10, '', TEXT.amber);
    text(208, 10, 'SHIPS');
    this.shipCount = text(300, 10, '', TEXT.amber);
    add(this.shipIcons);
    text(432, 10, 'VAULT');
    this.level = text(500, 10, '', TEXT.amber);
    text(544, 10, 'CARGO');
    this.cargoValue = text(612, 10, '', TEXT.amber);
    // Tap or click to toggle: phones have no M key. The hit area is padded so it's easy to hit with a thumb.
    this.soundToggle = text(W - 8, 10, 'SOUND OFF', TEXT.dim, 1, 0);
    this.soundZone = add(zone(W - 140, 0, 140, 36, () => toggleMute()));

    text(740, BAR + 12, 'VAULT MAP', TEXT.dim, 0.5, 0);
    add(this.mapCells);
    this.currentCell.rect(0, 0, MAP.cell - 2, MAP.cell - 2).stroke({ width: 2, color: COLORS.mapCurrent, alignment: 0.5 });
    add(this.currentCell);
    clock.tween(this.currentCell, { alpha: 0.2 }, { ms: 400, yoyo: true, repeat: -1 });
    LEGEND.forEach(([cell, s], i) => {
      const x = PANEL.x + (i % 2) * 80, y = MAP_BOTTOM + 10 + Math.floor(i / 2) * 18;
      g.rect(x, y + 2, 10, 10).fill(CELL_COLOR[cell]);
      text(x + 16, y, s);
    });

    // Cargo tally: one row per tier, so any amount of loot fits in the same space.
    text(PANEL.x, PANEL.y, 'CARGO');
    this.cargoTotal = text(PANEL.right, PANEL.y, '', TEXT.amber, 1, 0);
    g.rect(PANEL.x, PANEL.y + 22, PANEL.right - PANEL.x, 2).fill(COLORS.line);
    this.tiers = Object.fromEntries(
      TIERS.map((kind, i) => {
        const y = PANEL.y + 32 + i * ROW_H;
        const icon = add(new Sprite(tex[kind]));
        icon.anchor.set(0.5);
        icon.position.set(PANEL.x + 8, y + 8);
        return [kind, { icon, count: text(PANEL.x + 24, y, ''), value: text(PANEL.right, y, '', TEXT.dim, 1, 0) }];
      }),
    ) as Record<TreasureKind, TierRow>;

    const below = PANEL.y + 32 + TIERS.length * ROW_H + 8;
    this.hostiles = text(PANEL.x, below, '');
    this.hint = text(RW / 2, RB + 2, '', TEXT.dim, 0.5, 0);

    // And no P key: on touch, II after the score pauses.
    this.pauseBars = add(new Graphics().rect(PAUSE.x, PAUSE.y, 5, 14).rect(PAUSE.x + 9, PAUSE.y, 5, 14).fill(TEXT.ink));
    this.pauseTap = add(zone(PAUSE.x - 16, 0, 46, BAR, () => actions.pause(true)));

    // The pause panel: RESUME and TITLE, as buttons a thumb or the mouse can hit.
    const pw = 380, ph = 190, px = RW / 2, top = (BAR + RB) / 2 - ph / 2;
    const pg = new Graphics();
    pg.rect(0, BAR, RW, RB - BAR).fill({ color: COLORS.void, alpha: 0.55 });
    pg.rect(px - pw / 2, top, pw, ph).fill({ color: COLORS.void, alpha: 0.94 });
    pg.rect(px - pw / 2, top, pw, ph).stroke({ width: 2, color: COLORS.line, alignment: 1 });
    this.pauseMenu.addChild(pg, label('PAUSED', px, top + 20, 32, TEXT.ink, { res: 2, ax: 0.5 }));
    const button = (bx: number, s: string, primary: boolean, act: () => void) => {
      const bw = 150, bh = 48, by = top + 84, art = new Graphics();
      if (primary) art.rect(bx - bw / 2, by, bw, bh).fill(COLORS.amber);
      else art.rect(bx - bw / 2 + 1, by + 1, bw - 2, bh - 2).stroke({ width: 2, color: TEXT.ink });
      this.pauseMenu.addChild(art, label(s, bx, by + bh / 2, 16, primary ? '#05060d' : TEXT.ink, { res: 2, ax: 0.5, ay: 0.5 }), zone(bx - bw / 2, by, bw, bh, act));
    };
    button(px - 85, 'RESUME', true, () => actions.pause(false));
    button(px + 85, 'TITLE', false, () => actions.toTitle());
    this.pauseHint = label('', px, top + ph - 34, 16, TEXT.dim, { res: 2, ax: 0.5 });
    this.pauseMenu.addChild(this.pauseHint);
    this.pauseMenu.visible = false;
    add(this.pauseMenu);
  }

  update(s: HudState) {
    const total = s.cargo.reduce((sum, k) => sum + TREASURE[k].value, 0);
    set(this.score, String(s.score).padStart(6, '0').replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    set(this.cargoValue, pts(total));
    set(this.level, String(s.level).padStart(2, '0'));
    set(this.hostiles, s.hostiles ? `HOSTILES ${s.hostiles}` : 'ROOM SECURE', s.hostiles ? TEXT.danger : TEXT.dim);
    set(this.hint, s.attract || s.paused ? '' : HINTS[s.device]);
    const muted = isMuted();
    set(this.soundToggle, muted ? 'SOUND OFF' : 'SOUND ON', muted ? TEXT.danger : TEXT.dim);
    this.soundToggle.visible = !s.attract;
    this.soundZone.eventMode = s.attract ? 'none' : 'static';
    const pauseTap = s.device === 'touch' && !s.attract && !s.over && !s.paused;
    this.pauseBars.visible = pauseTap;
    this.pauseTap.eventMode = pauseTap ? 'static' : 'none';
    this.pauseMenu.visible = s.paused;
    this.pauseMenu.eventMode = s.paused ? 'passive' : 'none';
    if (s.paused) set(this.pauseHint, PAUSE_HINTS[s.device]);
    this.drawMap(s.map);

    // Ships in reserve (not counting the one in play).
    if (s.lives !== this.shownLives) {
      this.shownLives = s.lives;
      const reserve = Math.max(0, s.lives - 1);
      const shown = reserve > MAX_SHIP_ICONS ? 1 : reserve;
      for (const c of this.shipIcons.removeChildren()) c.destroy();
      for (let i = 0; i < shown; i++) {
        const icon = new Sprite(tex.player);
        icon.anchor.set(0.5);
        icon.position.set(288 + i * 20, 18);
        this.shipIcons.addChild(icon);
      }
      set(this.shipCount, reserve > MAX_SHIP_ICONS ? `x${reserve}` : '');
    }

    const cargoKey = s.cargo.join();
    if (cargoKey !== this.shownCargo) {
      this.shownCargo = cargoKey;
      set(this.cargoTotal, s.cargo.length ? pts(total) : 'EMPTY');
      for (const kind of TIERS) {
        const n = s.cargo.filter((k) => k === kind).length;
        const row = this.tiers[kind];
        row.icon.alpha = n ? 1 : 0.3;
        set(row.count, `x${n}`, n ? TEXT.ink : TEXT.dim);
        set(row.value, n ? pts(n * TREASURE[kind].value) : '-', n ? TEXT.amber : TEXT.dim);
      }
    }
  }

  /** One colour per room state; the exit gets a cyan frame once found, your latest drop a white X. */
  private drawMap(map: HudState['map']) {
    const g = this.mapCells.clear();
    map.cells.forEach((cell, i) => {
      const { x, y } = this.cellOrigin(i);
      g.rect(x, y, MAP.cell, MAP.cell).fill(CELL_COLOR[cell]);
      if (i === map.exit && cell !== 'unvisited') {
        g.rect(x + 4, y + 4, MAP.cell - 8, MAP.cell - 8).fill(COLORS.beam);
        g.rect(x + 6, y + 6, MAP.cell - 12, MAP.cell - 12).fill(CELL_COLOR[cell]);
      }
    });
    if (map.wreck >= 0) {
      const { x, y } = this.cellOrigin(map.wreck);
      for (let i = 4; i < MAP.cell - 4; i += 2) g.rect(x + i, y + i, 2, 2).rect(x + MAP.cell - 2 - i, y + i, 2, 2);
      g.fill(COLORS.mapCurrent);
    }
    const here = this.cellOrigin(map.current);
    this.currentCell.position.set(here.x + 1, here.y + 1);
  }

  private cellOrigin(index: number) {
    const col = index % GRID, row = Math.floor(index / GRID);
    return { x: MAP.x + col * (MAP.cell + MAP.gap), y: MAP.y + row * (MAP.cell + MAP.gap) };
  }
}
