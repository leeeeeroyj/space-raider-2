/** A seeded random number generator (mulberry32 over an FNV-1a hash of the seed): same seed, same sequence. */
export class Rng {
  private s: number;

  constructor(seed: string) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    this.s = h >>> 0;
  }

  /** 0 ≤ n < 1. */
  frac() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer from min to max, inclusive. */
  between(min: number, max: number) {
    return min + Math.floor(this.frac() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.frac() * list.length)];
  }

  /** Shuffles in place and returns the same array. */
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.frac() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}

/** Unseeded helpers, for things that don't need to repeat. */
export const rand = {
  between: (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1)),
  float: (min: number, max: number) => min + Math.random() * (max - min),
  pick: <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)],
};

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
