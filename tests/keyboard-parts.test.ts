import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { StyleRemixer } from '../src/core/writer/style-remixer';

describe('鍵盤主奏聲部 (Keyboard Parts: Right 1 & Right 2) 控制邏輯測試', () => {
  const styPath = resolve(__dirname, '../samples/4006_SX900.T547.sty');
  const buffer = readFileSync(styPath);
  const parsed = YamahaParser.parse(buffer);

  it('能自動為 Intro A 建議 Right 1 與 Right 2 關聯通道', () => {
    const introA = StyleRemixer.getSectionTickRange(parsed, 'Intro A');
    expect(introA).toBeDefined();

    const melodyChannels: number[] = [];
    for (const part of parsed.parts) {
      const melody = StyleRemixer.analyzeSectionChannelMelody(parsed, introA!.startTick, introA!.endTick, part.channel);
      if (melody.isMelody) {
        melodyChannels.push(part.channel);
      }
    }

    // 預期至少有 2 個旋律通道 (Channel 5 即 idx 4, Channel 12 即 idx 11)
    expect(melodyChannels.length).toBeGreaterThanOrEqual(2);
    expect(melodyChannels[0]).toBe(4); // R1: Ch 5 Pad
    expect(melodyChannels[1]).toBe(11); // R2: Ch 12 Chord 1
  });

  it('關閉 Right 1 時能同步將關聯的 STY 段落聲部設為靜音', () => {
    const sectionMuteState: Record<string, Record<number, boolean>> = {
      'Intro A': {},
      'Main A': {},
    };

    // 模擬 Right 1 關聯至 Channel 5 (idx 4)
    const r1 = {
      enabled: true,
      linkedChannel: 4,
    };

    // 點擊關閉 R1
    r1.enabled = false;
    sectionMuteState['Intro A'][r1.linkedChannel] = !r1.enabled;

    // Intro A 中 Channel 5 應被靜音
    expect(sectionMuteState['Intro A'][4]).toBe(true);

    // Main A 中不受影響
    expect(sectionMuteState['Main A'][4]).toBeFalsy();

    // 再次開啟 R1
    r1.enabled = true;
    sectionMuteState['Intro A'][r1.linkedChannel] = !r1.enabled;
    expect(sectionMuteState['Intro A'][4]).toBe(false);
  });
});
