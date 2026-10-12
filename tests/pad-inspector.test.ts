import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';

describe('PAD 內部細節探測', () => {
  it('印出 PAD 檔案內的詳細音軌與 Marker 關係', () => {
    const pad1Path = path.resolve(__dirname, '../samples/4006-1_PAD.PAD');
    const buf = fs.readFileSync(pad1Path);
    const parsed = YamahaParser.parse(new Uint8Array(buf), 'PAD');

    console.log('--- 段落 Marker 詳細清單 ---');
    parsed.sections.forEach((s) => {
      console.log(`段落: ${s.name}, 起始 Tick: ${s.startTick}, 結束 Tick: ${s.endTick}, 小節數: ${s.measureCount}`);
    });

    console.log('--- 軌道與音符統計 ---');
    parsed.tracks.forEach((t, i) => {
      const noteCount = t.events.filter((e) => e.type === 'noteOn').length;
      console.log(`Track ${i}: 名稱=${t.name ?? '(無)'}, 總事件數=${t.events.length}, NoteOn數量=${noteCount}`);
    });
  });
});
