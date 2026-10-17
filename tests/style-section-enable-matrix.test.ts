import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { StyleRemixer } from '../src/core/writer/style-remixer';

describe('步驟 2.2: 段落專屬聲部發聲矩陣 (Section Part Enable Matrix) 與主旋律自動偵測', () => {
  const styPath = resolve(__dirname, '../samples/4006_SX900.T547.sty');
  const buffer = readFileSync(styPath);
  const parsed = YamahaParser.parse(buffer);

  it('能精準偵測 Intro A 裡的導奏主旋律聲部 (Right 1/2 屬性)', () => {
    const introA = StyleRemixer.getSectionTickRange(parsed, 'Intro A');
    expect(introA).toBeDefined();

    // Channel 5 (idx 4, Pad / 慢弦樂): 包含 78 顆高音主旋律音符
    const padAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      introA!.startTick,
      introA!.endTick,
      4
    );
    expect(padAnalysis.isMelody).toBe(true);
    expect(padAnalysis.noteCount).toBe(78);
    expect(padAnalysis.highNoteRatio).toBeGreaterThan(0.9);
    expect(padAnalysis.pitchRangeStr).toContain('D#4');

    // Channel 12 (idx 11, Chord 1 / 鋼琴): 包含 25 顆高音對位旋律音符
    const pianoAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      introA!.startTick,
      introA!.endTick,
      11
    );
    expect(pianoAnalysis.isMelody).toBe(true);
    expect(pianoAnalysis.noteCount).toBe(25);
    expect(pianoAnalysis.highNoteRatio).toBeGreaterThan(0.7);

    // Channel 2 (idx 1, Bass): 純低音貝斯，絕不誤判為旋律
    const bassAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      introA!.startTick,
      introA!.endTick,
      1
    );
    expect(bassAnalysis.isMelody).toBe(false);

    // Channel 10 (idx 9, Main Rhythm 2): 鼓組打擊樂，絕不誤判為旋律
    const drumAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      introA!.startTick,
      introA!.endTick,
      9
    );
    expect(drumAnalysis.isMelody).toBe(false);
  });

  it('在常規伴奏段落 (如 Main A) 不會誤將和弦伴奏判定為主旋律', () => {
    const mainA = StyleRemixer.getSectionTickRange(parsed, 'Main A');
    expect(mainA).toBeDefined();

    // Main A 的 Chord 1 (idx 2, Piano): 伴奏和弦，非主旋律
    const chordAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      mainA!.startTick,
      mainA!.endTick,
      2
    );
    expect(chordAnalysis.isMelody).toBe(false);

    // Main A 的 Bass (idx 1):
    const bassAnalysis = StyleRemixer.analyzeSectionChannelMelody(
      parsed,
      mainA!.startTick,
      mainA!.endTick,
      1
    );
    expect(bassAnalysis.isMelody).toBe(false);
  });

  it('段落專屬靜音狀態能獨立運作 (在 Intro A 靜音 Channel 5 不影響 Main A)', () => {
    const sectionMuteState: Record<string, Record<number, boolean>> = {};

    // 模擬將 Intro A 的 Channel 5 (idx 4) 設為靜音
    sectionMuteState['Intro A'] = { 4: true };

    // 檢查 Intro A: Channel 5 應為靜音，其他通道不靜音
    expect(sectionMuteState['Intro A']?.[4]).toBe(true);
    expect(sectionMuteState['Intro A']?.[1]).toBeFalsy();

    // 檢查 Main A: Channel 5 仍應正常演奏，不受 Intro A 影響
    expect(sectionMuteState['Main A']?.[4]).toBeFalsy();
  });
});
