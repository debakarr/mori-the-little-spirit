const AUDIO_URL = `${import.meta.env.BASE_URL}audio/`;
const MUSIC_LEVEL = 0.9; // music loop gain at full music volume
// CC0 loops from OpenGameArt, prepared by tools/blender/prepare_audio.py
const LOOPS = {
  music: 'music_forest.mp3', // "Forest Ambience" by TinyWorlds
  birds: 'ambience_birds.mp3', // "Birds and Wind - Ambient" by Spring Spring
  water: 'stream_water.mp3', // "Sea and river wave sounds" (Vistula) by RandomMind
};

/**
 * Ambience with Web Audio: a calm music loop, a birds-and-wind bed and a water loop that swells
 * near the stream, plus small synthesized effects (paw steps, jump whoosh, chimes).
 * Files start downloading right away; playback starts on the first user gesture. M toggles mute.
 */
export class Ambience {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = { master: 0.9, music: 0.6 };
    this.ducked = false;
    this.files = Object.fromEntries(Object.entries(LOOPS).map(([k, f]) => [k, fetch(AUDIO_URL + f).then((r) => r.arrayBuffer())]));
  }

  start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.gain.linearRampToValueAtTime(this.targetGain(), ctx.currentTime + 4);
    this.master.connect(ctx.destination);
    this.noise = this.makeNoise(4);
    this.gains = {};
    const level = { music: MUSIC_LEVEL * this.volume.music, birds: 0.35, water: 0 };
    for (const [k, file] of Object.entries(this.files)) {
      const g = (this.gains[k] = ctx.createGain());
      g.gain.value = level[k];
      g.connect(this.master);
      file.then((data) => ctx.decodeAudioData(data)).then((buf) => this.loop(buf, g)).catch(() => {});
    }
  }

  /** Loop a decoded buffer, skipping the encoder's silent padding at either end so it doesn't click. */
  loop(buffer, out) {
    const d = buffer.getChannelData(0);
    let a = 0, b = d.length - 1;
    while (a < b && Math.abs(d[a]) < 1e-4) a++;
    while (b > a && Math.abs(d[b]) < 1e-4) b--;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = a / buffer.sampleRate;
    src.loopEnd = (b + 1) / buffer.sampleRate;
    src.connect(out);
    src.start(0, src.loopStart);
  }

  makeNoise(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = (Math.random() * 2 - 1) * 0.6 + b * 2.5;
    }
    return buf;
  }

  toggleMute() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    this.applyGain();
  }

  targetGain() {
    return this.muted ? 0 : this.volume.master * (this.ducked ? 0.45 : 1);
  }

  applyGain() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.2);
    this.gains.music.gain.setTargetAtTime(MUSIC_LEVEL * this.volume.music, this.ctx.currentTime, 0.2);
  }

  /** Settings: master and music volume, 0..1. */
  setVolume({ master, music }) {
    this.volume = { master, music };
    this.applyGain();
  }

  /** Quieter while the pause menu is open. */
  duck(on) {
    this.ducked = on;
    this.applyGain();
  }

  /** streamDist in metres from the listener; t in seconds. */
  update(dt, t, streamDist) {
    if (!this.ctx) return;
    this.gains.water.gain.setTargetAtTime(0.4 * Math.max(0, 1 - streamDist / 12) ** 1.5, this.ctx.currentTime, 0.4);
  }

  step(wet = false, run = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = wet ? 'bandpass' : 'lowpass';
    f.frequency.value = wet ? 1400 : 380 + Math.random() * 120;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((wet ? 0.05 : 0.035) * (1 + run * 0.5), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (wet ? 0.18 : 0.08));
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 3, 0.2);
  }

  whoosh(up = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 320 : 180, t);
    o.frequency.exponentialRampToValueAtTime(up ? 620 : 90, t + 0.18);
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  chime(root = 660) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [1, 1.5, 2, 2.52].forEach((m, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      o.type = 'sine';
      o.frequency.value = root * m;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 2.3);
    });
  }
}
