type Wave = 'square' | 'saw' | 'triangle' | 'sine' | 'noise';

/**
 * One retro voice, sfxr style. Times are in seconds. `slide` bends the pitch in octaves per second;
 * `steps` are semitone jumps spread evenly across the sound (arpeggios, jingles); `vibrato` is [hz, depth 0..1];
 * `duty` is the square wave's pulse width; `smooth` (0..1) low-passes the result, lower is duller;
 * `filter` sweeps a low-pass from one cutoff (Hz) to another across the sound; `drive` soft-clips it for punch;
 * `layers` are more voices mixed in (a boom is a noise burst plus a low thump);
 * `volume` is the peak level. A `loop` sound has no envelope and should hold whole cycles so it loops cleanly.
 * At play time, `jitter` detunes each play by up to that many cents, and `reverb` / `echo` send some of it to the
 * shared effects.
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
  filter?: [number, number];
  drive?: number;
  layers?: Voice[];
  volume?: number;
  loop?: boolean;
  jitter?: number;
  reverb?: number;
  echo?: number;
}

const length = (v: Voice) => (v.attack ?? 0) + (v.sustain ?? 0) + (v.decay ?? 0);

/** Fills `out` with one voice (no layers), adding to what's there. */
function voice(rate: number, v: Voice, out: Float32Array, loop: boolean) {
  const attack = v.attack ?? 0, sustain = v.sustain ?? 0, decay = v.decay ?? 0;
  const total = length(v);
  const n = Math.min(out.length, Math.ceil(total * rate));
  const duty = v.duty ?? 0.5, volume = v.volume ?? 0.5, smooth = v.smooth ?? 1;
  let phase = 0, noise = Math.random() * 2 - 1, filtered = 0, lowpassed = 0;
  // A loop is rendered twice and the second pass kept, so the filters have settled and the seam doesn't click.
  for (let i = loop ? -n : 0; i < n; i++) {
    const t = (i < 0 ? i + n : i) / rate;
    let f = v.freq * 2 ** ((v.slide ?? 0) * t);
    if (v.steps) f *= 2 ** (v.steps[Math.min(v.steps.length - 1, Math.floor((t / total) * v.steps.length))] / 12);
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
    let x = filtered;
    if (v.filter) {
      const cutoff = v.filter[0] * (v.filter[1] / v.filter[0]) ** (t / total);
      lowpassed += (x - lowpassed) * (1 - Math.exp((-2 * Math.PI * cutoff) / rate));
      x = lowpassed;
    }
    let env = 1;
    if (!loop) {
      if (t < attack) env = t / attack;
      else if (t > attack + sustain) env = Math.max(0, 1 - (t - attack - sustain) / decay) ** 2;
    }
    if (i >= 0) out[i] += x * env * volume;
  }
}

/** Renders a voice and its layers into a buffer. */
export function render(ctx: BaseAudioContext, v: Voice): AudioBuffer {
  const rate = ctx.sampleRate;
  const all = [v, ...(v.layers ?? [])];
  const buffer = ctx.createBuffer(1, Math.ceil(Math.max(...all.map(length)) * rate), rate);
  const out = buffer.getChannelData(0);
  for (const part of all) voice(rate, part, out, !!v.loop);
  if (v.drive) {
    const k = Math.tanh(v.drive);
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * v.drive) / k;
  }
  return buffer;
}
