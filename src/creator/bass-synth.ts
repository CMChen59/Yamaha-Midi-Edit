/**
 * Yamaha PSR-SX920 專注創作台 (V2)
 * 輕量純 Web Audio 類比低音合成器 (Bass Synth)
 * 專為電貝斯 (Finger Bass / Slap Bass) 與合成貝斯設計
 * 雙振盪器 (鋸齒波 + 正弦次重低音) + 24dB 諧振低通濾波器與快速包絡
 */

export class BassSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  constructor() {
    // 延遲至首次點擊時初始化 AudioContext
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

  /**
   * 將 MIDI 音符轉為赫茲 (Hz)
   * MIDI 69 = A4 = 440Hz
   */
  private midiToFreq(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  /**
   * 播放貝斯單音
   * @param note MIDI 音高 (例如 36 = C1, 48 = C2)
   * @param velocity 力度 (0 ~ 127)
   * @param durationMs 持續長度 (毫秒)
   */
  public playNote(note: number, velocity: number = 100, durationMs: number = 240) {
    this.initAudio();
    if (!this.ctx || !this.masterGain) return;

    const now = this.ctx.currentTime;
    const freq = this.midiToFreq(note);
    const velRatio = Math.max(0.2, Math.min(1.0, velocity / 127));
    const durSec = Math.max(0.08, durationMs / 1000);

    // 主振盪器 1: 鋸齒波 (提供溫暖豐富的泛音)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, now);

    // 次重低音振盪器 2: 正弦波 (提供厚實扎實的低音敲擊感)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq, now);

    // 24dB 低通濾波器 (Moog / Roland 電貝斯風格，帶 Resonance)
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(4.0, now);

    // 濾波器包絡線：起始瞬間打開到較高頻，隨後迅速衰減至低頻沉穩處
    const filterCutoffStart = Math.min(4000, freq * 8 * velRatio);
    const filterCutoffSustain = Math.min(1200, freq * 2.5);
    filter.frequency.setValueAtTime(filterCutoffStart, now);
    filter.frequency.exponentialRampToValueAtTime(filterCutoffSustain, now + 0.12);

    // 音量包絡線 (ADSR)
    const ampGain = this.ctx.createGain();
    ampGain.gain.setValueAtTime(0.0001, now);
    // 快速 Attack (4ms) 消除爆音並保有打弦顆粒感
    ampGain.gain.linearRampToValueAtTime(velRatio * 0.9, now + 0.006);
    // 自然 Decay 衰減至 Sustain 音量
    ampGain.gain.exponentialRampToValueAtTime(velRatio * 0.5, now + 0.15);
    // 尾部釋音 Release
    ampGain.gain.setValueAtTime(velRatio * 0.5, now + durSec - 0.03);
    ampGain.gain.exponentialRampToValueAtTime(0.0001, now + durSec);

    // 訊號鏈路連接: Osc -> Filter -> AmpGain -> MasterGain
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(ampGain);
    ampGain.connect(this.masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + durSec + 0.05);
    osc2.stop(now + durSec + 0.05);
  }
}

export const bassSynth = new BassSynth();
