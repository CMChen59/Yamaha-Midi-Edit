import type { YamahaFileParsed, YamahaSection, MidiEvent } from '../core/models/types';
import { getSharedAudioContext } from '../creator/shared-audio-context';
import { drumSynth } from '../creator/drum-synth';
import { bassSynth } from '../creator/bass-synth';
import { chordSynth } from '../creator/chord-synth';
import { midiManager } from '../core/audio/midi-manager';

export interface PlaybackNoteEvent {
  relTick: number;          // 相對於段落起始的 Tick
  channel: number;          // MIDI Channel (0-indexed, 通常 8~15 為 SFF2)
  noteNumber: number;       // 音高 (0~127)
  velocity: number;         // 力度 (1~127)
  durationTicks: number;    // 發聲長度 (Ticks)
  durationMs: number;       // 發聲長度 (毫秒)
}

export interface PlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  currentSectionName: string | null;
  bpm: number;
  isLooping: boolean;
  outputMode: 'webaudio' | 'midi';
  currentBar: number;
  currentBeat: number;
  currentTick: number;
}

export type TickCallback = (bar: number, beat: number, tick: number, totalBars: number) => void;
export type ChannelActivityCallback = (activeChannels: Set<number>) => void;

export class StyPlaybackEngine {
  private parsed: YamahaFileParsed | null = null;
  private currentSection: YamahaSection | null = null;
  private sectionEvents: PlaybackNoteEvent[] = [];
  private totalSectionTicks: number = 0;
  private totalBars: number = 1;

  private isPlaying: boolean = false;
  private isLooping: boolean = true;
  private bpm: number = 120;
  private outputMode: 'webaudio' | 'midi' = 'webaudio';

  // 播放排程時鐘
  private timerId: any = null;
  private rafId: number | null = null;
  private playbackStartAudioTime: number = 0;
  private lastScheduledTick: number = 0;

  // 聲部靜音與獨奏 (Channel 8~15, 以及 0~7)
  private mutedChannels: Set<number> = new Set();
  private soloChannel: number | null = null;
  private channelVolumes: Map<number, number> = new Map(); // 0~127

  // 回呼
  private onTickCallback: TickCallback | null = null;
  private onActivityCallback: ChannelActivityCallback | null = null;
  private activeChannelsInWindow: Set<number> = new Set();

  constructor() {
    // 預設全聲部音量為 100
    for (let c = 0; c < 16; c++) {
      this.channelVolumes.set(c, 100);
    }
  }

  public loadParsed(parsed: YamahaFileParsed) {
    this.stop();
    this.parsed = parsed;
    this.bpm = parsed.bpm || 120;
    this.currentSection = null;
    this.sectionEvents = [];
  }

  public getSections(): YamahaSection[] {
    if (!this.parsed) return [];
    return this.parsed.sections.filter(s => {
      const name = s.name.toLowerCase();
      return !name.startsWith('sff') && !name.startsWith('sint') && !name.startsWith('rp') && !name.startsWith('cm');
    });
  }

  public getParsed(): YamahaFileParsed | null {
    return this.parsed;
  }

  public getBpm(): number {
    return this.bpm;
  }

  public setBpm(newBpm: number) {
    const clamped = Math.max(30, Math.min(300, Math.round(newBpm)));
    if (this.bpm === clamped) return;

    if (this.isPlaying) {
      const ctx = getSharedAudioContext();
      const now = ctx ? ctx.currentTime : 0;
      const division = this.parsed?.division || 480;
      const currentTick = this.lastScheduledTick;

      this.bpm = clamped;
      const newTicksPerSec = (this.bpm * division) / 60;
      this.playbackStartAudioTime = now - (currentTick / newTicksPerSec);
    } else {
      this.bpm = clamped;
    }
  }

  public setLoop(loop: boolean) {
    this.isLooping = loop;
  }

  public getLoop(): boolean {
    return this.isLooping;
  }

  public setOutputMode(mode: 'webaudio' | 'midi') {
    this.outputMode = mode;
    if (mode === 'webaudio' && this.isPlaying) {
      midiManager.panicAllChannels();
    }
  }

  public getOutputMode(): 'webaudio' | 'midi' {
    return this.outputMode;
  }

  public setOnTick(cb: TickCallback) {
    this.onTickCallback = cb;
  }

  public setOnActivity(cb: ChannelActivityCallback) {
    this.onActivityCallback = cb;
  }

  public setChannelMute(channel: number, mute: boolean) {
    if (mute) {
      this.mutedChannels.add(channel);
    } else {
      this.mutedChannels.delete(channel);
    }
  }

  public isChannelMuted(channel: number): boolean {
    if (this.soloChannel !== null) {
      return this.soloChannel !== channel;
    }
    return this.mutedChannels.has(channel);
  }

  public setChannelSolo(channel: number | null) {
    this.soloChannel = channel;
  }

  public getChannelSolo(): number | null {
    return this.soloChannel;
  }

  public setChannelVolume(channel: number, vol: number) {
    this.channelVolumes.set(channel, Math.max(0, Math.min(127, Math.round(vol))));
  }

  public getChannelVolume(channel: number): number {
    return this.channelVolumes.get(channel) ?? 100;
  }

  /**
   * 選擇段落並萃取原始音符事件流
   */
  public selectSection(sectionName: string): boolean {
    if (!this.parsed) return false;
    const target = this.parsed.sections.find(s => s.name.toLowerCase() === sectionName.toLowerCase());
    if (!target) return false;

    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.stop();
    }

    this.currentSection = target;
    const division = this.parsed.division || 480;
    const num = this.parsed.timeSignature.numerator || 4;
    const den = this.parsed.timeSignature.denominator || 4;
    const ticksPerBar = division * num * (4 / den);

    const startTick = target.startTick;
    const endTick = target.endTick ?? (startTick + ticksPerBar);
    this.totalSectionTicks = Math.max(ticksPerBar, endTick - startTick);
    this.totalBars = Math.max(1, Math.round(this.totalSectionTicks / ticksPerBar));

    // 檢查伴奏是否包含 SFF2 專用通道 (8~15)
    let hasSff2Channels = false;
    for (const trk of this.parsed.tracks) {
      let cur = 0;
      for (const ev of trk.events) {
        cur += ev.delta;
        if (cur >= startTick && cur < endTick && ev.channel !== undefined && ev.channel >= 8 && ev.channel <= 15) {
          hasSff2Channels = true;
          break;
        }
      }
      if (hasSff2Channels) break;
    }

    // 提取該段落的所有 NoteOn 與 NoteOff
    const rawEvents: { tick: number; ev: MidiEvent }[] = [];
    for (const trk of this.parsed.tracks) {
      let cur = 0;
      for (const ev of trk.events) {
        cur += ev.delta;
        if (cur >= startTick && cur < endTick) {
          // 若有 SFF2 軌道，則完全排除 SFF1 (0~7) 以免半音衝突
          if (hasSff2Channels && ev.channel !== undefined && ev.channel < 8) {
            continue;
          }
          rawEvents.push({ tick: cur, ev });
        }
      }
    }

    // 組合 NoteOn 與其長度
    const noteOnMap: Map<string, { tick: number; ev: MidiEvent }> = new Map();
    const resultEvents: PlaybackNoteEvent[] = [];

    // 先依 tick 排序
    rawEvents.sort((a, b) => a.tick - b.tick);

    for (const item of rawEvents) {
      const { tick, ev } = item;
      const ch = ev.channel ?? 0;
      const note = ev.noteNumber ?? 0;
      const key = `${ch}_${note}`;

      if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        // 如果前一個音尚未 NoteOff，先結算前一個音
        if (noteOnMap.has(key)) {
          const prev = noteOnMap.get(key)!;
          const durTicks = Math.max(24, tick - prev.tick);
          resultEvents.push({
            relTick: prev.tick - startTick,
            channel: ch,
            noteNumber: note,
            velocity: prev.ev.velocity ?? 100,
            durationTicks: durTicks,
            durationMs: (durTicks / division) * (60 / this.bpm) * 1000,
          });
        }
        noteOnMap.set(key, item);
      } else if (ev.type === 'noteOff' || (ev.type === 'noteOn' && (ev.velocity ?? 0) === 0)) {
        if (noteOnMap.has(key)) {
          const prev = noteOnMap.get(key)!;
          const durTicks = Math.max(24, tick - prev.tick);
          resultEvents.push({
            relTick: prev.tick - startTick,
            channel: ch,
            noteNumber: note,
            velocity: prev.ev.velocity ?? 100,
            durationTicks: durTicks,
            durationMs: (durTicks / division) * (60 / this.bpm) * 1000,
          });
          noteOnMap.delete(key);
        }
      }
    }

    // 處理尚未 NoteOff 的剩餘音符
    noteOnMap.forEach((prev) => {
      const ch = prev.ev.channel ?? 0;
      const note = prev.ev.noteNumber ?? 0;
      const durTicks = Math.min(ticksPerBar, Math.max(48, endTick - prev.tick));
      resultEvents.push({
        relTick: prev.tick - startTick,
        channel: ch,
        noteNumber: note,
        velocity: prev.ev.velocity ?? 100,
        durationTicks: durTicks,
        durationMs: (durTicks / division) * (60 / this.bpm) * 1000,
      });
    });

    // 依相對 Tick 嚴格排序
    resultEvents.sort((a, b) => a.relTick - b.relTick);
    this.sectionEvents = resultEvents;

    if (wasPlaying) {
      this.play();
    }

    return true;
  }

  public getCurrentSection(): YamahaSection | null {
    return this.currentSection;
  }

  public getTotalBars(): number {
    return this.totalBars;
  }

  /**
   * 啟動微秒級高精度排程播放
   */
  public play() {
    if (!this.currentSection || this.sectionEvents.length === 0) return;
    this.stop();

    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    this.isPlaying = true;

    const division = this.parsed?.division || 480;
    const ticksPerSec = (this.bpm * division) / 60;
    const startTime = (ctx ? ctx.currentTime : 0) + 0.04; // 40ms 安全緩衝

    this.playbackStartAudioTime = startTime;
    this.lastScheduledTick = -1;

    const lookaheadIntervalMs = 25; // 25ms 檢查週期
    const lookaheadWindowSec = 0.15; // 150ms 預排視窗

    const scheduleLoop = () => {
      if (!this.isPlaying) return;
      const currentCtx = getSharedAudioContext();
      if (!currentCtx) return;

      const nowAudioTime = currentCtx.currentTime;
      // 計算目前已經播放了多少秒
      const elapsedSec = Math.max(0, nowAudioTime - this.playbackStartAudioTime);
      const currentAbsoluteTick = elapsedSec * ticksPerSec;

      // 如果超出當前段落長度
      if (currentAbsoluteTick >= this.totalSectionTicks) {
        if (this.isLooping) {
          // 無縫循環：將起點平移一個段落長度，不產生任何時鐘抖動
          const loopCount = Math.floor(currentAbsoluteTick / this.totalSectionTicks);
          this.playbackStartAudioTime += (this.totalSectionTicks * loopCount) / ticksPerSec;
          this.lastScheduledTick = -1;
        } else {
          this.stop();
          return;
        }
      }

      const loopCurrentTick = (currentAbsoluteTick % this.totalSectionTicks);
      const windowEndTick = loopCurrentTick + (lookaheadWindowSec * ticksPerSec);

      // 排程 [lastScheduledTick + 1, windowEndTick] 範圍內的音符
      this.activeChannelsInWindow.clear();

      for (const event of this.sectionEvents) {
        const evTick = event.relTick;
        // 檢查音符是否落在當前預排視窗中
        if (evTick > this.lastScheduledTick && evTick <= windowEndTick) {
          // 聲部靜音檢查
          if (this.isChannelMuted(event.channel)) continue;

          // 計算發聲精確音訊時間
          const eventAudioTime = this.playbackStartAudioTime + (evTick / ticksPerSec);
          const durSec = (event.durationTicks / division) * (60 / this.bpm);
          const durMs = durSec * 1000;

          // 考量音量滑桿比例
          const chVol = this.getChannelVolume(event.channel);
          const scaledVel = Math.round(event.velocity * (chVol / 127));
          if (scaledVel <= 0) continue;

          this.activeChannelsInWindow.add(event.channel);

          if (this.outputMode === 'webaudio') {
            this.playWebAudioNote(event.channel, event.noteNumber, scaledVel, durMs, eventAudioTime);
          } else {
            this.playMidiNote(event.channel, event.noteNumber, scaledVel, durMs, eventAudioTime, nowAudioTime);
          }
        }
      }

      this.lastScheduledTick = windowEndTick;
    };

    scheduleLoop();
    this.timerId = setInterval(scheduleLoop, lookaheadIntervalMs);

    // 輕量 60fps 游標回呼（只計算小節與拍號，零重 DOM 操作）
    const num = this.parsed?.timeSignature.numerator || 4;
    const den = this.parsed?.timeSignature.denominator || 4;
    const ticksPerBar = division * num * (4 / den);
    const ticksPerBeat = division * (4 / den);

    const renderTick = () => {
      if (!this.isPlaying) return;
      const currentCtx = getSharedAudioContext();
      const now = currentCtx ? currentCtx.currentTime : 0;
      const elapsedSec = Math.max(0, now - this.playbackStartAudioTime);
      const curTick = (elapsedSec * ticksPerSec) % this.totalSectionTicks;

      const currentBar = Math.floor(curTick / ticksPerBar) + 1;
      const beatInBar = (curTick % ticksPerBar) / ticksPerBeat + 1;

      if (this.onTickCallback) {
        this.onTickCallback(currentBar, parseFloat(beatInBar.toFixed(1)), Math.round(curTick), this.totalBars);
      }
      if (this.onActivityCallback && this.activeChannelsInWindow.size > 0) {
        this.onActivityCallback(new Set(this.activeChannelsInWindow));
      }

      this.rafId = requestAnimationFrame(renderTick);
    };

    this.rafId = requestAnimationFrame(renderTick);
  }

  public pause() {
    this.stop();
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.outputMode === 'midi') {
      midiManager.panicAllChannels();
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  private playWebAudioNote(channel: number, note: number, velocity: number, durMs: number, when: number) {
    // 依 Yamaha 標準聲部指派合成器
    if (channel === 8 || channel === 9 || channel === 0) {
      // 節奏部 (Rhythm 1 / Rhythm 2 / Sub Rhythm)
      drumSynth.playNote(note, velocity, when);
    } else if (channel === 10 || channel === 1) {
      // 貝斯 (Bass)
      bassSynth.playNote(note, velocity, durMs, when);
    } else {
      // 和弦與樂句 (Chord 1, Chord 2, Pad, Phrase 1, Phrase 2)
      chordSynth.playNote(note, velocity, durMs, when);
    }
  }

  private playMidiNote(channel: number, note: number, velocity: number, durMs: number, when: number, nowAudioTime: number) {
    if (!midiManager.getSelectedOutput()) return;
    const deltaMs = Math.max(0, (when - nowAudioTime) * 1000);
    const midiTimestamp = performance.now() + deltaMs;

    midiManager.sendNoteOn(channel, note, velocity, midiTimestamp);
    midiManager.sendNoteOff(channel, note, midiTimestamp + durMs);
  }
}

export const styPlaybackEngine = new StyPlaybackEngine();
