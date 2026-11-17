import { Application, Container } from 'pixi.js';
import { HEIGHT, RENDER_SCALE, WIDTH } from '../config';

/** A whole screen (title, or a raid with its HUD). Owns everything under `root`, and its own listeners. */
export interface Screen {
  readonly name: string;
  readonly root: Container;
  update(ms: number): void;
  destroy(): void;
}

/** Longest frame step, ms: after a stall the game slows down instead of jumping. */
const MAX_STEP = 50;
const BATCH_TEXTURES = 4;

/**
 * The Pixi app and the current screen. The canvas is WIDTH × HEIGHT design pixels at RENDER_SCALE, and the page
 * scales it to fit the window (letterboxed, centred).
 */
export class Game {
  readonly app = new Application();
  screen: Screen | undefined;

  async init(parent: HTMLElement) {
    await this.app.init({
      width: WIDTH * RENDER_SCALE, height: HEIGHT * RENDER_SCALE, background: 0x05060d,
      antialias: false, roundPixels: true, preference: 'webgl', autoDensity: false, resolution: 1,
    });
    // Pixi's batch shader picks one of up to 32 textures per pixel by branching. A frame here uses only a handful, and
    // the smaller shader halves the cost of every pixel on software rendering (and helps weak phone GPUs).
    this.app.renderer.limits.maxBatchableTextures = Math.min(this.app.renderer.limits.maxBatchableTextures, BATCH_TEXTURES);
    parent.append(this.app.canvas);
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const fit = () => {
      const k = Math.min(window.innerWidth / (WIDTH * RENDER_SCALE), window.innerHeight / (HEIGHT * RENDER_SCALE));
      Object.assign(this.app.canvas.style, { width: `${WIDTH * RENDER_SCALE * k}px`, height: `${HEIGHT * RENDER_SCALE * k}px` });
    };
    window.addEventListener('resize', fit);
    fit();
    this.app.ticker.add((t) => {
      if (this.next) this.swap(this.next);
      this.screen?.update(Math.min(t.deltaMS, MAX_STEP));
    });
  }

  /**
   * Switches screens at the start of the next frame, so the screen asking can finish its own update first. `make`
   * runs then too: the new screen is built after the old one is gone.
   */
  show(make: () => Screen) {
    this.next = make;
  }

  private next: (() => Screen) | undefined;

  private swap(make: () => Screen) {
    this.next = undefined;
    const old = this.screen;
    this.screen = undefined;
    if (old) {
      this.app.stage.removeChild(old.root);
      old.destroy();
    }
    this.screen = make();
    this.app.stage.addChild(this.screen.root);
  }

  /** Mouse position in design pixels, from a page position. */
  toDesign(clientX: number, clientY: number) {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * WIDTH, y: ((clientY - r.top) / r.height) * HEIGHT };
  }
}

export const game = new Game();

/** Screen changes, set up by main.ts so screens don't import each other. */
export const nav = {
  toTitle: () => {},
  toRoom: (_attract?: number) => {},
};
