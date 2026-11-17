import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import {
  AIM_MODE_SELECTABLE, BEAM, BROOD, COLORS, COLS, HOSTILE_COLORS, HUD_H, HUNTER, INTERIOR, MINE, PLAYER, RENDER_SCALE, ROOM_H,
  ROOM_W, ROWS, SCAVENGER, SCORING, SENTRY, STACK, TEXT, TILE, TREASURE, WARDEN, aimMode, tileCenter, type TreasureKind,
} from '../config';
import { DEMO_SECS } from '../attract';
import { Clock, EASE, type Handle } from '../engine/clock';
import { hitSurface, moveToward, overlaps, pushOut, rayCircle, rayToWall, separate, type Body } from '../engine/collide';
import { input, type ControlState } from '../engine/input';
import { clamp, dist, rand } from '../engine/rng';
import { nav, type Screen } from '../engine/screens';
import { label, zone } from '../engine/text';
import { Effects } from '../effects';
import { addGlow, addTreasureGlow, startSparkles } from '../fx';
import { loadHi, saveHi } from '../hi';
import { boltTexture, CENTER, besideDoor, doorTiles, entryPoint, inDoor, insideInterior, isEdge, isWall, signTexture } from '../room/geometry';
import { Pilot } from '../room/pilot';
import { Stack, wallBlock } from '../render/stack';
import { loopSound, playSound, toggleMute, type Loop } from '../sfx';
import { touchSticks } from '../touch';
import {
  GRID, OPPOSITE, generateVault, hostileCount, mapCell, neighbor, roomIndex,
  type Foe, type FoeKind, type Loot, type Room, type Side, type Vault,
} from '../vault';
import { Hud, type HudState } from './hud';

type EnemyKind = 'hunter' | FoeKind;

export interface Enemy extends Body {
  kind: EnemyKind | 'scavenger';
  view: Stack;
  hp: number;
  /** Harmless until then: it's still fading in. */
  armedAt: number;
  /** The room's record of it, for foes that live in the room (not hunters or the scavenger). */
  foe?: Foe;
  /** Hatched by a brood pod: doesn't count toward the room. */
  brood?: boolean;
  /** Doesn't move, and isn't pushed (sentries and brood pods). */
  fixed?: boolean;
  /** Bounces off walls and other hostiles (mines). */
  bouncy?: boolean;
  nextShotAt?: number;
  warned?: boolean;
  nextHatchAt?: number;
  wakeAt?: number;
  // Scavenger only.
  shoo?: number;
  shooed?: boolean;
  fleeing?: boolean;
  fleeTo?: { x: number; y: number };
  stolen?: TreasureKind;
  gone?: boolean;
}

interface Bolt extends Body {
  view: Sprite;
}

interface Treasure {
  loot: Loot;
  x: number;
  y: number;
  r: number;
  view: Stack;
}

const pts = (n: number) => n.toLocaleString('en-US');
const ENEMY_HP: Record<EnemyKind, number> = { hunter: HUNTER.hp, sentry: SENTRY.hp, mine: MINE.hp, warden: WARDEN.hp, brood: BROOD.hp };
const ENEMY_POINTS: Record<EnemyKind, number> = {
  hunter: HUNTER.points, sentry: SENTRY.points, mine: MINE.points, warden: WARDEN.points, brood: BROOD.points,
};
/** Draw order inside the room. */
const Z = { floor: 0, grid: 0.5, floorFx: 1, actors: 8, beam: 12, fx: 20, sparkle: 30, text: 140, banner: 150, crosshair: 200, fade: 1000 };

export class RoomScreen implements Screen {
  readonly name = 'room';
  readonly root = new Container();
  /** Demos started since the page loaded (attract mode). */
  static demos = 0;

  readonly clock = new Clock();
  /** The room, drawn in design pixels and scaled up to the canvas. Effects filter, shake and roll it. */
  private readonly world = new Container();
  private readonly hud: Hud;
  private readonly fx: Effects;
  private readonly pilot = new Pilot();
  private readonly beamHumLoop: Loop | undefined;
  private readonly beam = new Graphics();
  private readonly crosshair = new Graphics();
  private readonly fader = new Graphics().rect(0, 0, ROOM_W, HUD_H + ROOM_H).fill(0xffffff);
  /** Things for the current room only, cleared on the way out: walls, signpost, floating text, debris. */
  private readonly roomFloor = new Container();
  private readonly roomTop = new Container();
  /** Everything that stands up (walls, the ship, hostiles, loot, the pad, bolts), drawn back to front by floor y. */
  private readonly actors = new Container();
  private wallBlocks: Sprite[] = [];
  private readonly sparkleLayer = new Container();
  readonly banner: Text;
  readonly subBanner: Text;
  private bannerFade: Handle | undefined;
  private readonly listeners: Array<() => void> = [];

  readonly player: Body & { view: Stack; visible: boolean };
  enemies: Enemy[] = [];
  scavenger: Enemy | undefined;
  bolts: Bolt[] = [];
  private treasures: Treasure[] = [];
  private pad: (Body & { view: Stack }) | undefined;
  private walls: boolean[][] = [];
  /** The hostile the beam is flashing white, so it can be put back when the beam moves off. */
  flashed: Enemy | undefined;

  vault!: Vault;
  room!: Room;
  private readonly runSeed: string;
  score = 0;
  lives = PLAYER.lives;
  cargo: TreasureKind[] = [];
  private snap8 = AIM_MODE_SELECTABLE && aimMode.snap8;
  dead = false;
  over = false;
  banking = false;
  overAt = 0;
  invulnerableUntil = 0;
  nextSpawnAt = 0;
  /** A scavenger can show up once per room visit, decided the first time you're in the room with cargo. */
  private scavengerRolled = false;
  private scavengerDue: number | undefined;
  /** Paused: nothing moves and the HUD shows RESUME and TITLE. */
  paused = false;
  private readonly hi = loadHi();
  private newHi = false;
  /** Attract mode: this demo's seed (the next demo uses the one after); -1 in a real run. */
  private readonly demoSeed: number;
  private demoOver = false;
  private demoClock = 0;
  private device: ControlState['device'] = 'kbm';

  /** `attract` (a seed) runs a demo: the pilot raids a vault picked by the seed. */
  constructor(attract?: number) {
    const demo = attract !== undefined;
    this.demoSeed = demo ? attract : -1;
    this.runSeed = demo ? `demo-${attract}` : `${Date.now()}-${Math.random()}`;
    if (demo) RoomScreen.demos++;
    document.body.style.cursor = demo ? 'default' : 'none';
    this.beamHumLoop = demo ? undefined : loopSound('beam');

    this.world.scale.set(RENDER_SCALE);
    this.world.sortableChildren = true;
    this.fx = new Effects(this.clock, this.world);
    this.root.addChild(this.fx.view);
    const at = <T extends Container>(o: T, z: number) => {
      o.zIndex = z;
      return this.world.addChild(o);
    };
    at(this.drawFloor(), Z.floor);
    at(this.fx.floor, Z.grid);
    at(this.roomFloor, Z.floorFx);
    this.actors.sortableChildren = true;
    at(this.actors, Z.actors);
    at(this.fx.top, Z.fx);
    at(this.sparkleLayer, Z.sparkle);
    at(this.roomTop, Z.text);
    at(this.beam, Z.beam).blendMode = 'add';
    at(this.crosshair, Z.crosshair);
    at(this.fader, Z.fade).alpha = 0;
    const mid = { x: ROOM_W / 2, y: HUD_H + ROOM_H / 2 };
    this.banner = at(label('', mid.x, mid.y - 48, 16, TEXT.amber, { res: RENDER_SCALE, ax: 0.5, ay: 0.5 }), Z.banner);
    this.subBanner = at(label('', mid.x, mid.y - 36, 8, TEXT.ink, { res: RENDER_SCALE, ax: 0.5, align: 'center', lineSpacing: 4 }), Z.banner);

    const view = this.actors.addChild(new Stack('player', STACK.shadow.player));
    this.player = { x: CENTER.x, y: CENTER.y, vx: 0, vy: 0, r: PLAYER.radius, view, visible: true };

    this.hud = new Hud(this.clock, { pause: (on) => this.setPaused(on), toTitle: () => this.toTitle() });
    this.root.addChild(this.hud.root);

    touchSticks.show(!demo);
    if (!demo) {
      // A phone call, a tab switch or the screen locking pauses the run.
      const hidden = () => {
        if (document.hidden) this.setPaused(true);
      };
      document.addEventListener('visibilitychange', hidden);
      this.listeners.push(() => document.removeEventListener('visibilitychange', hidden));
    }
    startSparkles(this.clock, this.sparkleLayer, () => this.treasures.map((t) => ({ x: t.x, y: t.y - STACK.mid })));
    this.clock.every(HUNTER.spawnEveryMs / 3, () => this.spawnHunter());
    this.startVault(demo ? 1 + (attract % 3) : 1);
  }

  destroy() {
    touchSticks.show(false);
    this.beamHumLoop?.stop();
    for (const off of this.listeners) off();
    this.clock.clear();
    this.root.destroy({ children: true, context: true });
  }

  /** Pauses or resumes (not once the run is over, or in attract mode). */
  setPaused(on: boolean) {
    if (this.demoSeed >= 0 || on === this.paused || (on && this.over)) return;
    this.paused = on;
    this.clock.paused = on;
    if (on) {
      this.beam.clear();
      this.beamHum(false);
    }
    touchSticks.show(!on);
    playSound('chime');
  }

  update(ms: number) {
    const dt = ms / 1000;
    const demo = this.demoSeed >= 0;
    // Mouse aim starts from beam height, so the beam (drawn that high) runs through the crosshair.
    const controls = demo ? this.pilot.steer(this, dt) : input().read({ x: this.player.x, y: this.player.y - STACK.beamZ });
    this.device = controls.device;
    if (demo && !this.demoOver && (this.over || (this.demoClock += dt) > DEMO_SECS)) {
      // Attract mode: the next demo, from the next seed.
      this.demoOver = true;
      nav.toRoom((this.demoSeed + 1) % 2 ** 31);
      return;
    }
    if (AIM_MODE_SELECTABLE && controls.toggleAim) aimMode.snap8 = this.snap8 = !this.snap8;
    if (controls.mute) toggleMute();
    if (this.paused) {
      if (controls.back) this.toTitle();
      else if (controls.pause || controls.confirm) this.setPaused(false);
      this.crosshair.clear();
      this.hud.update(this.hudState());
      return;
    }
    // Esc and B have nothing else to do mid-run, so they pause too (and then go to the title).
    if (!this.over && (controls.pause || controls.back)) {
      this.setPaused(true);
      this.crosshair.clear();
      this.hud.update(this.hudState());
      return;
    }

    this.clock.update(ms);
    const now = this.clock.now;
    if (this.over) {
      if (now - this.overAt > 800) {
        if (controls.confirm) return nav.toRoom();
        if (controls.back) return this.toTitle();
      }
      this.beam.clear();
      this.beamHum(false);
    } else if (this.banking) {
      this.player.vx = this.player.vy = 0;
      this.beam.clear();
      this.beamHum(false);
    } else {
      this.updatePlayer(controls.move, now);
      this.updateEnemies(now);
      this.updateScavenger(now);
      this.physics(dt);
      this.updateBolts();
      this.updateBeam(controls.fire && !this.dead, controls.aim, dt);
      this.checkDoorways();
    }
    this.syncViews();

    this.fx.update(dt);
    this.crosshair.clear();
    const c = input();
    if (!demo && controls.device === 'kbm' && c.mouseSeen && c.mouse.x < ROOM_W && c.mouse.y > HUD_H) {
      const x = Math.round(c.mouse.x), y = Math.round(c.mouse.y);
      this.crosshair.rect(x - 5, y, 3, 1).rect(x + 3, y, 3, 1).rect(x, y - 5, 1, 3).rect(x, y + 3, 1, 3).fill(COLORS.amber);
    }
    this.hud.update(this.hudState());
  }

  private hudState(): HudState {
    return {
      score: this.score, lives: this.lives, cargo: this.cargo, device: this.device, level: this.vault.level,
      hostiles: hostileCount(this.room),
      map: {
        cells: this.vault.rooms.map(mapCell),
        current: roomIndex(this.room),
        exit: roomIndex(this.vault.exit),
        wreck: this.vault.wreck ? roomIndex(this.vault.wreck) : -1,
      },
      paused: this.paused, attract: this.demoSeed >= 0, over: this.over,
    };
  }

  toTitle() {
    // Leaving mid-run still counts toward the high score.
    if (!this.over) saveHi(this.score);
    nav.toTitle();
  }

  // ---- Movement and collisions ----

  /** Moves everything by its velocity, then sorts out walls, the room's edges and hostiles bumping into each other. */
  private physics(dt: number) {
    const p = this.player;
    if (!this.dead) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // No edge for the ship: walls stop it, doorways let it through to the next room.
      this.hitWalls(p, false);
    }
    for (const e of this.enemies) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.fixed) continue;
      this.hitWalls(e, !!e.bouncy);
      // Hostiles stay inside the room.
      const b = { x0: e.r, x1: ROOM_W - e.r, y0: HUD_H + e.r, y1: HUD_H + ROOM_H - e.r };
      if (e.x < b.x0) { e.x = b.x0; hitSurface(e, 1, 0, !!e.bouncy); }
      if (e.x > b.x1) { e.x = b.x1; hitSurface(e, -1, 0, !!e.bouncy); }
      if (e.y < b.y0) { e.y = b.y0; hitSurface(e, 0, 1, !!e.bouncy); }
      if (e.y > b.y1) { e.y = b.y1; hitSurface(e, 0, -1, !!e.bouncy); }
    }
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i], b = this.enemies[j];
        const n = separate(a, b, !!a.fixed, !!b.fixed);
        if (!n) continue;
        if (a.bouncy) hitSurface(a, -n.nx, -n.ny, true);
        if (b.bouncy) hitSurface(b, n.nx, n.ny, true);
      }
    }
    // Scavengers are ghosts: no wall or hostile collisions.
    const s = this.scavenger;
    if (s) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    for (const b of this.bolts) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    if (this.dead) return;
    for (const e of [...this.enemies]) if (overlaps(p, e)) this.onEnemyTouch(e);
    if (this.scavenger && overlaps(p, this.scavenger)) this.onScavengerTouch(this.scavenger);
    for (const b of [...this.bolts]) if (overlaps(p, b)) this.onBolt(b);
    for (const t of [...this.treasures]) if (overlaps(p, t)) this.collect(t);
    if (this.pad && overlaps(p, this.pad)) this.bank();
  }

  /** Pushes a body out of any wall tiles it overlaps. */
  private hitWalls(b: Body, bounce: boolean) {
    const c0 = Math.floor((b.x - b.r) / TILE), c1 = Math.floor((b.x + b.r) / TILE);
    const r0 = Math.floor((b.y - b.r - HUD_H) / TILE), r1 = Math.floor((b.y + b.r - HUD_H) / TILE);
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) {
        if (!this.walls[r][c]) continue;
        const n = pushOut(b, { x: c * TILE, y: HUD_H + r * TILE, w: TILE, h: TILE });
        if (n) hitSurface(b, n.nx, n.ny, bounce);
      }
    }
  }

  /** Puts every sprite where its body is. */
  private syncViews() {
    const p = this.player;
    const secs = this.clock.now / 1000, turn = Math.PI * 2;
    const place = (o: Container, x: number, y: number) => {
      o.position.set(x, y);
      o.zIndex = y;
    };
    place(p.view, p.x, p.y);
    p.view.zIndex += 0.5;
    p.view.visible = p.visible;
    p.view.lift = STACK.hover.player + Math.sin(secs * 3) * STACK.bob;
    for (const e of this.enemies) {
      place(e.view, e.x, e.y);
      if (e.kind === 'hunter' || e.kind === 'mine') e.view.spin = secs * STACK.spin[e.kind] * turn;
      else if (e.kind === 'sentry') e.view.spin = Math.atan2(p.y - e.y, p.x - e.x) - Math.PI / 2;
    }
    if (this.scavenger) place(this.scavenger.view, this.scavenger.x, this.scavenger.y);
    for (const b of this.bolts) place(b.view, b.x, b.y);
    for (const t of this.treasures) {
      t.view.zIndex = t.y;
      t.view.spin = secs * STACK.spin.loot * turn + t.x;
    }
  }

  // ---- Vault and rooms ----

  private startVault(level: number) {
    this.vault = generateVault(level, `${this.runSeed}-${level}`);
    this.enterRoom(this.vault.entrance);
    this.showBanner(`VAULT ${level}`, 'FIND THE EXIT. GRAB WHAT GLOWS.', 2000);
  }

  /** Swaps the room's contents for `room`. Hostiles still alive stay counted in the room you left. */
  private enterRoom(room: Room, from?: Side) {
    // Whatever was on screen belonged to the last room: banners, floating text, debris.
    this.hideBanner();
    for (const layer of [this.roomFloor, this.roomTop]) for (const o of layer.removeChildren()) o.destroy({ children: true, context: true });
    for (const o of [...this.wallBlocks, ...this.treasures.map((t) => t.view)]) o.destroy({ children: true });
    this.wallBlocks = [];
    this.fx.clear();
    this.clearHostiles();
    this.treasures = [];
    if (this.pad) {
      this.pad.view.destroy({ children: true, context: true });
      this.pad = undefined;
    }

    this.room = room;
    room.visited = true;
    this.buildWalls(room);
    if (room !== this.vault.exit) this.addSignpost(room);
    if (from) playSound('door');
    for (const loot of room.loot) this.placeTreasure(loot);
    if (room === this.vault.exit) {
      const view = new Stack('exit');
      view.position.set(CENTER.x, CENTER.y);
      // Under anything standing on it.
      view.zIndex = CENTER.y - TILE;
      addGlow(this.clock, view, COLORS.beam);
      this.actors.addChild(view);
      this.pad = { x: CENTER.x, y: CENTER.y, vx: 0, vy: 0, r: 4, view };
      this.showBanner('EXTRACTION', 'FLY ONTO THE PAD TO BANK YOUR CARGO\nAND LEAVE THE VAULT', 2200);
    }

    const at = from ? entryPoint(room, from) : CENTER;
    Object.assign(this.player, { x: at.x, y: at.y, vx: 0, vy: 0 });
    this.nextSpawnAt = this.clock.now + HUNTER.entryGraceMs;
    this.scavengerRolled = false;
    this.scavengerDue = undefined;
    this.buildFoes();
    this.fade(COLORS.void, 160);
  }

  /** A floor arrow pointing straight toward the exit room (not the route: you still have to find the doors). */
  private addSignpost(room: Room) {
    const a = Math.atan2(this.vault.exit.row - room.row, this.vault.exit.col - room.col);
    const dir = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
    const sign = new Container();
    const arrow = sign.addChild(new Sprite(signTexture(dir)));
    arrow.anchor.set(0.5);
    arrow.position.set(CENTER.x, CENTER.y);
    sign.addChild(label('EXIT', CENTER.x, CENTER.y + 13, 8, TEXT.amber, { res: RENDER_SCALE, ax: 0.5, ay: 0.5 }));
    sign.alpha = 0.6;
    this.roomFloor.addChild(sign);
    this.clock.tween(sign, { alpha: 0.25 }, { ms: 1100, yoyo: true, repeat: -1, ease: EASE.sineInOut });
  }

  /** Flying through a doorway past the room's edge takes you into the neighbouring room. */
  private checkDoorways() {
    if (this.dead) return;
    const { x, y } = this.player;
    const side: Side | undefined =
      y < HUD_H + 2 ? 'top' : y > HUD_H + ROOM_H - 2 ? 'bottom' : x < 2 ? 'left' : x > ROOM_W - 2 ? 'right' : undefined;
    const next = side && neighbor(this.vault, this.room, side);
    if (side && next) this.enterRoom(next, OPPOSITE[side]);
  }

  private drawFloor() {
    const g = new Graphics();
    const shades = [0x121528, 0x14182d, 0x111324];
    for (let r = 1; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        const x = c * TILE, y = HUD_H + r * TILE;
        g.rect(x, y, TILE, TILE).fill(shades[(((c * 73856093) ^ (r * 19349663)) >>> 0) % 3]);
        g.rect(x, y + TILE - 1, TILE, 1).rect(x + TILE - 1, y, 1, TILE).fill(0x0c0e1c);
        g.rect(x + 1, y + 1, 1, 1).rect(x + TILE - 3, y + TILE - 3, 1, 1).fill(0x1d2240);
      }
    }
    return g;
  }

  private buildWalls(room: Room) {
    this.walls = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => isWall(room, c, r)));
    const glow = new Graphics();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!isEdge(c, r)) continue;
        const { x, y } = tileCenter(c, r);
        if (inDoor(room, c, r)) {
          glow.rect(x - 8, y - 8, TILE, TILE).fill(COLORS.void);
          if (r === 0) glow.rect(x - 8, y + 6, TILE, 1);
          else if (r === ROWS - 1) glow.rect(x - 8, y - 7, TILE, 1);
          else if (c === 0) glow.rect(x + 6, y - 8, 1, TILE);
          else glow.rect(x - 7, y - 8, 1, TILE);
          glow.fill(COLORS.amber);
        } else {
          // The near (bottom) wall is kept low so it doesn't hide the floor.
          const height = r === ROWS - 1 ? STACK.nearWall : STACK.wall;
          this.wallBlocks.push(this.actors.addChild(wallBlock(besideDoor(room, c, r) ? 'door' : 'wall', x - TILE / 2, y - TILE / 2, height)));
        }
      }
    }
    this.roomFloor.addChild(glow);
    this.clock.tween(glow, { alpha: 0.4 }, { ms: 900, yoyo: true, repeat: -1 });
  }

  // ---- Player ----

  private updatePlayer(move: { x: number; y: number }, now: number) {
    if (this.dead) return;
    this.player.vx = move.x * PLAYER.speed;
    this.player.vy = move.y * PLAYER.speed;
    const shielded = now < this.invulnerableUntil;
    this.player.view.alpha = shielded && Math.floor(now / 80) % 2 ? 0.3 : 1;
  }

  private canBeHit() {
    return !this.dead && !this.over && !this.banking && this.clock.now >= this.invulnerableUntil;
  }

  private onEnemyTouch(enemy: Enemy) {
    if (!this.canBeHit() || this.clock.now < enemy.armedAt) return;
    this.loseShip();
  }

  private onBolt(bolt: Bolt) {
    if (!this.canBeHit()) return;
    this.removeBolt(bolt);
    this.loseShip();
  }

  loseShip() {
    if (this.dead || this.over) return;
    this.dead = true;
    this.lives -= 1;
    this.beam.clear();
    this.beamHum(false);
    playSound('die');
    const p = this.player;
    this.fx.burst(p.x, p.y - STACK.mid, [COLORS.amber, COLORS.beam, 0xff3df0], 'huge');
    this.fade(0xff466e, 140);
    p.vx = p.vy = 0;
    p.visible = false;
    this.dropCargo(p.x, p.y);
    // Drones on screen blow up with you but aren't killed: they stay in the room's count.
    for (const e of this.enemies) if (e.kind === 'hunter') this.fx.burst(e.x, e.y - STACK.mid, [...HOSTILE_COLORS.hunter]);
    this.clearHostiles();

    if (this.lives <= 0) {
      this.clock.delay(PLAYER.respawnDelayMs, () => {
        this.over = true;
        this.overAt = this.clock.now;
        if (this.demoSeed >= 0) return;
        this.newHi = saveHi(this.score);
        playSound('gameOver');
        const best = this.newHi ? 'NEW HIGH SCORE!' : `HI ${pts(Math.max(this.hi, this.score))}`;
        if (this.device === 'touch') {
          this.showBanner('GAME OVER', `SCORE ${pts(this.score)}\n${best}`);
          this.addTapButtons();
        } else {
          this.showBanner('GAME OVER', `SCORE ${pts(this.score)}\n${best}\n\nENTER / A  RETRY      ESC / B  TITLE`);
        }
      });
      return;
    }
    // Respawn back at the vault's starting point; the room you died in keeps your dropped cargo.
    this.clock.delay(PLAYER.respawnDelayMs, () => {
      this.enterRoom(this.vault.entrance);
      p.visible = true;
      this.invulnerableUntil = this.clock.now + PLAYER.invulnerableMs;
      this.dead = false;
    });
  }

  private addScore(points: number) {
    const before = Math.floor(this.score / SCORING.extraShipEvery);
    this.score += points;
    const earned = Math.floor(this.score / SCORING.extraShipEvery) - before;
    if (earned > 0) {
      this.lives += earned;
      playSound('extraShip');
      this.floatText(this.player.x, this.player.y - 14, 'EXTRA SHIP', TEXT.beam);
    }
  }

  // ---- Treasure, the wreck marker and banking ----

  private placeTreasure(loot: Loot) {
    const view = new Stack(loot.kind, STACK.shadow.loot);
    view.position.set(loot.x, loot.y);
    addTreasureGlow(this.clock, view, -STACK.mid);
    this.actors.addChild(view);
    // Loot floats a little and bobs.
    view.lift = 2;
    this.clock.tween(view, { lift: 4 }, { ms: 600 + Math.random() * 300, yoyo: true, repeat: -1, ease: EASE.sineInOut });
    this.treasures.push({ loot, x: loot.x, y: loot.y, r: 5, view });
  }

  private collect(t: Treasure) {
    if (this.dead) return;
    const loot = t.loot;
    this.room.loot.splice(this.room.loot.indexOf(loot), 1);
    this.treasures.splice(this.treasures.indexOf(t), 1);
    this.cargo.push(loot.kind);
    this.floatText(t.x, t.y - 8, `+${TREASURE[loot.kind].name.toUpperCase()}`, TEXT.amber);
    this.fx.pop(t.x, t.y - STACK.mid, [COLORS.loot, COLORS.amber], 24);
    playSound('pickup', { detune: Object.keys(TREASURE).indexOf(loot.kind) * 200 });
    t.view.destroy({ children: true, context: true });
    // 5200 rules: picking up any treasure clears the wreck X.
    this.vault.wreck = undefined;
    if (!this.room.loot.length) {
      this.showBanner('LOOT CLEAR', 'NOTHING LEFT TO GRAB IN THIS ROOM', 1600);
      this.clock.delay(180, () => playSound('chime'));
    }
  }

  /**
   * Cargo drops where the ship died (Atari 5200 rules). Every drop stays in its room until you pick it up
   * or the game ends; only the newest drop's room is marked with an X on the vault map, for one life.
   */
  private dropCargo(x: number, y: number) {
    this.vault.wreck = undefined;
    if (!this.cargo.length) return;
    const cx = clamp(x, INTERIOR.x0 + 14, INTERIOR.x1 - 14);
    const cy = clamp(y, INTERIOR.y0 + 14, INTERIOR.y1 - 14);
    this.vault.wreck = this.room;
    // Rings of 8 around the X, so a big haul spreads out instead of stacking.
    this.cargo.forEach((kind, i) => {
      const ring = Math.floor(i / 8), slot = i % 8;
      const a = (slot / 8) * Math.PI * 2 + ring * 0.4;
      const r = this.cargo.length > 1 ? 11 + ring * 10 : 0;
      this.dropLoot(kind, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    });
    this.cargo = [];
  }

  /** Puts a treasure on this room's floor, kept inside the walls. */
  private dropLoot(kind: TreasureKind, x: number, y: number) {
    const loot: Loot = { kind, x: clamp(x, INTERIOR.x0 + 6, INTERIOR.x1 - 6), y: clamp(y, INTERIOR.y0 + 6, INTERIOR.y1 - 6) };
    this.room.loot.push(loot);
    this.placeTreasure(loot);
  }

  /** Landing on the extraction pad cashes in your cargo and ends the vault. */
  private bank() {
    if (this.dead || this.banking || this.over) return;
    this.banking = true;
    this.beam.clear();
    this.beamHum(false);
    this.clearHostiles();
    playSound('bank');
    this.fx.pop(this.player.x, this.player.y - STACK.mid, [COLORS.loot, COLORS.beam, COLORS.amber], 90);

    const cargoValue = this.cargo.reduce((sum, k) => sum + TREASURE[k].value, 0);
    const visited = this.vault.rooms.filter((r) => r.visited).length;
    const explored = visited === GRID * GRID;
    this.addScore(cargoValue);
    if (explored) {
      this.addScore(SCORING.explorerBonus);
      this.lives += 1;
    }
    this.cargo = [];
    const detail = explored ? `EXPLORER BONUS +${pts(SCORING.explorerBonus)} AND A SHIP` : `ROOMS VISITED ${visited} OF ${GRID * GRID}`;
    this.showBanner(`VAULT ${this.vault.level} CLEAR`, `CARGO BANKED +${pts(cargoValue)}\n${detail}`, 2600);
    // A demo doesn't hold still that long.
    this.clock.delay(this.demoSeed >= 0 ? 1600 : 3000, () => {
      this.banking = false;
      this.startVault(this.vault.level + 1);
    });
  }

  // ---- Hostiles ----

  addEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const big = kind === 'warden' || kind === 'brood';
    const view = this.actors.addChild(new Stack(kind, STACK.shadow[kind]));
    view.position.set(x, y);
    const e: Enemy = { kind, x, y, vx: 0, vy: 0, r: big ? 7 : 6, view, hp: ENEMY_HP[kind], armedAt: this.clock.now + HUNTER.armMs };
    this.enemies.push(e);
    return e;
  }

  private removeEnemy(e: Enemy) {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (this.flashed === e) this.flashed = undefined;
    e.view.destroy({ children: true });
  }

  /** Places the room's sentries, mines, wardens and brood pods at their starting spots. */
  private buildFoes() {
    const grace = this.clock.now + HUNTER.entryGraceMs;
    for (const foe of this.room.foes) {
      const e = this.addEnemy(foe.kind, foe.x, foe.y);
      e.foe = foe;
      if (foe.kind === 'sentry' || foe.kind === 'brood') e.fixed = true;
      if (foe.kind === 'sentry') e.nextShotAt = grace + Math.random() * SENTRY.fireEveryMs;
      if (foe.kind === 'brood') e.nextHatchAt = grace + BROOD.hatchEveryMs / 2;
      if (foe.kind === 'mine') {
        e.bouncy = true;
        e.wakeAt = grace;
      }
    }
  }

  /** Removes everything hostile from the screen. A scavenger leaving with your loot hides it elsewhere. */
  private clearHostiles() {
    if (this.scavenger) this.scavengerEscapes(this.scavenger);
    for (const e of [...this.enemies]) this.removeEnemy(e);
    for (const b of [...this.bolts]) this.removeBolt(b);
  }

  private spawnHunter() {
    if (this.over || this.dead || this.banking || this.clock.now < this.nextSpawnAt) return;
    const alive = this.enemies.filter((e) => e.kind === 'hunter' && !e.brood).length;
    if (alive >= Math.min(HUNTER.maxAlive, this.room.hunters)) return;
    const options = doorTiles(this.room).filter((p) => dist(p.x, p.y, this.player.x, this.player.y) > 64);
    if (!options.length) return;
    const at = rand.pick(options);
    const h = this.addEnemy('hunter', at.x, at.y);
    h.view.alpha = 0;
    this.clock.tween(h.view, { alpha: 1 }, { ms: HUNTER.armMs });
    this.fx.implode(at.x, at.y - STACK.mid, HOSTILE_COLORS.hunter[0]);
    this.nextSpawnAt = this.clock.now + HUNTER.spawnEveryMs;
  }

  private updateEnemies(now: number) {
    const hunterSpeed = HUNTER.speed + (this.vault.level - 1) * HUNTER.speedPerLevel;
    const p = this.player;
    for (const e of [...this.enemies]) {
      if (this.dead) {
        e.vx = e.vy = 0;
        continue;
      }
      switch (e.kind) {
        case 'hunter':
          moveToward(e, p.x, p.y, hunterSpeed);
          break;
        case 'mine': {
          if (now < (e.wakeAt ?? 0)) break;
          // Straight diagonal lines; bounces keep the speed, bumps into other hostiles don't sap it.
          const speed = Math.hypot(e.vx, e.vy);
          if (speed < 1) {
            const a = ((45 + 90 * rand.between(0, 3)) * Math.PI) / 180;
            e.vx = Math.cos(a) * MINE.speed;
            e.vy = Math.sin(a) * MINE.speed;
          } else {
            e.vx *= MINE.speed / speed;
            e.vy *= MINE.speed / speed;
          }
          break;
        }
        case 'warden':
          this.moveWarden(e);
          break;
        case 'sentry': {
          const shotAt = e.nextShotAt!;
          // Blinks (and beeps) just before it fires, so you can get out of the line.
          const warning = now > shotAt - SENTRY.telegraphMs;
          e.view.alpha = warning && Math.floor(now / 60) % 2 ? 0.4 : 1;
          if (warning && !e.warned) {
            e.warned = true;
            playSound('warn');
          }
          if (now >= shotAt) {
            e.warned = false;
            this.fireBolt(e);
            e.nextShotAt = now + SENTRY.fireEveryMs * rand.float(0.8, 1.2);
          }
          break;
        }
        case 'brood':
          if (now >= e.nextHatchAt!) {
            e.nextHatchAt = now + BROOD.hatchEveryMs;
            if (this.broodDrones() < BROOD.maxDrones) this.hatch(e);
          }
          break;
      }
    }
  }

  /** Parks between you and the nearest treasure in the room; with no treasure left, it comes for you. */
  private moveWarden(e: Enemy) {
    const p = this.player;
    const loot = this.room.loot.reduce<Loot | undefined>(
      (best, l) => (!best || dist(e.x, e.y, l.x, l.y) < dist(e.x, e.y, best.x, best.y) ? l : best),
      undefined,
    );
    if (!loot) {
      moveToward(e, p.x, p.y, WARDEN.speed);
      return;
    }
    const a = Math.atan2(p.y - loot.y, p.x - loot.x);
    const gx = loot.x + Math.cos(a) * WARDEN.guardDistance, gy = loot.y + Math.sin(a) * WARDEN.guardDistance;
    if (dist(e.x, e.y, gx, gy) < 2) e.vx = e.vy = 0;
    else moveToward(e, gx, gy, WARDEN.speed);
  }

  private fireBolt(sentry: Enemy) {
    const view = new Sprite(boltTexture());
    view.anchor.set(0.5);
    // Flies at beam height.
    view.pivot.y = STACK.beamZ;
    this.actors.addChild(view);
    const a = Math.atan2(this.player.y - sentry.y, this.player.x - sentry.x);
    this.bolts.push({ x: sentry.x, y: sentry.y, vx: Math.cos(a) * SENTRY.boltSpeed, vy: Math.sin(a) * SENTRY.boltSpeed, r: 2, view });
    playSound('bolt');
  }

  private removeBolt(b: Bolt) {
    this.bolts.splice(this.bolts.indexOf(b), 1);
    b.view.destroy();
  }

  /** Bolts stop at the walls. */
  private updateBolts() {
    for (const b of [...this.bolts]) {
      if (this.dead) b.vx = b.vy = 0;
      if (!insideInterior(b.x, b.y)) this.removeBolt(b);
    }
  }

  private broodDrones() {
    return this.enemies.filter((e) => e.brood).length;
  }

  /** Brood drones hunt like any drone but don't count toward the room: only the pod does. */
  private hatch(brood: Enemy) {
    const a = Math.random() * Math.PI * 2;
    const d = this.addEnemy('hunter', brood.x + Math.cos(a) * 12, brood.y + Math.sin(a) * 12);
    d.brood = true;
    d.view.alpha = 0;
    this.clock.tween(d.view, { alpha: 1 }, { ms: HUNTER.armMs });
    this.fx.implode(d.x, d.y - STACK.mid, HOSTILE_COLORS.brood[0]);
    this.fx.pop(brood.x, brood.y - STACK.mid, [...HOSTILE_COLORS.brood], 10);
    playSound('hatch');
  }

  private hurt(e: Enemy, amount: number) {
    if (e.kind === 'scavenger') {
      this.shoo(e, amount);
      return;
    }
    e.hp -= amount;
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Enemy) {
    const kind = e.kind as EnemyKind;
    this.fx.burst(e.x, e.y - STACK.mid, [...HOSTILE_COLORS[kind]], kind === 'brood' || kind === 'warden' ? 'big' : 'small');
    playSound(kind === 'brood' || kind === 'warden' ? 'boomBig' : 'boom');
    this.floatText(e.x, e.y - 8, `${ENEMY_POINTS[kind]}`, TEXT.ink);
    this.removeEnemy(e);
    if (e.foe) this.room.foes.splice(this.room.foes.indexOf(e.foe), 1);
    else if (!e.brood) this.room.hunters -= 1;
    this.addScore(ENEMY_POINTS[kind]);
    if (!hostileCount(this.room) && !e.brood) {
      this.floatText(ROOM_W / 2, HUD_H + 30, 'ROOM SECURE', TEXT.beam);
      this.clock.delay(180, () => playSound('chime'));
    }
  }

  // ---- Scavenger ----

  private updateScavenger(now: number) {
    if (!this.scavengerRolled && this.cargo.length) {
      this.scavengerRolled = true;
      if (Math.random() < SCAVENGER.chance) this.scavengerDue = now + rand.between(...SCAVENGER.delayMs);
    }
    if (this.scavengerDue !== undefined && now >= this.scavengerDue && !this.dead) {
      this.scavengerDue = undefined;
      this.spawnScavenger();
    }
    const s = this.scavenger;
    if (!s) return;
    if (this.dead) {
      s.vx = s.vy = 0;
      return;
    }
    if (s.fleeing) {
      moveToward(s, s.fleeTo!.x, s.fleeTo!.y, SCAVENGER.fleeSpeed);
      if (s.x < -8 || s.x > ROOM_W + 8 || s.y < HUD_H - 8 || s.y > HUD_H + ROOM_H + 8) this.scavengerEscapes(s);
    } else {
      moveToward(s, this.player.x, this.player.y, SCAVENGER.speed);
    }
  }

  private spawnScavenger() {
    if (this.scavenger) return;
    const p = this.player;
    const at = doorTiles(this.room).reduce((far, d) => (dist(d.x, d.y, p.x, p.y) > dist(far.x, far.y, p.x, p.y) ? d : far));
    const view = this.actors.addChild(new Stack('scavenger', STACK.shadow.scavenger));
    view.alpha = 0.7;
    this.scavenger = {
      kind: 'scavenger', x: at.x, y: at.y, vx: 0, vy: 0, r: 6, view, hp: 0, shoo: SCAVENGER.shooHp, armedAt: this.clock.now + HUNTER.armMs, fleeing: false,
    };
    this.floatText(at.x, clamp(at.y, HUD_H + 14, HUD_H + ROOM_H - 14), 'SCAVENGER!', TEXT.danger);
    playSound('scavenger');
  }

  /** Grabs your most valuable piece of cargo and runs for it. */
  private onScavengerTouch(s: Enemy) {
    if (this.dead || this.over || this.banking || s.fleeing || this.clock.now < s.armedAt) return;
    if (this.cargo.length) {
      const best = this.cargo.reduce((bi, k, i, all) => (TREASURE[k].value > TREASURE[all[bi]].value ? i : bi), 0);
      const [kind] = this.cargo.splice(best, 1);
      s.stolen = kind;
      s.view.tint = COLORS.loot;
      playSound('steal');
      this.floatText(this.player.x, this.player.y - 12, `-${TREASURE[kind].name.toUpperCase()}`, TEXT.danger);
    }
    this.flee(s);
  }

  /** Off through the nearest wall: scavengers don't need doors. */
  private flee(s: Enemy) {
    const edges = [
      { d: s.y - HUD_H, x: s.x, y: HUD_H - 32 },
      { d: HUD_H + ROOM_H - s.y, x: s.x, y: HUD_H + ROOM_H + 32 },
      { d: s.x, x: -32, y: s.y },
      { d: ROOM_W - s.x, x: ROOM_W + 32, y: s.y },
    ];
    const to = edges.reduce((a, b) => (b.d < a.d ? b : a));
    s.fleeing = true;
    s.fleeTo = { x: to.x, y: to.y };
  }

  /** Enough beam makes it drop what it stole and run. It can't be destroyed. */
  private shoo(s: Enemy, amount: number) {
    if (s.shooed) return;
    s.shoo = (s.shoo ?? 0) - amount;
    if (s.shoo > 0) return;
    s.shooed = true;
    playSound('shoo');
    this.addScore(SCAVENGER.points);
    this.floatText(s.x, s.y - 8, `${SCAVENGER.points}`, TEXT.ink);
    this.fx.pop(s.x, s.y - STACK.mid, [...HOSTILE_COLORS.scavenger], 24);
    if (s.stolen) {
      this.dropLoot(s.stolen, s.x, s.y);
      s.stolen = undefined;
      s.view.tint = 0xffffff;
    }
    this.flee(s);
  }

  private scavengerEscapes(s: Enemy) {
    const stolen = s.stolen;
    s.view.destroy({ children: true });
    this.scavenger = undefined;
    if (!stolen) return;
    const rooms = this.vault.rooms.filter((r) => r !== this.room && r !== this.vault.exit);
    const hideout = rand.pick(rooms);
    hideout.loot.push({ kind: stolen, ...tileCenter(rand.between(3, COLS - 4), rand.between(3, ROWS - 4)) });
    playSound('steal', { detune: -500 });
    this.showBanner('LOOT STOLEN', `THE SCAVENGER HID YOUR ${TREASURE[stolen].name.toUpperCase()}\nSOMEWHERE ELSE IN THE VAULT`, 2200);
  }

  // ---- Beam ----

  /** The beam's hum loops while you fire, and rises in pitch while it's hitting something. */
  private beamHum(on: boolean, hitting = false) {
    const hum = this.beamHumLoop;
    if (!hum) return;
    if (on && !hum.isPlaying) hum.play();
    else if (!on && hum.isPlaying) hum.stop();
    if (on) hum.setDetune(hitting ? 300 : 0);
  }

  /** A hostile under the beam flickers white. The scavenger keeps its own tint (it shows stolen loot). */
  private flash(target: Enemy | undefined) {
    if (this.flashed !== target && this.flashed && !this.flashed.view.destroyed) this.flashed.view.white = false;
    this.flashed = target;
    if (target) target.view.white = Math.floor(this.clock.now / 60) % 2 === 1;
  }

  private updateBeam(firing: boolean, rawAim: number, dt: number) {
    const g = this.beam.clear();
    this.beamHum(firing && !this.dead);
    if (this.dead) {
      this.flash(undefined);
      return;
    }
    const step = Math.PI / 4;
    const aim = this.snap8 ? Math.round(rawAim / step) * step : rawAim;
    const dx = Math.cos(aim), dy = Math.sin(aim);
    // The hull never rotates: the beam leaves from the edge of a 14px box, so diagonals exit at a corner.
    const hull = 7 / Math.max(Math.abs(dx), Math.abs(dy));
    const sx = this.player.x + dx * hull, sy = this.player.y + dy * hull;

    if (firing) {
      let length = rayToWall(sx, sy, dx, dy);
      let target: Enemy | undefined;
      const targets = [...this.enemies, ...(this.scavenger && !this.scavenger.shooed ? [this.scavenger] : [])];
      for (const e of targets) {
        const radius = e.kind === 'warden' ? WARDEN.hitRadius : e.kind === 'brood' ? BROOD.hitRadius : BEAM.hitRadius;
        const t = rayCircle(sx, sy, dx, dy, e.x, e.y, radius);
        if (t < length) {
          length = t;
          target = e;
        }
      }
      const ex = sx + dx * length, ey = sy + dy * length;
      // Collisions are worked out on the floor; the beam is drawn at hull height.
      const h = STACK.beamZ;
      g.moveTo(sx, sy - h).lineTo(ex, ey - h).stroke({ width: 4, color: COLORS.beam, alpha: 0.28 });
      g.moveTo(sx, sy - h).lineTo(ex, ey - h).stroke({ width: 1, color: COLORS.beamCore, alpha: 1 });
      g.rect(Math.round(ex) - 2, Math.round(ey - h) - 2, 4, 4).fill(target ? COLORS.beamCore : COLORS.beam);
      const kind = target?.kind;
      this.fx.hit(ex, ey - h, aim, kind ? HOSTILE_COLORS[kind][0] : COLORS.beam);
      this.flash(kind && kind !== 'scavenger' ? target : undefined);
      if (target) this.hurt(target, BEAM.damagePerSecond * dt);
      this.beamHum(true, Boolean(target));
    } else {
      this.flash(undefined);
    }
    g.rect(Math.round(sx) - 1, Math.round(sy - STACK.beamZ) - 1, 2, 2).fill(firing ? COLORS.beamCore : COLORS.beam);
  }

  // ---- Effects ----

  /** A full-room wash of `color` that fades out (room entry, losing a ship). */
  private fade(color: number, ms: number) {
    this.clock.killTweensOf(this.fader);
    this.fader.tint = color;
    this.fader.alpha = 1;
    this.clock.tween(this.fader, { alpha: 0 }, { ms });
  }

  private floatText(x: number, y: number, s: string, color: string) {
    const t = this.roomTop.addChild(label(s, x, y, 8, color, { res: RENDER_SCALE, ax: 0.5, ay: 0.5 }));
    this.clock.tween(t, { y: y - 10, alpha: 0 }, { ms: 900, onComplete: () => t.destroy() });
  }

  /** Game over on a phone: RETRY and TITLE as words to tap. */
  private addTapButtons() {
    const y = HUD_H + ROOM_H / 2 - 8;
    const button = (x: number, s: string, action: () => void) => {
      const t = label(s, x, y, 16, TEXT.amber, { res: RENDER_SCALE, ax: 0.5, ay: 0.5 });
      t.zIndex = Z.banner;
      this.world.addChild(t);
      const z = zone(x - t.width / 2 - 16, y - t.height / 2 - 12, t.width + 32, t.height + 24, () => {
        if (this.clock.now - this.overAt > 800) action();
      });
      z.zIndex = Z.banner;
      this.world.addChild(z);
    };
    button(ROOM_W / 2 - 52, 'RETRY', () => nav.toRoom());
    button(ROOM_W / 2 + 52, 'TITLE', () => this.toTitle());
  }

  private hideBanner() {
    this.bannerFade?.remove();
    this.bannerFade = undefined;
    this.banner.alpha = 0;
    this.subBanner.alpha = 0;
  }

  private showBanner(title: string, sub: string, ms?: number) {
    this.hideBanner();
    this.banner.text = title;
    this.subBanner.text = sub;
    this.banner.alpha = this.subBanner.alpha = 1;
    if (ms) {
      const fade = { a: 1 };
      this.bannerFade = this.clock.tween(fade, { a: 0 }, {
        ms: 400, delay: ms,
        onUpdate: () => (this.banner.alpha = this.subBanner.alpha = fade.a),
      });
    }
  }
}
