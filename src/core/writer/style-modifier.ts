/**
 * Yamaha Style 伴奏風格 (.STY) 混音與聲部屬性即時修改引擎 (Style Modifier)
 * 負責直接在現有 STY 專案上更新 8 伴奏聲部之音量、聲相、效果器與音色設定，
 * 自動維持 Track 0 SMF 0 格式時序一致性與 CASM 轉調區塊相容性。
 */

import { YamahaPadModifier } from './pad-modifier';
import { StyleRemixer } from './style-remixer';
import { DEFAULT_STYLE_PARTS } from '../models/style-types';
import type {
  YamahaFileParsed,
  MidiTrack,
  MidiEvent,
} from '../models/types';

export interface StylePartMixingParams {
  volume?: number;       // 0 ~ 127 (CC 7)
  pan?: number;          // 0 ~ 127 (CC 10, 64 is Center)
  reverb?: number;       // 0 ~ 127 (CC 91)
  chorus?: number;       // 0 ~ 127 (CC 93)
  bankMsb?: number;      // 0 ~ 127 (CC 0)
  bankLsb?: number;      // 0 ~ 127 (CC 32)
  programChange?: number;// 0 ~ 127 (PC)
}

export class YamahaStyleModifier {
  /**
   * 更新指定 STY 伴奏聲部的混音與音色參數
   * 同步更新 parsed.parts 與 Track 0 開頭對應通道的 CC/PC 初始化事件，並重新編碼 rawChunk
   */
  public static setPartMixing(
    parsed: YamahaFileParsed,
    channel: number,
    params: StylePartMixingParams
  ): boolean {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return false;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return false;

    const isDrum = channel === 8 || channel === 9;

    // 1. 更新或建立 parsed.parts 中的聲部條目
    let part = parsed.parts.find((p) => p.channel === channel);
    if (!part) {
      const partDef = Object.values(DEFAULT_STYLE_PARTS).find((p) => p.channel === channel);
      part = {
        trackIndex: 0,
        channel,
        partName: partDef?.name ?? `Part (Ch ${channel + 1})`,
        volume: 100,
        pan: 64,
        reverb: 40,
        chorus: 0,
        bankMsb: isDrum ? 127 : 0,
        bankLsb: isDrum ? 0 : 112,
        programChange: 0,
      };
      parsed.parts.push(part);
      parsed.parts.sort((a, b) => a.channel - b.channel);
    }

    if (params.volume !== undefined) {
      part.volume = Math.max(0, Math.min(127, Math.round(params.volume)));
    }
    if (params.pan !== undefined) {
      part.pan = Math.max(0, Math.min(127, Math.round(params.pan)));
    }
    if (params.reverb !== undefined) {
      part.reverb = Math.max(0, Math.min(127, Math.round(params.reverb)));
    }
    if (params.chorus !== undefined) {
      part.chorus = Math.max(0, Math.min(127, Math.round(params.chorus)));
    }
    if (params.bankMsb !== undefined) {
      // 鼓組聲部 (Ch 8/9) Bank MSB 強制保護為 127 (標準鼓組) 或 126 (SFX Kit)，杜絕琴端誤判為鋼琴或自動靜音
      const safeMsb = isDrum && params.bankMsb !== 126 && params.bankMsb !== 127 ? 127 : params.bankMsb;
      part.bankMsb = Math.max(0, Math.min(127, safeMsb));
    }
    if (params.bankLsb !== undefined) {
      part.bankLsb = Math.max(0, Math.min(127, Math.round(params.bankLsb)));
    }
    if (params.programChange !== undefined) {
      part.programChange = Math.max(0, Math.min(127, Math.round(params.programChange)));
    }

    // 2. 同步更新 Track 0 開頭事件中的初始化 CC 與 PC
    if (params.bankMsb !== undefined && part.bankMsb !== undefined) {
      this.updateOrInsertCC(track0, channel, 0, part.bankMsb);
    }
    if (params.bankLsb !== undefined && part.bankLsb !== undefined) {
      this.updateOrInsertCC(track0, channel, 32, part.bankLsb);
    }
    if (params.programChange !== undefined && part.programChange !== undefined) {
      this.updateOrInsertPC(track0, channel, part.programChange);
    }
    if (params.volume !== undefined && part.volume !== undefined) {
      this.updateOrInsertCC(track0, channel, 7, part.volume);
    }
    if (params.pan !== undefined && part.pan !== undefined) {
      this.updateOrInsertCC(track0, channel, 10, part.pan);
    }
    if (params.reverb !== undefined && part.reverb !== undefined) {
      this.updateOrInsertCC(track0, channel, 91, part.reverb);
    }
    if (params.chorus !== undefined && part.chorus !== undefined) {
      this.updateOrInsertCC(track0, channel, 93, part.chorus);
    }

    // 3. 重新編碼 Track 0 二進位 Chunk
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return true;
  }

  /**
   * 在 Track 0 的開頭初始化區間更新或插入特定通道的 Control Change 事件
   */
  private static updateOrInsertCC(
    track: MidiTrack,
    channel: number,
    controller: number,
    value: number
  ): void {
    // 優先在第一個 NoteOn 之前尋找初始化事件
    const firstNoteIdx = track.events.findIndex((e) => e.type === 'noteOn');
    const searchLimit = firstNoteIdx >= 0 ? firstNoteIdx : track.events.length;

    let found = false;
    for (let i = 0; i < searchLimit; i++) {
      const ev = track.events[i];
      if (ev.type === 'controlChange' && ev.channel === channel && ev.controller === controller) {
        ev.value = value;
        found = true;
        break;
      }
    }

    if (!found) {
      // 若未找到，插入在第一個 NoteOn 之前 (保持 delta = 0)
      const insertIdx = firstNoteIdx >= 0 ? firstNoteIdx : track.events.length;
      track.events.splice(insertIdx, 0, {
        delta: 0,
        type: 'controlChange',
        channel,
        controller,
        value,
      });
    }
  }

  /**
   * 在 Track 0 的開頭初始化區間更新或插入特定通道的 Program Change 事件
   */
  private static updateOrInsertPC(
    track: MidiTrack,
    channel: number,
    program: number
  ): void {
    const firstNoteIdx = track.events.findIndex((e) => e.type === 'noteOn');
    const searchLimit = firstNoteIdx >= 0 ? firstNoteIdx : track.events.length;

    let found = false;
    for (let i = 0; i < searchLimit; i++) {
      const ev = track.events[i];
      if (ev.type === 'programChange' && ev.channel === channel) {
        ev.program = program;
        found = true;
        break;
      }
    }

    if (!found) {
      const insertIdx = firstNoteIdx >= 0 ? firstNoteIdx : track.events.length;
      track.events.splice(insertIdx, 0, {
        delta: 0,
        type: 'programChange',
        channel,
        program,
      });
    }
  }

  /**
   * 步驟 2.3: 動態裁切或延伸指定伴奏段落的小節長度 (Measure Cut & Extend)
   * 自動計算並重構 SMF 時序、平移所有後續段落的 Tick 與 Marker，確保 CASM 與伴奏結構完全對齊相容。
   *
   * @param parsed STY 解析物件
   * @param sectionName 目標段落名稱 (例如 'Intro A', 'Main A', 'Fill In BB')
   * @param targetMeasures 目標小節數 (1 ~ 64)
   * @returns boolean 是否調整成功
   */
  public static resizeSectionMeasures(
    parsed: YamahaFileParsed,
    sectionName: string,
    targetMeasures: number
  ): boolean {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return false;

    const targetBars = Math.max(1, Math.min(64, Math.round(targetMeasures)));
    const division = parsed.division || 480;
    const timeSig = parsed.timeSignature || { numerator: 4, denominator: 4 };
    const ticksPerMeasure = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));

    // 1. 取得當前段落資訊
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return false;

    const startTick = range.startTick;
    const oldEndTick = range.endTick;
    const oldMeasures = range.measureCount;
    if (oldMeasures === targetBars) return true; // 無需變更

    const newDuration = targetBars * ticksPerMeasure;
    const oldDuration = oldEndTick - startTick;
    const diffTicks = newDuration - oldDuration;
    const cutTick = startTick + newDuration;

    // 2. 針對所有軌道 (Format 0 主要是 Track 0) 同步重算時序
    for (const track of parsed.tracks) {
      if (!track || !track.events) continue;

      let curTick = 0;
      const annotated = track.events.map((ev) => {
        curTick += ev.delta;
        return { ev: { ...ev }, absTick: curTick };
      });

      const beforeEvents = annotated.filter((e) => e.absTick < startTick);
      const inSectionEvents = annotated.filter((e) => e.absTick >= startTick && e.absTick < oldEndTick);
      const afterEvents = annotated.filter((e) => e.absTick >= oldEndTick);

      const newAnnotated: Array<{ ev: MidiEvent; absTick: number }> = [...beforeEvents];

      if (targetBars < oldMeasures) {
        // 裁切縮短 (Truncate / Cut)
        for (const item of inSectionEvents) {
          if (item.absTick < cutTick) {
            newAnnotated.push(item);
          }
        }
      } else {
        // 延伸拉長 (Extend / Loop Pattern)
        // 1. 保留原本段落內的所有事件
        newAnnotated.push(...inSectionEvents);

        // 2. 循環填充新增的小節區間 [oldEndTick, cutTick)
        const repeatLength = oldDuration > 0 ? oldDuration : ticksPerMeasure;
        let offset = repeatLength;
        while (startTick + offset < cutTick) {
          for (const item of inSectionEvents) {
            // 不重複複製段落 Marker，避免出現混亂的重複段落標記
            const isMarker = item.ev.type === 'meta' && (item.ev.metaType === 0x06 || item.ev.metaType === 0x07);
            if (isMarker) continue;

            const repeatedTick = item.absTick + offset;
            if (repeatedTick < cutTick) {
              newAnnotated.push({
                ev: { ...item.ev },
                absTick: repeatedTick,
              });
            }
          }
          offset += repeatLength;
        }
      }

      // 3. 後續段落事件平移 diffTicks
      for (const item of afterEvents) {
        newAnnotated.push({
          ev: { ...item.ev },
          absTick: item.absTick + diffTicks,
        });
      }

      // 4. 重新依絕對時序排序
      newAnnotated.sort((a, b) => {
        if (a.absTick !== b.absTick) return a.absTick - b.absTick;
        const aIsMeta = a.ev.type === 'meta';
        const bIsMeta = b.ev.type === 'meta';
        if (aIsMeta && !bIsMeta) return -1;
        if (!aIsMeta && bIsMeta) return 1;
        const aIsOff = a.ev.type === 'noteOff' || (a.ev.type === 'noteOn' && (a.ev.velocity ?? 0) === 0);
        const bIsOff = b.ev.type === 'noteOff' || (b.ev.type === 'noteOn' && (b.ev.velocity ?? 0) === 0);
        if (aIsOff && !bIsOff) return -1;
        if (!aIsOff && bIsOff) return 1;
        return 0;
      });

      // 5. 重新計算 delta-time
      let prevTick = 0;
      track.events = newAnnotated.map((item) => {
        const delta = Math.max(0, item.absTick - prevTick);
        prevTick = item.absTick;
        item.ev.delta = delta;
        return item.ev;
      });

      // 清理並重新編碼 rawChunk
      YamahaPadModifier.sanitizeTrackDuplicateNotes(track);
      YamahaPadModifier.rebuildTrackRawChunk(track);
    }

    // 6. 更新 parsed.sections 結構
    for (const s of parsed.sections) {
      if (s.name.trim().toLowerCase() === sectionName.trim().toLowerCase()) {
        s.measureCount = targetBars;
        s.endTick = startTick + newDuration;
      } else if (s.startTick >= oldEndTick) {
        s.startTick += diffTicks;
        if (s.endTick !== undefined) {
          s.endTick += diffTicks;
        }
      }
    }

    return true;
  }
}
