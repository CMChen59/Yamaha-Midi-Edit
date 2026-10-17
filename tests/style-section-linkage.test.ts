import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { StyleRemixer } from '../src/core/writer/style-remixer';

describe('步驟 2.1: STY 伴奏段落選取與聲部發聲連動 (Section & Parts Mixer Linkage)', () => {
  const sampleStyPath = path.resolve(__dirname, '../public/samples/4006_SX900.T547.sty');
  const buffer = fs.readFileSync(sampleStyPath);
  const parsed = YamahaParser.parse(new Uint8Array(buffer), 'STY');

  it('1. 解析真實 STY 檔案時，SFF1 通道 (0~7) 能正確映射為親切聲部名稱而非通用 Part N', () => {
    const ch1 = parsed.parts.find(p => p.channel === 1);
    const ch2 = parsed.parts.find(p => p.channel === 2);
    const ch3 = parsed.parts.find(p => p.channel === 3);
    const ch4 = parsed.parts.find(p => p.channel === 4);

    expect(ch1).toBeDefined();
    expect(ch1!.partName).toContain('Bass');
    expect(ch2!.partName).toContain('Chord 1');
    expect(ch3!.partName).toContain('Chord 2');
    expect(ch4!.partName).toContain('Pad');
  });

  it('2. 正確計算各段落的時間軸範圍 (Tick Range & Measure Count)', () => {
    const rangeMainA = StyleRemixer.getSectionTickRange(parsed, 'Main A');
    expect(rangeMainA).not.toBeNull();
    expect(rangeMainA!.startTick).toBe(7680);
    expect(rangeMainA!.endTick).toBe(69120);
    expect(rangeMainA!.measureCount).toBe(8);

    const rangeIntroA = StyleRemixer.getSectionTickRange(parsed, 'Intro A');
    expect(rangeIntroA).not.toBeNull();
    expect(rangeIntroA!.startTick).toBe(276480);
    expect(rangeIntroA!.endTick).toBe(353280);
    expect(rangeIntroA!.measureCount).toBe(10);
  });

  it('3. 伴奏聲部音符數隨所選段落動態連動，精確反映演奏中 (發聲) 與未演奏 (靜音) 狀態', () => {
    const rangeMainA = StyleRemixer.getSectionTickRange(parsed, 'Main A')!;
    const rangeIntroA = StyleRemixer.getSectionTickRange(parsed, 'Intro A')!;

    // Main A 段落各聲部音符
    const mainABassNotes = StyleRemixer.countNotesInChannel(parsed, rangeMainA.startTick, rangeMainA.endTick, 1);
    const mainAChord1Notes = StyleRemixer.countNotesInChannel(parsed, rangeMainA.startTick, rangeMainA.endTick, 2);
    const mainAPadNotes = StyleRemixer.countNotesInChannel(parsed, rangeMainA.startTick, rangeMainA.endTick, 4);
    const mainASubRhythmNotes = StyleRemixer.countNotesInChannel(parsed, rangeMainA.startTick, rangeMainA.endTick, 8);

    // 在 Main A 中，Bass 與 Chord 1 演奏中，Pad 與 Sub Rhythm 未演奏 (0 音符)
    expect(mainABassNotes).toBe(34);
    expect(mainAChord1Notes).toBe(66);
    expect(mainAPadNotes).toBe(0);
    expect(mainASubRhythmNotes).toBe(0);

    // Intro A 段落各聲部音符
    const introABassNotes = StyleRemixer.countNotesInChannel(parsed, rangeIntroA.startTick, rangeIntroA.endTick, 1);
    const introAPadNotes = StyleRemixer.countNotesInChannel(parsed, rangeIntroA.startTick, rangeIntroA.endTick, 4);
    const introASubRhythmNotes = StyleRemixer.countNotesInChannel(parsed, rangeIntroA.startTick, rangeIntroA.endTick, 8);

    // 在 Intro A 中，Pad 與 Sub Rhythm 轉為演奏中！
    expect(introABassNotes).toBe(37);
    expect(introAPadNotes).toBe(78);
    expect(introASubRhythmNotes).toBe(35);
  });

  it('4. 能正確檢測與提取段落專屬 (Section-Specific) 的音色與控制覆寫', () => {
    const rangeIntroA = StyleRemixer.getSectionTickRange(parsed, 'Intro A')!;
    const override = StyleRemixer.getSectionChannelOverride(parsed, rangeIntroA.startTick, rangeIntroA.endTick, 1);

    // 驗證結構傳回
    expect(override).toBeDefined();
    expect(typeof override).toBe('object');
  });
});
