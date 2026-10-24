/**
 * Yamaha PSR-SX920 專注創作台 (V2)
 * 輕量純 Web Audio 類比低音合成器 (Bass Synth)
 * 支援多款貝斯物理模型：電貝斯 (Finger / Pick)、原聲低音大提琴 (Acoustic Upright)、
 * 擊弦貝斯 (Slap) 與合成重低音 (Sub Bass / Synth Bass)
 */

export class BassSynth {
  private static muted: boolean = false;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentCategory: string = 'Electric';
  private currentVoiceId: string = 'finger-bass';

  public static setMuted(muted: boolean) {
    BassSynth.muted = muted;
  }

  public static isMuted(): boolean {
    return BassSynth.muted;
  }

  public setMuted(muted: boolean) {
    BassSynth.muted = muted;
  }

  constructor() {
    // 延遲至首次點擊時初始化 AudioContext
  }

  public setVoice(voice: { category?: string; id?: string; name?: string }) {
    if (voice.category) {
      this.currentCategory = voice.category;
    }
    if (voice.id) {
      this.currentVoiceId = voice.id;
    }
  }

  private initAudio() {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private midiToFreq(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  public playNote(note: number, velocity: number = 100, durationMs: number = 240) {
    if (BassSynth.muted) return;
    this.initAudio();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const freq = this.midiToFreq(note);
    const velRatio = Math.max(0.2, Math.min(1.0, velocity / 127));
    const durSec = Math.max(0.08, durationMs / 1000);

    const isAcoustic = this.currentCategory === 'Acoustic' || this.currentVoiceId.includes('acoustic');
    const isSynth = this.currentCategory === 'Synth' || this.currentVoiceId.includes('sub') || this.currentVoiceId.includes('synth');
    const isSlap = this.currentVoiceId.includes('slap');
    const isPick = this.currentVoiceId.includes('pick');

    if (isAcoustic) {
      // 原聲大提琴貝斯：三角波 + 正弦次重低音，溫暖木箱箱體共鳴 (180Hz)
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, now);

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(1800, freq * 3.5), now);

      const ampGain = this.ctx.createGain();
      ampGain.gain.setValueAtTime(0.0001, now);
      ampGain.gain.linearRampToValueAtTime(velRatio * 0.95, now + 0.012);
      ampGain.gain.exponentialRampToValueAtTime(velRatio * 0.45, now + 0.18);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec + 0.04);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(ampGain);
      ampGain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durSec + 0.08);
      osc2.stop(now + durSec + 0.08);

      setTimeout(() => {
        try {
          osc1.disconnect();
          osc2.disconnect();
          filter.disconnect();
          ampGain.disconnect();
        } catch (_) {}
      }, (durSec + 0.1) * 1000);

    } else if (isSynth) {
      // 合成貝斯：Sub Bass 808 或是 Moog 鋸齒諧振貝斯
      const osc = this.ctx.createOscillator();
      osc.type = this.currentVoiceId.includes('808') ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(freq, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(5.0, now);
      filter.frequency.setValueAtTime(freq * 8 * velRatio, now);
      filter.frequency.exponentialRampToValueAtTime(freq * 2, now + 0.15);

      const ampGain = this.ctx.createGain();
      ampGain.gain.setValueAtTime(0.0001, now);
      ampGain.gain.linearRampToValueAtTime(velRatio * 1.0, now + 0.005);
      ampGain.gain.exponentialRampToValueAtTime(velRatio * 0.5, now + 0.2);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

      osc.connect(filter);
      filter.connect(ampGain);
      ampGain.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + durSec + 0.05);

      setTimeout(() => {
        try {
          osc.disconnect();
          filter.disconnect();
          ampGain.disconnect();
        } catch (_) {}
      }, (durSec + 0.08) * 1000);

    } else {
      // 標準電貝斯 (Finger Bass / Pick Bass / Slap Bass)
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(freq, now);

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(isSlap ? 5.5 : isPick ? 4.5 : 3.8, now);

      const cutoffMultiplier = isSlap ? 12 : isPick ? 9 : 7;
      const filterCutoffStart = Math.min(5000, freq * cutoffMultiplier * velRatio);
      const filterCutoffSustain = Math.min(1400, freq * 2.5);
      filter.frequency.setValueAtTime(filterCutoffStart, now);
      filter.frequency.exponentialRampToValueAtTime(filterCutoffSustain, now + (isSlap ? 0.08 : 0.12));

      const ampGain = this.ctx.createGain();
      ampGain.gain.setValueAtTime(0.0001, now);
      ampGain.gain.linearRampToValueAtTime(velRatio * (isSlap ? 1.05 : 0.9), now + 0.005);
      ampGain.gain.exponentialRampToValueAtTime(velRatio * 0.5, now + 0.15);
      ampGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(ampGain);
      ampGain.connect(this.masterGain);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durSec + 0.05);
      osc2.stop(now + durSec + 0.05);

      setTimeout(() => {
        try {
          osc1.disconnect();
          osc2.disconnect();
          filter.disconnect();
          ampGain.disconnect();
        } catch (_) {}
      }, (durSec + 0.08) * 1000);
    }
  }
}

export const bassSynth = new BassSynth();
