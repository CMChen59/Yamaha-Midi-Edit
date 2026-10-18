import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { YamahaWriter } from '../src/core/writer/yamaha-writer';
import { YamahaStyleAssembly } from '../src/core/writer/style-assembly';
import { StyleRemixer } from '../src/core/writer/style-remixer';

describe('方案 B: Yamaha 段落聲部組裝精靈 (Style Section Assembly Studio)', () => {
  const sampleStyPath = path.resolve(__dirname, '../public/samples/4006_SX900.T547.sty');

  const getFreshParsed = () => {
    const buffer = fs.readFileSync(sampleStyPath);
    return YamahaParser.parse(new Uint8Array(buffer), 'STY');
  };

  it('1. 能正確解析伴奏段落概覽資訊 (getSectionOverview & getAllSectionsOverview)', () => {
    const parsed = getFreshParsed();
    const overview = YamahaStyleAssembly.getSectionOverview(parsed, 'Main A');

    expect(overview).toBeDefined();
    expect(overview?.name).toBe('Main A');
    expect(overview?.measureCount).toBe(8);
    expect(overview?.parts.length).toBe(8);

    // 檢查全風格概覽
    const allOverviews = YamahaStyleAssembly.getAllSectionsOverview(parsed);
    expect(allOverviews.length).toBeGreaterThan(0);
    const names = allOverviews.map((o) => o.name);
    expect(names).toContain('Main A');
    expect(names).toContain('Main B');
    expect(names).toContain('Fill In BB');
  });

  it('2. 能精準進行單一聲部跨段落組裝替換 (Single Part Assembly - Replace Mode)', () => {
    const parsed = getFreshParsed();

    const mainARange = StyleRemixer.getSectionTickRange(parsed, 'Main A')!;
    const mainBRange = StyleRemixer.getSectionTickRange(parsed, 'Main B')!;

    // 找出在 Main A 有演奏音符的通道
    const overviewA = YamahaStyleAssembly.getSectionOverview(parsed, 'Main A')!;
    const activePartA = overviewA.parts.find((p) => p.noteCount > 0)!;
    expect(activePartA).toBeDefined();
    const channel = activePartA.channel;
    const srcNoteCount = activePartA.noteCount;

    const prevNotesInB = StyleRemixer.countNotesInChannel(
      parsed,
      mainBRange.startTick,
      mainBRange.endTick,
      channel
    );

    // 執行組裝：將 Main A 的該聲部複製替換至 Main B
    const result = YamahaStyleAssembly.assemblePart({
      destParsed: parsed,
      destSection: 'Main B',
      destChannel: channel,
      srcParsed: parsed,
      srcSection: 'Main A',
      srcChannel: channel,
      copyMode: 'replace',
      loopMode: 'loop',
      copyVoiceParams: true,
    });

    expect(result.success).toBe(true);
    expect(result.notesCopied).toBe(srcNoteCount);
    expect(result.previousNoteCount).toBe(prevNotesInB);

    // 驗證 Main B 該通道的新音符數等於來源音符數
    const newNotesInB = StyleRemixer.countNotesInChannel(
      parsed,
      mainBRange.startTick,
      mainBRange.endTick,
      channel
    );
    expect(newNotesInB).toBe(srcNoteCount);

    // 驗證 Main A 未受影響
    const notesInAAfter = StyleRemixer.countNotesInChannel(
      parsed,
      mainARange.startTick,
      mainARange.endTick,
      channel
    );
    expect(notesInAAfter).toBe(srcNoteCount);
  });

  it('3. 支援小節循環填滿功能 (Loop to Fill: 短段落循環鋪滿長段落)', () => {
    const parsed = getFreshParsed();

    // Fill In BB 為 1 小節過門段落
    const fillRange = StyleRemixer.getSectionTickRange(parsed, 'Fill In BB')!;
    const mainRange = StyleRemixer.getSectionTickRange(parsed, 'Main A')!; // 8 小節

    // 取得 Fill In BB 中有音符的通道
    const fillNotesCh9 = StyleRemixer.countNotesInChannel(
      parsed,
      fillRange.startTick,
      fillRange.endTick,
      9
    );
    expect(fillNotesCh9).toBeGreaterThan(0);

    // 以 loopMode = 'loop' 將 1 小節的 Fill 鼓組組裝至 8 小節的 Main A
    const result = YamahaStyleAssembly.assemblePart({
      destParsed: parsed,
      destSection: 'Main A',
      destChannel: 9,
      srcParsed: parsed,
      srcSection: 'Fill In BB',
      srcChannel: 9,
      copyMode: 'replace',
      loopMode: 'loop',
    });

    expect(result.success).toBe(true);
    // 8 小節 / 1 小節 = 8 次循環
    expect(result.loopCount).toBe(8);
    expect(result.notesCopied).toBe(fillNotesCh9 * 8);

    const finalNotesInMainA = StyleRemixer.countNotesInChannel(
      parsed,
      mainRange.startTick,
      mainRange.endTick,
      9
    );
    expect(finalNotesInMainA).toBe(fillNotesCh9 * 8);
  });

  it('4. 支援單次填入模式 (Once Mode: 不循環只複製一次)', () => {
    const parsed = getFreshParsed();

    const fillRange = StyleRemixer.getSectionTickRange(parsed, 'Fill In BB')!;
    const mainRange = StyleRemixer.getSectionTickRange(parsed, 'Main A')!;

    const fillNotesCh9 = StyleRemixer.countNotesInChannel(
      parsed,
      fillRange.startTick,
      fillRange.endTick,
      9
    );

    const result = YamahaStyleAssembly.assemblePart({
      destParsed: parsed,
      destSection: 'Main A',
      destChannel: 9,
      srcParsed: parsed,
      srcSection: 'Fill In BB',
      srcChannel: 9,
      copyMode: 'replace',
      loopMode: 'once',
    });

    expect(result.success).toBe(true);
    expect(result.loopCount).toBe(1);
    expect(result.notesCopied).toBe(fillNotesCh9);

    const finalNotesInMainA = StyleRemixer.countNotesInChannel(
      parsed,
      mainRange.startTick,
      mainRange.endTick,
      9
    );
    expect(finalNotesInMainA).toBe(fillNotesCh9);
  });

  it('5. 支援旋律移調 (Transpose) 與力度縮放 (Velocity Scale)', () => {
    const parsed = getFreshParsed();
    const mainRange = StyleRemixer.getSectionTickRange(parsed, 'Main A')!;

    // 尋找非鼓組的旋律聲部 (Ch 1 為 Bass, 34 音符)
    const rawBassNotes = StyleRemixer.extractSectionChannelNotes(
      parsed,
      mainRange.startTick,
      mainRange.endTick,
      1
    );
    expect(rawBassNotes.length).toBeGreaterThan(0);

    const origFirstNote = rawBassNotes[0];

    // 將 Bass 移調 +5 個半音，力度縮放 0.8 倍複製至 Main B
    const result = YamahaStyleAssembly.assemblePart({
      destParsed: parsed,
      destSection: 'Main B',
      destChannel: 1,
      srcParsed: parsed,
      srcSection: 'Main A',
      srcChannel: 1,
      copyMode: 'replace',
      transposeShift: 5,
      velocityScale: 0.8,
    });

    expect(result.success).toBe(true);

    const mainBRange = StyleRemixer.getSectionTickRange(parsed, 'Main B')!;
    const newBassNotes = StyleRemixer.extractSectionChannelNotes(
      parsed,
      mainBRange.startTick,
      mainBRange.endTick,
      1
    );

    expect(newBassNotes.length).toBe(rawBassNotes.length);
    expect(newBassNotes[0].note).toBe(origFirstNote.note + 5);
    expect(newBassNotes[0].velocity).toBe(Math.round(origFirstNote.velocity * 0.8));
  });

  it('6. 批次一鍵複製到所有 Main 伴奏段落 (copyPartToAllMains)', () => {
    const parsed = getFreshParsed();

    const batchResult = YamahaStyleAssembly.copyPartToAllMains(parsed, 'Main A', 9);
    expect(batchResult.success).toBe(true);
    expect(batchResult.sectionsModified).toContain('Main A');
    expect(batchResult.sectionsModified).toContain('Main B');
    expect(batchResult.sectionsModified).toContain('Main C');
    expect(batchResult.sectionsModified).toContain('Main D');
    expect(batchResult.totalNotesCopied).toBeGreaterThan(0);

    // 驗證 Main B, C, D 均包含 Ch 9 音符
    for (const secName of ['Main B', 'Main C', 'Main D']) {
      const range = StyleRemixer.getSectionTickRange(parsed, secName)!;
      const count = StyleRemixer.countNotesInChannel(parsed, range.startTick, range.endTick, 9);
      expect(count).toBeGreaterThan(0);
    }
  });

  it('7. 整段段落全聲部克隆 (cloneFullSection)', () => {
    const parsed = getFreshParsed();

    const cloneResult = YamahaStyleAssembly.cloneFullSection({
      destParsed: parsed,
      destSection: 'Main D',
      srcParsed: parsed,
      srcSection: 'Main A',
    });

    expect(cloneResult.success).toBe(true);
    expect(cloneResult.channelsCloned.length).toBeGreaterThan(0);
    expect(cloneResult.totalNotesCopied).toBeGreaterThan(0);

    // 驗證 Main D 總音符數與 Main A 吻合
    const overviewA = YamahaStyleAssembly.getSectionOverview(parsed, 'Main A')!;
    const overviewD = YamahaStyleAssembly.getSectionOverview(parsed, 'Main D')!;

    for (const ch of cloneResult.channelsCloned) {
      const pA = overviewA.parts.find((p) => p.channel === ch);
      const pD = overviewD.parts.find((p) => p.channel === ch);
      expect(pD?.noteCount).toBe(pA?.noteCount);
    }
  });

  it('8. 匯出完整性檢驗：經組裝拼貼後，CASM 區塊與 SMF 0 二進位結構 100% 完好無損', () => {
    const parsed = getFreshParsed();

    // 執行聲部拼貼與段落組裝
    YamahaStyleAssembly.assemblePart({
      destParsed: parsed,
      destSection: 'Main B',
      destChannel: 9,
      srcParsed: parsed,
      srcSection: 'Main A',
      srcChannel: 9,
      loopMode: 'loop',
    });

    YamahaStyleAssembly.copyPartToAllMains(parsed, 'Main A', 1);

    // 匯出巡檢
    const inspection = YamahaWriter.inspectPreExport(parsed);
    expect(inspection.hasCasm).toBe(true);
    expect(inspection.casmSize).toBe(4025); // 原廠 CASM 4,025 bytes 完好保留
    expect(inspection.sectionCount).toBe(14);
    expect(inspection.totalNotes).toBeGreaterThan(100);

    // 執行反向二進位編碼與重解析檢驗
    const validation = YamahaWriter.validateAndWrite(parsed);
    expect(validation.success).toBe(true);
    expect(validation.format).toBe('STY');
    expect(validation.hasCasm).toBe(true);
    expect(validation.casmSize).toBe(4025);
    expect(validation.bytes.length).toBeGreaterThan(10000);
  });
});
