/**
 * The mixer: master → speakers, with separate sound-effect and music levels, plus a shared reverb and a short echo
 * that sounds can send a little of themselves to. Made on the first key press or tap (browsers only allow audio after
 * one).
 */
export interface Bus {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  /** Inputs of the reverb and the echo: connect a send gain to them. */
  reverb: AudioNode;
  echo: AudioNode;
}

let bus: Bus | undefined;

export const getBus = () => bus;

/** A room-sized reverb from decaying noise: no sample files needed. */
function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

export function makeBus(): Bus {
  if (bus) return bus;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  // A gentle limiter so stacked explosions don't clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  master.connect(limiter).connect(ctx.destination);

  // Sound effects stack up (three explosions at once), so they sit lower than the music's peaks would suggest.
  const sfx = ctx.createGain();
  sfx.gain.value = 0.6;
  const music = ctx.createGain();
  sfx.connect(master);
  music.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 1.8, 3);
  const reverbOut = ctx.createGain();
  reverbOut.gain.value = 0.55;
  reverb.connect(reverbOut).connect(master);

  // Echo: a delay feeding back through a low-pass, so each repeat is duller.
  const echo = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.21;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.5;
  echo.connect(delay);
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(echoOut).connect(master);

  bus = { ctx, master, sfx, music, reverb, echo };
  return bus;
}

/** Sends `amount` (0..1) of `node` to the reverb and/or the echo. */
export function send(node: AudioNode, reverb = 0, echo = 0) {
  if (!bus) return;
  for (const [amount, to] of [[reverb, bus.reverb], [echo, bus.echo]] as const) {
    if (amount <= 0) continue;
    const g = bus.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(to);
  }
}
