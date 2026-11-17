import { ATTRACT } from './attract';

type Wave = 'square' | 'saw' | 'triangle' | 'sine' | 'noise';

/**
 * One retro voice, sfxr style. Times are in seconds. `slide` bends the pitch in octaves per second;
 * `steps` are semitone jumps spread evenly across the sound (arpeggios, jingles); `vibrato` is [hz, depth 0..1];
 * `duty` is the square wave's pulse width; `smooth` (0..1) low-passes the result, lower is duller;
 * `volume` is the peak level. A `loop` sound has no envelope and should hold whole cycles so it loops cleanly.
 */
export interface Voice {
  wave: Wave;
  freq: number;
  attack?: number;
  sustain?: number;
  decay?: number;
  slide?: number;
  steps?: number[];
  vibrato?: [number, number];
  duty?: number;
  smooth?: number;
  volume?: number;
  loop?: boolean;
}

/** Every sound in the game. Tweak freely: they're rebuilt from these numbers each time the game loads. */
export const SOUNDS = {
  beam: { wave: 'saw', freq: 110, sustain: 0.2, vibrato: [30, 0.05], smooth: 0.25, volume: 0.3, loop: true },
  boom: { wave: 'noise', freq: 1400, slide: -2.5, sustain: 0.04, decay: 0.32, volume: 0.55 },
  boomBig: { wave: 'noise', freq: 900, slide: -1.6, sustain: 0.1, decay: 0.7, volume: 0.7 },
  die: { wave: 'noise', freq: 1100, slide: -1.2, sustain: 0.15, decay: 0.9, volume: 0.8 },
  pickup: { wave: 'square', freq: 660, steps: [0, 7, 12], sustain: 0.12, decay: 0.08, duty: 0.25, volume: 0.3 },
  chime: { wave: 'triangle', freq: 880, steps: [0, 5, 12], sustain: 0.2, decay: 0.25, volume: 0.45 },
  door: { wave: 'noise', freq: 3000, slide: -3, attack: 0.03, sustain: 0.05, decay: 0.15, smooth: 0.15, volume: 0.35 },
  warn: { wave: 'square', freq: 1200, steps: [0, 5], sustain: 0.12, duty: 0.5, volume: 0.12 },
  bolt: { wave: 'square', freq: 1500, slide: -4, sustain: 0.02, decay: 0.14, duty: 0.3, volume: 0.22 },
  hatch: { wave: 'sine', freq: 140, slide: 2, vibrato: [18, 0.3], sustain: 0.12, decay: 0.12, volume: 0.6 },
  scavenger: { wave: 'triangle', freq: 520, vibrato: [9, 0.25], steps: [0, 3, 0, 3], sustain: 0.45, decay: 0.1, volume: 0.4 },
  steal: { wave: 'square', freq: 880, slide: -2.2, steps: [0, -5], sustain: 0.25, decay: 0.1, duty: 0.4, volume: 0.3 },
  shoo: { wave: 'square', freq: 440, slide: 3, sustain: 0.12, decay: 0.05, duty: 0.25, volume: 0.28 },
  bank: { wave: 'square', freq: 523.25, steps: [0, 4, 7, 12, 16, 19, 24], sustain: 0.7, decay: 0.3, duty: 0.25, volume: 0.3 },
  extraShip: { wave: 'triangle', freq: 523.25, steps: [0, 4, 7, 12, 7, 12], sustain: 0.6, decay: 0.15, volume: 0.5 },
  gameOver: { wave: 'square', freq: 392, steps: [0, -2, -4, -5, -7, -12], sustain: 1.1, decay: 0.4, duty: 0.5, volume: 0.25 },
  powerup: { wave: 'square', freq: 523.25, steps: [0, 7, 12, 19, 24], sustain: 0.35, decay: 0.15, duty: 0.25, volume: 0.3 },
  holdFull: { wave: 'square', freq: 196, steps: [0, -1], sustain: 0.12, decay: 0.06, duty: 0.5, volume: 0.22 },
  shieldHit: { wave: 'triangle', freq: 1320, slide: -1.5, vibrato: [40, 0.2], sustain: 0.18, decay: 0.25, volume: 0.45 },
  select: { wave: 'square', freq: 880, sustain: 0.04, decay: 0.04, duty: 0.5, volume: 0.2 },
  start: { wave: 'square', freq: 440, steps: [0, 7, 12, 19], sustain: 0.28, decay: 0.1, duty: 0.25, volume: 0.3 },
} satisfies Record<string, Voice>;

export type SoundName = keyof typeof SOUNDS;
const MUTE_STORAGE = 'space-raider-muted';

function render(ctx: BaseAudioContext, v: Voice): AudioBuffer {
  const rate = ctx.sampleRate;
  const attack = v.attack ?? 0, sustain = v.sustain ?? 0, decay = v.decay ?? 0;
  const length = attack + sustain + decay;
  const buffer = ctx.createBuffer(1, Math.ceil(length * rate), rate);
  const out = buffer.getChannelData(0);
  const duty = v.duty ?? 0.5, volume = v.volume ?? 0.5, smooth = v.smooth ?? 1;
  let phase = 0, noise = Math.random() * 2 - 1, filtered = 0;
  // A loop is rendered twice and the second pass kept, so the filter has settled and the seam doesn't click.
  for (let i = v.loop ? -out.length : 0; i < out.length; i++) {
    const t = i / rate;
    let f = v.freq * 2 ** ((v.slide ?? 0) * t);
    if (v.steps) f *= 2 ** (v.steps[Math.min(v.steps.length - 1, Math.floor((t / length) * v.steps.length))] / 12);
    if (v.vibrato) f *= 1 + Math.sin(2 * Math.PI * v.vibrato[0] * t) * v.vibrato[1];
    phase += f / rate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      noise = Math.random() * 2 - 1; // noise holds one random level per cycle, so it can be pitched
    }
    let s: number;
    switch (v.wave) {
      case 'square': s = phase < duty ? 1 : -1; break;
      case 'saw': s = 2 * phase - 1; break;
      case 'triangle': s = 1 - 4 * Math.abs(phase - 0.5); break;
      case 'sine': s = Math.sin(2 * Math.PI * phase); break;
      case 'noise': s = noise; break;
    }
    filtered += (s - filtered) * smooth;
    let env = 1;
    if (!v.loop) {
      if (t < attack) env = t / attack;
      else if (t > attack + sustain) env = (1 - (t - attack - sustain) / decay) ** 2;
    }
    if (i >= 0) out[i] = filtered * env * volume;
  }
  return buffer;
}

let ctx: AudioContext | undefined;
let master: GainNode | undefined;
const buffers = new Map<SoundName, AudioBuffer>();
let muted = false;
let played = 0;
let started = false;

/**
 * Gets sound ready: reads the mute setting, then makes the audio context and builds every sound on the first key press,
 * click or tap (browsers only let a page start audio after one). Never in attract mode, which makes no sound.
 */
export function initAudio() {
  if (ATTRACT || started) return;
  started = true;
  try {
    muted = localStorage.getItem(MUTE_STORAGE) === '1';
  } catch {
    // Storage blocked: sound stays on.
  }
  const unlock = () => {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      for (const [name, voice] of Object.entries(SOUNDS) as Array<[SoundName, Voice]>) buffers.set(name, render(ctx, voice));
    }
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('pointerdown', unlock, true);
}
/** Plays a sound once. `detune` is in cents. Does nothing until the first key press or tap, or while muted. */
export function playSound(name: SoundName, o: { detune?: number } = {}) {
  const buffer = buffers.get(name);
  if (!ctx || !master || !buffer) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.detune.value = o.detune ?? 0;
  src.connect(master);
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
      const buffer = buffers.get(name);
      if (src || !ctx || !master || !buffer) return;
      src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.detune.value = detune;
      src.connect(master);
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
/** Sounds started since the page loaded (the attract test checks there are none). */
export const soundsPlayed = () => played;

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 1;
  try {
    localStorage.setItem(MUTE_STORAGE, muted ? '1' : '0');
  } catch {
    // Storage blocked: the setting lasts for this visit only.
  }
}
