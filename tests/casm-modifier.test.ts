import { describe, it, expect } from 'vitest';
import { CasmModifier, CASM_STANDARD_PRESETS } from '../src/core/writer/casm-modifier';
import { YamahaStyleSynthesizer } from '../src/core/writer/style-synthesizer';

describe('CasmModifier CASM 轉調規則編輯引擎測試', () => {
  it('1. 能取得完整的 8 聲部預設 CASM 規則清單', () => {
    const rules = CasmModifier.getDefaultPartRules();
    expect(rules).toHaveLength(8);

    const bass = rules.find((r) => r.partId === 'Bass');
    expect(bass).toBeDefined();
    expect(bass?.ntr).toBe('Root Transpose');
    expect(bass?.ntt).toBe('Bass');

    const rhy1 = rules.find((r) => r.partId === 'Rhythm1');
    expect(rhy1?.ntr).toBe('Root Fixed');
    expect(rhy1?.ntt).toBe('Bypass');
  });

  it('2. 能自合成空白 Style 中提取 CASM 規則並驗證結構', () => {
    const style = YamahaStyleSynthesizer.createBlankStyle({
      styleName: 'TestStyle',
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      division: 480,
      sections: [{ name: 'Main A', bars: 4 }],
    });

    expect(style.hasCasm).toBe(true);
    const extracted = CasmModifier.extractPartRules(style);
    expect(extracted).toHaveLength(8);

    const chord1 = extracted.find((r) => r.partId === 'Chord1');
    expect(chord1?.ntr).toBe('Root Transpose');
    expect(chord1?.ntt).toBe('Chord');
  });

  it('3. 能修改聲部 NTR/NTT 與音域極限並成功回寫二進位 CASM', () => {
    const style = YamahaStyleSynthesizer.createBlankStyle({
      styleName: 'TestStyle',
      bpm: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      division: 480,
      sections: [{ name: 'Main A', bars: 4 }],
    });

    const rules = CasmModifier.extractPartRules(style);
    // 將 Phrase 1 修改為 Root Fixed + Bypass (自訂不轉調)
    const phr1 = rules.find((r) => r.partId === 'Phrase1');
    if (phr1) {
      phr1.ntr = 'Root Fixed';
      phr1.ntt = 'Bypass';
      phr1.noteLowLimit = 40;
      phr1.noteHighLimit = 80;
    }

    const res = CasmModifier.updateParsedCasm(style, rules);
    expect(res.success).toBe(true);

    // 重新提取驗證
    const reExtracted = CasmModifier.extractPartRules(style);
    const rePhr1 = reExtracted.find((r) => r.partId === 'Phrase1');
    expect(rePhr1?.ntr).toBe('Root Fixed');
    expect(rePhr1?.ntt).toBe('Bypass');
    expect(rePhr1?.noteLowLimit).toBe(40);
    expect(rePhr1?.noteHighLimit).toBe(80);
  });
});
