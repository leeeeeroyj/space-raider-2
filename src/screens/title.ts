import { Container, Graphics, type Text } from 'pixi.js';
import { AIM_MODE_SELECTABLE, COLORS, HEIGHT, RENDER_SCALE, STACK, TEXT, WIDTH, aimMode } from '../config';
import { Clock } from '../engine/clock';
import { input } from '../engine/input';
import { nav, type Screen } from '../engine/screens';
import { label, setText, zone } from '../engine/text';
import { addTreasureGlow, startSparkles } from '../fx';
import { loadHi } from '../hi';
import { Stack } from '../render/stack';
import { playMusic } from '../audio/music';
import { initAudio, playSound, soundLabel, toggleMusic, toggleMute } from '../sfx';

type Star = { x: number; y: number; speed: number; alpha: number };
const MENU: ReadonlyArray<'start' | 'aim'> = AIM_MODE_SELECTABLE ? ['start', 'aim'] : ['start'];
const LOOT = ['t1_coin', 't2_chip', 't3_star', 't4_crystal', 't5_idol'] as const;
const HOSTILES = ['hunter', 'sentry', 'mine', 'warden', 'brood', 'scavenger'] as const;

export class TitleScreen implements Screen {
  readonly name = 'title';
  readonly root = new Container();
  private readonly clock = new Clock();
  private readonly stage = new Container();
  private readonly starfield = new Graphics();
  private readonly fader = new Graphics().rect(0, 0, WIDTH, HEIGHT).fill(COLORS.void);
  private stars: Star[];
  private selected = 0;
  private menu: Text[] = [];
  private padStatus: Text | undefined;
  private readonly soundText: Text;
  /** The high score line, if there is one (the tests read it). */
  hiText: Text | undefined;
  private leaving = false;
  /** The legend's models, turning slowly. */
  private readonly turning: Stack[] = [];

  constructor() {
    initAudio();
    playMusic('title');
    // Start listening now, so the first key press counts.
    input();
    this.root.addChild(this.stage);
    this.stage.scale.set(RENDER_SCALE);
    this.stage.addChild(this.starfield);
    document.body.style.cursor = 'default';
    this.stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * WIDTH, y: Math.random() * HEIGHT, speed: 3 + Math.random() * 14, alpha: 0.25 + Math.random() * 0.6,
    }));

    const cx = WIDTH / 2;
    const text = (x: number, y: number, s: string, size: number, color: string) =>
      this.stage.addChild(label(s, x, y, size, color, { res: RENDER_SCALE, ax: 0.5, align: 'center' }));
    // The legend's models stand a little below the middle of the row, so they look centred on it.
    const model = (key: string, x: number, y: number, turns = true) => {
      const s = new Stack(key, STACK.shadow[key] ?? STACK.shadow.loot);
      s.position.set(x, y + 5);
      if (turns) this.turning.push(s);
      return s;
    };

    text(cx, 10, 'A VAULT RAID IN 36 ROOMS', 8, TEXT.dim);
    text(cx, 20, 'SPACE RAIDER', 24, TEXT.amber);
    text(cx, 48, 'BLAST THE HOSTILES. GRAB WHAT GLOWS. GET OUT ALIVE.', 8, TEXT.ink);
    const hi = loadHi();
    if (hi) this.hiText = text(WIDTH - 40, 2, `HI ${hi.toLocaleString('en-US')}`, 8, TEXT.amber);
    this.soundText = text(40, 2, '', 8, TEXT.dim);

    // Legend: what you fly, what to collect, what to shoot.
    text(64, 64, 'YOU', 8, TEXT.dim);
    // The ship never turns.
    this.stage.addChild(model('player', 64, 86, false));
    text(196, 64, 'LOOT  500 TO 8,000', 8, TEXT.dim);
    const loot = LOOT.map((key, i) => {
      const c = new Container();
      c.position.set(156 + i * 20, 86);
      c.addChild(model(key, 0, 0));
      return this.stage.addChild(addTreasureGlow(this.clock, c, -2));
    });
    const sparkles = this.stage.addChild(new Container());
    startSparkles(this.clock, sparkles, () => loot);
    text(340, 64, 'HOSTILES', 8, TEXT.danger);
    HOSTILES.forEach((key, i) => {
      const s = this.stage.addChild(model(key, 340 + (i - 2.5) * 18, 86));
      s.alpha = key === 'scavenger' ? 0.7 : 1;
    });

    this.menu = MENU.map((_, i) => {
      const item = text(cx, 106 + i * 18 + (MENU.length === 1 ? 9 : 0), '', 16, TEXT.dim);
      const z = this.stage.addChild(zone(cx - 60, item.y - 2, 120, 22, () => this.activate(i)));
      z.on('pointerover', () => (this.selected = i));
      return item;
    });
    // Phones and tablets get touch instructions instead of keyboard and controller ones.
    const touchScreen = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    text(cx, 146, touchScreen ? 'TAP START' : AIM_MODE_SELECTABLE ? 'UP / DOWN CHOOSE  ·  ENTER / A SELECT  ·  LEFT / RIGHT CHANGE AIM' : 'PRESS ENTER OR A, OR CLICK START', 8, TEXT.dim);

    const column = (x: number, title: string, keys: string, actions: string) => {
      text(x, 162, title, 8, TEXT.amber);
      this.stage.addChild(label(keys, x - 4, 174, 8, TEXT.ink, { res: RENDER_SCALE, ax: 1, align: 'right', lineSpacing: 2 }));
      this.stage.addChild(label(actions, x + 4, 174, 8, TEXT.dim, { res: RENDER_SCALE, lineSpacing: 2 }));
    };
    const aimLine = (key: string) => (AIM_MODE_SELECTABLE ? `\n${key}` : '');
    const aimAction = AIM_MODE_SELECTABLE ? '\nAIM MODE' : '';
    if (touchScreen) {
      column(cx, 'TOUCH', 'LEFT CIRCLE\nRIGHT CIRCLE\nTAP II\nTAP', 'MOVE\nAIM + FIRE\nPAUSE, TOP LEFT\nSOUND / MUSIC, TOP RIGHT');
    } else {
      column(112, 'KEYBOARD + MOUSE', `WASD\nMOUSE\nCLICK  ·  P${aimLine('Q')}\nM  ·  N`, `MOVE\nAIM\nFIRE  ·  PAUSE${aimAction}\nSOUND  ·  MUSIC`);
      column(304, 'CONTROLLER', `L-STICK\nR-STICK\nRT  ·  START${aimLine('BACK')}\n${AIM_MODE_SELECTABLE ? 'Y' : 'Y  ·  BACK'}`, `MOVE\nAIM + FIRE\nFIRE  ·  PAUSE${aimAction}\n${AIM_MODE_SELECTABLE ? 'SOUND' : 'SOUND  ·  MUSIC'}`);
      this.padStatus = text(cx, 218, '', 8, TEXT.dim);
    }

    this.stage.addChild(this.fader);
    this.clock.tween(this.fader, { alpha: 0 }, { ms: 250 });
  }

  update(ms: number) {
    this.clock.update(ms);
    this.drawStars(ms / 1000);
    const secs = this.clock.now / 1000;
    this.turning.forEach((s, i) => (s.spin = secs * 0.15 * Math.PI * 2 + i * 0.7));
    const m = input().readMenu();
    if (m.mute) toggleMute();
    if (m.music) toggleMusic();
    setText(this.soundText, soundLabel());
    if (!this.leaving) {
      if ((m.up || m.down) && MENU.length > 1) {
        this.selected = (this.selected + (m.down ? 1 : MENU.length - 1)) % MENU.length;
        playSound('select');
      }
      if (AIM_MODE_SELECTABLE && (m.toggleAim || (MENU[this.selected] === 'aim' && (m.left || m.right)))) aimMode.snap8 = !aimMode.snap8;
      else if (m.confirm) this.activate(this.selected);
    }

    const labels = { start: 'START', aim: `AIM: ${aimMode.snap8 ? '8-WAY' : '360'}` };
    this.menu.forEach((item, i) => {
      const on = i === this.selected;
      const s = labels[MENU[i]];
      setText(item, on ? (MENU[i] === 'aim' ? `< ${s} >` : `> ${s} <`) : s, on ? TEXT.amber : TEXT.dim);
    });

    if (this.padStatus) {
      const pad = input().pad();
      setText(this.padStatus, pad ? 'CONTROLLER CONNECTED' : 'USING A CONTROLLER? PRESS ANY BUTTON ON IT', pad ? TEXT.beam : TEXT.dim);
    }
  }

  destroy() {
    this.clock.clear();
    this.root.destroy({ children: true, context: true });
  }

  private activate(index: number) {
    if (this.leaving) return;
    if (MENU[index] === 'aim') {
      aimMode.snap8 = !aimMode.snap8;
      return;
    }
    this.leaving = true;
    playSound('start');
    this.clock.tween(this.fader, { alpha: 1 }, { ms: 250, onComplete: () => nav.toRoom() });
  }

  private drawStars(dt: number) {
    const g = this.starfield.clear();
    for (const s of this.stars) {
      s.y += s.speed * dt;
      if (s.y > HEIGHT) {
        s.y = 0;
        s.x = Math.random() * WIDTH;
      }
      g.rect(Math.round(s.x), Math.round(s.y), 1, 1).fill({ color: 0xffffff, alpha: s.alpha });
    }
  }
}
