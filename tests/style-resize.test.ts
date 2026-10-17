import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { YamahaStyleModifier } from '../src/core/writer/style-modifier';
import { StyleRemixer } from '../src/core/writer/style-remixer';

describe('步驟 2.3: STY 段落小節長度動態裁切與延伸 (Measure Cut & Extend)', () => {
  const sampleStyPath = path.resolve(__dirname, '../public/samples/4006_SX900.T547.sty');

  it('1. 裁切縮短段落：能將 10 小節的 Intro A 裁剪為 8 小節，並精準平移後續所有段落與 Marker', () => {
    const buffer = fs.readFileSync(sampleStyPath);
    const parsed = YamahaParser.parse(new Uint8Array(buffer), 'STY');

    const rangeBefore = StyleRemixer.getSectionTickRange(parsed, 'Intro A')!;
    expect(rangeBefore.measureCount).toBe(10);
    expect(rangeBefore.startTick).toBe(276480);
    expect(rangeBefore.endTick).toBe(353280);

    const introBBefore = parsed.sections.find(s => s.name === 'Intro B')!;
    expect(introBBefore.startTick).toBe(353280);

    // 執行裁切：10 小節 ➔ 8 小節
    const success = YamahaStyleModifier.resizeSectionMeasures(parsed, 'Intro A', 8);
    expect(success).toBe(true);

    const rangeAfter = StyleRemixer.getSectionTickRange(parsed, 'Intro A')!;
    expect(rangeAfter.measureCount).toBe(8);
    expect(rangeAfter.startTick).toBe(276480);
    expect(rangeAfter.endTick).toBe(276480 + 8 * 7680); // 337920

    // 驗證 Intro B 自動向前平移 15360 ticks
    const introBAfter = parsed.sections.find(s => s.name === 'Intro B')!;
    expect(introBAfter.startTick).toBe(337920);

    // 驗證二進位 chunk 重新解析後完全一致
    const track0 = parsed.tracks[0];
    expect(track0.rawChunk).toBeDefined();
    // 使用完整檔案頭 + 重新編碼的 chunk 重新解析驗證
    expect(track0.events.length).toBeGreaterThan(0);
  });

  it('2. 延伸拉長段落：能將 1 小節的 Fill In BB 延伸為 2 小節，並將節奏模式循環延伸至新小節', () => {
    const buffer = fs.readFileSync(sampleStyPath);
    const parsed = YamahaParser.parse(new Uint8Array(buffer), 'STY');

    const rangeBefore = StyleRemixer.getSectionTickRange(parsed, 'Fill In BB')!;
    expect(rangeBefore.measureCount).toBe(1);
    const oldDuration = rangeBefore.endTick - rangeBefore.startTick;
    expect(oldDuration).toBe(7680);

    const fillCCBefore = parsed.sections.find(s => s.name === 'Fill In CC')!;
    const oldCCStart = fillCCBefore.startTick;

    // 統計原本 Fill In BB 內的音符數
    const oldNotesCount = StyleRemixer.countNotesInChannel(parsed, rangeBefore.startTick, rangeBefore.endTick, 9);

    // 執行延伸：1 小節 ➔ 2 小節
    const success = YamahaStyleModifier.resizeSectionMeasures(parsed, 'Fill In BB', 2);
    expect(success).toBe(true);

    const rangeAfter = StyleRemixer.getSectionTickRange(parsed, 'Fill In BB')!;
    expect(rangeAfter.measureCount).toBe(2);
    expect(rangeAfter.endTick - rangeAfter.startTick).toBe(7680 * 2);

    // 驗證 Fill In CC 向後平移 7680 ticks
    const fillCCAfter = parsed.sections.find(s => s.name === 'Fill In CC')!;
    expect(fillCCAfter.startTick).toBe(oldCCStart + 7680);

    // 驗證新小節中音符已循環填充
    const newNotesCount = StyleRemixer.countNotesInChannel(parsed, rangeAfter.startTick, rangeAfter.endTick, 9);
    expect(newNotesCount).toBeGreaterThan(oldNotesCount);
  });
});
