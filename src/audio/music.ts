import { getBus, send } from './bus';

/**
 * Chiptune music, composed in code and played by a small tracker. A timer wakes every 25 ms and schedules the notes
 * due in the next 120 ms on the audio clock, so timing stays tight whatever the frame rate does.
 *
 * In a raid the music follows the game, changing only on a bar line: the calm layer (pad and bass) always plays;
 * hostiles in the room bring in the combat layer (drums, driving bass and an arpeggio); a nearly full hold adds
 * running hats. Every vault moves the key.
 */

type Song = 'title' | 'game';
export interface Mood {
  combat: boolean;
  heavy: boolean;
}

/** A bar's chord: root in semitones above the key, and whether it's minor. */
type Chord = [number, boolean];

/** Tweak freely. Steps are 16ths; a bar is 16 steps. */
export const MUSIC = {
  title: { bpm: 92, chords: [[0, true], [7, true], [8, false], [10, false]] as Chord[] },
  game: { bpm: 126, chords: [[0, true], [8, false], [3, false], [10, false]] as Chord[] },
  /** The key's root note (MIDI: 45 is the A two octaves below middle A), and how each vault shifts it. */
  root: 45,
  keyByVault: [0, 3, -2, 5, 2],
  /** Bass, in semitones above the chord root, one per 8th note. */
  bass: [0, 0, 12, 0, 7, 0, 12, 0],
  /** Arpeggio: indexes into the chord's notes (0 root, 1 third, 2 fifth, 3 octave), one per 16th. */
  arp: [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 3, 2, 1, 2, 3, 2],
  kick: [0, 8, 10],
  snare: [4, 12],
  volume: { bass: 0.13, pad: 0.035, arp: 0.045, kick: 0.5, snare: 0.18, hat: 0.05 },
};

const LOOKAHEAD = 0.12;
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

let song: Song | undefined;
let key = 0;
let mood: Mood = { combat: false, heavy: false };
/** The mood the current bar was scheduled with: changes wait for the next bar. */
let barMood: Mood = mood;
let step = 0;
let nextAt = 0;
let timer: number | undefined;
let pulse: PeriodicWave | undefined;
let noise: AudioBuffer | undefined;
let duckUntil = 0;

/** A square wave with a 25% duty, the classic chiptune lead. Web Audio's own square is fixed at 50%. */
function pulseWave(ctx: AudioContext) {
  const n = 32, real = new Float32Array(n), imag = new Float32Array(n), d = 0.25;
  for (let i = 1; i < n; i++) {
    real[i] = (2 / (i * Math.PI)) * Math.sin(2 * Math.PI * i * d);
    imag[i] = (2 / (i * Math.PI)) * (1 - Math.cos(2 * Math.PI * i * d));
  }
  return ctx.createPeriodicWave(real, imag);
}

function noiseBuffer(ctx: AudioContext) {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** One note: an oscillator through an optional low-pass, with a quick attack and a release, into the music bus. */
function note(t: number, freq: number, dur: number, o: { wave: OscillatorType | 'pulse'; vol: number; attack?: number; release?: number; cutoff?: number; detune?: number; reverb?: number; echo?: number }) {
  const bus = getBus()!;
  const ctx = bus.ctx;
  const osc = ctx.createOscillator();
  if (o.wave === 'pulse') osc.setPeriodicWave((pulse ??= pulseWave(ctx)));
  else osc.type = o.wave;
  osc.frequency.value = freq;
  osc.detune.value = o.detune ?? 0;
  const g = ctx.createGain();
  const attack = o.attack ?? 0.005, release = o.release ?? 0.05;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.vol, t + attack);
  g.gain.setValueAtTime(o.vol, t + Math.max(attack, dur));
  g.gain.linearRampToValueAtTime(0, t + Math.max(attack, dur) + release);
  let out: AudioNode = osc;
  if (o.cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff;
    out = osc.connect(f);
  }
  out.connect(g).connect(bus.music);
  send(g, o.reverb, o.echo);
  osc.start(t);
  osc.stop(t + Math.max(attack, dur) + release + 0.02);
}

/** Drums from shared noise, and a kick from a falling sine. */
function drum(t: number, kind: 'kick' | 'snare' | 'hat', vol: number) {
  const bus = getBus()!;
  const ctx = bus.ctx;
  const g = ctx.createGain();
  g.connect(bus.music);
  if (kind === 'kick') {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.3);
    return;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise ??= noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = kind === 'hat' ? 'highpass' : 'bandpass';
  f.frequency.value = kind === 'hat' ? 7000 : 1800;
  const len = kind === 'hat' ? 0.04 : 0.16;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(f).connect(g);
  if (kind === 'snare') send(g, 0.25);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.01);
}

/** Schedules everything on one 16th-note step. */
function play(t: number, s: number, stepLen: number) {
  const tune = MUSIC[song!];
  const v = MUSIC.volume;
  const bar = Math.floor(s / 16) % tune.chords.length, at = s % 16;
  if (at === 0) barMood = mood;
  const [chordRoot, minor] = tune.chords[bar];
  const root = MUSIC.root + key + chordRoot;
  const tones = [0, minor ? 3 : 4, 7, 12];
  const title = song === 'title';
  const { combat, heavy } = title ? { combat: false, heavy: false } : barMood;

  // Pad: the chord, held for the bar.
  if (at === 0) {
    for (const n of tones.slice(0, 3)) {
      for (const detune of [-7, 7]) note(t, midi(root + 12 + n), stepLen * 15, { wave: 'sawtooth', vol: v.pad, attack: 0.25, release: 0.5, cutoff: title ? 900 : 1300, detune, reverb: 0.5 });
    }
  }
  // Bass: quarter notes when calm, driving 8ths in a fight.
  if (at % 2 === 0 && (combat || at % 4 === 0)) {
    note(t, midi(root + MUSIC.bass[at / 2]), stepLen * (combat ? 1.6 : 3.4), { wave: 'pulse', vol: v.bass, release: 0.04, cutoff: combat ? 1100 : 700 });
  }
  // Arpeggio: 16ths in a fight, a slow 8th-note version on the title screen.
  if (combat || (title && at % 2 === 0)) {
    note(t, midi(root + 24 + tones[MUSIC.arp[at]]), stepLen * 0.7, { wave: 'pulse', vol: v.arp, release: 0.03, cutoff: 3500, echo: 0.35 });
  }
  if (combat) {
    if (MUSIC.kick.includes(at)) drum(t, 'kick', v.kick);
    if (MUSIC.snare.includes(at)) drum(t, 'snare', v.snare);
    if (heavy || at % 4 === 2) drum(t, 'hat', at % 2 ? v.hat * 0.6 : v.hat);
  }
}

function tick() {
  const bus = getBus();
  if (!bus || !song) return;
  const ctx = bus.ctx;
  const stepLen = 60 / MUSIC[song].bpm / 4;
  // After a stall (a background tab), pick up from now instead of rushing to catch up.
  if (nextAt < ctx.currentTime - 0.25) nextAt = ctx.currentTime + 0.05;
  while (nextAt < ctx.currentTime + LOOKAHEAD) {
    if (step === 0) startedAt = nextAt;
    play(nextAt, step, stepLen);
    nextAt += stepLen;
    step++;
  }
  const ducked = ctx.currentTime < duckUntil;
  bus.music.gain.setTargetAtTime(!enabled ? 0 : paused ? 0.3 : ducked ? 0.25 : 1, ctx.currentTime, 0.08);
}

let paused = false;
let enabled = true;

/** Music on or off (sound effects carry on either way). */
export function enableMusic(on: boolean) {
  enabled = on;
}

/** Starts a song from its first bar (or keeps it going if it's already playing). `vault` sets the key. */
export function playMusic(which: Song, vault = 1) {
  key = MUSIC.keyByVault[(vault - 1) % MUSIC.keyByVault.length];
  paused = false;
  if (song === which) return;
  song = which;
  step = 0;
  nextAt = 0;
  mood = barMood = { combat: false, heavy: false };
  timer ??= window.setInterval(tick, 25);
}

export function stopMusic() {
  song = undefined;
  const bus = getBus();
  if (bus) bus.music.gain.setTargetAtTime(0, bus.ctx.currentTime, 0.3);
}

/** What the room is like now; the music follows from the next bar. */
export function setMood(m: Mood) {
  mood = m;
}

/** Quieter while paused. */
export function pauseMusic(on: boolean) {
  paused = on;
}

/** What's playing, for the tests: the song, steps played, the mood of the current bar, and when it started. */
export const musicState = () => ({ song, step, barMood, enabled, paused, startedAt, now: getBus()?.ctx.currentTime ?? 0, bpm: song ? MUSIC[song].bpm : 0 });
let startedAt = 0;

/** Dips the music for a jingle. */
export function duckMusic(ms: number) {
  const bus = getBus();
  if (bus) duckUntil = bus.ctx.currentTime + ms / 1000;
}
