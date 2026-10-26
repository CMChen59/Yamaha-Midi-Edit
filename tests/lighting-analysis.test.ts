import { describe, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';

describe('Yamaha STY 段落亮燈與資料底層邏輯深度剖析', () => {
  it('剖析 1024_容易受傷的女人.sty 之段落 Marker、音符分佈與琴端實體按鍵亮燈機制', () => {
    const filePath = path.resolve(__dirname, '../public/samples/1024_容易受傷的女人.sty');
    const buf = fs.readFileSync(filePath);
    const parsed = YamahaParser.parse(new Uint8Array(buf), 'STY');

    console.log('=== 1024_容易受傷的女人.sty 段落詳細清單 ===');
    for (const s of parsed.sections) {
      let noteCount = 0;
      let t = 0;
      const chNotes: Record<number, number> = {};
      for (const ev of parsed.tracks[0].events) {
        t += ev.delta;
        if (t >= s.startTick && (s.endTick === undefined || t < s.endTick)) {
          if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0 && ev.channel !== undefined) {
            noteCount++;
            chNotes[ev.channel] = (chNotes[ev.channel] || 0) + 1;
          }
        }
      }
      const chStr = Object.entries(chNotes).map(([ch, n]) => `Ch${ch}:${n}`).join(' ');
      console.log(`段落 [${s.name.padEnd(12)}]: 起始=${s.startTick.toString().padStart(6)}, 結束=${(s.endTick ?? 0).toString().padStart(6)}, 小節數=${s.measureCount ?? 0}, 音符數=${noteCount} (${chStr})`);
    }

    console.log('\n=== PSR-SX920 琴端面板 15 大按鍵亮燈判定 ===');
    const ALL_PANEL_BUTTONS = [
      { id: 'Intro A', label: 'INTRO [I]' },
      { id: 'Intro B', label: 'INTRO [II]' },
      { id: 'Intro C', label: 'INTRO [III]' },
      { id: 'Main A', label: 'MAIN [A]' },
      { id: 'Main B', label: 'MAIN [B]' },
      { id: 'Main C', label: 'MAIN [C]' },
      { id: 'Main D', label: 'MAIN [D]' },
      { id: 'Fill In AA', label: 'AUTO FILL [A->A]' },
      { id: 'Fill In BB', label: 'AUTO FILL [B->B]' },
      { id: 'Fill In CC', label: 'AUTO FILL [C->C]' },
      { id: 'Fill In DD', label: 'AUTO FILL [D->D]' },
      { id: 'Break', altId: 'Fill In BA', label: 'BREAK' },
      { id: 'Ending A', label: 'ENDING [I]' },
      { id: 'Ending B', label: 'ENDING [II]' },
      { id: 'Ending C', label: 'ENDING [III]' }
    ];

    for (const btn of ALL_PANEL_BUTTONS) {
      let sec = parsed.sections.find(s => s.name.toLowerCase() === btn.id.toLowerCase());
      if (!sec && btn.altId) {
        sec = parsed.sections.find(s => s.name.toLowerCase() === btn.altId.toLowerCase());
      }

      if (!sec) {
        console.log(`🔘 面板按鍵 ${btn.label.padEnd(18)}: ❌ 熄滅 (檔案中無此段落 Marker)`);
        continue;
      }

      // 計算該段落是否有音符
      let notes = 0;
      let t = 0;
      for (const ev of parsed.tracks[0].events) {
        t += ev.delta;
        if (t >= sec.startTick && (sec.endTick === undefined || t < sec.endTick)) {
          if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) notes++;
        }
      }

      const hasCasm = parsed.casmMappings?.[sec.name.toLowerCase()] !== undefined;

      console.log(`🔘 面板按鍵 ${btn.label.padEnd(18)}: ${notes > 0 ? '🟢 亮燈 (有資料)' : '⚪ 熄滅/半暗 (空段落)'} | Marker: "${sec.name}" | 小節: ${sec.measureCount} | 音符數: ${notes} | CASM設定: ${hasCasm ? 'YES' : 'NO'}`);
    }
  });
});
