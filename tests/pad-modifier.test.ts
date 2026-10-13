import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { YamahaWriter } from '../src/core/writer/yamaha-writer';
import { YamahaPadModifier } from '../src/core/writer/pad-modifier';

describe('步驟 2.1: Pad 屬性與混音編輯雙向同步驗證 (PadModifier Verification)', () => {
  const samplePath = path.resolve(__dirname, '../samples/4006-2_PAD.PAD');

  it('能成功修改 Pad 名稱、Repeat、ChordMatch、Icon、音量與聲相，並無失真保存至新二進位檔案', () => {
    const rawBuffer = new Uint8Array(fs.readFileSync(samplePath));
    const parsed = YamahaParser.parse(rawBuffer, 'PAD');

    // 1. 修改 Pad 1 屬性
    YamahaPadModifier.setPadName(parsed, 1, 'Acoustic Guitar');
    YamahaPadModifier.setPadRepeat(parsed, 1, true);
    YamahaPadModifier.setPadChordMatch(parsed, 1, true);
    YamahaPadModifier.setPadIcon(parsed, 1, 'S809');

    // 2. 修改 Pad 1 混音
    YamahaPadModifier.setPadMixing(parsed, 1, {
      volume: 115,
      pan: 80,
      reverb: 45,
      programChange: 25,
    });

    // 3. 修改 Pad 2 屬性與混音
    YamahaPadModifier.setPadName(parsed, 2, 'Finger Bass');
    YamahaPadModifier.setPadRepeat(parsed, 2, false);
    YamahaPadModifier.setPadChordMatch(parsed, 2, true);
    YamahaPadModifier.setPadMixing(parsed, 2, {
      volume: 98,
      pan: 40,
    });

    // 4. 重構寫出新二進位檔
    const modifiedBytes = YamahaWriter.write(parsed);
    expect(modifiedBytes.length).toBeGreaterThan(0);

    // 5. 重新送入 Parser 解析驗證
    const reParsed = YamahaParser.parse(modifiedBytes, 'PAD');

    // 驗證 Pad 1
    expect(reParsed.padConfig).toBeDefined();
    expect(reParsed.padConfig?.names[0]).toBe('Acoustic Guitar');
    expect(reParsed.padConfig?.repeatFlags[0]).toBe(true);
    expect(reParsed.padConfig?.chordMatchFlags[0]).toBe(true);
    expect(reParsed.padConfig?.icons[0]).toBe('S809');

    // 驗證 Pad 2
    expect(reParsed.padConfig?.names[1]).toBe('Finger Bass');
    expect(reParsed.padConfig?.repeatFlags[1]).toBe(false);
    expect(reParsed.padConfig?.chordMatchFlags[1]).toBe(true);

    // 驗證 Track 1 混音 Controller
    const trk1Events = reParsed.tracks[1].events;
    const vol1 = trk1Events.find((e) => e.type === 'controlChange' && e.controller === 7)?.value;
    const pan1 = trk1Events.find((e) => e.type === 'controlChange' && e.controller === 10)?.value;
    const rev1 = trk1Events.find((e) => e.type === 'controlChange' && e.controller === 91)?.value;
    const pc1 = trk1Events.find((e) => e.type === 'programChange')?.program;

    expect(vol1).toBe(115);
    expect(pan1).toBe(80);
    expect(rev1).toBe(45);
    expect(pc1).toBe(25);

    // 驗證 Track 2 音量
    const trk2Events = reParsed.tracks[2].events;
    const vol2 = trk2Events.find((e) => e.type === 'controlChange' && e.controller === 7)?.value;
    const pan2 = trk2Events.find((e) => e.type === 'controlChange' && e.controller === 10)?.value;
    expect(vol2).toBe(98);
    expect(pan2).toBe(40);
  });
});
