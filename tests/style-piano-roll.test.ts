import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { StyleRemixer } from '../src/core/writer/style-remixer';
import { resolveAuditionInstrumentId } from '../src/core/data/yamaha-voices';

describe('步驟 3.1: STY 段落聲部鋼琴卷軸 (Piano Roll) 音符提取與時序視覺化驗證', () => {
  const sampleStyPath = path.resolve(__dirname, '../public/samples/4006_SX900.T547.sty');
  const buffer = fs.readFileSync(sampleStyPath);
  const parsed = YamahaParser.parse(new Uint8Array(buffer), 'STY');

  it('1. 能為伴奏段落 (Main A) 精確提取各聲部相對段落起點的音符時序 (Relative Ticks)', () => {
    const range = StyleRemixer.getSectionTickRange(parsed, 'Main A');
    expect(range).not.toBeNull();
    expect(range!.startTick).toBe(7680);
    expect(range!.endTick).toBe(69120);
    expect(range!.measureCount).toBe(8);

    const totalSectionTicks = range!.endTick - range!.startTick; // 61440 ticks

    // Channel 1: Bass 聲部
    const bassNotes = StyleRemixer.extractSectionChannelNotes(parsed, range!.startTick, range!.endTick, 1);
    expect(bassNotes.length).toBe(34);

    for (const note of bassNotes) {
      // 相對 Tick 必須從 0 起算，且不得超出段落時長
      expect(note.startTick).toBeGreaterThanOrEqual(0);
      expect(note.startTick).toBeLessThan(totalSectionTicks);
      expect(note.durationTick).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
      // Bass 音高應在合理低音音域內 (C1~C4: 24~60)
      expect(note.note).toBeGreaterThanOrEqual(24);
      expect(note.note).toBeLessThanOrEqual(60);
    }

    // Channel 2: Chord 1 和弦聲部
    const chordNotes = StyleRemixer.extractSectionChannelNotes(parsed, range!.startTick, range!.endTick, 2);
    expect(chordNotes.length).toBe(66);
    for (const note of chordNotes) {
      expect(note.startTick).toBeGreaterThanOrEqual(0);
      expect(note.startTick).toBeLessThan(totalSectionTicks);
      expect(note.durationTick).toBeGreaterThan(0);
    }
  });

  it('2. 在高音旋律伴奏段落 (Intro A) 中，精準提取 Sub Rhythm (Ch 8 / PC 75 跳躍撥弦) 之音符與音高', () => {
    const range = StyleRemixer.getSectionTickRange(parsed, 'Intro A');
    expect(range).not.toBeNull();
    expect(range!.startTick).toBe(276480);
    expect(range!.endTick).toBe(353280);
    expect(range!.measureCount).toBe(10);

    const totalSectionTicks = range!.endTick - range!.startTick; // 76800 ticks

    // Channel 8 (Sub Rhythm, 螢幕顯示 Ch 9)：在 Intro A 中演奏跳躍撥弦 Pizzicato 旋律
    const subRhythmNotes = StyleRemixer.extractSectionChannelNotes(parsed, range!.startTick, range!.endTick, 8);
    expect(subRhythmNotes.length).toBe(35);

    // 檢查音高分佈：原檔中為 A#4 (70) ~ G5 (79) 的輕快撥弦
    const pitches = subRhythmNotes.map(n => n.note);
    const minPitch = Math.min(...pitches);
    const maxPitch = Math.max(...pitches);
    expect(minPitch).toBe(70); // A#4
    expect(maxPitch).toBe(87); // D#6

    for (const note of subRhythmNotes) {
      expect(note.startTick).toBeGreaterThanOrEqual(0);
      expect(note.startTick).toBeLessThan(totalSectionTicks);
      expect(note.durationTick).toBeGreaterThan(0);
    }

    // 驗證音色解析為跳躍撥弦 (pizzicato)，而非打擊樂器
    const inst = resolveAuditionInstrumentId(0, 113, 75, 8);
    expect(inst.instrumentId).toBe('pizzicato');
    expect(inst.isDrum).toBe(false);
  });

  it('3. 段落內未演奏 (空白) 的聲部能安全返回空陣列，供鋼琴卷軸繪製純淨小節網格', () => {
    const range = StyleRemixer.getSectionTickRange(parsed, 'Main A');
    expect(range).not.toBeNull();

    // 在 Main A 中，Channel 4 (Pad) 與 Channel 8 (Sub Rhythm) 為靜音 (0 音符)
    const emptyPadNotes = StyleRemixer.extractSectionChannelNotes(parsed, range!.startTick, range!.endTick, 4);
    const emptySubRhythmNotes = StyleRemixer.extractSectionChannelNotes(parsed, range!.startTick, range!.endTick, 8);

    expect(emptyPadNotes).toEqual([]);
    expect(emptySubRhythmNotes).toEqual([]);
  });

  it('4. 驗證相對時鐘對齊演算法：音符的 startTick 加上段落 startTick 100% 等於 SMF Track 0 的絕對時鐘', () => {
    const range = StyleRemixer.getSectionTickRange(parsed, 'Intro A')!;
    const notes = StyleRemixer.extractSectionChannelNotes(parsed, range.startTick, range.endTick, 8);

    // 從原始 Track 0 收集絕對時鐘
    const track0 = parsed.tracks[0];
    let absTick = 0;
    const absStartTicks: number[] = [];
    for (const ev of track0.events) {
      absTick += ev.delta;
      if (absTick >= range.startTick && absTick < range.endTick && ev.channel === 8 && ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        absStartTicks.push(absTick);
      }
    }

    expect(notes.length).toBe(absStartTicks.length);
    for (let i = 0; i < notes.length; i++) {
      expect(notes[i].startTick + range.startTick).toBe(absStartTicks[i]);
    }
  });

  it('5. 鋼琴卷軸樂器與發聲身分證解析：各聲部皆能正確獲得專屬合成器模型', () => {
    // Channel 9: Main Rhythm (標準鼓組)
    const drumInst = resolveAuditionInstrumentId(127, 0, 89, 9);
    expect(drumInst.isDrum).toBe(true);
    expect(drumInst.instrumentId).toBe('standard-drum-kit');

    // Channel 1: Bass (電貝斯)
    const bassInst = resolveAuditionInstrumentId(104, 2, 33, 1);
    expect(bassInst.isDrum).toBe(false);
    expect(bassInst.instrumentId).toBe('electric-bass');

    // Channel 2: Chord 1 (鋼琴 / 鍵盤)
    const chordInst = resolveAuditionInstrumentId(104, 1, 0, 2);
    expect(chordInst.isDrum).toBe(false);
    expect(chordInst.instrumentId).toBe('grand-piano');
  });
});
