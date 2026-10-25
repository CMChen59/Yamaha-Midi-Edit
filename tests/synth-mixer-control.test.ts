import { describe, it, expect, beforeEach } from 'vitest';
import { drumSynth, DrumSynth } from '../src/creator/drum-synth';
import { bassSynth, BassSynth } from '../src/creator/bass-synth';
import { chordSynth, ChordSynth } from '../src/creator/chord-synth';

describe('Step 1: 合成器獨立音量 (Volume) 與立體聲聲相 (Pan) 控制', () => {
  beforeEach(() => {
    DrumSynth.setMuted(false);
    BassSynth.setMuted(false);
    ChordSynth.setMuted(false);
    drumSynth.setChannelMuted(false);
    bassSynth.setChannelMuted(false);
    chordSynth.setChannelMuted(false);
  });

  it('1. 鼓組、貝斯與和弦合成器具備標準預設音量與聲相', () => {
    expect(drumSynth.getVolume()).toBe(100);
    expect(drumSynth.getPan()).toBe(64);

    expect(bassSynth.getVolume()).toBe(95);
    expect(bassSynth.getPan()).toBe(64);

    expect(chordSynth.getVolume()).toBe(90);
    expect(chordSynth.getPan()).toBe(52);
  });

  it('2. 能正確動態設定與限制音量範圍 (0 ~ 127)', () => {
    drumSynth.setVolume(120);
    expect(drumSynth.getVolume()).toBe(120);

    // 數值越界自動限制
    drumSynth.setVolume(200);
    expect(drumSynth.getVolume()).toBe(127);

    drumSynth.setVolume(-50);
    expect(drumSynth.getVolume()).toBe(0);

    // 貝斯與和弦
    bassSynth.setVolume(80);
    expect(bassSynth.getVolume()).toBe(80);

    chordSynth.setVolume(75);
    expect(chordSynth.getVolume()).toBe(75);
  });

  it('3. 能正確動態設定立體聲聲相 Pan (0 ~ 127, 64 為正中央)', () => {
    // 鼓組置中 64
    drumSynth.setPan(64);
    expect(drumSynth.getPan()).toBe(64);

    // 和弦 1 偏左 (L12 -> 52)
    chordSynth.setPan(52);
    expect(chordSynth.getPan()).toBe(52);

    // 和弦 2 偏右 (R12 -> 76)
    chordSynth.setPan(76);
    expect(chordSynth.getPan()).toBe(76);

    // 邊界防護
    chordSynth.setPan(999);
    expect(chordSynth.getPan()).toBe(127);
    chordSynth.setPan(-999);
    expect(chordSynth.getPan()).toBe(0);
  });

  it('4. 支援獨立軌道靜音 (Channel Mute) 不干擾其他軌道', () => {
    expect(drumSynth.isChannelMuted()).toBe(false);
    expect(bassSynth.isChannelMuted()).toBe(false);

    drumSynth.setChannelMuted(true);
    expect(drumSynth.isChannelMuted()).toBe(true);
    expect(bassSynth.isChannelMuted()).toBe(false);

    drumSynth.setChannelMuted(false);
    expect(drumSynth.isChannelMuted()).toBe(false);
  });

  it('5. 多個 ChordSynth 實例 (如 Chord 1 與 Chord 2) 各自擁有獨立的 Volume 與 Pan', () => {
    const chord2Synth = new ChordSynth();
    chord2Synth.setVoice({ category: 'Guitar', id: 'folk-guitar' });
    chord2Synth.setVolume(85);
    chord2Synth.setPan(76); // R12

    chordSynth.setVolume(90);
    chordSynth.setPan(52); // L12

    expect(chordSynth.getVolume()).toBe(90);
    expect(chordSynth.getPan()).toBe(52);

    expect(chord2Synth.getVolume()).toBe(85);
    expect(chord2Synth.getPan()).toBe(76);
  });
});
