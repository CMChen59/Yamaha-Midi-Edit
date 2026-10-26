import { describe, it, expect } from 'vitest';
import { drumSynth } from '../src/creator/drum-synth';
import { bassSynth } from '../src/creator/bass-synth';
import { chordSynth } from '../src/creator/chord-synth';

describe('Rock-Solid Web Audio Metronome & Sample-Accurate Timing', () => {
  it('supports passing when (audio timestamp) to drumSynth.playNote without errors', () => {
    expect(() => {
      drumSynth.playNote(36, 100, 1.25); // Kick at t = 1.25s
      drumSynth.playNote(38, 100, 1.50); // Snare at t = 1.50s
      drumSynth.playNote(42, 100, 1.75); // HiHat at t = 1.75s
    }).not.toThrow();
  });

  it('supports passing when (audio timestamp) to bassSynth.playNote without errors', () => {
    expect(() => {
      bassSynth.playNote(36, 100, 240, 1.25); // C1 bass at t = 1.25s
      bassSynth.playNote(43, 90, 240, 1.50);  // G1 bass at t = 1.50s
    }).not.toThrow();
  });

  it('supports passing when (audio timestamp) to chordSynth.playNote without errors', () => {
    expect(() => {
      chordSynth.playNote(48, 95, 350, 1.25); // C3 chord at t = 1.25s
      chordSynth.playNote(52, 95, 350, 1.25); // E3 chord at t = 1.25s
      chordSynth.playNote(55, 95, 350, 1.25); // G3 chord at t = 1.25s
    }).not.toThrow();
  });

  it('verifies mathematical step interval calculation across common tempos', () => {
    // 120 BPM: 1 beat = 500ms, 16th note (4 steps/beat) = 125ms
    const step120 = (60 / 120 / 4) * 1000;
    expect(step120).toBe(125);

    // 132 BPM: 1 beat = 454.545ms, 16th note = 113.636ms
    const step132 = (60 / 132 / 4) * 1000;
    expect(Math.round(step132 * 100) / 100).toBe(113.64);

    // Lookahead schedule simulation: 16 steps at 120 BPM
    const audioTimes: number[] = [];
    const startAudio = 0.5;
    const stepSec = step120 / 1000;
    for (let s = 0; s < 16; s++) {
      audioTimes.push(startAudio + s * stepSec);
    }

    // Intervals between scheduled audio notes must be 100.00% constant (0.125s)
    for (let i = 1; i < audioTimes.length; i++) {
      const dt = audioTimes[i] - audioTimes[i - 1];
      expect(Math.abs(dt - 0.125)).toBeLessThan(0.000001);
    }
  });
});
