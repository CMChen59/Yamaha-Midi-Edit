import { BinaryWriter } from './binary-writer';
import type { YamahaFileParsed, MidiEvent, MidiTrack } from '../models/types';

/**
 * Yamaha Pad 屬性與混音編輯核心模組
 * 負責將記憶體中的修改同步至 MIDI 軌道事件與 Yamaha 專利控制標籤 (RP, CM, N, I)
 */
export class YamahaPadModifier {
  /**
   * 更新指定 Pad (1~4) 的名稱
   */
  public static setPadName(parsed: YamahaFileParsed, padNum: number, name: string): void {
    if (!parsed.padConfig) {
      parsed.padConfig = {
        names: ['Pad 1', 'Pad 2', 'Pad 3', 'Pad 4'],
        icons: ['', '', '', ''],
        repeatFlags: [false, false, false, false],
        chordMatchFlags: [false, false, false, false],
      };
    }
    const idx = padNum - 1;
    if (idx >= 0 && idx < 4) {
      parsed.padConfig.names[idx] = name.trim();
      this.syncControlTagsToTrack0(parsed);
    }
  }

  /**
   * 更新指定 Pad (1~4) 的循環播放 (Repeat / RP) 旗標
   */
  public static setPadRepeat(parsed: YamahaFileParsed, padNum: number, repeat: boolean): void {
    if (!parsed.padConfig) return;
    const idx = padNum - 1;
    if (idx >= 0 && idx < 4) {
      parsed.padConfig.repeatFlags[idx] = repeat;
      this.syncControlTagsToTrack0(parsed);
    }
  }

  /**
   * 更新指定 Pad (1~4) 的和弦跟隨 (Chord Match / CM) 旗標
   */
  public static setPadChordMatch(parsed: YamahaFileParsed, padNum: number, chordMatch: boolean): void {
    if (!parsed.padConfig) return;
    const idx = padNum - 1;
    if (idx >= 0 && idx < 4) {
      parsed.padConfig.chordMatchFlags[idx] = chordMatch;
      this.syncControlTagsToTrack0(parsed);
    }
  }

  /**
   * 更新指定 Pad (1~4) 的圖示代碼 (Icon / I)
   */
  public static setPadIcon(parsed: YamahaFileParsed, padNum: number, icon: string): void {
    if (!parsed.padConfig) return;
    const idx = padNum - 1;
    if (idx >= 0 && idx < 4) {
      parsed.padConfig.icons[idx] = icon.trim();
      this.syncControlTagsToTrack0(parsed);
    }
  }

  /**
   * 更新指定 Pad 的混音參數 (音量、左右平衡、混響、音色)
   */
  public static setPadMixing(
    parsed: YamahaFileParsed,
    padNum: number,
    params: {
      volume?: number;
      pan?: number;
      reverb?: number;
      bankMsb?: number;
      bankLsb?: number;
      programChange?: number;
    }
  ): void {
    const track = parsed.tracks[padNum]; // Pad 1~4 對應 Track 1~4
    if (!track) return;

    let targetChannel = padNum - 1;
    // 取得該 Track 使用的 Channel
    const firstChanEv = track.events.find((e) => e.channel !== undefined);
    if (firstChanEv && firstChanEv.channel !== undefined) {
      targetChannel = firstChanEv.channel;
    }

    // 更新音量 (CC 7)
    if (params.volume !== undefined) {
      this.updateOrInsertCC(track, targetChannel, 7, params.volume);
    }

    // 更新聲相 (CC 10)
    if (params.pan !== undefined) {
      this.updateOrInsertCC(track, targetChannel, 10, params.pan);
    }

    // 更新混響 (CC 91)
    if (params.reverb !== undefined) {
      this.updateOrInsertCC(track, targetChannel, 91, params.reverb);
    }

    // 更新 Bank MSB (CC 0)
    if (params.bankMsb !== undefined) {
      this.updateOrInsertCC(track, targetChannel, 0, params.bankMsb);
    }

    // 更新 Bank LSB (CC 32)
    if (params.bankLsb !== undefined) {
      this.updateOrInsertCC(track, targetChannel, 32, params.bankLsb);
    }

    // 更新 Program Change
    if (params.programChange !== undefined) {
      this.updateOrInsertPC(track, targetChannel, params.programChange);
    }

    // 重新編碼該 Track 的二進位 rawChunk
    this.rebuildTrackRawChunk(track);
  }

  /**
   * 同步 Pad 控制標籤 (RP, CM, N1~N4, I1~I4) 至 Track 0
   */
  private static syncControlTagsToTrack0(parsed: YamahaFileParsed): void {
    if (!parsed.padConfig || parsed.tracks.length === 0) return;
    const track0 = parsed.tracks[0];
    const cfg = parsed.padConfig;

    // 1. 移除舊有的控制 Marker (RP, CM, N1~N4, I1~I4)
    track0.events = track0.events.filter((ev) => {
      if (ev.type === 'meta' && (ev.metaType === 6 || ev.metaType === 7) && ev.text) {
        const t = ev.text.trim();
        if (t.startsWith('RP') || t.startsWith('CM') || /^N[1-4]/.test(t) || /^I[1-4]/.test(t)) {
          return false;
        }
      }
      return true;
    });

    // 2. 找到 End of Track (Meta 0x2F) 的位置，在其前方插入新的控制標籤
    const endMetaIdx = track0.events.findIndex((e) => e.type === 'meta' && e.metaType === 0x2f);
    const insertPos = endMetaIdx >= 0 ? endMetaIdx : track0.events.length;

    // 生成標籤字串
    const rpTag = `RP${cfg.repeatFlags.map((f) => (f ? '1' : '0')).join('')}`;
    const cmTag = `CM${cfg.chordMatchFlags.map((f) => (f ? '1' : '0')).join('')}`;

    const newControlEvents: MidiEvent[] = [
      this.createMarkerEvent(rpTag),
      this.createMarkerEvent(cmTag),
    ];

    for (let i = 0; i < 4; i++) {
      const num = i + 1;
      const name = cfg.names[i] || `Pad${num}`;
      const icon = cfg.icons[i] || 'S809';
      newControlEvents.push(this.createMarkerEvent(`N${num}${name}`));
      newControlEvents.push(this.createMarkerEvent(`I${num}${icon}`));
    }

    track0.events.splice(insertPos, 0, ...newControlEvents);

    // 重新編碼 Track 0 的 rawChunk
    this.rebuildTrackRawChunk(track0);
  }

  private static createMarkerEvent(text: string): MidiEvent {
    const encoder = new TextEncoder();
    const metaData = encoder.encode(text);
    return {
      delta: 0,
      type: 'meta',
      metaType: 6, // Marker
      text,
      metaData,
    };
  }

  private static updateOrInsertCC(track: MidiTrack, channel: number, controller: number, value: number): void {
    const existing = track.events.find(
      (e) => e.type === 'controlChange' && e.controller === controller && (e.channel === undefined || e.channel === channel)
    );
    if (existing) {
      existing.value = value;
      existing.channel = channel;
    } else {
      // 插入在第一個 NoteOn 之前
      const firstNoteIdx = track.events.findIndex((e) => e.type === 'noteOn');
      const insertIdx = firstNoteIdx >= 0 ? firstNoteIdx : 0;
      track.events.splice(insertIdx, 0, {
        delta: 0,
        type: 'controlChange',
        channel,
        controller,
        value,
      });
    }
  }

  private static updateOrInsertPC(track: MidiTrack, channel: number, program: number): void {
    const existing = track.events.find(
      (e) => e.type === 'programChange' && (e.channel === undefined || e.channel === channel)
    );
    if (existing) {
      existing.program = program;
      existing.channel = channel;
    } else {
      const firstNoteIdx = track.events.findIndex((e) => e.type === 'noteOn');
      const insertIdx = firstNoteIdx >= 0 ? firstNoteIdx : 0;
      track.events.splice(insertIdx, 0, {
        delta: 0,
        type: 'programChange',
        channel,
        program,
      });
    }
  }

  /**
   * 更新指定 Pad 音軌中特定音符的力度 (Velocity)、長度 (Duration Ticks)、起始位置 (Start Tick) 或音高 (Note Number)
   */
  public static updateNoteEvent(
    parsed: YamahaFileParsed,
    padNum: number,
    target: { note: number; startTick: number; oldDurationTick: number },
    updates: { velocity?: number; durationTick?: number; startTick?: number; note?: number }
  ): boolean {
    const track = parsed.tracks[padNum];
    if (!track || !track.events) return false;

    let curTick = 0;
    const annotated = track.events.map((ev, index) => {
      curTick += ev.delta;
      return { ev, absTick: curTick, index };
    });

    // 尋找目標 Note-On 事件
    const onEntry = annotated.find(
      (item) =>
        item.absTick === target.startTick &&
        item.ev.type === 'noteOn' &&
        item.ev.noteNumber === target.note &&
        (item.ev.velocity ?? 0) > 0
    );
    if (!onEntry) return false;

    // 尋找對應的 Note-Off 事件 (Note-Off 或 Note-On with vel=0)
    let offEntry = annotated.find(
      (item) =>
        item.index > onEntry.index &&
        item.absTick === target.startTick + target.oldDurationTick &&
        item.ev.noteNumber === target.note &&
        (item.ev.type === 'noteOff' || (item.ev.type === 'noteOn' && item.ev.velocity === 0))
    );

    if (!offEntry) {
      // 容錯備用：找第一個在此 Note-On 之後的 Note-Off
      offEntry = annotated.find(
        (item) =>
          item.index > onEntry.index &&
          item.ev.noteNumber === target.note &&
          (item.ev.type === 'noteOff' || (item.ev.type === 'noteOn' && item.ev.velocity === 0))
      );
    }

    let modified = false;

    // 計算當前有效音長 (供移動起始位置時保持音長)
    const effectiveDur = updates.durationTick !== undefined
      ? Math.max(1, Math.round(updates.durationTick))
      : (offEntry ? offEntry.absTick - onEntry.absTick : target.oldDurationTick);

    // 更新力度 (Velocity)
    if (updates.velocity !== undefined) {
      const newVel = Math.max(1, Math.min(127, Math.round(updates.velocity)));
      onEntry.ev.velocity = newVel;
      modified = true;
    }

    // 更新音高 (Note Number)
    if (updates.note !== undefined) {
      const newNote = Math.max(0, Math.min(127, Math.round(updates.note)));
      onEntry.ev.noteNumber = newNote;
      if (offEntry) offEntry.ev.noteNumber = newNote;
      modified = true;
    }

    // 更新起始位置 (Start Tick)
    if (updates.startTick !== undefined) {
      const newStart = Math.max(0, Math.round(updates.startTick));
      onEntry.absTick = newStart;
      if (offEntry) offEntry.absTick = newStart + effectiveDur;
      modified = true;
    } else if (updates.durationTick !== undefined && offEntry) {
      // 若只更新音長，不變更起始位置
      offEntry.absTick = onEntry.absTick + effectiveDur;
      modified = true;
    }

    if (!modified) return false;

    // 保證 End of Track (0x2F) 不早於任何事件
    const endMeta = annotated.find((item) => item.ev.type === 'meta' && item.ev.metaType === 0x2f);
    if (endMeta) {
      for (const item of annotated) {
        if (item.ev !== endMeta.ev && item.absTick > endMeta.absTick) {
          endMeta.absTick = item.absTick;
        }
      }
    }

    // 依據 absTick 重新排序，若 absTick 相同則維持原有相對順序
    annotated.sort((a, b) => {
      if (a.absTick !== b.absTick) return a.absTick - b.absTick;
      return a.index - b.index;
    });

    // 重新計算各事件之 delta-time
    let prevTick = 0;
    track.events = annotated.map((item) => {
      const delta = item.absTick - prevTick;
      prevTick = item.absTick;
      item.ev.delta = Math.max(0, delta);
      return item.ev;
    });

    // 重新編碼該 Track 的二進位 rawChunk
    this.rebuildTrackRawChunk(track);
    return true;
  }

  /**
   * 重新編碼標準 MIDI Track (MTrk) 的二進位 Byte Buffer
   */
  public static rebuildTrackRawChunk(track: MidiTrack): void {
    const writer = new BinaryWriter();

    for (const ev of track.events) {
      // 寫入 Delta-time
      writer.writeVarInt(ev.delta);

      if (ev.type === 'meta') {
        writer.writeUint8(0xff);
        writer.writeUint8(ev.metaType ?? 0);
        const data = ev.metaData ?? new Uint8Array(0);
        writer.writeVarInt(data.length);
        writer.writeBytes(data);
      } else if (ev.type === 'sysex') {
        writer.writeUint8(0xf0);
        const data = ev.rawBytes ?? new Uint8Array(0);
        writer.writeVarInt(data.length);
        writer.writeBytes(data);
      } else {
        const channel = (ev.channel ?? 0) & 0x0f;
        let statusByte = 0;

        if (ev.type === 'noteOn') {
          statusByte = 0x90 | channel;
        } else if (ev.type === 'noteOff') {
          statusByte = 0x80 | channel;
        } else if (ev.type === 'controlChange') {
          statusByte = 0xb0 | channel;
        } else if (ev.type === 'programChange') {
          statusByte = 0xc0 | channel;
        } else if (ev.type === 'pitchBend') {
          statusByte = 0xe0 | channel;
        }

        if (statusByte !== 0) {
          writer.writeUint8(statusByte);

          if (ev.type === 'noteOn' || ev.type === 'noteOff') {
            writer.writeUint8((ev.noteNumber ?? 60) & 0x7f);
            writer.writeUint8((ev.velocity ?? 64) & 0x7f);
          } else if (ev.type === 'controlChange') {
            writer.writeUint8((ev.controller ?? 0) & 0x7f);
            writer.writeUint8((ev.value ?? 0) & 0x7f);
          } else if (ev.type === 'programChange') {
            writer.writeUint8((ev.program ?? 0) & 0x7f);
          } else if (ev.type === 'pitchBend') {
            const val = ev.value ?? 8192;
            writer.writeUint8(val & 0x7f);
            writer.writeUint8((val >> 7) & 0x7f);
          }
        }
      }
    }

    const eventBytes = writer.toUint8Array();

    // 組裝 MTrk 標頭與長度
    const chunkWriter = new BinaryWriter();
    chunkWriter.writeString('MTrk');
    chunkWriter.writeUint32BE(eventBytes.length);
    chunkWriter.writeBytes(eventBytes);

    track.rawChunk = chunkWriter.toUint8Array();
  }
}
