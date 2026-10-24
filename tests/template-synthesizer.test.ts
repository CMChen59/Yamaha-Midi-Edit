import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { YamahaTemplateStyleSynthesizer } from '../src/core/writer/template-style-synthesizer';
import { YamahaParser } from '../src/core/parser/yamaha-parser';
import { getGoldenStyleTemplateBytes } from '../src/core/data/yamaha-style-template';

describe('YamahaTemplateStyleSynthesizer', () => {
  it('synthesizes a perfect SX920 style file from golden template', () => {
    // 1. Prepare dummy drum, bass, and chord patterns (4 bars)
    const drumPattern = new Map<number, boolean[]>();
    const kick = new Array(64).fill(false);
    const snare = new Array(64).fill(false);
    const hihat = new Array(64).fill(false);

    for (let b = 0; b < 4; b++) {
      kick[b * 16 + 0] = true;
      kick[b * 16 + 8] = true;
      snare[b * 16 + 4] = true;
      snare[b * 16 + 12] = true;
      for (let s = 0; s < 16; s += 2) {
        hihat[b * 16 + s] = true;
      }
    }
    drumPattern.set(36, kick);
    drumPattern.set(38, snare);
    drumPattern.set(42, hihat);

    const bassPattern = new Map<number, number>();
    for (let b = 0; b < 4; b++) {
      bassPattern.set(b * 16 + 0, 36);
      bassPattern.set(b * 16 + 8, 36);
    }

    const chordPattern = new Map<number, Set<number>>();
    for (let b = 0; b < 4; b++) {
      chordPattern.set(b * 16 + 0, new Set([60, 64, 67]));
      chordPattern.set(b * 16 + 8, new Set([60, 64, 67]));
    }

    const bytes = YamahaTemplateStyleSynthesizer.synthesizeFromTemplate({
      styleName: 'Pop Rock 2026',
      bpm: 128,
      drumKit: { msb: 127, lsb: 0, pc: 0 },
      bassVoice: { msb: 0, lsb: 0, pc: 33 },
      chordVoice: { msb: 0, lsb: 0, pc: 0 },
      sections: [
        {
          name: 'Main A',
          bars: 4,
          drumPattern,
          bassPattern,
          chordPattern,
        },
      ],
    });

    expect(bytes).toBeDefined();
    expect(bytes.length).toBeGreaterThan(10000);

    // Parse back
    const parsed = YamahaParser.parse(bytes, 'STY');
    expect(parsed.format).toBe('STY');
    expect(parsed.division).toBe(96);
    expect(parsed.hasCasm).toBe(true);

    const casmChunk = parsed.customChunks.find(c => c.id === 'CASM');
    expect(casmChunk).toBeDefined();
    expect(casmChunk?.data.length).toBe(6031); // Golden template CASM (3701) + 5 Fill In CSEGs (2330)

    // Verify track name
    const tr0 = parsed.tracks[0];
    const timeSigEv = tr0.events.find(e => e.type === 'meta' && e.metaType === 0x58);
    console.log('TimeSignature event:', timeSigEv, 'parsed timeSignature:', parsed.timeSignature);
    const nameEv = tr0.events.find(e => e.type === 'meta' && e.metaType === 0x03);
    expect(nameEv?.text).toBe('Pop Rock 2026');

    // Print all sections and note ranges in each section
    console.log('\n--- Section details in synthesized file ---');
    parsed.sections.forEach(s => {
      console.log(`  ${s.name.padEnd(12)} startTick=${s.startTick} endTick=${s.endTick} bars=${s.measureCount}`);
    });

    // Check where notes exist
    let t = 0;
    const notesBySection = new Map<string, number>();
    for (const ev of tr0.events) {
      t += ev.delta;
      if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        // Find which section this note belongs to
        const sec = parsed.sections.find(s => s.startTick <= t && (s.endTick === undefined || t < s.endTick));
        const sName = sec?.name || 'Unknown';
        notesBySection.set(sName, (notesBySection.get(sName) || 0) + 1);
      }
    }
    console.log('\n--- Notes per section ---');
    notesBySection.forEach((cnt, sName) => {
      console.log(`  ${sName.padEnd(12)}: ${cnt} notes`);
    });

    // Verify sections have notes
    const noteCount = tr0.events.filter(e => e.type === 'noteOn' && (e.velocity ?? 0) > 0).length;
    console.log('Total notes in synthesized file:', noteCount);
    expect(noteCount).toBeGreaterThan(500);

    // Save sample to disk
    fs.writeFileSync('public/samples/SX920_Golden_Template.sty', Buffer.from(bytes));
    console.log('Saved to public/samples/SX920_Golden_Template.sty (bytes: ' + bytes.length + ')');
  });

  it('correctly handles 8-step (1/8 note) resolution without 2x compression or blank bars', () => {
    // 4 bars with 8 steps per bar = 32 steps total
    const drumPattern = new Map<number, boolean[]>();
    const kick = new Array(32).fill(false);
    const snare = new Array(32).fill(false);
    // Put kick on step 0 and 4 of each bar (beat 1 and 3)
    for (let b = 0; b < 4; b++) {
      kick[b * 8 + 0] = true;
      kick[b * 8 + 4] = true;
      snare[b * 8 + 2] = true;
      snare[b * 8 + 6] = true;
    }
    drumPattern.set(36, kick);
    drumPattern.set(38, snare);

    const bassPattern = new Map<number, number>();
    for (let b = 0; b < 4; b++) {
      bassPattern.set(b * 8 + 0, 36);
      bassPattern.set(b * 8 + 4, 36);
    }

    const chordPattern = new Map<number, Set<number>>();
    for (let b = 0; b < 4; b++) {
      chordPattern.set(b * 8 + 0, new Set([60, 64, 67]));
    }

    const bytes = YamahaTemplateStyleSynthesizer.synthesizeFromTemplate({
      styleName: '8Beat Folk',
      bpm: 100,
      stepsPerBar: 8,
      drumKit: { msb: 127, lsb: 0, pc: 0 },
      bassVoice: { msb: 0, lsb: 0, pc: 33 },
      chordVoice: { msb: 0, lsb: 0, pc: 24 }, // Guitar
      sections: [
        {
          name: 'Main A',
          bars: 4,
          stepsPerBar: 8,
          drumPattern,
          bassPattern,
          chordPattern,
        },
      ],
    });

    const parsed = YamahaParser.parse(bytes, 'STY');
    const mainA = parsed.sections.find(s => s.name === 'Main A')!;
    expect(mainA).toBeDefined();

    // Check notes within Main A (startTick to startTick + 4 bars = 4 * 384 = 1536 ticks)
    const tr0 = parsed.tracks[0];
    let t = 0;
    const notesInMainABars: number[] = [0, 0, 0, 0]; // count per bar (Bar 1, 2, 3, 4)
    for (const ev of tr0.events) {
      t += ev.delta;
      if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        if (t >= mainA.startTick && t < mainA.startTick + 4 * 384) {
          const barIdx = Math.floor((t - mainA.startTick) / 384);
          if (barIdx >= 0 && barIdx < 4) {
            notesInMainABars[barIdx]++;
          }
        }
      }
    }

    console.log('Notes in 8-beat Main A first 4 bars:', notesInMainABars);
    // Every single bar (1, 2, 3, 4) MUST have notes! No bar should be 0!
    expect(notesInMainABars[0]).toBeGreaterThan(0);
    expect(notesInMainABars[1]).toBeGreaterThan(0);
    expect(notesInMainABars[2]).toBeGreaterThan(0);
    expect(notesInMainABars[3]).toBeGreaterThan(0);
  });

  it('tests full synthesis with Fill In AA and Fill In BB in CASM and Track 0', () => {
    // 1. Prepare dummy drum, bass, and chord patterns
    const drumPattern = new Map<number, boolean[]>();
    const kick = new Array(64).fill(false);
    kick[0] = true;
    kick[8] = true;
    drumPattern.set(36, kick);

    const bassPattern = new Map<number, number>();
    bassPattern.set(0, 36);

    const chordPattern = new Map<number, Set<number>>();
    chordPattern.set(0, new Set([60, 64, 67]));

    // Custom Fill In AA pattern (snare roll)
    const fillDrum = new Map<number, boolean[]>();
    const snare = new Array(16).fill(true); // 16 snare hits!
    fillDrum.set(38, snare);

    const fillBass = new Map<number, number>();
    fillBass.set(0, 36);
    fillBass.set(8, 43);

    const fillChord = new Map<number, Set<number>>();
    fillChord.set(0, new Set([60, 64, 67]));

    const bytes = YamahaTemplateStyleSynthesizer.synthesizeFromTemplate({
      styleName: 'Pop Rock With Fills',
      bpm: 120,
      drumKit: { msb: 127, lsb: 0, pc: 0 },
      bassVoice: { msb: 0, lsb: 112, pc: 33 },
      chordVoice: { msb: 104, lsb: 0, pc: 0 },
      sections: [
        {
          name: 'Main A',
          bars: 4,
          drumPattern,
          bassPattern,
          chordPattern,
        },
        {
          name: 'Main B',
          bars: 4,
          drumPattern,
          bassPattern,
          chordPattern,
        },
        {
          name: 'Fill In AA',
          bars: 1,
          drumPattern: fillDrum,
          bassPattern: fillBass,
          chordPattern: fillChord,
        },
      ],
    });

    expect(bytes).toBeDefined();
    expect(bytes.length).toBeGreaterThan(5000);

    const parsed = YamahaParser.parse(bytes, 'STY');
    const fillAA = parsed.sections.find(s => s.name === 'Fill In AA');
    const fillBB = parsed.sections.find(s => s.name === 'Fill In BB');
    const fillCC = parsed.sections.find(s => s.name === 'Fill In CC');
    const fillDD = parsed.sections.find(s => s.name === 'Fill In DD');
    const fillBA = parsed.sections.find(s => s.name === 'Fill In BA');

    expect(fillAA).toBeDefined();
    expect(fillBB).toBeDefined();
    expect(fillCC).toBeDefined();
    expect(fillDD).toBeDefined();
    expect(fillBA).toBeDefined();

    // Verify notes exist inside Fill In AA
    let t = 0;
    let notesInFillAA = 0;
    let notesInFillBB = 0;
    for (const ev of parsed.tracks[0].events) {
      t += ev.delta;
      if (ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        if (t >= fillAA!.startTick && (fillAA!.endTick === undefined || t < fillAA!.endTick)) {
          notesInFillAA++;
        }
        if (t >= fillBB!.startTick && (fillBB!.endTick === undefined || t < fillBB!.endTick)) {
          notesInFillBB++;
        }
      }
    }

    console.log(`Fill In AA notes count: ${notesInFillAA}, Fill In BB notes count: ${notesInFillBB}`);
    expect(notesInFillAA).toBeGreaterThan(0); // Custom snare roll + bass + chord
    expect(notesInFillBB).toBeGreaterThan(0); // Fallback from Main B with snare roll accent
  });
});
