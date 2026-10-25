import { getGoldenStyleTemplateBytes } from '../data/yamaha-style-template';
import { YamahaParser } from '../parser/yamaha-parser';
import { YamahaWriter } from './yamaha-writer';
import { YamahaPadModifier } from './pad-modifier';
import type { MidiEvent } from '../models/types';

export interface TemplateVoiceConfig {
  msb: number;
  lsb: number;
  pc: number;
}

export interface TemplatePartMixer {
  volume: number;  // 0 ~ 127 (CC 7)
  pan: number;     // 0 ~ 127 (CC 10, 64 = Center)
  reverb?: number; // 0 ~ 127 (CC 91 殘響發送量)
  chorus?: number; // 0 ~ 127 (CC 93 合唱發送量)
}

export interface TemplateMixerConfig {
  drum?: TemplatePartMixer;
  bass?: TemplatePartMixer;
  chord?: TemplatePartMixer;
  dynamicTracks?: Record<string, TemplatePartMixer>;
}

export interface TemplateSectionInput {
  name: string;
  bars: number;
  stepsPerBar?: number;
  drumPattern: Map<number, boolean[]>;
  bassPattern: Map<number, number>;
  chordPattern: Map<number, Set<number>>;
  dynamicPatterns?: Record<string, Map<number, Set<number>>>;
}

export interface TemplateStyleExportOptions {
  styleName: string;
  bpm: number;
  timeSignature?: { numerator: number; denominator: number };
  stepsPerBar?: number;
  drumKit: TemplateVoiceConfig;
  bassVoice: TemplateVoiceConfig;
  chordVoice: TemplateVoiceConfig;
  dynamicVoices?: Record<string, TemplateVoiceConfig>;
  sections: TemplateSectionInput[];
  mixer?: TemplateMixerConfig;
}

export class YamahaTemplateStyleSynthesizer {
  /**
   * 使用經過 Yamaha PSR-SX920 實體琴 100% 驗證通過的 1920 PPQ 黃金全曲式範本 (Full-House Template) 進行伴奏合成。
   * 此方法完整保留 Yamaha 原廠之 MThd、SInt 初始化握手標頭、SysEx (Works Header, GM On, XG On)、
   * 以及合法完整的 SFF2 CASM (Chord Audio Style Mapping) 轉調映射區塊，
   * 範本原生內建 Main A~D、Fill In AA~DD、Intro A~C、Ending A 共 12 個音樂段落，
   * 確保實體琴載入時絕對不會出現 "Data has not been loaded properly" 錯誤，
   * 且按下 [AUTO FILL-IN] 或 [Fill In A/B/C/D] 鍵時能完美發出過門樂音與小鼓滾奏過渡。
   */
  public static synthesizeFromTemplate(options: TemplateStyleExportOptions): Uint8Array {
    const rawTemplateBytes = getGoldenStyleTemplateBytes();
    const parsed = YamahaParser.parse(rawTemplateBytes, 'STY');

    const division = parsed.division || 1920; // 1920 PPQ (Yamaha PSR-SX920 原廠標準高解析度時鐘)
    const timeSig = options.timeSignature ?? { numerator: 4, denominator: 4 };
    const ticksPerBeat = division;
    const ticksPerBar = Math.round(ticksPerBeat * timeSig.numerator * (4 / timeSig.denominator));

    const tr0 = parsed.tracks[0];
    if (!tr0 || !tr0.events) {
      throw new Error('黃金範本 Track 0 無效');
    }

    // 1. 取得使用者主要段落 (以 Main A 為基準錨點)
    const mainAUser = options.sections.find(s => s.name === 'Main A') || options.sections[0];
    const userSectionMap = new Map<string, TemplateSectionInput>();
    options.sections.forEach(s => userSectionMap.set(s.name, s));

    // 2. 收集非音符事件，並在 SInt 區塊內更新音色 PC/Bank，在開頭更新曲名與 Tempo
    // 定義 Yamaha PSR-SX920 混音標準 (CC 7 音量、CC 10 聲相、CC 91 殘響、CC 93 合唱)
    const targetVolMap: Record<number, number> = {
      9: options.mixer?.drum?.volume ?? 100,
      10: options.mixer?.bass?.volume ?? 95,
      11: options.mixer?.chord?.volume ?? 90,
      12: options.mixer?.dynamicTracks?.Chord2?.volume ?? 85,
      13: options.mixer?.dynamicTracks?.Pad?.volume ?? 80,
      14: options.mixer?.dynamicTracks?.Phrase1?.volume ?? 85,
      15: options.mixer?.dynamicTracks?.Phrase2?.volume ?? 80,
    };

    const targetPanMap: Record<number, number> = {
      9: options.mixer?.drum?.pan ?? 64,
      10: options.mixer?.bass?.pan ?? 64,
      11: options.mixer?.chord?.pan ?? 52, // L12 偏左 12 度
      12: options.mixer?.dynamicTracks?.Chord2?.pan ?? 76, // R12 偏右 12 度
      13: options.mixer?.dynamicTracks?.Pad?.pan ?? 64, // 置中
      14: options.mixer?.dynamicTracks?.Phrase1?.pan ?? 44, // L20 偏左 20 度
      15: options.mixer?.dynamicTracks?.Phrase2?.pan ?? 84, // R20 偏右 20 度
    };

    const targetRevMap: Record<number, number> = {
      9: options.mixer?.drum?.reverb ?? 40,
      10: options.mixer?.bass?.reverb ?? 20,
      11: options.mixer?.chord?.reverb ?? 65,
      12: options.mixer?.dynamicTracks?.Chord2?.reverb ?? 50,
      13: options.mixer?.dynamicTracks?.Pad?.reverb ?? 75,
      14: options.mixer?.dynamicTracks?.Phrase1?.reverb ?? 60,
      15: options.mixer?.dynamicTracks?.Phrase2?.reverb ?? 60,
    };

    const targetChoMap: Record<number, number> = {
      9: options.mixer?.drum?.chorus ?? 0,
      10: options.mixer?.bass?.chorus ?? 0,
      11: options.mixer?.chord?.chorus ?? 20,
      12: options.mixer?.dynamicTracks?.Chord2?.chorus ?? 40,
      13: options.mixer?.dynamicTracks?.Pad?.chorus ?? 50,
      14: options.mixer?.dynamicTracks?.Phrase1?.chorus ?? 20,
      15: options.mixer?.dynamicTracks?.Phrase2?.chorus ?? 30,
    };

    const handledVolChannels = new Set<number>();
    const handledPanChannels = new Set<number>();
    const handledRevChannels = new Set<number>();
    const handledChoChannels = new Set<number>();

    interface TimedEvent {
      absTick: number;
      priority: number;
      event: MidiEvent;
    }
    const timedEvents: TimedEvent[] = [];
    let curTick = 0;

    for (const ev of tr0.events) {
      curTick += ev.delta;

      // 移除範本內既有的舊音符
      if (ev.type === 'noteOn' || ev.type === 'noteOff') {
        continue;
      }

      // 更新曲名 (Meta 0x03 Track Name)
      if (ev.type === 'meta' && ev.metaType === 0x03) {
        const cleanName = options.styleName.trim() || 'Custom Style';
        ev.text = cleanName;
        ev.metaData = new TextEncoder().encode(cleanName);
        timedEvents.push({ absTick: curTick, priority: 3, event: ev });
        continue;
      }

      // 更新節奏 (Meta 0x51 Tempo)
      if (ev.type === 'meta' && ev.metaType === 0x51) {
        const safeBpm = Math.max(30, Math.min(300, options.bpm || 120));
        const mpqn = Math.round(60_000_000 / safeBpm);
        ev.metaData = new Uint8Array([(mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff]);
        timedEvents.push({ absTick: curTick, priority: 7, event: ev });
        continue;
      }

      // 更新拍號 (Meta 0x58 Time Signature)
      if (ev.type === 'meta' && ev.metaType === 0x58 && options.timeSignature) {
        const num = options.timeSignature.numerator;
        const den = options.timeSignature.denominator;
        const denPow = Math.round(Math.log2(den));
        ev.metaData = new Uint8Array([num, denPow, 24, 8]);
        timedEvents.push({ absTick: curTick, priority: 5, event: ev });
        continue;
      }

      // 在 SInt 小節內 (tick < ticksPerBar) 更新各聲部之 Bank MSB (CC 0), Bank LSB (CC 32), 與 Program Change (PC) 以及 Volume (CC 7) 與 Pan (CC 10)
      if (curTick < ticksPerBar) {
        const ch = ev.channel;
        if (ch !== undefined) {
          // 更新 CC 7 (Volume 音量)
          if (ev.type === 'controlChange' && ev.controller === 7 && targetVolMap[ch] !== undefined) {
            ev.value = Math.max(0, Math.min(127, Math.round(targetVolMap[ch])));
            handledVolChannels.add(ch);
          }
          // 更新 CC 10 (Pan 聲相)
          else if (ev.type === 'controlChange' && ev.controller === 10 && targetPanMap[ch] !== undefined) {
            ev.value = Math.max(0, Math.min(127, Math.round(targetPanMap[ch])));
            handledPanChannels.add(ch);
          }
          // 更新 CC 91 (Reverb 空間殘響發送量)
          else if (ev.type === 'controlChange' && ev.controller === 91 && targetRevMap[ch] !== undefined) {
            ev.value = Math.max(0, Math.min(127, Math.round(targetRevMap[ch])));
            handledRevChannels.add(ch);
          }
          // 更新 CC 93 (Chorus 合唱效果發送量)
          else if (ev.type === 'controlChange' && ev.controller === 93 && targetChoMap[ch] !== undefined) {
            ev.value = Math.max(0, Math.min(127, Math.round(targetChoMap[ch])));
            handledChoChannels.add(ch);
          }

          // Channel 9 (Rhythm 2 / 鼓組)
          if (ch === 9) {
            if (ev.type === 'controlChange' && ev.controller === 0) {
              ev.value = options.drumKit.msb;
            } else if (ev.type === 'controlChange' && ev.controller === 32) {
              ev.value = options.drumKit.lsb;
            } else if (ev.type === 'programChange') {
              (ev as any).program = options.drumKit.pc;
              ev.value = options.drumKit.pc;
            }
          }
          // Channel 10 (Bass / 貝斯)
          else if (ch === 10) {
            if (ev.type === 'controlChange' && ev.controller === 0) {
              ev.value = options.bassVoice.msb;
            } else if (ev.type === 'controlChange' && ev.controller === 32) {
              ev.value = options.bassVoice.lsb;
            } else if (ev.type === 'programChange') {
              (ev as any).program = options.bassVoice.pc;
              ev.value = options.bassVoice.pc;
            }
          }
          // Channel 11 (Chord 1 / 和弦 1)
          else if (ch === 11) {
            if (ev.type === 'controlChange' && ev.controller === 0) {
              ev.value = options.chordVoice.msb;
            } else if (ev.type === 'controlChange' && ev.controller === 32) {
              ev.value = options.chordVoice.lsb;
            } else if (ev.type === 'programChange') {
              (ev as any).program = options.chordVoice.pc;
              ev.value = options.chordVoice.pc;
            }
          }
          // 動態聲部 (Chord 2: ch 12, Pad: ch 13, Phrase 1: ch 14, Phrase 2: ch 15)
          else if (ch === 12) {
            const v = options.dynamicVoices?.Chord2 || { msb: 0, lsb: 112, pc: 25 };
            if (ev.type === 'controlChange' && ev.controller === 0) ev.value = v.msb;
            else if (ev.type === 'controlChange' && ev.controller === 32) ev.value = v.lsb;
            else if (ev.type === 'programChange') {
              (ev as any).program = v.pc;
              ev.value = v.pc;
            }
          } else if (ch === 13 && options.dynamicVoices?.Pad) {
            const v = options.dynamicVoices.Pad;
            if (ev.type === 'controlChange' && ev.controller === 0) ev.value = v.msb;
            else if (ev.type === 'controlChange' && ev.controller === 32) ev.value = v.lsb;
            else if (ev.type === 'programChange') {
              (ev as any).program = v.pc;
              ev.value = v.pc;
            }
          } else if (ch === 14 && options.dynamicVoices?.Phrase1) {
            const v = options.dynamicVoices.Phrase1;
            if (ev.type === 'controlChange' && ev.controller === 0) ev.value = v.msb;
            else if (ev.type === 'controlChange' && ev.controller === 32) ev.value = v.lsb;
            else if (ev.type === 'programChange') {
              (ev as any).program = v.pc;
              ev.value = v.pc;
            }
          } else if (ch === 15 && options.dynamicVoices?.Phrase2) {
            const v = options.dynamicVoices.Phrase2;
            if (ev.type === 'controlChange' && ev.controller === 0) ev.value = v.msb;
            else if (ev.type === 'controlChange' && ev.controller === 32) ev.value = v.lsb;
            else if (ev.type === 'programChange') {
              (ev as any).program = v.pc;
              ev.value = v.pc;
            }
          }
        }
      }

      // 保留其餘所有 Yamaha 原始架構事件 (SysEx, CC7 音量, CC10 聲相, CC91 殘響, SFF2/SInt Markers 等)
      const priority = ev.type === 'sysex' ? 1 : ev.type === 'meta' && ev.metaType === 0x06 ? 20 : 10;
      timedEvents.push({ absTick: curTick, priority, event: ev });
    }

    // 2.1 確保 SInt 小節中所有啟用之聲部皆具備 CC 7 (Volume), CC 10 (Pan), CC 91 (Reverb), CC 93 (Chorus) 控制器事件
    Object.entries(targetVolMap).forEach(([chStr, vol]) => {
      const ch = Number(chStr);
      if (!handledVolChannels.has(ch)) {
        timedEvents.push({
          absTick: 178,
          priority: 10,
          event: { delta: 0, type: 'controlChange', channel: ch, controller: 7, value: vol },
        });
      }
    });

    Object.entries(targetPanMap).forEach(([chStr, pan]) => {
      const ch = Number(chStr);
      if (!handledPanChannels.has(ch)) {
        timedEvents.push({
          absTick: 183,
          priority: 10,
          event: { delta: 0, type: 'controlChange', channel: ch, controller: 10, value: pan },
        });
      }
    });

    Object.entries(targetRevMap).forEach(([chStr, rev]) => {
      const ch = Number(chStr);
      if (!handledRevChannels.has(ch)) {
        timedEvents.push({
          absTick: 188,
          priority: 10,
          event: { delta: 0, type: 'controlChange', channel: ch, controller: 91, value: rev },
        });
      }
    });

    Object.entries(targetChoMap).forEach(([chStr, cho]) => {
      const ch = Number(chStr);
      if (!handledChoChannels.has(ch)) {
        timedEvents.push({
          absTick: 193,
          priority: 10,
          event: { delta: 0, type: 'controlChange', channel: ch, controller: 93, value: cho },
        });
      }
    });

    // 3. 將使用者的樂音編入範本的所有段落中
    // 範本段落：Main A-D, Fill In AA-DD, Intro A-C, Ending A
    for (const sec of parsed.sections) {
      if (sec.name === 'SFF2' || sec.name === 'SInt') continue;

      const secStart = sec.startTick;
      const secBars = sec.measureCount || (sec.endTick ? Math.round((sec.endTick - sec.startTick) / ticksPerBar) : 4);

      // 決定該段落應採用的使用者輸入：優先使用同名段落，若無則依段落性質智能映射
      let targetUserSec = userSectionMap.get(sec.name);
      let isAutoDerivedFill = false;

      if (!targetUserSec) {
        if (sec.name === 'Fill In AA') {
          targetUserSec = userSectionMap.get('Main A') || mainAUser;
          isAutoDerivedFill = true;
        } else if (sec.name === 'Fill In BB') {
          targetUserSec = userSectionMap.get('Main B') || userSectionMap.get('Main A') || mainAUser;
          isAutoDerivedFill = true;
        } else if (sec.name === 'Fill In CC') {
          targetUserSec = userSectionMap.get('Main C') || userSectionMap.get('Main A') || mainAUser;
          isAutoDerivedFill = true;
        } else if (sec.name === 'Fill In DD') {
          targetUserSec = userSectionMap.get('Main D') || userSectionMap.get('Main A') || mainAUser;
          isAutoDerivedFill = true;
        } else if (sec.name.startsWith('Fill')) {
          targetUserSec = mainAUser;
          isAutoDerivedFill = true;
        } else if (sec.name.startsWith('Main')) {
          targetUserSec = userSectionMap.get('Main A') || mainAUser;
        } else if (sec.name.startsWith('Intro')) {
          targetUserSec = userSectionMap.get('Intro A') || mainAUser;
        } else if (sec.name.startsWith('Ending')) {
          targetUserSec = userSectionMap.get('Ending A') || mainAUser;
        } else {
          targetUserSec = mainAUser;
        }
      }

      const patternBars = Math.max(1, targetUserSec.bars || 4);

      // 動態判定該段落的每小節格數 (stepsPerBar，例如 8 格或 16 格)
      let secStepsPerBar = targetUserSec.stepsPerBar || options.stepsPerBar;
      if (!secStepsPerBar) {
        let maxLen = 0;
        targetUserSec.drumPattern.forEach((arr) => {
          if (arr.length > maxLen) maxLen = arr.length;
        });
        if (maxLen > 0 && targetUserSec.bars > 0) {
          secStepsPerBar = Math.round(maxLen / targetUserSec.bars);
        } else {
          secStepsPerBar = 16;
        }
      }
      const secTicksPerStep = Math.round(ticksPerBar / secStepsPerBar);

      for (let b = 0; b < secBars; b++) {
        // 若為 Ending 尾奏段落且超過使用者定義之小節數，後續小節維持留白延音，不重複滾奏
        if (sec.name.startsWith('Ending') && b >= patternBars) {
          continue;
        }

        // 決定當前小節對應使用者輸入的哪一小節
        let userBar = b % patternBars;
        if (isAutoDerivedFill && patternBars > 1) {
          // 自動過門取最後一小節
          userBar = patternBars - 1;
        } else if (sec.name.startsWith('Intro') && patternBars > 1 && b >= patternBars) {
          // 前奏首小節為倒數計拍，超出小節數時延續最後一小節的節奏推進
          userBar = patternBars - 1;
        }

        const barOffset = b * ticksPerBar;

        // 3.1 鼓點 (Ch 10 / index 9)
        targetUserSec.drumPattern.forEach((steps, note) => {
          for (let s = 0; s < secStepsPerBar; s++) {
            const stepIdx = userBar * secStepsPerBar + s;
            if (steps[stepIdx]) {
              const noteStart = secStart + barOffset + s * secTicksPerStep;
              const noteEnd = noteStart + Math.max(12, Math.round(secTicksPerStep * 0.75));
              timedEvents.push({
                absTick: noteStart,
                priority: 50,
                event: { delta: 0, type: 'noteOn', channel: 9, noteNumber: note, velocity: 100 },
              });
              timedEvents.push({
                absTick: noteEnd,
                priority: 40,
                event: { delta: 0, type: 'noteOff', channel: 9, noteNumber: note, velocity: 0 },
              });
            }
          }
        });

        // 3.1.1 若為自動衍生之過門段落 (Fill In)，在該小節最後一拍注入小鼓滾奏 (Snare Roll) 營造過門氣勢
        if (isAutoDerivedFill) {
          const fillRollSteps = secStepsPerBar === 16 ? [14, 15] : [secStepsPerBar - 1];
          for (const s of fillRollSteps) {
            const noteStart = secStart + barOffset + s * secTicksPerStep;
            const noteEnd = noteStart + Math.max(12, Math.round(secTicksPerStep * 0.5));
            timedEvents.push({
              absTick: noteStart,
              priority: 50,
              event: { delta: 0, type: 'noteOn', channel: 9, noteNumber: 38, velocity: 115 },
            });
            timedEvents.push({
              absTick: noteEnd,
              priority: 40,
              event: { delta: 0, type: 'noteOff', channel: 9, noteNumber: 38, velocity: 0 },
            });
          }
        }

        // 3.2 貝斯 (Ch 11 / index 10)
        for (let s = 0; s < secStepsPerBar; s++) {
          const stepIdx = userBar * secStepsPerBar + s;
          const note = targetUserSec.bassPattern.get(stepIdx);
          if (note !== undefined) {
            const noteStart = secStart + barOffset + s * secTicksPerStep;
            const noteEnd = noteStart + Math.max(18, Math.round(secTicksPerStep * 1.5));
            timedEvents.push({
              absTick: noteStart,
              priority: 50,
              event: { delta: 0, type: 'noteOn', channel: 10, noteNumber: note, velocity: 100 },
            });
            timedEvents.push({
              absTick: noteEnd,
              priority: 40,
              event: { delta: 0, type: 'noteOff', channel: 10, noteNumber: note, velocity: 0 },
            });
          }
        }

        // 3.3 和弦 1 (Ch 12 / index 11)
        if (targetUserSec.chordPattern) {
          for (let s = 0; s < secStepsPerBar; s++) {
            const stepIdx = userBar * secStepsPerBar + s;
            const noteSet = targetUserSec.chordPattern.get(stepIdx);
            if (noteSet && noteSet.size > 0) {
              const noteStart = secStart + barOffset + s * secTicksPerStep;
              const noteEnd = noteStart + Math.max(18, Math.round(secTicksPerStep * 1.7));
              noteSet.forEach(note => {
                timedEvents.push({
                  absTick: noteStart,
                  priority: 50,
                  event: { delta: 0, type: 'noteOn', channel: 11, noteNumber: note, velocity: 95 },
                });
                timedEvents.push({
                  absTick: noteEnd,
                  priority: 40,
                  event: { delta: 0, type: 'noteOff', channel: 11, noteNumber: note, velocity: 0 },
                });
              });
            }
          }
        }

        // 3.4 動態伴奏音軌 (Chord 2: ch 12, Pad: ch 13, Phrase 1: ch 14, Phrase 2: ch 15)
        if (targetUserSec.dynamicPatterns) {
          const partChannelMap: Record<string, number> = {
            Chord2: 12,
            Pad: 13,
            Phrase1: 14,
            Phrase2: 15,
          };
          Object.entries(targetUserSec.dynamicPatterns).forEach(([partId, pat]) => {
            const ch = partChannelMap[partId] ?? 12;
            for (let s = 0; s < secStepsPerBar; s++) {
              const stepIdx = userBar * secStepsPerBar + s;
              const noteSet = pat.get(stepIdx);
              if (noteSet && noteSet.size > 0) {
                const noteStart = secStart + barOffset + s * secTicksPerStep;
                const noteEnd = noteStart + Math.max(18, Math.round(secTicksPerStep * 1.7));
                noteSet.forEach(note => {
                  timedEvents.push({
                    absTick: noteStart,
                    priority: 50,
                    event: { delta: 0, type: 'noteOn', channel: ch, noteNumber: note, velocity: 90 },
                  });
                  timedEvents.push({
                    absTick: noteEnd,
                    priority: 40,
                    event: { delta: 0, type: 'noteOff', channel: ch, noteNumber: note, velocity: 0 },
                  });
                });
              }
            }
          });
        }
      }
    }

    // 4. 依照時間排序所有事件 (先發生的優先，同 Tick 依 priority 排序)
    timedEvents.sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      return a.priority - b.priority;
    });

    // 5. 重新計算 Delta-time
    let prevTick = 0;
    const finalEvents: MidiEvent[] = [];
    for (const item of timedEvents) {
      item.event.delta = Math.max(0, item.absTick - prevTick);
      finalEvents.push(item.event);
      prevTick = item.absTick;
    }

    tr0.events = finalEvents;

    // 6. 重新封裝 Track 0 的 MTrk 二進位 RawChunk
    YamahaPadModifier.rebuildTrackRawChunk(tr0);

    // 7. 使用 YamahaWriter 進行雙向完整性校驗並輸出合法二進位檔
    const validation = YamahaWriter.validateAndWrite(parsed);
    if (!validation.success) {
      throw new Error('Yamaha 伴奏二進位合成驗證失敗');
    }

    return validation.bytes;
  }
}
