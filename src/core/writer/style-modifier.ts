/**
 * Yamaha Style 伴奏風格 (.STY) 混音與聲部屬性即時修改引擎 (Style Modifier)
 * 負責直接在現有 STY 專案上更新 8 伴奏聲部之音量、聲相、效果器與音色設定，
 * 自動維持 Track 0 SMF 0 格式時序一致性與 CASM 轉調區塊相容性。
 */

import { YamahaPadModifier } from './pad-modifier';
import { StyleRemixer } from './style-remixer';
import { PadRecorder, type QuantizeGrid } from './pad-recorder';
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
    params: StylePartMixingParams,
    options?: {
      targetSection?: string;
    }
  ): boolean {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return false;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return false;

    // 僅 MIDI Ch 10 (channel index 9, 即 Rhythm 2 Main Drums) 為強制鼓組保護聲部
    // MIDI Ch 9 (channel index 8, 即 Rhythm 1 Sub Rhythm) 在 Yamaha 伴奏中經常擔任跳躍撥弦 (Pizzicato)、敲擊樂或打擊旋律，不可強制鎖定為 127
    const isDrum = channel === 9;

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
      // 鼓組聲部 (Ch 10, Rhythm 2) Bank MSB 強制保護為 127 (標準鼓組) 或 126 (SFX Kit)，杜絕琴端誤判為鋼琴或自動靜音
      const safeMsb = isDrum && params.bankMsb !== 126 && params.bankMsb !== 127 ? 127 : params.bankMsb;
      part.bankMsb = Math.max(0, Math.min(127, safeMsb));
    }
    if (params.bankLsb !== undefined) {
      part.bankLsb = Math.max(0, Math.min(127, Math.round(params.bankLsb)));
    }
    if (params.programChange !== undefined) {
      part.programChange = Math.max(0, Math.min(127, Math.round(params.programChange)));
    }

    // 2. 若指定了 targetSection，則只更新 (或插入) 該段落範圍內的專屬事件
    if (options?.targetSection) {
      this.updateSectionEvents(parsed, track0, channel, options.targetSection, params, part);
    } else {
      // 3. 預設全域聲部換音色/混音 (Global Revoicing)
      // 3a. 同步更新 Track 0 開頭事件中的初始化 CC 與 PC (第一個 NoteOn 之前)
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

      // 3b. 同步更新全曲所有後續段落中的同通道事件 (杜絕 Intro/Main/Ending 內部內嵌舊 PC/CC 覆蓋)
      for (const ev of track0.events) {
        if (ev.channel === channel) {
          if (ev.type === 'programChange' && params.programChange !== undefined && part.programChange !== undefined) {
            ev.program = part.programChange;
          }
          if (ev.type === 'controlChange') {
            if (ev.controller === 0 && params.bankMsb !== undefined && part.bankMsb !== undefined) ev.value = part.bankMsb;
            if (ev.controller === 32 && params.bankLsb !== undefined && part.bankLsb !== undefined) ev.value = part.bankLsb;
            if (ev.controller === 7 && params.volume !== undefined && part.volume !== undefined) ev.value = part.volume;
            if (ev.controller === 10 && params.pan !== undefined && part.pan !== undefined) ev.value = part.pan;
            if (ev.controller === 91 && params.reverb !== undefined && part.reverb !== undefined) ev.value = part.reverb;
            if (ev.controller === 93 && params.chorus !== undefined && part.chorus !== undefined) ev.value = part.chorus;
          }
        }
      }
    }

    // 4. 重新編碼 Track 0 二進位 Chunk
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return true;
  }

  /**
   * 更新或插入特定伴奏段落 (Section) 內部的通道專屬 CC / PC 設定
   */
  private static updateSectionEvents(
    parsed: YamahaFileParsed,
    track: MidiTrack,
    channel: number,
    sectionName: string,
    params: StylePartMixingParams,
    part: { bankMsb?: number; bankLsb?: number; programChange?: number; volume?: number; pan?: number }
  ): void {
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return;

    let curTick = 0;
    let foundPc = false;
    let foundMsb = false;
    let foundLsb = false;

    for (const ev of track.events) {
      curTick += ev.delta;
      if (curTick >= range.startTick && curTick < range.endTick && ev.channel === channel) {
        if (ev.type === 'programChange' && params.programChange !== undefined) {
          ev.program = params.programChange;
          foundPc = true;
        }
        if (ev.type === 'controlChange') {
          if (ev.controller === 0 && params.bankMsb !== undefined) {
            ev.value = part.bankMsb ?? params.bankMsb;
            foundMsb = true;
          }
          if (ev.controller === 32 && params.bankLsb !== undefined) {
            ev.value = params.bankLsb;
            foundLsb = true;
          }
          if (ev.controller === 7 && params.volume !== undefined) ev.value = params.volume;
          if (ev.controller === 10 && params.pan !== undefined) ev.value = params.pan;
          if (ev.controller === 91 && params.reverb !== undefined) ev.value = params.reverb;
          if (ev.controller === 93 && params.chorus !== undefined) ev.value = params.chorus;
        }
      }
    }

    // 若該段落內部尚未有專屬 PC 事件，且指定了 programChange，在段落起始點 (startTick) 插入專屬事件
    if (!foundPc && params.programChange !== undefined) {
      let t = 0;
      let insertIdx = track.events.length;
      for (let i = 0; i < track.events.length; i++) {
        t += track.events[i].delta;
        if (t >= range.startTick) {
          insertIdx = i;
          break;
        }
      }

      if (part.bankMsb !== undefined && !foundMsb) {
        track.events.splice(insertIdx++, 0, {
          delta: 0,
          type: 'controlChange',
          channel,
          controller: 0,
          value: part.bankMsb,
        });
      }
      if (part.bankLsb !== undefined && !foundLsb) {
        track.events.splice(insertIdx++, 0, {
          delta: 0,
          type: 'controlChange',
          channel,
          controller: 32,
          value: part.bankLsb ?? 0,
        });
      }
      track.events.splice(insertIdx, 0, {
        delta: 0,
        type: 'programChange',
        channel,
        program: params.programChange,
      });
    }
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

  /**
   * 步驟 3.2: 更新指定伴奏段落 (Section) 內指定通道的單顆音符事件 (音高、起音 Tick、音長、力度)
   */
  public static updateSectionNote(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    target: { note: number; startTick: number; oldDurationTick?: number },
    updates: { note?: number; startTick?: number; durationTick?: number; velocity?: number }
  ): boolean {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return false;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return false;

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return false;

    const targetAbsStart = range.startTick + target.startTick;

    let curTick = 0;
    const annotated = track0.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev: { ...ev }, absTick: curTick, index };
    });

    const onEntry = annotated.find(
      (item) =>
        item.ev.channel === channel &&
        item.ev.type === 'noteOn' &&
        item.ev.noteNumber === target.note &&
        (item.ev.velocity ?? 0) > 0 &&
        Math.abs(item.absTick - targetAbsStart) <= 12
    );
    if (!onEntry) return false;

    const offEntry = annotated.find(
      (item) =>
        item.index > onEntry.index &&
        item.ev.channel === channel &&
        item.ev.noteNumber === target.note &&
        (item.ev.type === 'noteOff' || (item.ev.type === 'noteOn' && (item.ev.velocity ?? 0) === 0))
    );
    if (!offEntry) return false;

    const oldAbsStart = onEntry.absTick;
    const oldAbsEnd = offEntry.absTick;
    const oldDur = Math.max(1, oldAbsEnd - oldAbsStart);

    const newNote = updates.note !== undefined ? Math.max(0, Math.min(127, Math.round(updates.note))) : onEntry.ev.noteNumber!;
    const newVel = updates.velocity !== undefined ? Math.max(1, Math.min(127, Math.round(updates.velocity))) : onEntry.ev.velocity!;
    const newAbsStart = updates.startTick !== undefined ? range.startTick + Math.max(0, Math.round(updates.startTick)) : oldAbsStart;
    const newDur = updates.durationTick !== undefined ? Math.max(12, Math.round(updates.durationTick)) : oldDur;
    const newAbsEnd = newAbsStart + newDur;

    onEntry.ev.noteNumber = newNote;
    onEntry.ev.velocity = newVel;
    onEntry.absTick = newAbsStart;

    offEntry.ev.noteNumber = newNote;
    offEntry.absTick = newAbsEnd;

    annotated.sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      const aIsOff = a.ev.type === 'noteOff' || (a.ev.type === 'noteOn' && (a.ev.velocity ?? 0) === 0);
      const bIsOff = b.ev.type === 'noteOff' || (b.ev.type === 'noteOn' && (b.ev.velocity ?? 0) === 0);
      if (aIsOff && !bIsOff) return -1;
      if (!aIsOff && bIsOff) return 1;
      return a.index - b.index;
    });

    let prev = 0;
    track0.events = annotated.map((item) => {
      item.ev.delta = Math.max(0, item.absTick - prev);
      prev = item.absTick;
      return item.ev;
    });

    YamahaPadModifier.sanitizeTrackDuplicateNotes(track0);
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return true;
  }

  /**
   * 步驟 3.2: 刪除指定伴奏段落 (Section) 內指定通道的單顆音符事件
   */
  public static deleteSectionNote(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    target: { note: number; startTick: number; oldDurationTick?: number }
  ): boolean {
    return this.batchDeleteSectionNotes(parsed, sectionName, channel, [target]) > 0;
  }

  /**
   * 步驟 3.2: 批次刪除指定伴奏段落 (Section) 內指定通道的多顆音符事件
   */
  public static batchDeleteSectionNotes(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    targets: Array<{ note: number; startTick: number; oldDurationTick?: number }>
  ): number {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0 || targets.length === 0) return 0;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return 0;

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return 0;

    let curTick = 0;
    const annotated = track0.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev: { ...ev }, absTick: curTick, index };
    });

    const deletedIndices = new Set<number>();

    for (const t of targets) {
      const targetAbsStart = range.startTick + t.startTick;
      const onEntry = annotated.find(
        (item) =>
          !deletedIndices.has(item.index) &&
          item.ev.channel === channel &&
          item.ev.type === 'noteOn' &&
          item.ev.noteNumber === t.note &&
          (item.ev.velocity ?? 0) > 0 &&
          Math.abs(item.absTick - targetAbsStart) <= 12
      );
      if (!onEntry) continue;

      const offEntry = annotated.find(
        (item) =>
          !deletedIndices.has(item.index) &&
          item.index > onEntry.index &&
          item.ev.channel === channel &&
          item.ev.noteNumber === t.note &&
          (item.ev.type === 'noteOff' || (item.ev.type === 'noteOn' && (item.ev.velocity ?? 0) === 0))
      );
      if (!offEntry) continue;

      deletedIndices.add(onEntry.index);
      deletedIndices.add(offEntry.index);
    }

    if (deletedIndices.size === 0) return 0;

    const remaining = annotated.filter((item) => !deletedIndices.has(item.index));
    let prev = 0;
    track0.events = remaining.map((item) => {
      item.ev.delta = Math.max(0, item.absTick - prev);
      prev = item.absTick;
      return item.ev;
    });

    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return Math.floor(deletedIndices.size / 2);
  }

  /**
   * 步驟 3.2: 在指定伴奏段落 (Section) 內指定通道新增一顆音符事件
   */
  public static addSectionNote(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    noteData: { note: number; startTick: number; durationTick: number; velocity: number }
  ): boolean {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return false;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return false;

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return false;

    const absStart = range.startTick + Math.max(0, Math.round(noteData.startTick));
    const dur = Math.max(12, Math.round(noteData.durationTick));
    const absEnd = absStart + dur;

    let curTick = 0;
    const annotated = track0.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev: { ...ev }, absTick: curTick, index };
    });

    const dup = annotated.find(
      (item) =>
        item.ev.channel === channel &&
        item.ev.type === 'noteOn' &&
        item.ev.noteNumber === noteData.note &&
        Math.abs(item.absTick - absStart) <= 6
    );
    if (dup) return false;

    const onEv: MidiEvent = {
      delta: 0,
      type: 'noteOn',
      channel,
      noteNumber: Math.max(0, Math.min(127, Math.round(noteData.note))),
      velocity: Math.max(1, Math.min(127, Math.round(noteData.velocity))),
    };
    const offEv: MidiEvent = {
      delta: 0,
      type: 'noteOff',
      channel,
      noteNumber: Math.max(0, Math.min(127, Math.round(noteData.note))),
      velocity: 0,
    };

    annotated.push({ ev: onEv, absTick: absStart, index: 999990 });
    annotated.push({ ev: offEv, absTick: absEnd, index: 999991 });

    annotated.sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      const aIsOff = a.ev.type === 'noteOff' || (a.ev.type === 'noteOn' && (a.ev.velocity ?? 0) === 0);
      const bIsOff = b.ev.type === 'noteOff' || (b.ev.type === 'noteOn' && (b.ev.velocity ?? 0) === 0);
      if (aIsOff && !bIsOff) return -1;
      if (!aIsOff && bIsOff) return 1;
      return a.index - b.index;
    });

    let prev = 0;
    track0.events = annotated.map((item) => {
      item.ev.delta = Math.max(0, item.absTick - prev);
      prev = item.absTick;
      return item.ev;
    });

    YamahaPadModifier.sanitizeTrackDuplicateNotes(track0);
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return true;
  }

  /**
   * 步驟 3.2: 批次修改指定伴奏段落 (Section) 內指定通道的多顆音符事件 (多選移調/調力度/伸縮時長)
   */
  public static batchUpdateSectionNotes(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    updates: Array<{
      target: { note: number; startTick: number; oldDurationTick?: number };
      newProps?: { note?: number; startTick?: number; durationTick?: number; velocity?: number };
      updates?: { note?: number; startTick?: number; durationTick?: number; velocity?: number };
    }>
  ): number {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0 || updates.length === 0) return 0;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return 0;

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return 0;

    let curTick = 0;
    const annotated = track0.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev: { ...ev }, absTick: curTick, index };
    });

    let successCount = 0;

    for (const u of updates) {
      const props = u.newProps || u.updates || {};
      const targetAbsStart = range.startTick + u.target.startTick;
      const onEntry = annotated.find(
        (item) =>
          item.ev.channel === channel &&
          item.ev.type === 'noteOn' &&
          item.ev.noteNumber === u.target.note &&
          (item.ev.velocity ?? 0) > 0 &&
          Math.abs(item.absTick - targetAbsStart) <= 12
      );
      if (!onEntry) continue;

      const offEntry = annotated.find(
        (item) =>
          item.index > onEntry.index &&
          item.ev.channel === channel &&
          item.ev.noteNumber === u.target.note &&
          (item.ev.type === 'noteOff' || (item.ev.type === 'noteOn' && (item.ev.velocity ?? 0) === 0))
      );
      if (!offEntry) continue;

      const oldDur = Math.max(1, offEntry.absTick - onEntry.absTick);

      if (props.note !== undefined) {
        const nn = Math.max(0, Math.min(127, Math.round(props.note)));
        onEntry.ev.noteNumber = nn;
        offEntry.ev.noteNumber = nn;
      }
      if (props.velocity !== undefined) {
        onEntry.ev.velocity = Math.max(1, Math.min(127, Math.round(props.velocity)));
      }
      if (props.startTick !== undefined) {
        onEntry.absTick = range.startTick + Math.max(0, Math.round(props.startTick));
      }
      if (props.durationTick !== undefined) {
        const nd = Math.max(12, Math.round(props.durationTick));
        offEntry.absTick = onEntry.absTick + nd;
      } else if (props.startTick !== undefined) {
        offEntry.absTick = onEntry.absTick + oldDur;
      }

      successCount++;
    }

    if (successCount === 0) return 0;

    annotated.sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      const aIsOff = a.ev.type === 'noteOff' || (a.ev.type === 'noteOn' && (a.ev.velocity ?? 0) === 0);
      const bIsOff = b.ev.type === 'noteOff' || (b.ev.type === 'noteOn' && (b.ev.velocity ?? 0) === 0);
      if (aIsOff && !bIsOff) return -1;
      if (!aIsOff && bIsOff) return 1;
      return a.index - b.index;
    });

    let prev = 0;
    track0.events = annotated.map((item) => {
      item.ev.delta = Math.max(0, item.absTick - prev);
      prev = item.absTick;
      return item.ev;
    });

    YamahaPadModifier.sanitizeTrackDuplicateNotes(track0);
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return successCount;
  }

  /**
   * 步驟 3.2: 八度快捷移調 (+/- 12 semitones)
   */
  public static shiftSectionOctave(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    direction: 1 | -1,
    targetStartTick?: number,
    targetNote?: number
  ): { success: boolean; shiftedCount: number } {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return { success: false, shiftedCount: 0 };
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return { success: false, shiftedCount: 0 };

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return { success: false, shiftedCount: 0 };

    const semitones = direction * 12;
    let curTick = 0;
    const annotated = track0.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev: { ...ev }, absTick: curTick, index };
    });

    let shiftedCount = 0;

    if (targetStartTick !== undefined && targetNote !== undefined) {
      const targetAbsStart = range.startTick + targetStartTick;
      const onEntry = annotated.find(
        (i) =>
          i.ev.channel === channel &&
          i.ev.type === 'noteOn' &&
          i.ev.noteNumber === targetNote &&
          (i.ev.velocity ?? 0) > 0 &&
          Math.abs(i.absTick - targetAbsStart) <= 12
      );
      if (!onEntry) return { success: false, shiftedCount: 0 };

      const offEntry = annotated.find(
        (i) =>
          i.index > onEntry.index &&
          i.ev.channel === channel &&
          i.ev.noteNumber === targetNote &&
          (i.ev.type === 'noteOff' || (i.ev.type === 'noteOn' && (i.ev.velocity ?? 0) === 0))
      );

      const newNote = Math.max(0, Math.min(127, targetNote + semitones));
      onEntry.ev.noteNumber = newNote;
      if (offEntry) offEntry.ev.noteNumber = newNote;
      shiftedCount = 1;
    } else {
      // 全軌移調 (該段落該通道所有音符)
      for (const item of annotated) {
        if (item.absTick >= range.startTick && item.absTick < range.endTick && item.ev.channel === channel) {
          if ((item.ev.type === 'noteOn' || item.ev.type === 'noteOff') && item.ev.noteNumber !== undefined) {
            item.ev.noteNumber = Math.max(0, Math.min(127, item.ev.noteNumber + semitones));
            if (item.ev.type === 'noteOn' && (item.ev.velocity ?? 0) > 0) {
              shiftedCount++;
            }
          }
        }
      }
    }

    if (shiftedCount === 0) return { success: false, shiftedCount: 0 };

    let prev = 0;
    track0.events = annotated.map((item) => {
      item.ev.delta = Math.max(0, item.absTick - prev);
      prev = item.absTick;
      return item.ev;
    });

    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return { success: true, shiftedCount };
  }

  /**
   * 步驟 3.2: 段落聲部音符量化 (Quantize)
   */
  public static quantizeSectionTrack(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    grid: QuantizeGrid,
    targetStartTick?: number,
    targetNote?: number
  ): { success: boolean; quantizedCount: number } {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) return { success: false, quantizedCount: 0 };
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return { success: false, quantizedCount: 0 };

    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return { success: false, quantizedCount: 0 };

    const notes = StyleRemixer.extractSectionChannelNotes(parsed, range.startTick, range.endTick, channel);
    if (notes.length === 0) return { success: false, quantizedCount: 0 };

    const ppq = parsed.division || 480;
    const minDur = PadRecorder.getMinGridDuration(grid, ppq);
    const isSingle = targetStartTick !== undefined && targetNote !== undefined;

    const updates: Array<{
      target: { note: number; startTick: number; oldDurationTick?: number };
      newProps: { startTick: number; durationTick: number };
    }> = [];

    for (const n of notes) {
      if (isSingle && (n.note !== targetNote || Math.abs(n.startTick - targetStartTick!) > 12)) {
        continue;
      }
      const qStart = PadRecorder.snapTickToGrid(n.startTick, grid, ppq);
      const qEnd = PadRecorder.snapTickToGrid(n.startTick + n.durationTick, grid, ppq);
      const qDur = Math.max(minDur, qEnd - qStart);

      updates.push({
        target: { note: n.note, startTick: n.startTick, oldDurationTick: n.durationTick },
        newProps: { startTick: qStart, durationTick: qDur },
      });
    }

    if (updates.length === 0) return { success: false, quantizedCount: 0 };

    const count = this.batchUpdateSectionNotes(parsed, sectionName, channel, updates);
    return { success: count > 0, quantizedCount: count };
  }

  /**
   * 步驟 3.3: 取得指定伴奏段落的總小節數
   */
  public static getSectionMeasureCount(parsed: YamahaFileParsed, sectionName: string): number {
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    return range ? range.measureCount : 4;
  }

  /**
   * 步驟 3.3: 複製指定伴奏段落內的特定小節音符至目標小節 (支援覆蓋 replace 或 插入順移 insert)
   * @param channel 若指定 channel (0~15)，僅複製該聲部；若為 -1 則複製全體伴奏聲部
   * @param sourceBar 1-indexed, 例如 1
   * @param targetBar 1-indexed, 例如 2 或 3
   * @param mode 'replace' (覆蓋替換) | 'insert' (插入順移，段落長度 +1)
   */
  public static copySectionMeasure(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    sourceBar: number,
    targetBar: number,
    mode: 'replace' | 'insert' = 'replace'
  ): { success: boolean; copiedCount: number; newTotalBars: number } {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) {
      return { success: false, copiedCount: 0, newTotalBars: 1 };
    }
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return { success: false, copiedCount: 0, newTotalBars: 1 };

    const curLen = range.measureCount;
    if (sourceBar <= 0 || targetBar <= 0 || (sourceBar === targetBar && mode !== 'insert') || sourceBar > curLen) {
      return { success: false, copiedCount: 0, newTotalBars: curLen };
    }

    const division = parsed.division || 480;
    const timeSig = parsed.timeSignature || { numerator: 4, denominator: 4 };
    const ticksPerMeasure = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));

    const sourceRelStart = (sourceBar - 1) * ticksPerMeasure;
    const sourceRelEnd = sourceRelStart + ticksPerMeasure;

    const channelsToCopy = channel >= 0 ? [channel] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const sourceNotesByChannel: Array<{ channel: number; note: number; velocity: number; startTick: number; durationTick: number }> = [];

    for (const ch of channelsToCopy) {
      const chNotes = StyleRemixer.extractSectionChannelNotes(parsed, range.startTick, range.endTick, ch);
      const inBar = chNotes.filter(n => n.startTick >= sourceRelStart && n.startTick < sourceRelEnd);
      for (const n of inBar) {
        sourceNotesByChannel.push({ ...n, channel: ch });
      }
    }

    if (sourceNotesByChannel.length === 0) {
      return { success: false, copiedCount: 0, newTotalBars: curLen };
    }

    let finalBars = curLen;

    if (mode === 'insert') {
      finalBars = curLen + 1;
      const targetAbsStart = range.startTick + (targetBar - 1) * ticksPerMeasure;

      // 1. 平移 Track 0 事件：
      //    - 目標小節及之後事件（包含本段後續小節與後續所有伴奏段落及標記）皆向後推移 1 小節
      //    - 不推移本段落起始 Marker 及小節 1 之前的中繼事件
      for (const track of parsed.tracks) {
        if (!track || !track.events) continue;
        let curTick = 0;
        const annotated = track.events.map((ev, index) => {
          curTick += ev.delta;
          return { ev: { ...ev }, absTick: curTick, index };
        });

        for (const item of annotated) {
          const isMeta = item.ev.type === 'meta';
          if (isMeta && item.absTick <= range.startTick) {
            continue;
          }
          if (item.absTick >= targetAbsStart) {
            item.absTick += ticksPerMeasure;
          }
        }

        annotated.sort((a, b) => {
          if (a.absTick !== b.absTick) return a.absTick - b.absTick;
          const aIsMeta = a.ev.type === 'meta';
          const bIsMeta = b.ev.type === 'meta';
          if (aIsMeta && !bIsMeta) return -1;
          if (!aIsMeta && bIsMeta) return 1;
          return a.index - b.index;
        });

        let prev = 0;
        track.events = annotated.map((item) => {
          item.ev.delta = Math.max(0, item.absTick - prev);
          prev = item.absTick;
          return item.ev;
        });
        YamahaPadModifier.rebuildTrackRawChunk(track);
      }

      // 2. 更新 parsed.sections 結構
      for (const s of parsed.sections) {
        if (s.name.trim().toLowerCase() === sectionName.trim().toLowerCase()) {
          s.measureCount = finalBars;
          s.endTick = (s.endTick ?? range.endTick) + ticksPerMeasure;
        } else if (s.startTick >= range.endTick) {
          s.startTick += ticksPerMeasure;
          if (s.endTick !== undefined) {
            s.endTick += ticksPerMeasure;
          }
        }
      }
    } else {
      if (targetBar > curLen) {
        finalBars = targetBar;
        this.resizeSectionMeasures(parsed, sectionName, finalBars);
      }

      const targetRelStart = (targetBar - 1) * ticksPerMeasure;
      const targetRelEnd = targetRelStart + ticksPerMeasure;

      for (const ch of channelsToCopy) {
        const chNotes = StyleRemixer.extractSectionChannelNotes(parsed, range.startTick, range.endTick, ch);
        const existingInTarget = chNotes.filter(n => n.startTick >= targetRelStart && n.startTick < targetRelEnd);
        if (existingInTarget.length > 0) {
          this.batchDeleteSectionNotes(parsed, sectionName, ch, existingInTarget.map(n => ({
            note: n.note,
            startTick: n.startTick,
            oldDurationTick: n.durationTick,
          })));
        }
      }
    }

    const targetRelStart = (targetBar - 1) * ticksPerMeasure;
    for (const s of sourceNotesByChannel) {
      const offsetInBar = s.startTick - sourceRelStart;
      const newStartRel = targetRelStart + offsetInBar;
      this.addSectionNote(parsed, sectionName, s.channel, {
        note: s.note,
        startTick: newStartRel,
        durationTick: s.durationTick,
        velocity: s.velocity,
      });
    }

    return { success: true, copiedCount: sourceNotesByChannel.length, newTotalBars: finalBars };
  }

  /**
   * 步驟 3.3: 一鍵倍增指定小節 (Duplicate Section Measure / Ctrl+D)
   */
  public static duplicateSectionMeasure(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    sourceBar?: number
  ): { success: boolean; copiedCount: number; newTargetBar: number } {
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return { success: false, copiedCount: 0, newTargetBar: 1 };
    const curLen = range.measureCount;
    const src = sourceBar !== undefined && sourceBar > 0 ? sourceBar : curLen;
    const target = src + 1;
    const res = this.copySectionMeasure(parsed, sectionName, channel, src, target, 'insert');
    return { success: res.success, copiedCount: res.copiedCount, newTargetBar: target };
  }

  /**
   * 步驟 3.3: 刪除或清空指定伴奏段落內的特定小節
   * @param mode 'clear' (清空該小節音符為靜音空白，總長度不變) | 'ripple' (剪除該小節，後續小節往前平移，總長度 -1)
   */
  public static deleteSectionMeasure(
    parsed: YamahaFileParsed,
    sectionName: string,
    channel: number,
    targetBar: number,
    mode: 'ripple' | 'clear' = 'clear'
  ): { success: boolean; deletedCount: number; newTotalBars: number } {
    if (!parsed || !parsed.tracks || parsed.tracks.length === 0) {
      return { success: false, deletedCount: 0, newTotalBars: 1 };
    }
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return { success: false, deletedCount: 0, newTotalBars: 1 };

    const curLen = range.measureCount;
    if (targetBar < 1 || targetBar > curLen) {
      return { success: false, deletedCount: 0, newTotalBars: curLen };
    }

    const division = parsed.division || 480;
    const timeSig = parsed.timeSignature || { numerator: 4, denominator: 4 };
    const ticksPerMeasure = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));

    const targetRelStart = (targetBar - 1) * ticksPerMeasure;
    const targetRelEnd = targetRelStart + ticksPerMeasure;

    // 清空目標小節音符
    // mode === 'ripple' 時，因為整個小節被裁除、後續全部往前順移，針對所有伴奏聲部處理
    const channelsToClear = mode === 'ripple' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] : (channel >= 0 ? [channel] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    let deletedCount = 0;

    for (const ch of channelsToClear) {
      const chNotes = StyleRemixer.extractSectionChannelNotes(parsed, range.startTick, range.endTick, ch);
      const inTarget = chNotes.filter(n => n.startTick >= targetRelStart && n.startTick < targetRelEnd);
      if (inTarget.length > 0) {
        deletedCount += this.batchDeleteSectionNotes(parsed, sectionName, ch, inTarget.map(n => ({
          note: n.note,
          startTick: n.startTick,
          oldDurationTick: n.durationTick,
        })));
      }
    }

    if (mode === 'clear') {
      return { success: true, deletedCount, newTotalBars: curLen };
    }

    // mode === 'ripple': 後續小節往前平移 1 小節，且段落總長度 -1
    if (curLen <= 1) {
      return { success: true, deletedCount, newTotalBars: 1 };
    }

    // 將 targetBar 之後的事件向前平移 1 小節（包含後續段落與標記）
    const targetAbsEnd = range.startTick + targetRelEnd;
    for (const track of parsed.tracks) {
      if (!track || !track.events) continue;
      let curTick = 0;
      const annotated = track.events.map((ev, index) => {
        curTick += ev.delta;
        return { ev: { ...ev }, absTick: curTick, index };
      });

      for (const item of annotated) {
        const isMeta = item.ev.type === 'meta';
        if (isMeta && item.absTick <= range.startTick) {
          continue;
        }
        if (item.absTick >= targetAbsEnd) {
          item.absTick -= ticksPerMeasure;
        }
      }

      annotated.sort((a, b) => {
        if (a.absTick !== b.absTick) return a.absTick - b.absTick;
        const aIsMeta = a.ev.type === 'meta';
        const bIsMeta = b.ev.type === 'meta';
        if (aIsMeta && !bIsMeta) return -1;
        if (!aIsMeta && bIsMeta) return 1;
        return a.index - b.index;
      });

      let prev = 0;
      track.events = annotated.map((item) => {
        item.ev.delta = Math.max(0, item.absTick - prev);
        prev = item.absTick;
        return item.ev;
      });
      YamahaPadModifier.rebuildTrackRawChunk(track);
    }

    // 更新 parsed.sections 結構
    const newTotalBars = curLen - 1;
    for (const s of parsed.sections) {
      if (s.name.trim().toLowerCase() === sectionName.trim().toLowerCase()) {
        s.measureCount = newTotalBars;
        s.endTick = (s.endTick ?? range.endTick) - ticksPerMeasure;
      } else if (s.startTick >= range.endTick) {
        s.startTick -= ticksPerMeasure;
        if (s.endTick !== undefined) {
          s.endTick -= ticksPerMeasure;
        }
      }
    }

    return { success: true, deletedCount, newTotalBars };
  }

  /**
   * 清空指定段落指定聲部（或全體聲部 channel = -1）的所有演奏音符
   */
  public static clearSectionNotes(parsed: YamahaFileParsed, sectionName: string, channel: number = -1): number {
    const range = StyleRemixer.getSectionTickRange(parsed, sectionName);
    if (!range) return 0;
    const track0 = parsed.tracks[0];
    if (!track0 || !track0.events) return 0;

    let curTick = 0;
    let deletedCount = 0;
    const filteredEvents: MidiEvent[] = [];
    const targetChannels = channel >= 0 ? [channel] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

    for (const ev of track0.events) {
      curTick += ev.delta;
      const isNote = (ev.type === 'noteOn' || ev.type === 'noteOff') && ev.channel !== undefined && targetChannels.includes(ev.channel);
      const inRange = curTick >= range.startTick && curTick < range.endTick;

      if (isNote && inRange) {
        if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
          deletedCount++;
        }
        continue;
      }
      filteredEvents.push(ev);
    }

    // 重算 Delta-times
    let prevTick = 0;
    let runningTick = 0;
    for (const ev of track0.events) {
      runningTick += ev.delta;
      if (filteredEvents.includes(ev)) {
        ev.delta = runningTick - prevTick;
        prevTick = runningTick;
      }
    }

    track0.events = filteredEvents;
    YamahaPadModifier.rebuildTrackRawChunk(track0);
    return deletedCount;
  }
}


