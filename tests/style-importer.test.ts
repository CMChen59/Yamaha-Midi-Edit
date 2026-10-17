import { describe, it, expect } from 'vitest';
import { MidiImporter } from '../src/core/writer/midi-importer';
import { StyleImporter, type StyleImportOptions } from '../src/core/writer/style-importer';
import { YamahaStyleSynthesizer } from '../src/core/writer/style-synthesizer';
import { YamahaParser } from '../src/core/parser/yamaha-parser';

describe('Phase 3.2: StyleImporter 外部 MIDI 8 聲部智慧映射與伴奏合成引擎', () => {
  const demoBytes = MidiImporter.createDemoGrooveMidi();

  it('能深度剖析外部 MIDI 音軌特徵 (Pitch, Duration, Polyphony, Category)', () => {
    const analysis = StyleImporter.analyzeForStyle(demoBytes, 'demo_groove.mid');

    expect(analysis.fileName).toBe('demo_groove.mid');
    expect(analysis.tracks.length).toBe(5);
    expect(analysis.styleTracks.length).toBe(5);

    // Track 0: Conductor
    const t0 = analysis.styleTracks[0];
    expect(t0.notes.length).toBe(0);
    expect(t0.recommendedPart).toBeNull();

    // Track 1: Piano Chords (Ch 0, PC 0)
    const t1 = analysis.styleTracks[1];
    expect(t1.detectedCategory).toBe('piano');
    expect(t1.recommendedPart).toBe('Chord1');
    expect(t1.polyphonyRatio).toBeGreaterThan(0.5);

    // Track 2: Guitar Arp (Ch 1, PC 24)
    const t2 = analysis.styleTracks[2];
    expect(t2.detectedCategory).toBe('guitar');
    expect(t2.recommendedPart).toBe('Phrase1');

    // Track 3: Bass (Ch 2, PC 32)
    const t3 = analysis.styleTracks[3];
    expect(t3.detectedCategory).toBe('bass');
    expect(t3.recommendedPart).toBe('Bass');
    expect(t3.avgPitch).toBeLessThan(55);

    // Track 4: Drums (Ch 9, MIDI Ch 10)
    const t4 = analysis.styleTracks[4];
    expect(t4.detectedCategory).toBe('drums');
    expect(t4.recommendedPart).toBe('Rhythm2');
    expect(t4.recommendationReason).toContain('MIDI 通道 10');
  });

  it('能執行 8 聲部全域防衝突智慧分配 (Auto-Mapping)', () => {
    const analysis = StyleImporter.analyzeForStyle(demoBytes, 'demo_groove.mid');

    // 驗證自動推薦配置
    expect(analysis.autoMapping['Rhythm2']).toBe(4); // 爵士鼓組 -> Track 4
    expect(analysis.autoMapping['Bass']).toBe(3);    // 貝斯 -> Track 3
    expect(analysis.autoMapping['Chord1']).toBe(1);  // 鋼琴和弦 -> Track 1
    expect(analysis.autoMapping['Phrase1']).toBe(2); // 吉他琶音 -> Track 2
  });

  it('能依據智慧映射將外部 MIDI 切片合成標準 Yamaha Style (.sty)', () => {
    const analysis = StyleImporter.analyzeForStyle(demoBytes, 'demo_groove.mid');

    const importOptions: StyleImportOptions = {
      projectName: 'Groove Auto Style',
      bpm: 125,
      startBar: 1,
      endBar: 4,
      targetSection: 'Main A',
      partMappings: [
        { partId: 'Rhythm2', sourceTrackIndex: analysis.autoMapping['Rhythm2'] ?? null },
        { partId: 'Bass', sourceTrackIndex: analysis.autoMapping['Bass'] ?? null },
        { partId: 'Chord1', sourceTrackIndex: analysis.autoMapping['Chord1'] ?? null },
        { partId: 'Phrase1', sourceTrackIndex: analysis.autoMapping['Phrase1'] ?? null },
        { partId: 'Rhythm1', sourceTrackIndex: null },
        { partId: 'Chord2', sourceTrackIndex: null },
        { partId: 'Pad', sourceTrackIndex: null },
        { partId: 'Phrase2', sourceTrackIndex: null },
      ],
    };

    const style = StyleImporter.synthesizeStyleFromImport(analysis, importOptions);

    // 1. 驗證 SMF Format 0
    expect(style.midiFormat).toBe(0);
    expect(style.tracks.length).toBe(1);

    // 2. 驗證音樂段落
    const musicalSections = YamahaStyleSynthesizer.getMusicalSections(style);
    expect(musicalSections.length).toBe(1);
    expect(musicalSections[0].name).toBe('Main A');
    expect(musicalSections[0].measureCount).toBe(4);

    // 3. 驗證音符事件已成功注入
    const noteEvents = style.tracks[0].events.filter((e) => e.type === 'noteOn' && (e.velocity ?? 0) > 0);
    expect(noteEvents.length).toBeGreaterThan(30);

    // 4. 驗證通道涵蓋 8 大伴奏聲部中被映射的通道 (Ch 9=Rhythm2, Ch 10=Bass, Ch 11=Chord1, Ch 14=Phrase1)
    const activeChannels = new Set(noteEvents.map((e) => e.channel));
    expect(activeChannels.has(9)).toBe(true);  // Rhythm2
    expect(activeChannels.has(10)).toBe(true); // Bass
    expect(activeChannels.has(11)).toBe(true); // Chord1
    expect(activeChannels.has(14)).toBe(true); // Phrase1

    // 5. 驗證 SFF2 CASM Chunk 存在
    const casmChunk = style.customChunks.find((c) => c.id === 'CASM');
    expect(casmChunk).toBeDefined();

    // 6. 二進位序列化與雙向回讀
    const binary = YamahaStyleSynthesizer.serializeToStyleFile(style);
    expect(binary.length).toBeGreaterThan(1000);

    const reparsed = YamahaParser.parse(binary, 'STY');
    expect(reparsed.midiFormat).toBe(0);
    const reparsedSections = YamahaStyleSynthesizer.getMusicalSections(reparsed);
    expect(reparsedSections.length).toBe(1);
    expect(reparsedSections[0].name).toBe('Main A');
  });

  it('支援自訂移調與音色覆寫參數', () => {
    const analysis = StyleImporter.analyzeForStyle(demoBytes, 'demo_groove.mid');

    // 將 Bass 音軌向上移調 12 半音，並覆寫音量與 Pan
    const importOptions: StyleImportOptions = {
      projectName: 'Transposed Style',
      startBar: 1,
      endBar: 2,
      targetSection: 'Main A',
      partMappings: [
        {
          partId: 'Bass',
          sourceTrackIndex: 3,
          transposeShift: 12,
          voice: {
            pc: 38, // Synth Bass
            volume: 110,
            pan: 60,
          },
        },
      ],
    };

    const style = StyleImporter.synthesizeStyleFromImport(analysis, importOptions);
    const bassNotes = style.tracks[0].events.filter(
      (e) => e.type === 'noteOn' && e.channel === 10 && (e.velocity ?? 0) > 0
    );
    expect(bassNotes.length).toBeGreaterThan(0);

    // 驗證移調後的最低音符比原始區間高 12 半音
    const ticksPerMeasure = analysis.division * 4;
    const sliceOriginalNotes = analysis.tracks[3].notes.filter(
      (n) => n.startTick >= 0 && n.startTick < 2 * ticksPerMeasure
    );
    const originalBassMinNote = Math.min(...sliceOriginalNotes.map((n) => n.note));
    const synthesizedBassMinNote = Math.min(...bassNotes.map((e) => e.noteNumber!));
    expect(synthesizedBassMinNote).toBe(originalBassMinNote + 12);

    // 驗證控制器注入
    const volumeEvent = style.tracks[0].events.find(
      (e) => e.type === 'controlChange' && e.channel === 10 && e.controller === 7
    );
    expect(volumeEvent?.value).toBe(110);
  });
});
