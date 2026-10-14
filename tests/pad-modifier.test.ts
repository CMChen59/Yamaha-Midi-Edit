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

  it('能成功修改 Pad 音軌中特定音符的力度 (Velocity) 與長度 (Duration)', () => {
    const sample1Path = path.resolve(__dirname, '../samples/4006-1_PAD.PAD');
    const rawBuffer = new Uint8Array(fs.readFileSync(sample1Path));
    const parsed = YamahaParser.parse(rawBuffer, 'PAD');

    // 檢查 Pad 1 第一顆音符 (Note 65, Start 4608, Dur 384, Vel 88)
    const success = YamahaPadModifier.updateNoteEvent(
      parsed,
      1,
      { note: 65, startTick: 4608, oldDurationTick: 384 },
      { velocity: 118, durationTick: 192 }
    );
    expect(success).toBe(true);

    // 導出二進位並重新解析
    const modifiedBytes = YamahaWriter.write(parsed);
    const reParsed = YamahaParser.parse(modifiedBytes, 'PAD');

    // 提取 Track 1 音符
    let curTick = 0;
    const trk1 = reParsed.tracks[1];
    let note65OnVel: number | undefined;
    let note65Dur: number | undefined;

    for (const ev of trk1.events) {
      curTick += ev.delta;
      if (ev.type === 'noteOn' && ev.noteNumber === 65 && ev.velocity && ev.velocity > 0) {
        if (curTick === 4608) {
          note65OnVel = ev.velocity;
        }
      } else if ((ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) && ev.noteNumber === 65) {
        if (note65OnVel !== undefined && note65Dur === undefined) {
          note65Dur = curTick - 4608;
        }
      }
    }

    expect(note65OnVel).toBe(118);
    expect(note65Dur).toBe(192);
  });

  it('能成功平移修改音符的起始時間位置 (startTick) 與音高 (note)', () => {
    const sample1Path = path.resolve(__dirname, '../samples/4006-1_PAD.PAD');
    const rawBuffer = new Uint8Array(fs.readFileSync(sample1Path));
    const parsed = YamahaParser.parse(rawBuffer, 'PAD');

    // 將 Pad 1 第一顆音符 (Note 65, Start 4608, Dur 384) 移動到 Start 4800，音高改為 67 (G4)
    const success = YamahaPadModifier.updateNoteEvent(
      parsed,
      1,
      { note: 65, startTick: 4608, oldDurationTick: 384 },
      { startTick: 4800, note: 67 }
    );
    expect(success).toBe(true);

    // 導出二進位並重新解析
    const modifiedBytes = YamahaWriter.write(parsed);
    const reParsed = YamahaParser.parse(modifiedBytes, 'PAD');

    let curTick = 0;
    const trk1 = reParsed.tracks[1];
    let note67OnTick: number | undefined;
    let note67OffTick: number | undefined;

    for (const ev of trk1.events) {
      curTick += ev.delta;
      if (ev.type === 'noteOn' && ev.noteNumber === 67 && ev.velocity && ev.velocity > 0) {
        if (note67OnTick === undefined) {
          note67OnTick = curTick;
        }
      } else if ((ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) && ev.noteNumber === 67) {
        if (note67OnTick !== undefined && note67OffTick === undefined) {
          note67OffTick = curTick;
        }
      }
    }

    expect(note67OnTick).toBe(4800);
    // 音長維持 384，所以 Note-Off 應在 4800 + 384 = 5184
    expect(note67OffTick).toBe(5184);
  });

  it('能成功刪除特定音符 (deleteNoteEvent) 並保持時間軸正確性與二進位重構', () => {
    const sample1Path = path.resolve(__dirname, '../samples/4006-1_PAD.PAD');
    const rawBuffer = new Uint8Array(fs.readFileSync(sample1Path));
    const parsed = YamahaParser.parse(rawBuffer, 'PAD');

    // 刪除 Pad 1 第一顆音符 (Note 65, Start 4608, Dur 384)
    const success = YamahaPadModifier.deleteNoteEvent(parsed, 1, {
      note: 65,
      startTick: 4608,
      oldDurationTick: 384,
    });
    expect(success).toBe(true);

    // 導出二進位並重新解析
    const modifiedBytes = YamahaWriter.write(parsed);
    const reParsed = YamahaParser.parse(modifiedBytes, 'PAD');

    let curTick = 0;
    const trk1 = reParsed.tracks[1];
    let foundDeletedNote = false;
    let nextNoteStartTick: number | undefined;

    for (const ev of trk1.events) {
      curTick += ev.delta;
      if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        if (ev.noteNumber === 65 && curTick === 4608) {
          foundDeletedNote = true;
        }
        if (nextNoteStartTick === undefined && curTick >= 4992) {
          nextNoteStartTick = curTick;
        }
      }
    }

    expect(foundDeletedNote).toBe(false);
    // 下一顆音符 (Note 64 at 4992) 的時間位置不受影響
    expect(nextNoteStartTick).toBe(4992);
  });

  it('能成功新增全新音符 (addNoteEvent) 並正確排序 Note-On/Off 與導出二進位', () => {
    const sample1Path = path.resolve(__dirname, '../samples/4006-1_PAD.PAD');
    const rawBuffer = new Uint8Array(fs.readFileSync(sample1Path));
    const parsed = YamahaParser.parse(rawBuffer, 'PAD');

    // 在 Pad 1 新增一顆 Note 84 (C6), Start 4700, Dur 96, Vel 110
    const success = YamahaPadModifier.addNoteEvent(parsed, 1, {
      note: 84,
      startTick: 4700,
      durationTick: 96,
      velocity: 110,
    });
    expect(success).toBe(true);

    // 導出二進位並重新解析
    const modifiedBytes = YamahaWriter.write(parsed);
    const reParsed = YamahaParser.parse(modifiedBytes, 'PAD');

    let curTick = 0;
    const trk1 = reParsed.tracks[1];
    let createdNoteOn: { tick: number; vel: number } | undefined;
    let createdNoteOff: { tick: number } | undefined;

    for (const ev of trk1.events) {
      curTick += ev.delta;
      if (ev.type === 'noteOn' && ev.noteNumber === 84 && (ev.velocity ?? 0) > 0) {
        if (!createdNoteOn) {
          createdNoteOn = { tick: curTick, vel: ev.velocity! };
        }
      } else if ((ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) && ev.noteNumber === 84) {
        if (!createdNoteOff) {
          createdNoteOff = { tick: curTick };
        }
      }
    }

    expect(createdNoteOn).toBeDefined();
    expect(createdNoteOn?.tick).toBe(4700);
    expect(createdNoteOn?.vel).toBe(110);
    expect(createdNoteOff).toBeDefined();
    expect(createdNoteOff?.tick).toBe(4700 + 96);
  });
});
