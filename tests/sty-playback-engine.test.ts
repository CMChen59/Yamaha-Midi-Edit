import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { StyPlaybackEngine } from '../src/player/sty-playback-engine';

describe('StyPlaybackEngine: 純 STY 伴奏極速播放引擎測試', () => {
  const loveSongPath = path.resolve(__dirname, '../public/samples/LoveSong.T547.sty');

  it('能正確載入 STY 伴奏檔並提取段落資訊', () => {
    expect(fs.existsSync(loveSongPath)).toBe(true);
    const buf = fs.readFileSync(loveSongPath);
    const parsed = YamahaParser.parse(new Uint8Array(buf), 'STY');

    const engine = new StyPlaybackEngine();
    engine.loadParsed(parsed);

    expect(engine.getBpm()).toBe(70);
    const sections = engine.getSections();
    expect(sections.length).toBeGreaterThan(5);

    // 驗證包含 Intro B 與 Main A
    const names = sections.map(s => s.name);
    expect(names).toContain('Intro B');
    expect(names).toContain('Main A');
  });

  it('選擇 Intro B 段落時能精準擷取原始 SFF2 音符事件流並排除 SFF1 重複半音', () => {
    const buf = fs.readFileSync(loveSongPath);
    const parsed = YamahaParser.parse(new Uint8Array(buf), 'STY');

    const engine = new StyPlaybackEngine();
    engine.loadParsed(parsed);

    const ok = engine.selectSection('Intro B');
    expect(ok).toBe(true);
    expect(engine.getTotalBars()).toBe(4);

    // 存取內部萃取的事件 (藉由 any 檢查)
    const events: any[] = (engine as any).sectionEvents;
    expect(events.length).toBeGreaterThan(100);

    // 驗證所有事件的相對 Tick 為遞增
    for (let i = 1; i < events.length; i++) {
      expect(events[i].relTick).toBeGreaterThanOrEqual(events[i - 1].relTick);
    }

    // 驗證通道均為 SFF2 (8~15)，不應存在衝突的 SFF1 通道 (0~7)
    const channels = new Set(events.map(e => e.channel));
    for (let ch = 0; ch < 8; ch++) {
      expect(channels.has(ch)).toBe(false);
    }
    // 應包含 Bass (10), Chord 1 (11), Chord 2 (12), Pad (13)
    expect(channels.has(10)).toBe(true);
    expect(channels.has(11)).toBe(true);
    expect(channels.has(12)).toBe(true);
    expect(channels.has(13)).toBe(true);
  });

  it('能正確調整 BPM、循環模式與聲部靜音獨奏', () => {
    const engine = new StyPlaybackEngine();
    engine.setBpm(140);
    expect(engine.getBpm()).toBe(140);

    engine.setLoop(false);
    expect(engine.getLoop()).toBe(false);

    // 聲部靜音
    engine.setChannelMute(10, true);
    expect(engine.isChannelMuted(10)).toBe(true);
    expect(engine.isChannelMuted(11)).toBe(false);

    // 聲部獨奏 (Solo)
    engine.setChannelSolo(11);
    expect(engine.isChannelMuted(11)).toBe(false); // Solo 軌不被靜音
    expect(engine.isChannelMuted(10)).toBe(true);  // 非 Solo 軌被靜音
    expect(engine.isChannelMuted(9)).toBe(true);

    engine.setChannelSolo(null);
    expect(engine.isChannelMuted(11)).toBe(false);
  });
});
