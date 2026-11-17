export type Ease = (t: number) => number;

export const EASE = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => 1 - (1 - t) ** 2,
  sineInOut: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
} satisfies Record<string, Ease>;

/** Anything with a `destroyed` flag (every Pixi display object): its timers and tweens stop when it goes. */
type Owner = { destroyed: boolean };

export interface Handle {
  remove(): void;
}

interface Timer {
  at: number;
  every: number;
  fn: () => void;
  owner?: Owner;
  dead: boolean;
}

export interface TweenOptions {
  ms: number;
  ease?: Ease;
  delay?: number;
  /** Plays forward then back; one cycle is forward and back. */
  yoyo?: boolean;
  /** Extra cycles after the first; -1 repeats for ever. */
  repeat?: number;
  onUpdate?: () => void;
  onComplete?: () => void;
}

interface Tween extends TweenOptions {
  target: Record<string, unknown> & Partial<Owner>;
  to: Record<string, number>;
  from: Record<string, number>;
  start: number;
  started: boolean;
  dead: boolean;
}

/**
 * A screen's clock: timers and tweens in game time. While paused, `now` stands still, so everything that's due
 * waits out the pause by itself.
 */
export class Clock {
  now = 0;
  paused = false;
  private timers: Timer[] = [];
  private tweens: Tween[] = [];

  update(ms: number) {
    if (this.paused) return;
    this.now += ms;
    for (const t of [...this.timers]) {
      if (t.dead) continue;
      if (t.owner?.destroyed) {
        t.dead = true;
        continue;
      }
      if (this.now < t.at) continue;
      if (t.every > 0) t.at += t.every;
      else t.dead = true;
      t.fn();
    }
    this.timers = this.timers.filter((t) => !t.dead);

    for (const tw of [...this.tweens]) {
      if (tw.dead) continue;
      if (tw.target.destroyed) {
        tw.dead = true;
        continue;
      }
      const elapsed = this.now - tw.start;
      if (elapsed < 0) continue;
      if (!tw.started) {
        tw.started = true;
        for (const k of Object.keys(tw.to)) tw.from[k] = tw.target[k] as number;
      }
      const cycle = tw.yoyo ? tw.ms * 2 : tw.ms;
      const n = Math.floor(elapsed / cycle);
      const repeat = tw.repeat ?? 0;
      let p: number;
      const finished = repeat >= 0 && n > repeat;
      if (finished) p = tw.yoyo ? 0 : 1;
      else {
        p = (elapsed - n * cycle) / tw.ms;
        if (p > 1) p = 2 - p;
      }
      const e = (tw.ease ?? EASE.linear)(p);
      for (const k of Object.keys(tw.to)) tw.target[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      tw.onUpdate?.();
      if (finished) {
        tw.dead = true;
        tw.onComplete?.();
      }
    }
    this.tweens = this.tweens.filter((t) => !t.dead);
  }

  /** Calls `fn` once, `ms` from now. */
  delay(ms: number, fn: () => void, owner?: Owner): Handle {
    const t: Timer = { at: this.now + ms, every: 0, fn, owner, dead: false };
    this.timers.push(t);
    return { remove: () => (t.dead = true) };
  }

  /** Calls `fn` every `ms`. */
  every(ms: number, fn: () => void, owner?: Owner): Handle {
    const t: Timer = { at: this.now + ms, every: ms, fn, owner, dead: false };
    this.timers.push(t);
    return { remove: () => (t.dead = true) };
  }

  /** Eases the numeric properties in `to` from their current values. Stops by itself if the target is destroyed. */
  tween<T extends object>(target: T, to: Partial<Record<keyof T, number>>, options: TweenOptions): Handle {
    const tw: Tween = {
      ...options, target: target as Tween['target'], to: to as Record<string, number>, from: {},
      start: this.now + (options.delay ?? 0), started: false, dead: false,
    };
    this.tweens.push(tw);
    return { remove: () => (tw.dead = true) };
  }

  killTweensOf(target: object) {
    for (const tw of this.tweens) if (tw.target === target) tw.dead = true;
  }

  clear() {
    for (const t of this.timers) t.dead = true;
    for (const tw of this.tweens) tw.dead = true;
  }
}
