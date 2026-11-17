export const TILE = 16;
export const WIDTH = 416;
export const HEIGHT = 228;
export const HUD_H = 18;
export const COLS = 20;
export const ROWS = 12;
export const ROOM_W = COLS * TILE;
export const ROOM_H = ROWS * TILE;

/** Floor area inside the wall ring, in pixels. */
export const INTERIOR = { x0: TILE, y0: HUD_H + TILE, x1: ROOM_W - TILE, y1: HUD_H + ROOM_H - TILE };

export const COLORS = {
  void: 0x05060d,
  line: 0x272d55,
  panel: 0x13172e,
  visited: 0x2b3263,
  amber: 0xffb547,
  beam: 0x5ef2ff,
  beamCore: 0xdffcff,
  danger: 0xff5f73,
  loot: 0xffd27a,
  // Vault map room states.
  mapUnvisited: 0x2a3058,
  mapLoot: 0xc9962e,
  mapHostile: 0x9b3045,
  mapClear: 0x2f7a5a,
  mapCurrent: 0xffffff,
};

export const TEXT = {
  ink: '#e7e4f6',
  dim: '#9295b8',
  amber: '#ffb547',
  beam: '#5ef2ff',
  danger: '#ff5f73',
};

export const FONT = 'Silkscreen, monospace';

/** 8-way aim is built but switched off for now: no menu item, and Q / Back do nothing. */
export const AIM_MODE_SELECTABLE = false;
/** The aim mode, shared by the title screen and the room. true = 8-way, false = 360°. */
export const aimMode = { snap8: false };

/**
 * The canvas renders at this multiple of the 416×228 design size. The room is drawn scaled up by it, while the HUD is
 * scaled by half as much and can show native 16px sprites at half the size of room sprites without shrinking (and
 * distorting) them.
 */
export const RENDER_SCALE = 4;
export const HUD_SCALE = RENDER_SCALE / 2;

/** Eye candy (src/effects.ts). Each part can be switched off on its own if it costs too much on a phone. */
export const FX = {
  /** Springy neon grid over the floor. Spacing in design pixels; stiffness pulls back to rest, coupling spreads ripples. */
  grid: { enabled: true, spacing: 8, stiffness: 18, coupling: 700, damping: 3.5, maxOffset: 7, lineWidth: 0.5, alpha: 0.13, flashAlpha: 0.2, hueCycleSeconds: 24 },
  /**
   * Bright things (above `threshold`) get a soft halo, worked out at design size and laid over the room. `blur` is in
   * design pixels and `quality` is its number of passes; `scale` is how strong the halo is.
   */
  bloom: { enabled: true, threshold: 0.45, scale: 0.9, blur: 3, quality: 4 },
};

/** How each sprite is turned into a stack of slices (src/render/stack.ts). */
export type StackMode =
  /** Drawn from above: the sprite is the top, with `layers` darker copies under it. */
  | { kind: 'flat'; layers: number }
  /** Drawn from the front and round: each row is spun round the middle into a ring. */
  | { kind: 'lathe' }
  /** Drawn from the front: each row becomes a strip `depth` pixels deep, so the sprite is a thick cut-out. */
  | { kind: 'card'; depth: number };

/**
 * The 3D look. Every object is a stack of horizontal slices drawn one above the other, `step` design pixels apart, so
 * the camera seems to look down at an angle. Gameplay stays flat: things stand at their position and the beam flies
 * `beamZ` pixels up, at hull height.
 */
export const STACK = {
  step: 1,
  /** Slices are seen at an angle, so their depth looks shorter: a disc reads as an oval. */
  squash: 0.6,
  beamZ: 6,
  /** Wall height; the near (bottom) wall is kept low so it doesn't hide the floor. */
  wall: 10,
  nearWall: 4,
  /** How high fliers float above their shadow; the drone also bobs by `bob`. */
  hover: { player: 4, hunter: 3, scavenger: 3, mine: 1 } as Record<string, number>,
  bob: 1,
  /** Height of the middle of a hostile or a treasure: where explosions, sparkles and score numbers appear. */
  mid: 7,
  /** Turns a second: hunters and mines spin, loot turns to show it off. */
  spin: { hunter: 3, mine: 1.2, loot: 1.6 },
  models: {
    player: { kind: 'flat', layers: 3 },
    hunter: { kind: 'lathe' },
    sentry: { kind: 'lathe' },
    mine: { kind: 'lathe' },
    brood: { kind: 'lathe' },
    warden: { kind: 'card', depth: 3 },
    scavenger: { kind: 'card', depth: 3 },
    t1_coin: { kind: 'card', depth: 2 },
    t2_chip: { kind: 'flat', layers: 2 },
    t3_star: { kind: 'card', depth: 3 },
    t4_crystal: { kind: 'card', depth: 4 },
    t5_idol: { kind: 'card', depth: 4 },
    exit: { kind: 'flat', layers: 2 },
  } satisfies Record<string, StackMode>,
  /** Shadow radius under each kind, in design pixels. */
  shadow: { player: 6, hunter: 6, sentry: 6, mine: 5, brood: 7, warden: 7, scavenger: 5, loot: 4 } as Record<string, number>,
};

/** Wall colours (src/render/walls.ts). */
export const WALL = {
  top: 0x262c4a,
  frameTop: 0x30293a,
  faceTop: 0x232946,
  faceBottom: 0x0b0e1c,
  edge: 0x7f8bc4,
  seam: 0x0a0c18,
  trim: 0x46d8ff,
};

/** Spark colours when each kind blows up or takes damage. */
export const HOSTILE_COLORS = {
  hunter: [0xff3d6e, 0xff9a3d],
  sentry: [0x5dff8a, 0x3dd8ff],
  mine: [0xffd23d, 0xff6a3d],
  warden: [0xff8a2e, 0xff3df0],
  brood: [0xb46bff, 0xff3df0],
  scavenger: [0xc6ff4d, 0x5dff8a],
} as const;

/**
 * Touch sticks (src/touch.ts). They sit in the bars beside the game when the screen is wide enough; otherwise at these
 * bottom-corner spots (design pixels). A thumb landing within `grab` × radius of a centre takes that stick; dragging
 * toward the rim gives direction and strength.
 */
export const TOUCH_STICKS = { radius: 24, grab: 1.75, move: { x: 40, y: 180 }, aim: { x: 376, y: 180 } } as const;

export const PLAYER = { speed: 80, radius: 6, lives: 3, invulnerableMs: 1800, respawnDelayMs: 1000 };
export const HUNTER = {
  speed: 30, speedPerLevel: 4, hp: 1, points: 100, maxAlive: 4, spawnEveryMs: 1800, armMs: 400,
  /** Hostiles per room on vault 1 (inclusive range); each later vault adds one. */
  perRoom: [2, 4] as const,
  entranceRoom: 2,
  /** Grace period after entering a room before the first drone comes through a door. */
  entryGraceMs: 1200,
};
/** Original rules: treasure scores only when banked at the exit; 10,000 for visiting every room; a ship every 10,000. */
export const SCORING = { explorerBonus: 10000, extraShipEvery: 10000 };
export const BEAM = { damagePerSecond: 5, hitRadius: 7 };

// The other hostiles. hp is in seconds of beam at damagePerSecond 5 (so hp 5 = one second of fire).
export const SENTRY = { hp: 0.5, points: 25, fireEveryMs: 2600, telegraphMs: 450, boltSpeed: 75 };
export const MINE = { hp: 0.5, points: 25, speed: 32 };
export const WARDEN = { hp: 4, points: 125, speed: 20, hitRadius: 8, guardDistance: 22 };
export const BROOD = { hp: 5, points: 500, hitRadius: 8, hatchEveryMs: 3200, maxDrones: 3 };
/** Can't be destroyed: shoo it with shooHp of beam. Shows up at most once per room visit, only while you carry cargo. */
export const SCAVENGER = { points: 50, speed: 52, fleeSpeed: 95, shooHp: 0.4, chance: 0.35, delayMs: [3000, 7000] as const };

export type TreasureKind = 't1_coin' | 't2_chip' | 't3_star' | 't4_crystal' | 't5_idol';
export const TREASURE: Record<TreasureKind, { name: string; value: number }> = {
  t1_coin: { name: 'Scrap Coin', value: 500 },
  t2_chip: { name: 'Data Core', value: 1000 },
  t3_star: { name: 'Star Shard', value: 2000 },
  t4_crystal: { name: 'Relic Crystal', value: 4000 },
  t5_idol: { name: 'Ancient Idol', value: 8000 },
};

/** Sprite slots exported by tools/sprites.py to assets/sprites/<slot>.png. */
export const SPRITES = [
  'player', 'hunter', 'sentry', 'mine', 'warden', 'brood', 'scavenger',
  't1_coin', 't2_chip', 't3_star', 't4_crystal', 't5_idol',
  'door', 'exit', 'xmark', 'wall',
] as const;

/** Centre of a room tile in pixels. */
export const tileCenter = (col: number, row: number) => ({ x: col * TILE + TILE / 2, y: HUD_H + row * TILE + TILE / 2 });
