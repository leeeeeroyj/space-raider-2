import { AIM_MODE_SELECTABLE } from '../config';
import { touchSticks } from '../touch';
import { game } from './screens';

export type Device = 'kbm' | 'pad' | 'touch';
export interface Vec {
  x: number;
  y: number;
}

export interface ControlState {
  /** Movement, length 0..1. */
  move: Vec;
  /** Aim angle in radians (0 = right). */
  aim: number;
  fire: boolean;
  toggleAim: boolean;
  confirm: boolean;
  back: boolean;
  mute: boolean;
  /** N on the keyboard, Back on a controller (unless Back picks the aim mode). */
  music: boolean;
  /** P on the keyboard, Start on a controller. */
  pause: boolean;
  device: Device;
}

export interface MenuState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  toggleAim: boolean;
  mute: boolean;
  music: boolean;
  device: Device;
}

const DEADZONE = 0.2;
const AIM_THRESHOLD = 0.35;
const TRIGGER_THRESHOLD = 0.3;
const MENU_STICK = 0.5;
const TOUCH_DEADZONE = 0.15;
const TOUCH_AIM_THRESHOLD = 0.3;

// Standard gamepad mapping (Xbox layout).
const BTN = { A: 0, B: 1, Y: 3, RB: 5, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
const TRACKED = [BTN.A, BTN.B, BTN.Y, BTN.BACK, BTN.START, BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT];
/** Keys the game uses: the browser mustn't scroll or do anything else with them. */
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyM', 'KeyN', 'KeyP', 'Enter', 'Space', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const length = (v: Vec) => Math.hypot(v.x, v.y);
const normalize = (v: Vec) => {
  const l = length(v);
  if (l > 0) {
    v.x /= l;
    v.y /= l;
  }
  return v;
};

/**
 * One input layer for keyboard + mouse, a controller and touch. Whichever was used last owns the aim.
 * Controller: left stick or D-pad moves, right stick aims and fires, RT/RB fire, Y toggles sound, Start pauses (and confirms),
 * Back toggles aim mode. Touch: two sticks (src/touch.ts), left moves, right aims and fires.
 * There's one, made the first time it's asked for (never in attract mode, which reads no input at all).
 */
class Input {
  /** Phones and tablets start in touch mode, so the hints are right before the first touch. */
  device: Device = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'kbm';
  /** False until the mouse has moved over the game, so no crosshair is drawn at (0, 0). */
  mouseSeen = false;
  /** The mouse in design pixels. */
  mouse = { x: 0, y: 0 };
  private mouseDown = false;
  private held = new Set<string>();
  /** Keys pressed since each was last asked about. */
  private fresh = new Set<string>();
  private padAim = -Math.PI / 2;
  private touchAim = -Math.PI / 2;
  private prevButtons = new Set<number>();
  private prevStick = { x: 0, y: 0 };

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.held.add(e.code);
      this.fresh.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => {
      this.held.clear();
      this.mouseDown = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.device = 'kbm';
      this.mouseSeen = true;
      this.mouse = game.toDesign(e.clientX, e.clientY);
    });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') {
        this.device = 'touch';
        return;
      }
      this.device = 'kbm';
      this.mouse = game.toDesign(e.clientX, e.clientY);
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseDown = false;
    });
  }

  private just(code: string) {
    return this.fresh.delete(code);
  }

  /** The first connected controller, if the browser has seen one (it needs a button press first). */
  pad(): Gamepad | undefined {
    return (navigator.getGamepads?.() ?? []).find((p): p is Gamepad => !!p && p.connected);
  }

  /** Buttons pressed this frame that weren't pressed last frame. Call once per frame. */
  private padEdges(pad: Gamepad | undefined) {
    const down = new Set(pad ? TRACKED.filter((i) => pad.buttons[i]?.pressed) : []);
    const edges = new Set([...down].filter((i) => !this.prevButtons.has(i)));
    this.prevButtons = down;
    if (edges.size) this.device = 'pad';
    return edges;
  }

  /** Gameplay input. `from` is the ship, for mouse aim. */
  read(from: Vec): ControlState {
    const h = (c: string) => (this.held.has(c) ? 1 : 0);
    const move = normalize({ x: h('KeyD') - h('KeyA'), y: h('KeyS') - h('KeyW') });
    let fire = this.mouseDown;
    let toggleAim = this.just('KeyQ');
    let confirm = this.just('Enter') || this.just('Space');
    let back = this.just('Escape');
    let mute = this.just('KeyM');
    let music = this.just('KeyN');
    let pause = this.just('KeyP');
    this.fresh.clear();

    const pad = this.pad();
    const edges = this.padEdges(pad);
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);
      const b = (i: number) => pad.buttons[i]?.pressed ?? false;
      let mx = dz(pad.axes[0] ?? 0);
      let my = dz(pad.axes[1] ?? 0);
      if (b(BTN.LEFT)) mx = -1;
      if (b(BTN.RIGHT)) mx = 1;
      if (b(BTN.UP)) my = -1;
      if (b(BTN.DOWN)) my = 1;
      if (mx || my) {
        move.x = mx;
        move.y = my;
        if (length(move) > 1) normalize(move);
        this.device = 'pad';
      }
      const stick = { x: pad.axes[2] ?? 0, y: pad.axes[3] ?? 0 };
      if (length(stick) > AIM_THRESHOLD) {
        this.padAim = Math.atan2(stick.y, stick.x);
        fire = true;
        this.device = 'pad';
      }
      if ((pad.buttons[BTN.RT]?.value ?? 0) > TRIGGER_THRESHOLD || (pad.buttons[BTN.RB]?.value ?? 0) > TRIGGER_THRESHOLD) {
        fire = true;
        this.device = 'pad';
      }
      if (edges.has(BTN.BACK)) {
        if (AIM_MODE_SELECTABLE) toggleAim = true;
        else music = true;
      }
      if (edges.has(BTN.START) || edges.has(BTN.A)) confirm = true;
      if (edges.has(BTN.B)) back = true;
      if (edges.has(BTN.Y)) mute = true;
      if (edges.has(BTN.START)) pause = true;
    }

    touchSticks.render();
    if (touchSticks.active) this.device = 'touch';
    const thumbMove = touchSticks.vector('move');
    const thumbAim = touchSticks.vector('aim');
    if (thumbMove && length(thumbMove) > TOUCH_DEADZONE) {
      move.x = thumbMove.x;
      move.y = thumbMove.y;
      this.device = 'touch';
    }
    if (thumbAim && length(thumbAim) > TOUCH_AIM_THRESHOLD) {
      this.touchAim = Math.atan2(thumbAim.y, thumbAim.x);
      fire = true;
      this.device = 'touch';
    }
    const aim =
      this.device === 'pad' ? this.padAim
      : this.device === 'touch' ? this.touchAim
      : Math.atan2(this.mouse.y - from.y, this.mouse.x - from.x);
    return { move, aim, fire, toggleAim, confirm, back, mute, music, pause, device: this.device };
  }

  readMenu(): MenuState {
    const s: MenuState = {
      up: this.just('KeyW') || this.just('ArrowUp'),
      down: this.just('KeyS') || this.just('ArrowDown'),
      left: this.just('KeyA') || this.just('ArrowLeft'),
      right: this.just('KeyD') || this.just('ArrowRight'),
      confirm: this.just('Enter') || this.just('Space'),
      back: this.just('Escape'),
      toggleAim: this.just('KeyQ'),
      mute: this.just('KeyM'),
      music: this.just('KeyN'),
      device: this.device,
    };
    this.fresh.clear();
    if (Object.values(s).some((v) => v === true)) this.device = s.device = 'kbm';

    const pad = this.pad();
    const edges = this.padEdges(pad);
    if (pad) {
      // The left stick acts like a D-pad: one step each time it crosses the threshold.
      const x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0;
      const crossed = (now: number, before: number, sign: number) => now * sign > MENU_STICK && before * sign <= MENU_STICK;
      s.up ||= edges.has(BTN.UP) || crossed(y, this.prevStick.y, -1);
      s.down ||= edges.has(BTN.DOWN) || crossed(y, this.prevStick.y, 1);
      s.left ||= edges.has(BTN.LEFT) || crossed(x, this.prevStick.x, -1);
      s.right ||= edges.has(BTN.RIGHT) || crossed(x, this.prevStick.x, 1);
      s.confirm ||= edges.has(BTN.A) || edges.has(BTN.START);
      s.back ||= edges.has(BTN.B);
      if (AIM_MODE_SELECTABLE) s.toggleAim ||= edges.has(BTN.BACK);
      else s.music ||= edges.has(BTN.BACK);
      s.mute ||= edges.has(BTN.Y);
      if (Math.abs(x) > MENU_STICK || Math.abs(y) > MENU_STICK) this.device = 'pad';
      this.prevStick = { x, y };
      s.device = this.device;
    }
    return s;
  }
}

let instance: Input | undefined;
export const input = () => (instance ??= new Input());
