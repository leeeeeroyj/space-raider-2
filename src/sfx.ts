import { ATTRACT } from './attract';
import { getBus, makeBus, send } from './audio/bus';
import { enableMusic } from './audio/music';
import { render, type Voice } from './audio/synth';

export type { Voice };

/** Every sound in the game. Tweak freely: they're rebuilt from these numbers each time the game loads. */
export const SOUNDS = {
  beam: {
    wave: 'saw', freq: 110, sustain: 0.2, vibrato: [30, 0.05], smooth: 0.25, filter: [1600, 1600], volume: 0.26, loop: true,
    layers: [{ wave: 'sine', freq: 55, sustain: 0.2, volume: 0.18 }],
  },
  boom: {
    wave: 'noise', freq: 1400, slide: -2.5, sustain: 0.04, decay: 0.32, filter: [6000, 300], drive: 1.6, volume: 0.5, jitter: 150, reverb: 0.25,
    layers: [{ wave: 'sine', freq: 130, slide: -3, sustain: 0.04, decay: 0.25, volume: 0.6 }],
  },
  boomBig: {
    wave: 'noise', freq: 900, slide: -1.6, sustain: 0.1, decay: 0.7, filter: [4000, 150], drive: 2, volume: 0.6, jitter: 100, reverb: 0.4,
    layers: [{ wave: 'sine', freq: 90, slide: -2, sustain: 0.1, decay: 0.6, volume: 0.8 }],
  },
  die: {
    wave: 'noise', freq: 1100, slide: -1.2, sustain: 0.15, decay: 0.9, filter: [5000, 100], drive: 1.5, volume: 0.7, reverb: 0.5,
    layers: [
      { wave: 'sine', freq: 220, slide: -3, sustain: 0.1, decay: 0.8, volume: 0.6 },
      { wave: 'square', freq: 440, slide: -4, sustain: 0.05, decay: 0.4, duty: 0.25, volume: 0.12 },
    ],
  },
  pickup: {
    wave: 'square', freq: 660, steps: [0, 7, 12], sustain: 0.12, decay: 0.08, duty: 0.25, volume: 0.26, echo: 0.35,
    layers: [{ wave: 'triangle', freq: 1320, steps: [0, 7, 12], sustain: 0.12, decay: 0.12, volume: 0.15 }],
  },
  chime: {
    wave: 'triangle', freq: 880, steps: [0, 5, 12], sustain: 0.2, decay: 0.25, volume: 0.4, reverb: 0.5, echo: 0.3,
    layers: [{ wave: 'sine', freq: 1760, steps: [0, 5, 12], sustain: 0.2, decay: 0.3, volume: 0.15 }],
  },
  door: {
    wave: 'noise', freq: 3000, slide: -3, attack: 0.03, sustain: 0.05, decay: 0.15, filter: [7000, 700], volume: 0.3, jitter: 200, reverb: 0.2,
    layers: [{ wave: 'sine', freq: 95, slide: -1, attack: 0.02, sustain: 0.05, decay: 0.15, volume: 0.35 }],
  },
  warn: { wave: 'square', freq: 1200, steps: [0, 5], sustain: 0.12, duty: 0.5, filter: [3200, 3200], volume: 0.12 },
  bolt: {
    wave: 'square', freq: 1500, slide: -4, sustain: 0.02, decay: 0.14, duty: 0.3, volume: 0.2, jitter: 120, echo: 0.15,
    layers: [{ wave: 'noise', freq: 5000, sustain: 0.01, decay: 0.05, volume: 0.12 }],
  },
  hatch: {
    wave: 'sine', freq: 140, slide: 2, vibrato: [18, 0.3], sustain: 0.12, decay: 0.12, volume: 0.55, jitter: 150, reverb: 0.2,
    layers: [{ wave: 'noise', freq: 600, smooth: 0.2, sustain: 0.05, decay: 0.2, volume: 0.25 }],
  },
  scavenger: { wave: 'triangle', freq: 520, vibrato: [9, 0.25], steps: [0, 3, 0, 3], sustain: 0.45, decay: 0.1, volume: 0.38, echo: 0.3 },
  steal: { wave: 'square', freq: 880, slide: -2.2, steps: [0, -5], sustain: 0.25, decay: 0.1, duty: 0.4, volume: 0.28, echo: 0.3 },
  shoo: { wave: 'square', freq: 440, slide: 3, sustain: 0.12, decay: 0.05, duty: 0.25, volume: 0.26, jitter: 100 },
  bank: {
    wave: 'square', freq: 523.25, steps: [0, 4, 7, 12, 16, 19, 24], sustain: 0.7, decay: 0.3, duty: 0.25, volume: 0.28, reverb: 0.5, echo: 0.3,
    layers: [{ wave: 'triangle', freq: 1046.5, steps: [0, 4, 7, 12, 16, 19, 24], sustain: 0.7, decay: 0.4, volume: 0.15 }],
  },
  extraShip: { wave: 'triangle', freq: 523.25, steps: [0, 4, 7, 12, 7, 12], sustain: 0.6, decay: 0.15, volume: 0.48, reverb: 0.4, echo: 0.3 },
  gameOver: {
    wave: 'square', freq: 392, steps: [0, -2, -4, -5, -7, -12], sustain: 1.1, decay: 0.4, duty: 0.5, filter: [3000, 600], volume: 0.26, reverb: 0.6,
    layers: [{ wave: 'triangle', freq: 196, steps: [0, -2, -4, -5, -7, -12], sustain: 1.1, decay: 0.5, volume: 0.3 }],
  },
  powerup: {
    wave: 'square', freq: 523.25, steps: [0, 7, 12, 19, 24], sustain: 0.35, decay: 0.15, duty: 0.25, volume: 0.26, echo: 0.4, reverb: 0.3,
    layers: [{ wave: 'sine', freq: 1046.5, steps: [0, 7, 12, 19, 24], sustain: 0.35, decay: 0.25, volume: 0.15 }],
  },
  holdFull: { wave: 'square', freq: 196, steps: [0, -1], sustain: 0.12, decay: 0.06, duty: 0.5, filter: [1400, 500], volume: 0.24 },
  shieldHit: {
    wave: 'triangle', freq: 1320, slide: -1.5, vibrato: [40, 0.2], sustain: 0.18, decay: 0.25, volume: 0.42, reverb: 0.4,
    layers: [{ wave: 'noise', freq: 6000, sustain: 0.02, decay: 0.15, volume: 0.18 }],
  },
  select: { wave: 'square', freq: 880, sustain: 0.04, decay: 0.04, duty: 0.5, volume: 0.18, echo: 0.1 },
  start: { wave: 'square', freq: 440, steps: [0, 7, 12, 19], sustain: 0.28, decay: 0.1, duty: 0.25, volume: 0.28, reverb: 0.3, echo: 0.3 },
} satisfies Record<string, Voice>;

export type SoundName = keyof typeof SOUNDS;
const MUTE_STORAGE = 'space-raider-muted';
const MUSIC_STORAGE = 'space-raider-music';

const buffers = new Map<SoundName, AudioBuffer>();
let muted = false;
let musicOn = true;
let played = 0;
let started = false;

const store = (key: string, on: boolean) => {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Storage blocked: the setting lasts for this visit only.
  }
};

/** Applies the settings to the mixer (once it exists) and the music. */
function apply() {
  enableMusic(musicOn);
  const bus = getBus();
  if (bus) bus.master.gain.setTargetAtTime(muted ? 0 : 1, bus.ctx.currentTime, 0.02);
}

/**
 * Gets sound ready: reads the settings, then makes the mixer and builds every sound on the first key press, click or
 * tap (browsers only let a page start audio after one). Never in attract mode, which makes no sound.
 */
export function initAudio() {
  if (ATTRACT || started) return;
  started = true;
  try {
    muted = localStorage.getItem(MUTE_STORAGE) === '1';
    musicOn = localStorage.getItem(MUSIC_STORAGE) !== '0';
  } catch {
    // Storage blocked: sound and music stay on.
  }
  apply();
  const unlock = () => {
    if (!getBus()) {
      const bus = makeBus();
      for (const [name, voice] of Object.entries(SOUNDS) as Array<[SoundName, Voice]>) buffers.set(name, render(bus.ctx, voice));
      apply();
    }
    const ctx = getBus()!.ctx;
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('pointerdown', unlock, true);
}

/** Plays a sound once. `detune` is in cents. Does nothing until the first key press or tap. */
export function playSound(name: SoundName, o: { detune?: number } = {}) {
  const bus = getBus(), buffer = buffers.get(name);
  if (!bus || !buffer) return;
  const v: Voice = SOUNDS[name];
  const src = bus.ctx.createBufferSource();
  src.buffer = buffer;
  // A little different every time, so repeats don't grate.
  src.detune.value = (o.detune ?? 0) + (Math.random() * 2 - 1) * (v.jitter ?? 0);
  const g = bus.ctx.createGain();
  g.gain.value = 0.9 + Math.random() * 0.1;
  src.connect(g).connect(bus.sfx);
  send(g, v.reverb, v.echo);
  src.start();
  played++;
}

export interface Loop {
  readonly isPlaying: boolean;
  play(): void;
  stop(): void;
  setDetune(cents: number): void;
}

/** A looping sound you start and stop yourself. Call stop() when its screen goes. */
export function loopSound(name: SoundName): Loop {
  let src: AudioBufferSourceNode | undefined;
  let detune = 0;
  return {
    get isPlaying() {
      return src !== undefined;
    },
    play() {
      const bus = getBus(), buffer = buffers.get(name);
      if (src || !bus || !buffer) return;
      src = bus.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.detune.value = detune;
      src.connect(bus.sfx);
      src.start();
      played++;
    },
    stop() {
      src?.stop();
      src?.disconnect();
      src = undefined;
    },
    setDetune(cents: number) {
      detune = cents;
      if (src) src.detune.value = cents;
    },
  };
}

export const isMuted = () => muted;
export const isMusicOn = () => musicOn;
/** What the sound toggle shows: everything, sound effects only, or nothing. */
export const soundLabel = () => (muted ? 'SOUND OFF' : musicOn ? 'SOUND ON' : 'SFX ONLY');
/** Sounds started since the page loaded (the attract test checks there are none). */
export const soundsPlayed = () => played;

/** M: everything off, or back on. */
export function toggleMute() {
  muted = !muted;
  store(MUTE_STORAGE, muted);
  apply();
}

/** N or the pad's Back: the music only. */
export function toggleMusic() {
  if (muted) {
    muted = false;
    store(MUTE_STORAGE, false);
    musicOn = true;
  } else {
    musicOn = !musicOn;
  }
  store(MUSIC_STORAGE, musicOn);
  apply();
}

/** The sound tap (touch, or a click): all sound, then sound effects only, then off, then all again. */
export function cycleSound() {
  if (muted) {
    muted = false;
    musicOn = true;
  } else if (musicOn) {
    musicOn = false;
  } else {
    muted = true;
  }
  store(MUTE_STORAGE, muted);
  store(MUSIC_STORAGE, musicOn);
  apply();
}
