/**
 * Yamaha PSR-SX920 Style & Pad Web Audio Audition Engine
 * 提供瀏覽器端即時發聲、多軌合成器、音符排程與走帶監聽
 */

import { midiManager } from './midi-manager';

export interface NoteEvent {
  note: number;
  velocity: number;
  startTick: number;
  durationTick: number;
}

export interface ChannelAudioParams {
  volume?: number;       // 0 ~ 127 (CC 7)
  pan?: number;          // 0 ~ 127, 64 is center (CC 10)
  reverb?: number;       // 0 ~ 127 (CC 91)
  instrumentId?: string; // 預設樂器 ID (例如 'grand-piano', 'strings', 'pizzicato')
  msb?: number;          // Bank MSB (CC 0)
  lsb?: number;          // Bank LSB (CC 32)
  pc?: number;           // Program Change 0 ~ 127
  channel?: number;      // MIDI 通道 0 ~ 15
  isDrum?: boolean;      // 是否為打擊樂軌道 (Channel 10)
}

export interface PlaybackOptions {
  bpm: number;           // 每分鐘拍數 (預設 120)
  division: number;      // PPQ (預設 96)
  beatsPerBar?: number;  // 每小節拍數 (預設 4)
  loop: boolean;         // 是否循環播放 (對應 Yamaha Repeat 屬性)
  gridStartTick: number; // 小節起點基準 Tick
  totalTicks: number;    // 總播放長度 (小節數 * 每小節 Tick 數)
  channelParams?: ChannelAudioParams;
  onProgress?: (state: PlaybackState) => void;
  onEnded?: () => void;
}

export interface PlaybackState {
  currentTick: number;
  relTick: number;
  currentBar: number;
  currentBeat: number;
  progress: number;      // 0.0 ~ 1.0
  activeNoteNumbers: number[];
}

/**
 * 將 MIDI 音符編號轉換為頻率 (Hz)
 * A4 (69) = 440 Hz
 */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/**
 * 計算 Tick 與秒數的互相換算
 */
export function ticksToSeconds(ticks: number, bpm: number, division: number): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return (ticks / Math.max(1, division)) * secondsPerBeat;
}

export function secondsToTicks(seconds: number, bpm: number, division: number): number {
  const secondsPerBeat = 60 / Math.max(1, bpm);
  return (seconds / secondsPerBeat) * division;
}

/**
 * 簡易脈衝殘響 (Impulse Response) 緩衝區生成
 */
function createReverbBuffer(ctx: AudioContext, duration: number = 1.2, decay: number = 2.0): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let c = 0; c < 2; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const n = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      channelData[i] = n;
    }
  }
  return buffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private convolver: ConvolverNode | null = null;
  private isInitialized = false;

  // 播放走帶狀態
  private isCurrentlyPlaying = false;
  private currentPadNum: number | null = null;
  private animFrameId: number | null = null;
  private playbackStartTime: number = 0;
  private playbackOptions: PlaybackOptions | null = null;
  private scheduledNotes: NoteEvent[] = [];
  private activeVoices: Array<{ stop: (time: number) => void }> = [];

  // 防聲音重疊與排程隔離機制
  private playbackSessionId = 0;
  private scheduledTimerIds: any[] = [];
  private currentPadGain: GainNode | null = null;
  private activeOscillators: Array<OscillatorNode | AudioBufferSourceNode> = [];

  private createOscillator(): OscillatorNode {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    const osc = this.ctx.createOscillator();
    this.activeOscillators.push(osc);
    return osc;
  }

  private createBufferSource(): AudioBufferSourceNode {
    if (!this.ctx) throw new Error('AudioContext not initialized');
    const src = this.ctx.createBufferSource();
    this.activeOscillators.push(src);
    return src;
  }

  constructor() {
    // 延遲在使用者第一次互動時初始化 Web Audio
  }

  public init() {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    if (typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    this.ctx = new AudioContextClass();
    
    // 主音量與動態壓縮器（防止破音）
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.85, this.ctx.currentTime);

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-18, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

    // 建立輕量立體聲空間混響
    try {
      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = createReverbBuffer(this.ctx, 1.2, 2.5);
    } catch {
      this.convolver = null;
    }

    // 混音主幹線連接
    if (this.convolver) {
      const reverbGain = this.ctx.createGain();
      reverbGain.gain.setValueAtTime(0.25, this.ctx.currentTime);
      this.convolver.connect(reverbGain);
      reverbGain.connect(this.compressor);
    }

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    this.isInitialized = true;
  }

  public getContext(): AudioContext | null {
    if (!this.ctx) this.init();
    return this.ctx;
  }

  public isPlaying(): boolean {
    return this.isCurrentlyPlaying;
  }

  public getPlayingPadNum(): number | null {
    return this.currentPadNum;
  }

  /**
   * 停止當前所有發聲與走帶
   */
  public stop() {
    // 1. 作廢當前播放 Session Token，使所有尚未執行的非同步計時器即刻失效
    this.playbackSessionId++;

    // 2. 清除所有掛載中的 JavaScript 延遲排程 (Note-On / Note-Off)
    for (const tid of this.scheduledTimerIds) {
      clearTimeout(tid);
    }
    this.scheduledTimerIds = [];

    // 3. 取消走帶動畫
    if (this.animFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // 4. Web Audio 節點深度清理與子匯流排切斷
    if (this.ctx) {
      const now = this.ctx.currentTime;

      // 4.1 立即切斷並淡出 Pad 子匯流排，徹底消音並斷開連接
      if (this.currentPadGain) {
        try {
          this.currentPadGain.gain.cancelScheduledValues(now);
          this.currentPadGain.gain.setValueAtTime(this.currentPadGain.gain.value, now);
          this.currentPadGain.gain.linearRampToValueAtTime(0, now + 0.01);
          const oldPadGain = this.currentPadGain;
          setTimeout(() => {
            try { oldPadGain.disconnect(); } catch {}
          }, 25);
        } catch {}
        this.currentPadGain = null;
      }

      // 4.2 停止並斷開所有記錄中的震盪器與音源緩衝
      for (const osc of this.activeOscillators) {
        try {
          (osc as any).stop(now);
        } catch {}
        try {
          osc.disconnect();
        } catch {}
      }
      this.activeOscillators = [];

      // 4.3 執行所有聲音通道的自定義 stop
      for (const voice of this.activeVoices) {
        try {
          voice.stop(now);
        } catch {}
      }
      this.activeVoices = [];
    }

    // 5. 若 Web MIDI 輸出啟用，對實體琴進行 Panic (熄滅正在發聲的音符 + 全通道斷音)
    midiManager.panicAllChannels();

    this.isCurrentlyPlaying = false;
    const oldPad = this.currentPadNum;
    this.currentPadNum = null;

    if (this.playbackOptions?.onEnded) {
      this.playbackOptions.onEnded();
    }
    this.playbackOptions = null;
    return oldPad;
  }

  /**
   * 試聽單一音符/音色 (例如在音色庫彈奏預聽)
   */
  public playAuditionNote(note: number = 60, durationSec: number = 0.6, params: ChannelAudioParams = {}) {
    this.init();
    const ch = params.channel ?? ((this.currentPadNum ?? 1) - 1);
    const vel = params.volume ?? 100;

    // 1. 若 Web Audio 路由啟用，發動瀏覽器諧波合成
    if (midiManager.isAudioActive() && this.ctx) {
      const now = this.ctx.currentTime;
      this.triggerVoice(note, vel, now, durationSec, params);
    }

    // 2. 若 Web MIDI 路由啟用，向實體琴發送 Bank Select, PC, Volume, Note-On
    if (midiManager.isMidiActive()) {
      if (params.msb !== undefined || params.lsb !== undefined || params.pc !== undefined) {
        midiManager.sendVoiceChange(ch, {
          msb: params.msb ?? 0,
          lsb: params.lsb ?? 0,
          pc: params.pc ?? 0,
        });
      }
      if (params.volume !== undefined || params.pan !== undefined) {
        midiManager.sendMixerControllers(ch, { volume: params.volume, pan: params.pan });
      }

      midiManager.sendNoteOn(ch, note, vel);
      const onTimer = setTimeout(() => {
        midiManager.sendNoteOff(ch, note);
      }, durationSec * 1000);
      this.scheduledTimerIds.push(onTimer);
    }
  }

  /**
   * 播放指定音符序列
   */
  public playSequence(
    padNum: number,
    notes: NoteEvent[],
    options: PlaybackOptions
  ) {
    this.stop();
    this.init();

    if (!this.ctx || notes.length === 0) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const sessionId = ++this.playbackSessionId;
    this.isCurrentlyPlaying = true;
    this.currentPadNum = padNum;
    this.playbackOptions = options;
    this.scheduledNotes = notes;

    // 建立本次 Pad 專屬的子匯流排 (Pad Sub-bus Gain)，所有聲音走此節點匯入主混音
    if (this.masterGain && this.ctx) {
      this.currentPadGain = this.ctx.createGain();
      this.currentPadGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.currentPadGain.connect(this.masterGain);
    }

    const bpm = options.bpm || 120;
    const division = options.division || 96;
    const totalTicks = Math.max(options.totalTicks, 1);
    const loopDurationSec = ticksToSeconds(totalTicks, bpm, division);

    this.playbackStartTime = this.ctx.currentTime;

    // 若 Web MIDI 啟用，在序列開始前預先發送當前 Pad 的音色 (Bank/PC) 與混音 (CC7/CC10)
    if (midiManager.isMidiActive()) {
      const midiCh = options.channelParams?.channel ?? (padNum - 1);
      const params = options.channelParams || {};
      if (params.msb !== undefined || params.lsb !== undefined || params.pc !== undefined) {
        midiManager.sendVoiceChange(midiCh, {
          msb: params.msb ?? 0,
          lsb: params.lsb ?? 0,
          pc: params.pc ?? 0,
        });
      }
      midiManager.sendMixerControllers(midiCh, {
        volume: params.volume ?? 100,
        pan: params.pan ?? 64,
        reverb: params.reverb ?? 40,
      });
    }

    this.schedulePass(0, loopDurationSec, sessionId);

    // 啟動走帶動畫迴圈
    this.startAnimationLoop(sessionId);
  }

  /**
   * 排程一個循環週期的所有音符
   */
  private schedulePass(cycleIndex: number, loopDurationSec: number, sessionId: number) {
    if (!this.ctx || !this.playbackOptions || this.playbackSessionId !== sessionId || !this.isCurrentlyPlaying) return;

    const bpm = this.playbackOptions.bpm;
    const division = this.playbackOptions.division;
    const gridStartTick = this.playbackOptions.gridStartTick;
    const totalTicks = this.playbackOptions.totalTicks;
    const params = this.playbackOptions.channelParams || {};

    const passStartTime = this.playbackStartTime + cycleIndex * loopDurationSec;

    for (const n of this.scheduledNotes) {
      if (this.playbackSessionId !== sessionId || !this.isCurrentlyPlaying) return;

      const relTick = n.startTick - gridStartTick;
      if (relTick < 0 || relTick >= totalTicks) continue;

      const noteOffsetSec = ticksToSeconds(relTick, bpm, division);
      const noteDurSec = Math.max(ticksToSeconds(n.durationTick, bpm, division), 0.05);

      const noteStartTime = passStartTime + noteOffsetSec;
      const noteStopTime = noteStartTime + noteDurSec;

      // 若 Web Audio 路由開啟：觸發音符發聲
      if (midiManager.isAudioActive()) {
        this.triggerVoice(n.note, n.velocity, noteStartTime, noteDurSec, params);
      }

      // 若 Web MIDI 路由開啟：轉發至實體琴
      if (midiManager.isMidiActive()) {
        const midiCh = params.channel ?? ((this.currentPadNum ?? 1) - 1);
        const now = this.ctx.currentTime;
        const delayMs = Math.max(0, (noteStartTime - now) * 1000);
        const stopDelayMs = Math.max(0, (noteStopTime - now) * 1000);

        const onTimer = setTimeout(() => {
          if (this.playbackSessionId !== sessionId || !this.isCurrentlyPlaying) return;
          midiManager.sendNoteOn(midiCh, n.note, n.velocity);
        }, delayMs);
        this.scheduledTimerIds.push(onTimer);

        const offTimer = setTimeout(() => {
          if (this.playbackSessionId !== sessionId) return;
          midiManager.sendNoteOff(midiCh, n.note);
        }, stopDelayMs);
        this.scheduledTimerIds.push(offTimer);
      }
    }
  }

  /**
   * 合成單一音符聲響
   */
  private triggerVoice(
    note: number,
    velocity: number,
    startTime: number,
    durationSec: number,
    params: ChannelAudioParams
  ) {
    if (!this.ctx || !this.masterGain) return;

    const ctx = this.ctx;
    const vol = (params.volume ?? 100) / 127;
    const vel = velocity / 127;
    const gainFactor = vol * vel * 0.4;
    const inst = params.instrumentId || 'grand-piano';
    const isDrum = params.isDrum || (params.pc !== undefined && params.pc >= 120);

    // 建立軌道聲道架構 (Gain -> Panner -> Sub-bus / Master)
    const targetBus = this.currentPadGain || this.masterGain;
    const channelGain = ctx.createGain();
    channelGain.gain.setValueAtTime(gainFactor, startTime);

    const panVal = ((params.pan ?? 64) - 64) / 64;
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, panVal)), startTime);
      channelGain.connect(panner);
      panner.connect(targetBus);
      if (this.convolver && (params.reverb ?? 40) > 0) {
        const revSend = ctx.createGain();
        revSend.gain.setValueAtTime(((params.reverb ?? 40) / 127) * 0.5, startTime);
        panner.connect(revSend);
        revSend.connect(this.convolver);
      }
    } else {
      channelGain.connect(targetBus);
    }

    const freq = midiToFreq(note);
    if (isDrum) {
      this.synthesizeDrum(note, velocity, startTime, channelGain);
    } else if (inst.includes('strings') || inst.includes('kino')) {
      this.synthesizeStrings(freq, startTime, durationSec, channelGain);
    } else if (inst.includes('pizz')) {
      this.synthesizePizzicato(freq, startTime, durationSec, channelGain);
    } else if (inst.includes('guitar')) {
      this.synthesizeGuitar(freq, startTime, durationSec, channelGain);
    } else if (inst.includes('bass')) {
      this.synthesizeBass(freq, startTime, durationSec, channelGain);
    } else if (inst.includes('brass') || inst.includes('trumpet') || inst.includes('sax')) {
      this.synthesizeBrass(freq, startTime, durationSec, channelGain);
    } else if (inst.includes('flute')) {
      this.synthesizeFlute(freq, startTime, durationSec, channelGain);
    } else {
      // 鋼琴與鍵盤類 (Piano default)
      this.synthesizePiano(freq, startTime, durationSec, channelGain);
    }

    this.activeVoices.push({
      stop: (t: number) => {
        try {
          channelGain.gain.cancelScheduledValues(t);
          channelGain.gain.setValueAtTime(0, t);
          channelGain.disconnect();
        } catch {}
      }
    });
  }

  // --- 樂器聲音物理/諧波合成器 ---

  /** 鋼琴：雙諧波 (正弦基頻 + 三角泛音) 與指數衰減 */
  private synthesizePiano(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc1 = this.createOscillator();
    const osc2 = this.createOscillator();
    const env = this.ctx.createGain();

    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, start);

    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2, start);

    // 擊弦強烈 Attack，隨後自然指數 Decay
    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(1.0, start + 0.015);
    env.gain.exponentialRampToValueAtTime(0.6, start + 0.15);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.08);

    osc1.connect(env);
    osc2.connect(env);
    env.connect(target);

    osc1.start(start);
    osc2.start(start);
    osc1.stop(start + dur + 0.1);
    osc2.stop(start + dur + 0.1);
  }

  /** 弦樂：平滑 Attack、鋸齒波疊合低通濾波 */
  private synthesizeStrings(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc1 = this.createOscillator();
    const osc2 = this.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(freq, start);
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq * 1.003, start); // 微差失諧 (Detune) 創造豐厚感

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 4, 4500), start);

    // 弦樂柔和起音
    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(0.85, start + 0.08);
    env.gain.setValueAtTime(0.85, start + dur - 0.05);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.15);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(env);
    env.connect(target);

    osc1.start(start);
    osc2.start(start);
    osc1.stop(start + dur + 0.2);
    osc2.stop(start + dur + 0.2);
  }

  /** 撥弦 (Pizzicato)：極短 Pluck 擊發與快速休止 */
  private synthesizePizzicato(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc = this.createOscillator();
    const env = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    const pluckDur = Math.min(dur, 0.35);
    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(1.0, start + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, start + pluckDur);

    osc.connect(env);
    env.connect(target);

    osc.start(start);
    osc.stop(start + pluckDur + 0.02);
  }

  /** 吉他：撥弦三角波 + 微量亮部諧波 */
  private synthesizeGuitar(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc = this.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3.5, start);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, start + dur);

    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(0.9, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.3, start + 0.2);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.05);

    osc.connect(filter);
    filter.connect(env);
    env.connect(target);

    osc.start(start);
    osc.stop(start + dur + 0.08);
  }

  /** 貝斯：低頻 Sine/Triangle 重低音 */
  private synthesizeBass(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc = this.createOscillator();
    const env = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);

    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(1.0, start + 0.015);
    env.gain.exponentialRampToValueAtTime(0.5, start + 0.15);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.05);

    osc.connect(env);
    env.connect(target);

    osc.start(start);
    osc.stop(start + dur + 0.08);
  }

  /** 銅管/薩克斯風：方波與鋸齒諧波、動態開展濾波器 */
  private synthesizeBrass(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc = this.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, start);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 1.5, start);
    filter.frequency.linearRampToValueAtTime(freq * 4.5, start + 0.08);
    filter.frequency.setValueAtTime(freq * 3.5, start + dur);

    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(0.85, start + 0.04);
    env.gain.setValueAtTime(0.8, start + dur - 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.06);

    osc.connect(filter);
    filter.connect(env);
    env.connect(target);

    osc.start(start);
    osc.stop(start + dur + 0.1);
  }

  /** 長笛/木管：純淨正弦波 + 輕微呼吸氣音 */
  private synthesizeFlute(freq: number, start: number, dur: number, target: AudioNode) {
    if (!this.ctx) return;
    const osc = this.createOscillator();
    const env = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);

    env.gain.setValueAtTime(0.001, start);
    env.gain.linearRampToValueAtTime(0.75, start + 0.06);
    env.gain.setValueAtTime(0.75, start + dur - 0.03);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur + 0.08);

    osc.connect(env);
    env.connect(target);

    osc.start(start);
    osc.stop(start + dur + 0.1);
  }

  /** 打擊樂器 (Drums)：大鼓、小鼓、Hi-Hat 噪音 */
  private synthesizeDrum(note: number, vel: number, start: number, target: AudioNode) {
    if (!this.ctx) return;
    const velScale = Math.max(0.1, vel / 127);

    if (note === 35 || note === 36) {
      // 大鼓 (Bass Drum / Kick)
      const osc = this.createOscillator();
      const env = this.ctx.createGain();
      osc.frequency.setValueAtTime(130, start);
      osc.frequency.exponentialRampToValueAtTime(35, start + 0.09);

      env.gain.setValueAtTime(1.0 * velScale, start);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.22);

      osc.connect(env);
      env.connect(target);
      osc.start(start);
      osc.stop(start + 0.25);
    } else if (note === 38 || note === 40) {
      // 小鼓 (Snare)
      const osc = this.createOscillator();
      const oscEnv = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, start);
      osc.frequency.exponentialRampToValueAtTime(80, start + 0.08);
      oscEnv.gain.setValueAtTime(0.8, start);
      oscEnv.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
      osc.connect(oscEnv);
      oscEnv.connect(target);
      osc.start(start);
      osc.stop(start + 0.15);

      // 響弦白噪音
      this.playNoise(start, 0.16, 1200, target);
    } else if (note === 42 || note === 44 || note === 46) {
      // Hi-Hat (閉/開)
      const dur = note === 46 ? 0.28 : 0.05;
      this.playNoise(start, dur, 7000, target);
    } else {
      // 通鼓或其它金屬樂器
      const osc = this.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(midiToFreq(note), start);
      osc.frequency.exponentialRampToValueAtTime(midiToFreq(note) * 0.7, start + 0.15);
      env.gain.setValueAtTime(0.8, start);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      osc.connect(env);
      env.connect(target);
      osc.start(start);
      osc.stop(start + 0.22);
    }
  }

  /** 白噪音發生器 (用於 Hi-hat, Snare 響弦) */
  private playNoise(start: number, dur: number, highpassFreq: number, target: AudioNode) {
    if (!this.ctx) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(highpassFreq, start);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.7, start);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur);

    noise.connect(filter);
    filter.connect(env);
    env.connect(target);

    noise.start(start);
    noise.stop(start + dur + 0.02);
  }

  /**
   * 走帶動畫與 Tick 追蹤
   */
  private startAnimationLoop(sessionId: number) {
    let lastScheduledCycle = 0;

    const updateLoop = () => {
      if (this.playbackSessionId !== sessionId || !this.isCurrentlyPlaying || !this.ctx || !this.playbackOptions) return;

      const bpm = this.playbackOptions.bpm;
      const division = this.playbackOptions.division;
      const beatsPerBar = this.playbackOptions.beatsPerBar || 4;
      const gridStartTick = this.playbackOptions.gridStartTick;
      const totalTicks = this.playbackOptions.totalTicks;
      const ticksPerBar = division * beatsPerBar;
      const loopDurationSec = ticksToSeconds(totalTicks, bpm, division);

      const elapsedSec = this.ctx.currentTime - this.playbackStartTime;
      const currentCycle = Math.floor(elapsedSec / loopDurationSec);

      // 如果是單次播放且已經超過總長度，停止播放
      if (!this.playbackOptions.loop && elapsedSec >= loopDurationSec) {
        this.stop();
        return;
      }

      // 如果有開循環，且即將邁入下一個循環，提前排程下一個週期的音符
      if (this.playbackOptions.loop && currentCycle > lastScheduledCycle) {
        lastScheduledCycle = currentCycle;
        this.schedulePass(currentCycle, loopDurationSec, sessionId);
      }

      const cycleElapsedSec = elapsedSec % loopDurationSec;
      const relTick = Math.min(secondsToTicks(cycleElapsedSec, bpm, division), totalTicks);
      const currentTick = gridStartTick + relTick;
      const progress = Math.max(0, Math.min(1, relTick / totalTicks));

      const currentBar = Math.floor(relTick / ticksPerBar) + 1;
      const tickInBar = relTick % ticksPerBar;
      const currentBeat = Math.floor(tickInBar / division) + 1;

      // 找出當前正在發聲的音符
      const activeNoteNumbers: number[] = [];
      for (const n of this.scheduledNotes) {
        const nRelStart = n.startTick - gridStartTick;
        const nRelEnd = nRelStart + n.durationTick;
        if (relTick >= nRelStart && relTick < nRelEnd) {
          activeNoteNumbers.push(n.note);
        }
      }

      if (this.playbackOptions.onProgress) {
        this.playbackOptions.onProgress({
          currentTick,
          relTick,
          currentBar,
          currentBeat,
          progress,
          activeNoteNumbers,
        });
      }

      if (this.playbackSessionId === sessionId && this.isCurrentlyPlaying) {
        this.animFrameId = requestAnimationFrame(updateLoop);
      }
    };

    this.animFrameId = requestAnimationFrame(updateLoop);
  }

  // --- Web MIDI 支援 (委託至 midiManager) ---

  public getMidiManager() {
    return midiManager;
  }

  public async requestMidiAccess(): Promise<string[]> {
    const res = await midiManager.requestAccess();
    return res.devices.map(d => d.name);
  }

  public selectMidiOutput(nameOrId: string) {
    midiManager.selectOutput(nameOrId);
  }
}

// 導出全域單例引擎實例
export const audioEngine = new AudioEngine();
