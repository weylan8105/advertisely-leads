"use client";

/**
 * "Cha-ching" for live deal alerts, synthesised with Web Audio (no audio
 * file). Browsers only allow sound after the user has interacted with the
 * page, so `unlockDealSound` resumes the context on the first click/keypress;
 * until then `playChaChing` is a silent no-op.
 */

const MUTE_KEY = "adv:deal-sound-muted";
const VOLUME = 0.6;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  return ctx;
}

export function isDealSoundMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDealSoundMuted(muted: boolean) {
  try {
    if (muted) window.localStorage.setItem(MUTE_KEY, "1");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    /* storage blocked — mute lasts for this page only */
  }
}

/** Resume the audio context from inside a user gesture so later alerts can play. */
export function unlockDealSound() {
  const c = audio();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

function env(g: GainNode, t: number, peak: number, att: number, dur: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function tone(c: AudioContext, f: number, t: number, dur: number, peak: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(f, t);
  env(g, t, peak, 0.002, dur);
  o.connect(g);
  g.connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function bell(c: AudioContext, f: number, t: number, dur: number, peak: number) {
  for (const [mult, amp, decay] of [
    [1, 1, 1],
    [2, 0.45, 0.6],
    [2.76, 0.3, 0.45],
    [5.4, 0.12, 0.25],
  ]) {
    tone(c, f * mult, t, dur * decay, peak * amp);
  }
}

function noise(c: AudioContext, t: number, dur: number, freq: number, peak: number) {
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = c.createGain();
  env(g, t, peak, 0.002, dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master!);
  src.start(t);
}

export function playChaChing() {
  if (isDealSoundMuted()) return;
  const c = audio();
  if (!c || c.state !== "running") return;
  try {
    const t = c.currentTime + 0.02;
    noise(c, t, 0.06, 2500, 0.5);
    noise(c, t + 0.07, 0.05, 4000, 0.35);
    bell(c, 2093, t + 0.12, 0.9, 0.22);
    bell(c, 2637, t + 0.2, 1.1, 0.22);
  } catch {
    /* audio unavailable — the alert still shows */
  }
}
