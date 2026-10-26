import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { StyLoader } from '../src/creator/sty-loader';
import { YamahaTemplateStyleSynthesizer } from '../src/core/writer/template-style-synthesizer';
import { YamahaParser } from '../src/core/parser/yamaha-parser';

describe('StyLoader: 實體 STY 伴奏載入與解構驗證', () => {
  const samplePath = path.resolve(__dirname, '../public/samples/4006_SX900.T547.sty');

  it('能正確載入真實 PSR-SX900/SX920 STY 伴奏檔並解構出完整段落與音軌', () => {
    expect(fs.existsSync(samplePath)).toBe(true);
    const buf = fs.readFileSync(samplePath);
    const bytes = new Uint8Array(buf);

    const result = StyLoader.loadFromBytes(bytes, '4006_SX900.T547.sty');

    expect(result.fileName).toBe('4006_SX900.T547.sty');
    expect(result.bpm).toBeGreaterThan(60);
    expect(result.timeSignature.numerator).toBe(4);
    expect(result.timeSignature.denominator).toBe(4);
    expect(result.division).toBeGreaterThan(0);

    // 驗證解析出之段落清單
    expect(result.sections.size).toBeGreaterThan(5);
    expect(result.sections.has('Main A')).toBe(true);
    expect(result.sections.has('Main B')).toBe(true);
    expect(result.sections.has('Intro A')).toBe(true);
    expect(result.sections.has('Break')).toBe(true); // Fill In BA 對應至 Break

    // 檢查 Main A 音符資料
    const mainA = result.sections.get('Main A')!;
    expect(mainA.bars).toBeGreaterThanOrEqual(1);

    // 驗證鼓組點陣圖有打擊點
    let drumNoteCount = 0;
    mainA.drumPattern.forEach(steps => {
      drumNoteCount += steps.filter(Boolean).length;
    });
    expect(drumNoteCount).toBeGreaterThan(0);

    // 驗證貝斯音符
    expect(mainA.bassPattern.size).toBeGreaterThan(0);

    // 驗證和弦音符
    expect(mainA.chordPattern.size).toBeGreaterThan(0);

    // 驗證收集到的打擊樂器清單包含大鼓 (35 或 36) 與打擊樂器
    const hasKick = result.activeDrumNotes.includes(35) || result.activeDrumNotes.includes(36);
    expect(hasKick).toBe(true);
    expect(result.activeDrumNotes.length).toBeGreaterThan(5);

    // 驗證動態伴奏聲部
    console.log('載入成功摘要:', result.summary);
    console.log('動態啟用的聲部:', result.activeDynamicPartIds);
  });

  it('載入 STY 後修改音符並透過 TemplateSynthesizer 再度合成，音符成功更新且保留原曲結構', () => {
    const buf = fs.readFileSync(samplePath);
    const bytes = new Uint8Array(buf);
    const result = StyLoader.loadFromBytes(bytes, '4006_SX900.T547.sty');

    const mainA = result.sections.get('Main A')!;
    // 在 Main A 第 1 步進 (step 0) 人工加入一個明顯標記音符 (例如 Ride 51 與 Crash 49)
    if (!mainA.drumPattern.has(49)) {
      mainA.drumPattern.set(49, new Array(mainA.bars * 16).fill(false));
    }
    mainA.drumPattern.get(49)![0] = true;

    // 將解構出的 sections 轉入 TemplateSynthesizer 進行合成
    const sectionsInput = Array.from(result.sections.values()).map(s => ({
      name: s.name,
      bars: s.bars,
      stepsPerBar: 16,
      drumPattern: s.drumPattern,
      bassPattern: s.bassPattern,
      chordPattern: s.chordPattern,
      dynamicPatterns: s.dynamicPatterns,
    }));

    const exportedBytes = YamahaTemplateStyleSynthesizer.synthesizeFromTemplate({
      styleName: 'Modified_SX900',
      bpm: result.bpm,
      drumKit: { msb: result.drumKit.msb, lsb: result.drumKit.lsb, pc: result.drumKit.pc },
      bassVoice: { msb: result.bassVoice.msb, lsb: result.bassVoice.lsb, pc: result.bassVoice.pc },
      chordVoice: { msb: result.chordVoice.msb, lsb: result.chordVoice.lsb, pc: result.chordVoice.pc },
      sections: sectionsInput,
    });

    expect(exportedBytes).toBeDefined();
    expect(exportedBytes.length).toBeGreaterThan(10000);

    // 逆向驗證匯出檔案
    const parsedExport = YamahaParser.parse(exportedBytes, 'STY');
    expect(parsedExport.format).toBe('STY');
    expect(parsedExport.division).toBe(1920);

    // 驗證 Main A 中確實包含修改後之 NoteOn
    const tr0 = parsedExport.tracks[0];
    let t = 0;
    let mainACrashFound = false;

    const mainASec = parsedExport.sections.find(s => s.name === 'Main A')!;
    expect(mainASec).toBeDefined();

    for (const ev of tr0.events) {
      t += ev.delta;
      if (t >= mainASec.startTick && (mainASec.endTick === undefined || t < mainASec.endTick)) {
        if (ev.type === 'noteOn' && ev.noteNumber === 49 && (ev.velocity ?? 0) > 0) {
          mainACrashFound = true;
          break;
        }
      }
    }

    expect(mainACrashFound).toBe(true);
  });
});
