const MUTE_KEY = 'codetown.muted';

/** Tiny synthesized speech babble and UI sounds. */
export class Voice {
  private ctx?: AudioContext;
  private master?: GainNode;
  muted = localStorage.getItem(MUTE_KEY) === '1';

  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    return this.muted;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slide = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** One syllable of babble for a typed character. */
  blip(ch: string, pitch: number) {
    if (!/[a-z0-9áéíóúñ]/i.test(ch)) return;
    const code = ch.toLowerCase().charCodeAt(0);
    const vowel = 'aeiou'.includes(ch.toLowerCase());
    const base = 260 * pitch;
    const freq = base * (1 + ((code * 7) % 11) / 22) * (vowel ? 1.12 : 1);
    this.tone(freq, 0.055, 'triangle', 0.09, 0, vowel ? 1.08 : 0.94);
  }

  pop() {
    this.tone(520, 0.08, 'sine', 0.12, 0, 1.6);
  }

  close() {
    this.tone(660, 0.1, 'sine', 0.1, 0, 0.6);
  }

  chime() {
    this.tone(880, 0.22, 'sine', 0.1);
    this.tone(1320, 0.3, 'sine', 0.08, 0.12);
  }

  splash() {
    this.tone(180, 0.25, 'triangle', 0.1, 0, 0.5);
    this.tone(420, 0.18, 'sine', 0.06, 0.05, 0.7);
  }

  bite() {
    this.tone(700, 0.08, 'square', 0.07);
    this.tone(980, 0.12, 'square', 0.07, 0.09);
  }

  dig() {
    for (let i = 0; i < 3; i++) this.tone(140 + i * 20, 0.09, 'triangle', 0.09, i * 0.35, 0.6);
  }

  fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.08, i * 0.1));
  }

  poof() {
    this.tone(300, 0.12, 'triangle', 0.08, 0, 2.2);
  }

  vroom() {
    this.tone(80, 0.45, 'sawtooth', 0.05, 0, 2.6);
  }

  bump() {
    this.tone(110, 0.14, 'square', 0.06, 0, 0.6);
  }

  /** Race countdown: low beeps, then a high one for GO. */
  beep(go = false) {
    this.tone(go ? 880 : 440, go ? 0.4 : 0.16, 'square', 0.06);
  }
}
