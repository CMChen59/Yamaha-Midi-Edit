/**
 * Yamaha PSR-SX920 伴奏風格 (.STY) 載入與解構引擎 (StyLoader)
 * 負責將實體琴 STY 二進位資料完整解析為 Creator App 狀態架構：
 * 1. 拆解 Track 0 中的所有段落（Main A~D, Fill In AA~DD, Break, Intro A~C, Ending A~C）。
 * 2. 精準將時間軸（Ticks）量化映射至步進網格（Step Grid / Piano Roll）。
 * 3. 提取鼓組、貝斯、和弦與 4 組動態伴奏聲部（Chord 2, Pad, Phrase 1, Phrase 2）之音符與音色混音參數。
 * 4. 保留原曲 CASM 轉調群組與 OTS 系統標頭底座。
 */

import { YamahaParser } from '../core/parser/yamaha-parser';
import type { MidiEvent } from '../core/models/types';
import type { SectionStore, RealNoteMeta } from './creator-app';
import { YAMAHA_SX920_DRUM_KITS, type YamahaDrumKitPreset } from './drum-kits';
import { YAMAHA_SX920_BASS_VOICES, type YamahaBassPreset } from './bass-voices';
import { YAMAHA_SX920_CHORD_VOICES, type YamahaChordPreset } from './chord-voices';
import { findYamahaVoice } from '../core/data/yamaha-voices';

export interface LoadedStyleResult {
  fileName: string;
  bpm: number;
  timeSignature: { numerator: number; denominator: number };
  division: number;
  sections: Map<string, SectionStore>;
  drumKit: YamahaDrumKitPreset;
  rhythm1Kit?: YamahaDrumKitPreset;
  bassVoice: YamahaBassPreset;
  chordVoice: YamahaChordPreset;
  dynamicVoices: Record<string, YamahaChordPreset>;
  mixer: Record<string, { volume: number; pan: number; reverb: number; chorus: number }>;
  rawBytes: Uint8Array;
  activeDrumNotes: number[];
  activeDynamicPartIds: ('Chord2' | 'Pad' | 'Phrase1' | 'Phrase2')[];
  summary: string;
}

export class StyLoader {
  /**
   * 載入並解析 STY 檔案位元組
   */
  public static loadFromBytes(buffer: Uint8Array, fileName: string = 'Imported.sty'): LoadedStyleResult {
    const parsed = YamahaParser.parse(buffer, 'STY');

    const bpm = parsed.bpm && parsed.bpm > 20 && parsed.bpm < 300 ? parsed.bpm : 120;
    const timeSig = parsed.timeSignature ?? { numerator: 4, denominator: 4 };
    const division = parsed.division || 1920;

    // 計算每小節 ticks 與每步進 ticks
    // 預設 4/4 拍為 16 步進 (1/16 音符)；6/8 拍為 12 步進
    const stepsPerBar = timeSig.numerator === 6 && timeSig.denominator === 8 ? 12 : 16;
    const ticksPerMeasure = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));
    const ticksPerStep = Math.max(1, Math.round(ticksPerMeasure / stepsPerBar));

    // 1. 扁平化展開所有音軌的時間軸事件（支援 SMF Format 0 與 Format 1）
    interface FlatEvent extends MidiEvent {
      absTick: number;
    }
    const flatEvents: FlatEvent[] = [];

    for (const track of parsed.tracks) {
      let t = 0;
      for (const ev of track.events) {
        t += ev.delta;
        flatEvents.push({ ...ev, absTick: t });
      }
    }
    flatEvents.sort((a, b) => a.absTick - b.absTick);

    // 2. 聲部與音色、混音參數提取
    const mixer: Record<string, { volume: number; pan: number; reverb: number; chorus: number }> = {
      drum: { volume: 100, pan: 64, reverb: 40, chorus: 0 },
      bass: { volume: 95, pan: 64, reverb: 20, chorus: 0 },
      chord: { volume: 90, pan: 52, reverb: 65, chorus: 20 },
      Chord2: { volume: 85, pan: 76, reverb: 50, chorus: 40 },
      Pad: { volume: 80, pan: 64, reverb: 75, chorus: 50 },
      Phrase1: { volume: 85, pan: 44, reverb: 60, chorus: 20 },
      Phrase2: { volume: 80, pan: 84, reverb: 60, chorus: 30 },
    };

    let selectedDrumKit: YamahaDrumKitPreset = YAMAHA_SX920_DRUM_KITS[0];
    let selectedRhythm1Kit: YamahaDrumKitPreset | undefined = undefined;
    let selectedBassVoice: YamahaBassPreset = YAMAHA_SX920_BASS_VOICES[0];
    let selectedChordVoice: YamahaChordPreset = YAMAHA_SX920_CHORD_VOICES[0];
    const dynamicVoices: Record<string, YamahaChordPreset> = {};

    // 從 parsed.parts 提取聲部初始化設定
    for (const p of parsed.parts) {
      const ch = p.channel;
      // SFF2 通道判斷
      if (ch === 9) {
        // 主鼓組 (Ch 10 Rhythm 2)
        if (p.volume !== undefined) mixer.drum.volume = p.volume;
        if (p.pan !== undefined) mixer.drum.pan = p.pan;
        if (p.reverb !== undefined) mixer.drum.reverb = p.reverb;
        if (p.chorus !== undefined) mixer.drum.chorus = p.chorus;

        const matchedKit = YAMAHA_SX920_DRUM_KITS.find(k => k.pc === p.programChange);
        if (matchedKit) selectedDrumKit = matchedKit;
      } else if (ch === 8) {
        // 副鼓組 / 打擊樂 (Ch 9 Rhythm 1)
        const matchedKit = YAMAHA_SX920_DRUM_KITS.find(k => k.pc === p.programChange);
        if (matchedKit) selectedRhythm1Kit = matchedKit;
      } else if (ch === 10 || ch === 1) {
        // 貝斯 (Ch 11 或 SFF1 Ch 2)
        if (p.volume !== undefined) mixer.bass.volume = p.volume;
        if (p.pan !== undefined) mixer.bass.pan = p.pan;
        if (p.reverb !== undefined) mixer.bass.reverb = p.reverb;
        if (p.chorus !== undefined) mixer.bass.chorus = p.chorus;

        const matchedBass = YAMAHA_SX920_BASS_VOICES.find(b => b.pc === p.programChange);
        if (matchedBass) selectedBassVoice = matchedBass;
      } else if (ch === 11 || ch === 2) {
        // 和弦 1 (Ch 12 或 SFF1 Ch 3)
        if (p.volume !== undefined) mixer.chord.volume = p.volume;
        if (p.pan !== undefined) mixer.chord.pan = p.pan;
        if (p.reverb !== undefined) mixer.chord.reverb = p.reverb;
        if (p.chorus !== undefined) mixer.chord.chorus = p.chorus;

        const matchedChord = YAMAHA_SX920_CHORD_VOICES.find(c => c.pc === p.programChange);
        if (matchedChord) selectedChordVoice = matchedChord;
      } else if (ch === 12 || ch === 3) {
        // Chord 2
        this.fillDynamicVoiceMixer('Chord2', p, mixer, dynamicVoices);
      } else if (ch === 13 || ch === 4) {
        // Pad
        this.fillDynamicVoiceMixer('Pad', p, mixer, dynamicVoices);
      } else if (ch === 14 || ch === 5) {
        // Phrase 1
        this.fillDynamicVoiceMixer('Phrase1', p, mixer, dynamicVoices);
      } else if (ch === 15 || ch === 6) {
        // Phrase 2
        this.fillDynamicVoiceMixer('Phrase2', p, mixer, dynamicVoices);
      }
    }

    // 3. 解析各段落並歸納音符
    const sections = new Map<string, SectionStore>();
    const foundDrumNotes = new Set<number>();
    const activeDynamicParts = new Set<'Chord2' | 'Pad' | 'Phrase1' | 'Phrase2'>();

    // 標準支援段落清單映射表 (規範化段落名稱)
    const validSectionMap: Record<string, string> = {
      'main a': 'Main A',
      'main b': 'Main B',
      'main c': 'Main C',
      'main d': 'Main D',
      'fill in aa': 'Fill In AA',
      'fill in bb': 'Fill In BB',
      'fill in cc': 'Fill In CC',
      'fill in dd': 'Fill In DD',
      'fill in ba': 'Break',
      'break': 'Break',
      'intro a': 'Intro A',
      'intro b': 'Intro B',
      'intro c': 'Intro C',
      'ending a': 'Ending A',
      'ending b': 'Ending B',
      'ending c': 'Ending C',
    };

    for (const sec of parsed.sections) {
      const rawName = sec.name.trim();
      const lower = rawName.toLowerCase();
      const standardName = validSectionMap[lower];
      if (!standardName) {
        // 略過 SFF2, SInt 等非演奏段落標記
        continue;
      }

      // 計算該段落小節數
      let bars = sec.measureCount;
      if (!bars || bars <= 0) {
        const start = sec.startTick;
        const end = sec.endTick || (start + ticksPerMeasure);
        bars = Math.max(1, Math.round((end - start) / ticksPerMeasure));
      }

      const totalSteps = bars * stepsPerBar;

      // 初始化 Pattern 結構
      const drumPattern = new Map<number, boolean[]>();
      // 預設基礎鼓組音高列
      [36, 38, 42, 46, 49, 51].forEach(note => {
        drumPattern.set(note, new Array(totalSteps).fill(false));
      });

      const bassPattern = new Map<number, number>();
      const chordPattern = new Map<number, Set<number>>();
      const dynamicPatterns: Record<string, Map<number, Set<number>>> = {
        Chord2: new Map(),
        Pad: new Map(),
        Phrase1: new Map(),
        Phrase2: new Map(),
      };

      // 提取落在該段落時間範圍內的 NoteOn 事件
      const secStart = sec.startTick;
      const secEnd = sec.endTick !== undefined ? sec.endTick : secStart + bars * ticksPerMeasure;

      // 表現力對照表初始化
      const drumMeta = new Map<string, RealNoteMeta>();
      const bassMeta = new Map<number, RealNoteMeta>();
      const chordMeta = new Map<string, RealNoteMeta>();
      const dynamicMeta: Record<string, Map<string, RealNoteMeta>> = {
        Chord2: new Map(),
        Pad: new Map(),
        Phrase1: new Map(),
        Phrase2: new Map(),
      };
      const ccEvents: Array<{ channel: number; controller: number; value: number; step: number; relTick: number }> = [];
      const pitchBendEvents: Array<{ channel: number; value: number; step: number; relTick: number }> = [];

      // 收集該段落內的連續控制器與滑音事件 (CC 11 Expression, CC 1 Modulation, CC 64 Sustain 等)
      for (const ev of flatEvents) {
        if (ev.absTick >= secStart && ev.absTick < secEnd) {
          const relTick = ev.absTick - secStart;
          const step = Math.min(totalSteps - 1, Math.max(0, Math.floor(relTick / ticksPerStep)));
          if (ev.type === 'controlChange' && ev.channel !== undefined && ev.controller !== undefined && ev.value !== undefined) {
            if ([11, 1, 64, 71, 74].includes(ev.controller)) {
              ccEvents.push({
                channel: ev.channel,
                controller: ev.controller,
                value: ev.value,
                step,
                relTick,
              });
            }
          } else if (ev.type === 'pitchBend' && ev.channel !== undefined && ev.value !== undefined) {
            pitchBendEvents.push({
              channel: ev.channel,
              value: ev.value,
              step,
              relTick,
            });
          }
        }
      }

      const secNotes = flatEvents.filter(
        ev => ev.type === 'noteOn' && (ev.velocity ?? 0) > 0 && ev.absTick >= secStart && ev.absTick < secEnd
      );

      const msPerTick = (60000 / (bpm * division));

      for (let noteIdx = 0; noteIdx < secNotes.length; noteIdx++) {
        const ev = secNotes[noteIdx];
        const relTick = ev.absTick - secStart;
        const step = Math.round(relTick / ticksPerStep);
        if (step < 0 || step >= totalSteps) continue;

        const ch = ev.channel;
        const note = ev.noteNumber ?? 60;
        const velocity = Math.max(1, Math.min(127, ev.velocity ?? 100));

        // 計算音符發音真實時值 (尋找對應 NoteOff)
        let durationTicks = Math.round(ticksPerStep * 1.5);
        for (let j = 0; j < flatEvents.length; j++) {
          const nextEv = flatEvents[j];
          if (nextEv.absTick > ev.absTick && nextEv.channel === ev.channel && nextEv.noteNumber === ev.noteNumber) {
            if (nextEv.type === 'noteOff' || (nextEv.type === 'noteOn' && (nextEv.velocity ?? 0) === 0)) {
              durationTicks = Math.max(12, nextEv.absTick - ev.absTick);
              break;
            } else if (nextEv.type === 'noteOn') {
              durationTicks = Math.max(12, nextEv.absTick - ev.absTick);
              break;
            }
          }
        }
        const durationMs = Math.max(30, Math.round(durationTicks * msPerTick));

        // 計算掃弦微時差 (Strumming Micro-timing Offset)
        const nominalTick = step * ticksPerStep;
        const offsetTicks = relTick - nominalTick;
        const offsetMs = offsetTicks > 0 ? Math.min(45, Math.round(offsetTicks * msPerTick)) : 0;

        // 通道分流映射與真實表現力寫入
        if (ch === 9 || ch === 8 || ch === 0) {
          // 鼓組聲部 (ch=8 為 Rhythm 1 打擊樂, ch=9 為 Rhythm 2 主爵士鼓)
          if (!drumPattern.has(note)) {
            drumPattern.set(note, new Array(totalSteps).fill(false));
          }
          drumPattern.get(note)![step] = true;
          foundDrumNotes.add(note);

          drumMeta.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            sourceChannel: ch === 8 ? 8 : 9,
          });
        } else if (ch === 10 || ch === 1) {
          // 貝斯聲部
          bassPattern.set(step, note);
          bassMeta.set(step, {
            velocity,
            durationMs,
            durationTicks,
            sourceChannel: 10,
          });
        } else if (ch === 11 || ch === 2) {
          // 和弦 1 聲部
          if (!chordPattern.has(step)) {
            chordPattern.set(step, new Set());
          }
          chordPattern.get(step)!.add(note);
          chordMeta.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            offsetMs,
            offsetTicks,
            sourceChannel: 11,
          });
        } else if (ch === 12 || ch === 3) {
          // Chord 2
          this.addDynamicNote(dynamicPatterns.Chord2, step, note);
          activeDynamicParts.add('Chord2');
          dynamicMeta.Chord2.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            offsetMs,
            offsetTicks,
            sourceChannel: 12,
          });
        } else if (ch === 13 || ch === 4) {
          // Pad
          this.addDynamicNote(dynamicPatterns.Pad, step, note);
          activeDynamicParts.add('Pad');
          dynamicMeta.Pad.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            offsetMs,
            offsetTicks,
            sourceChannel: 13,
          });
        } else if (ch === 14 || ch === 5) {
          // Phrase 1
          this.addDynamicNote(dynamicPatterns.Phrase1, step, note);
          activeDynamicParts.add('Phrase1');
          dynamicMeta.Phrase1.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            offsetMs,
            offsetTicks,
            sourceChannel: 14,
          });
        } else if (ch === 15 || ch === 6) {
          // Phrase 2
          this.addDynamicNote(dynamicPatterns.Phrase2, step, note);
          activeDynamicParts.add('Phrase2');
          dynamicMeta.Phrase2.set(`${note}_${step}`, {
            velocity,
            durationMs,
            durationTicks,
            offsetMs,
            offsetTicks,
            sourceChannel: 15,
          });
        }
      }

      sections.set(standardName, {
        name: standardName,
        bars,
        drumPattern,
        bassPattern,
        chordPattern,
        dynamicPatterns,
        drumMeta,
        bassMeta,
        chordMeta,
        dynamicMeta,
        ccEvents,
        pitchBendEvents,
      });
    }

    // 收集所有打擊樂器音高 (由低至高排序)
    const activeDrumNotes = Array.from(foundDrumNotes).sort((a, b) => a - b);
    const activeDynamicPartIds = Array.from(activeDynamicParts);

    const summary = `成功載入【${fileName}】：共 ${sections.size} 個段落、BPM ${bpm}、${timeSig.numerator}/${timeSig.denominator} 拍號、動態啟用 ${activeDynamicPartIds.length} 個伴奏聲部。`;

    return {
      fileName,
      bpm,
      timeSignature: timeSig,
      division,
      sections,
      drumKit: selectedDrumKit,
      rhythm1Kit: selectedRhythm1Kit,
      bassVoice: selectedBassVoice,
      chordVoice: selectedChordVoice,
      dynamicVoices,
      mixer,
      rawBytes: buffer,
      activeDrumNotes,
      activeDynamicPartIds,
      summary,
    };
  }

  /**
   * 輔助動態和弦聲部加入音符
   */
  private static addDynamicNote(map: Map<number, Set<number>>, step: number, note: number) {
    if (!map.has(step)) {
      map.set(step, new Set());
    }
    map.get(step)!.add(note);
  }

  /**
   * 輔助提取動態聲部音色與混音
   */
  private static fillDynamicVoiceMixer(
    partId: string,
    p: { volume?: number; pan?: number; reverb?: number; chorus?: number; programChange?: number; bankMsb?: number; bankLsb?: number },
    mixer: Record<string, { volume: number; pan: number; reverb: number; chorus: number }>,
    dynamicVoices: Record<string, YamahaChordPreset>
  ) {
    if (!mixer[partId]) {
      mixer[partId] = { volume: 80, pan: 64, reverb: 50, chorus: 30 };
    }
    if (p.volume !== undefined) mixer[partId].volume = p.volume;
    if (p.pan !== undefined) mixer[partId].pan = p.pan;
    if (p.reverb !== undefined) mixer[partId].reverb = p.reverb;
    if (p.chorus !== undefined) mixer[partId].chorus = p.chorus;

    if (p.programChange !== undefined) {
      const match = YAMAHA_SX920_CHORD_VOICES.find(v => v.pc === p.programChange);
      if (match) {
        dynamicVoices[partId] = match;
      } else {
        const msb = p.bankMsb ?? 0;
        const lsb = p.bankLsb ?? 0;
        const pc = p.programChange;
        const found = findYamahaVoice(msb, lsb, pc);
        if (found) {
          const category = (found.category === 'Bass' || found.category === 'Woodwind' || found.category === 'Drums' || found.category === 'Percussion' || found.category === 'Legacy')
            ? 'Synth'
            : (found.category as YamahaChordPreset['category']);
          dynamicVoices[partId] = {
            id: `imported-${partId.toLowerCase()}`,
            name: found.name,
            category,
            categoryLabel: found.chineseName,
            msb: found.msb,
            lsb: found.lsb,
            pc: found.pc,
            panelPc: found.pc + 1,
            icon: '🎵',
            description: found.chineseName || found.name,
          };
        } else {
          dynamicVoices[partId] = {
            id: `custom-${partId.toLowerCase()}`,
            name: `Voice (PC ${pc + 1})`,
            category: 'Synth',
            categoryLabel: '合成器',
            msb,
            lsb,
            pc,
            panelPc: pc + 1,
            icon: '🎵',
            description: `Bank ${msb}-${lsb}, PC ${pc + 1}`,
          };
        }
      }
    }
  }
}
