import { describe, it, expect } from 'vitest';
import { YamahaStyleSynthesizer } from '../src/core/writer/style-synthesizer';
import { YamahaStyleModifier } from '../src/core/writer/style-modifier';
import { YamahaParser } from '../src/core/parser/yamaha-parser';

describe('Phase 4.1: YamahaStyleModifier 伴奏風格 8 聲部混音與音色修改引擎', () => {
  it('能即時修改 STY 聲部的音量、聲相、殘響與合唱參數，並同步至 Track 0 事件與 rawChunk', () => {
    const style = YamahaStyleSynthesizer.createBlankStyle({
      styleName: 'Test Style',
    });

    // 1. 修改 Bass 聲部 (Channel 10) 的混音參數
    const success = YamahaStyleModifier.setPartMixing(style, 10, {
      volume: 115,
      pan: 32, // L32
      reverb: 55,
      chorus: 20,
    });

    expect(success).toBe(true);

    // 驗證 parsed.parts 是否更新
    const bassPart = style.parts.find((p) => p.channel === 10);
    expect(bassPart?.volume).toBe(115);
    expect(bassPart?.pan).toBe(32);
    expect(bassPart?.reverb).toBe(55);
    expect(bassPart?.chorus).toBe(20);

    // 驗證 Track 0 開頭事件是否同步更新
    const events = style.tracks[0].events;
    const volEv = events.find((e) => e.type === 'controlChange' && e.channel === 10 && e.controller === 7);
    const panEv = events.find((e) => e.type === 'controlChange' && e.channel === 10 && e.controller === 10);
    const revEv = events.find((e) => e.type === 'controlChange' && e.channel === 10 && e.controller === 91);
    const choEv = events.find((e) => e.type === 'controlChange' && e.channel === 10 && e.controller === 93);

    expect(volEv?.value).toBe(115);
    expect(panEv?.value).toBe(32);
    expect(revEv?.value).toBe(55);
    expect(choEv?.value).toBe(20);

    // 驗證二進位序列化與回讀雙向相容
    const bytes = YamahaStyleSynthesizer.serializeToStyleFile(style);
    const reparsed = YamahaParser.parse(bytes, 'STY');
    const reparsedBass = reparsed.parts.find((p) => p.channel === 10);
    expect(reparsedBass?.volume).toBe(115);
    expect(reparsedBass?.pan).toBe(32);
    expect(reparsedBass?.reverb).toBe(55);
    expect(reparsedBass?.chorus).toBe(20);
  });

  it('能即時更換 STY 聲部的音色 (Bank MSB/LSB/PC)，且對鼓組聲部執行 Bank MSB 127 強制保護', () => {
    const style = YamahaStyleSynthesizer.createBlankStyle({
      styleName: 'Test Style',
    });

    // 1. 更換 Chord 1 (Channel 11) 為 Grand Piano (Bank 0-112, PC 0)
    YamahaStyleModifier.setPartMixing(style, 11, {
      bankMsb: 0,
      bankLsb: 112,
      programChange: 0,
    });
    const chord1 = style.parts.find((p) => p.channel === 11);
    expect(chord1?.bankMsb).toBe(0);
    expect(chord1?.bankLsb).toBe(112);
    expect(chord1?.programChange).toBe(0);

    // 2. 測試鼓組聲部 (Channel 9, Rhythm 2)：若傳入 bankMsb = 0，自動防護強制鎖定為 127
    YamahaStyleModifier.setPartMixing(style, 9, {
      bankMsb: 0, // 嘗試設為 0
      bankLsb: 0,
      programChange: 8, // Room Kit
    });
    const drumPart = style.parts.find((p) => p.channel === 9);
    expect(drumPart?.bankMsb).toBe(127); // 強制保護
    expect(drumPart?.programChange).toBe(8);

    // 驗證 Track 0 中的 PC 與 CC 0
    const events = style.tracks[0].events;
    const drumPc = events.find((e) => e.type === 'programChange' && e.channel === 9);
    const drumMsb = events.find((e) => e.type === 'controlChange' && e.channel === 9 && e.controller === 0);
    expect(drumPc?.program).toBe(8);
    expect(drumMsb?.value).toBe(127);
  });
});
