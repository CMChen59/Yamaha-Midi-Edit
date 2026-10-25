/**
 * Yamaha PSR-SX920 伴奏風格製作 (V2)
 * 前奏 (Intro) 與尾奏 (Ending) 智慧樣板生成引擎 (Section Presets Engine)
 * 提供倒數計拍、流行 2-5-1 和弦引導、俐落大鈸收束、樂團高潮大收尾等開箱即用之音樂骨架。
 */

import type { SectionStore } from './creator-app';

export interface GeneratedSectionPattern {
  name: string;
  bars: number;
  drumPattern: Map<number, boolean[]>;
  bassPattern: Map<number, number>;
  chordPattern: Map<number, Set<number>>;
  dynamicPatterns?: Record<string, Map<number, Set<number>>>;
}

export class SectionPresetsEngine {
  /**
   * 建立空白軌道結構
   */
  private static createBlankPatterns(totalSteps: number) {
    const drumPattern = new Map<number, boolean[]>();
    [36, 38, 42, 46, 49, 51].forEach(note => {
      drumPattern.set(note, new Array(totalSteps).fill(false));
    });
    const bassPattern = new Map<number, number>();
    const chordPattern = new Map<number, Set<number>>();
    return { drumPattern, bassPattern, chordPattern };
  }

  /**
   * 範本 1: 🥁 倒數計拍前奏 (Count-in Intro)
   * 第 1 小節: 4 拍 Hi-Hat / 鼓棒清脆計拍 (1, 2, 3, 4)
   * 第 2 小節: 輕快節奏進場 + 小鼓漸強滾奏，無縫交棒主歌
   */
  public static generateIntroCountIn(bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    const kick = drumPattern.get(36)!;
    const snare = drumPattern.get(38)!;
    const hihat = drumPattern.get(42)!;

    // 第 1 小節: 4 拍倒數計拍 (嗒、嗒、嗒、嗒)
    for (let beat = 0; beat < 4; beat++) {
      const step = Math.round(beat * (stepsPerBar / 4));
      if (step < totalSteps) {
        hihat[step] = true;
      }
    }

    // 第 2 小節 (若有): 樂團輕快節奏進場，最後一拍小鼓滾奏加花
    if (bars >= 2) {
      const bar1Offset = stepsPerBar;
      // 大鼓
      kick[bar1Offset + 0] = true;
      kick[bar1Offset + 8] = true;
      // 小鼓
      snare[bar1Offset + 4] = true;
      // Hi-Hat 八分音符
      for (let s = 0; s < 12; s += 2) {
        hihat[bar1Offset + s] = true;
      }
      // 最後一拍小鼓滾奏 (16 分音符漸強)
      snare[bar1Offset + 12] = true;
      snare[bar1Offset + 13] = true;
      snare[bar1Offset + 14] = true;
      snare[bar1Offset + 15] = true;

      // 貝斯 (C2)
      bassPattern.set(bar1Offset + 0, 36);
      bassPattern.set(bar1Offset + 8, 36);
      bassPattern.set(bar1Offset + 14, 43); // G2 過門銜接

      // 鋼琴和弦 (C Major)
      chordPattern.set(bar1Offset + 0, new Set([48, 52, 55])); // C3, E3, G3
      chordPattern.set(bar1Offset + 8, new Set([48, 52, 55]));
    }

    return {
      name: 'Intro A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }

  /**
   * 範本 2: 🎹 經典流行 2-5-1 和弦引導前奏 (Pop 2-5-1 Cadence)
   * 第 1 小節: Dm7 (II) 和弦與輕柔行進貝斯
   * 第 2 小節: G7 (V) 屬七和弦過渡，引導進主歌 C (I)
   */
  public static generateIntroHarmonic(bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    const kick = drumPattern.get(36)!;
    const snare = drumPattern.get(38)!;
    const hihat = drumPattern.get(42)!;

    // 第 1 小節: Dm7 (D2 貝斯, D-F-A 和弦)
    kick[0] = true;
    kick[8] = true;
    snare[4] = true;
    snare[12] = true;
    for (let s = 0; s < stepsPerBar; s += 2) hihat[s] = true;

    bassPattern.set(0, 38); // D2
    bassPattern.set(8, 38); // D2
    chordPattern.set(0, new Set([50, 53, 57])); // D3, F3, A3
    chordPattern.set(8, new Set([50, 53, 57]));

    // 第 2 小節: G7 -> 準備進 C
    if (bars >= 2) {
      const bar1 = stepsPerBar;
      kick[bar1 + 0] = true;
      kick[bar1 + 6] = true;
      kick[bar1 + 10] = true;
      snare[bar1 + 4] = true;
      // 小鼓過門
      snare[bar1 + 12] = true;
      snare[bar1 + 14] = true;
      snare[bar1 + 15] = true;
      for (let s = 0; s < 12; s += 2) hihat[bar1 + s] = true;

      bassPattern.set(bar1 + 0, 43); // G2
      bassPattern.set(bar1 + 8, 43); // G2
      bassPattern.set(bar1 + 14, 47); // B2 (導音引導進主歌 C)

      chordPattern.set(bar1 + 0, new Set([53, 55, 59])); // F3, G3, B3 (G7)
      chordPattern.set(bar1 + 8, new Set([53, 55, 59]));
    }

    return {
      name: 'Intro A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }

  /**
   * 範本 3: 💥 俐落大鈸收束 (Punch Ending)
   * 第 1 小節: 小鼓漸強滾奏預告結束
   * 第 2 小節: 第 1 拍大鈸 (Crash) + 重擊大鼓 + 根音三和弦長延音，俐落停止！
   */
  public static generateEndingPunch(bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    const kick = drumPattern.get(36)!;
    const snare = drumPattern.get(38)!;
    const hihat = drumPattern.get(42)!;
    const crash = drumPattern.get(49)!;

    // 第 1 小節: 推進加花
    kick[0] = true;
    kick[4] = true;
    kick[8] = true;
    kick[10] = true;
    snare[4] = true;
    for (let s = 0; s < 8; s += 2) hihat[s] = true;
    // 小鼓漸強滾奏
    snare[8] = true;
    snare[10] = true;
    snare[12] = true;
    snare[13] = true;
    snare[14] = true;
    snare[15] = true;

    bassPattern.set(0, 36); // C2
    bassPattern.set(4, 38); // D2
    bassPattern.set(8, 41); // F2
    bassPattern.set(12, 43); // G2

    chordPattern.set(0, new Set([48, 52, 55])); // C
    chordPattern.set(8, new Set([55, 59, 62])); // G

    // 第 2 小節: 第 1 拍定音重擊，之後全體靜音留白
    const endBar = (bars - 1) * stepsPerBar;
    crash[endBar + 0] = true; // 大鈸一擊！
    kick[endBar + 0] = true;  // 大鼓重音！
    snare[endBar + 0] = true; // 小鼓拍擊！

    bassPattern.set(endBar + 0, 36); // C2 根音定音
    chordPattern.set(endBar + 0, new Set([48, 52, 55, 60])); // C Major 完結和弦

    return {
      name: 'Ending A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }

  /**
   * 範本 4: 🥁 樂團高潮大收尾 (Climax Finish)
   * 狂熱的連擊切分節奏 + 雙重 Crash 大鈸震撼結尾
   */
  public static generateEndingClimax(bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    const kick = drumPattern.get(36)!;
    const snare = drumPattern.get(38)!;
    const crash = drumPattern.get(49)!;

    // 第 1 小節: 重音切分推進
    [0, 2, 4, 6, 8, 10, 12, 14].forEach(s => { kick[s] = true; });
    [4, 8, 12, 13, 14, 15].forEach(s => { snare[s] = true; });

    bassPattern.set(0, 36);
    bassPattern.set(4, 43);
    bassPattern.set(8, 41);
    bassPattern.set(12, 43);

    chordPattern.set(0, new Set([48, 52, 55]));
    chordPattern.set(6, new Set([48, 52, 55]));
    chordPattern.set(12, new Set([55, 59, 62]));

    // 第 2 小節: 3 下切分 Crash 重擊 + 最終長鳴 Crash
    const endBar = (bars - 1) * stepsPerBar;
    // 拍 1, 拍 2, 拍 3 點名
    [0, 4, 8].forEach(s => {
      crash[endBar + s] = true;
      kick[endBar + s] = true;
      bassPattern.set(endBar + s, 36);
      chordPattern.set(endBar + s, new Set([48, 52, 55]));
    });
    // 拍 4 最終一擊
    crash[endBar + 12] = true;
    kick[endBar + 12] = true;
    snare[endBar + 12] = true;
    bassPattern.set(endBar + 12, 36);
    chordPattern.set(endBar + 12, new Set([36, 48, 52, 55, 60]));

    return {
      name: 'Ending A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }

  /**
   * 範本 5: 🌊 抒情溫柔尾奏 (Soft Ending)
   * 輕柔 Ride 鈸與鋼琴分解和弦，餘音嫋嫋自然停止
   */
  public static generateEndingSoft(bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    const ride = drumPattern.get(51)!;
    const kick = drumPattern.get(36)!;

    // 第 1 小節: 慢速抒情琶音
    [0, 4, 8, 12].forEach(s => { ride[s] = true; });
    bassPattern.set(0, 36);
    bassPattern.set(8, 43);
    chordPattern.set(0, new Set([48, 52]));
    chordPattern.set(4, new Set([55]));
    chordPattern.set(8, new Set([60, 64]));
    chordPattern.set(12, new Set([67]));

    // 第 2 小節: 終止式和弦淡入靜止
    const endBar = (bars - 1) * stepsPerBar;
    kick[endBar + 0] = true;
    ride[endBar + 0] = true;
    bassPattern.set(endBar + 0, 36);
    chordPattern.set(endBar + 0, new Set([48, 52, 55, 60]));

    return {
      name: 'Ending A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }

  /**
   * 範本 6: ✨ 沿用 Main A 製作開場 (From Main A)
   * 複製 Main A 的伴奏風格，但在前 1 小節插入 4 拍 Hi-Hat 計拍
   */
  public static generateIntroFromMain(mainStore: SectionStore, bars: number = 2, stepsPerBar: number = 16): GeneratedSectionPattern {
    const totalSteps = bars * stepsPerBar;
    const { drumPattern, bassPattern, chordPattern } = this.createBlankPatterns(totalSteps);

    // 複製 Main A 內容至第 2 小節 (若有)
    if (bars >= 2) {
      const offset = stepsPerBar;
      mainStore.drumPattern.forEach((steps, note) => {
        if (!drumPattern.has(note)) {
          drumPattern.set(note, new Array(totalSteps).fill(false));
        }
        const targetArr = drumPattern.get(note)!;
        for (let s = 0; s < stepsPerBar; s++) {
          if (steps[s]) targetArr[offset + s] = true;
        }
      });

      mainStore.bassPattern.forEach((note, step) => {
        if (step < stepsPerBar) {
          bassPattern.set(offset + step, note);
        }
      });

      if (mainStore.chordPattern) {
        mainStore.chordPattern.forEach((set, step) => {
          if (step < stepsPerBar) {
            chordPattern.set(offset + step, new Set(set));
          }
        });
      }
    }

    // 第 1 小節強制置入 4 拍 Hi-Hat 倒數計拍
    const hihat = drumPattern.get(42)!;
    for (let beat = 0; beat < 4; beat++) {
      const step = Math.round(beat * (stepsPerBar / 4));
      hihat[step] = true;
    }

    return {
      name: 'Intro A',
      bars,
      drumPattern,
      bassPattern,
      chordPattern,
    };
  }
}
