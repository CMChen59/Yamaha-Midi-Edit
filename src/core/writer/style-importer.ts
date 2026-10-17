/**
 * Yamaha Style 伴奏風格 (.STY) 外部 MIDI 匯入分流與 8 聲部智慧映射引擎
 * 依據 Yamaha SFF2 / PSR-SX920 8 伴奏聲部規範
 */

import { MidiImporter, type MidiSourceAnalysis, type MidiSourceTrackSummary } from './midi-importer';
import { YamahaStyleSynthesizer } from './style-synthesizer';
import {
  DEFAULT_STYLE_PARTS,
  type StylePartId,
  type StyleSectionType,
  type StylePartConfig,
  type StyleNoteEvent,
  type StyleSectionConfig,
} from '../models/style-types';
import type { YamahaFileParsed } from '../models/types';

export type InstrumentCategory =
  | 'drums'
  | 'percussion'
  | 'bass'
  | 'piano'
  | 'guitar'
  | 'strings'
  | 'pad'
  | 'brass'
  | 'reed'
  | 'lead'
  | 'other';

export interface StyleTrackAnalysis extends MidiSourceTrackSummary {
  minPitch: number;
  maxPitch: number;
  avgPitch: number;
  avgDurationTicks: number;
  polyphonyRatio: number;
  detectedCategory: InstrumentCategory;
  recommendedPart: StylePartId | null;
  recommendationReason: string;
  alternativeParts: { partId: StylePartId; reason: string }[];
}

export interface StyleSourceAnalysis extends MidiSourceAnalysis {
  styleTracks: StyleTrackAnalysis[];
  autoMapping: Partial<Record<StylePartId, number>>;
}

export interface StylePartMappingItem {
  partId: StylePartId;
  sourceTrackIndex: number | null; // null 表示不指定/留空
  voice?: {
    msb?: number;
    lsb?: number;
    pc?: number;
    volume?: number;
    pan?: number;
    reverb?: number;
    chorus?: number;
  };
  transposeShift?: number; // 半音位移
}

export interface StyleImportOptions {
  projectName: string;
  bpm?: number;
  timeSignature?: { numerator: number; denominator: number };
  startBar?: number; // 1-indexed, default 1
  endBar?: number;   // 1-indexed, default 4 or 8
  targetSection?: StyleSectionType; // default 'Main A'
  partMappings: StylePartMappingItem[];
}

export class StyleImporter {
  /**
   * 智慧分析外部 MIDI，評估音軌音樂特徵並自動推薦對應 Yamaha Style 8 伴奏聲部
   */
  public static analyzeForStyle(
    input: MidiSourceAnalysis | Uint8Array,
    fileName: string = 'imported.mid'
  ): StyleSourceAnalysis {
    const baseAnalysis: MidiSourceAnalysis =
      input instanceof Uint8Array ? MidiImporter.analyzeMidi(input, fileName) : input;

    const styleTracks: StyleTrackAnalysis[] = baseAnalysis.tracks.map((track) => {
      return StyleImporter.analyzeSingleTrack(track, baseAnalysis.division);
    });

    // 執行 8 聲部智慧分配裁決演算法
    const autoMapping = StyleImporter.allocateParts(styleTracks);

    return {
      ...baseAnalysis,
      styleTracks,
      autoMapping,
    };
  }

  /**
   * 單音軌音樂特徵剖析
   */
  private static analyzeSingleTrack(
    track: MidiSourceTrackSummary,
    division: number
  ): StyleTrackAnalysis {
    if (track.notes.length === 0) {
      return {
        ...track,
        minPitch: 0,
        maxPitch: 0,
        avgPitch: 0,
        avgDurationTicks: 0,
        polyphonyRatio: 1.0,
        detectedCategory: 'other',
        recommendedPart: null,
        recommendationReason: '音軌無音符事件 (通常為導引軌或純控制器軌)',
        alternativeParts: [],
      };
    }

    let minPitch = 127;
    let maxPitch = 0;
    let sumPitch = 0;
    let sumDuration = 0;

    // 計算重疊度 (Polyphony)
    const tickNoteCountMap = new Map<number, number>();

    for (const n of track.notes) {
      if (n.note < minPitch) minPitch = n.note;
      if (n.note > maxPitch) maxPitch = n.note;
      sumPitch += n.note;
      sumDuration += n.durationTick;

      // 採 1/16 拍精度統計同時發聲數
      const quantizedTick = Math.round(n.startTick / (division / 4)) * (division / 4);
      tickNoteCountMap.set(quantizedTick, (tickNoteCountMap.get(quantizedTick) || 0) + 1);
    }

    const avgPitch = Math.round(sumPitch / track.notes.length);
    const avgDurationTicks = Math.round(sumDuration / track.notes.length);

    let maxSimultaneous = 1;
    let totalChordMoments = 0;
    for (const count of tickNoteCountMap.values()) {
      if (count > maxSimultaneous) maxSimultaneous = count;
      if (count >= 2) totalChordMoments++;
    }
    const polyphonyRatio = Number((totalChordMoments / Math.max(1, tickNoteCountMap.size)).toFixed(2));

    // 樂器類別自動推斷
    const detectedCategory = StyleImporter.detectCategory(track, avgPitch, avgDurationTicks, division);

    // 推薦初評
    const { recommendedPart, recommendationReason, alternativeParts } =
      StyleImporter.evaluateInitialRecommendation(track, detectedCategory, avgPitch, avgDurationTicks, division, polyphonyRatio);

    return {
      ...track,
      minPitch,
      maxPitch,
      avgPitch,
      avgDurationTicks,
      polyphonyRatio,
      detectedCategory,
      recommendedPart,
      recommendationReason,
      alternativeParts,
    };
  }

  /**
   * 推斷樂器分類 (Category)
   */
  private static detectCategory(
    track: MidiSourceTrackSummary,
    avgPitch: number,
    avgDurationTicks: number,
    division: number
  ): InstrumentCategory {
    const nameLower = (track.name || '').toLowerCase();
    const pc = track.programChange ?? -1;
    const isChannel10 = track.channel === 9; // MIDI Ch 10 is 0-indexed 9

    // 1. 鼓組與打擊樂判斷
    if (isChannel10 || nameLower.includes('drum') || nameLower.includes('kit') || nameLower.includes('beat')) {
      return 'drums';
    }
    if (nameLower.includes('perc') || nameLower.includes('latin') || nameLower.includes('conga') || nameLower.includes('tambourine')) {
      return 'percussion';
    }

    // 2. 貝斯判斷
    if (nameLower.includes('bass') || (pc >= 32 && pc <= 39) || (avgPitch <= 48 && avgDurationTicks >= division * 0.5)) {
      return 'bass';
    }

    // 3. 鋼琴 / 鍵盤
    if (nameLower.includes('piano') || nameLower.includes('ep') || nameLower.includes('key') || (pc >= 0 && pc <= 7)) {
      return 'piano';
    }

    // 4. 吉他
    if (nameLower.includes('guitar') || nameLower.includes('gt') || nameLower.includes('gtr') || (pc >= 24 && pc <= 31)) {
      return 'guitar';
    }

    // 5. 弦樂
    if (nameLower.includes('string') || nameLower.includes('str') || (pc >= 40 && pc <= 51)) {
      return 'strings';
    }

    // 6. 長音 Pad / 合成器背景
    if (nameLower.includes('pad') || nameLower.includes('warm') || nameLower.includes('sweep') || (pc >= 88 && pc <= 95)) {
      return 'pad';
    }

    // 7. 銅管 / 木管
    if (nameLower.includes('brass') || nameLower.includes('horn') || nameLower.includes('trumpet') || (pc >= 56 && pc <= 63)) {
      return 'brass';
    }
    if (nameLower.includes('sax') || nameLower.includes('flute') || (pc >= 64 && pc <= 79)) {
      return 'reed';
    }

    // 8. 主奏 Lead
    if (nameLower.includes('lead') || (pc >= 80 && pc <= 87)) {
      return 'lead';
    }

    // 9. 依音高與時值備援推斷
    if (avgPitch <= 50) return 'bass';
    if (avgDurationTicks >= division * 2) return 'pad';

    return 'other';
  }

  /**
   * 初步評估單軌推薦與理由
   */
  private static evaluateInitialRecommendation(
    track: MidiSourceTrackSummary,
    cat: InstrumentCategory,
    avgPitch: number,
    avgDurationTicks: number,
    division: number,
    polyphonyRatio: number
  ): {
    recommendedPart: StylePartId | null;
    recommendationReason: string;
    alternativeParts: { partId: StylePartId; reason: string }[];
  } {
    const isChannel10 = track.channel === 9;

    if (cat === 'drums' || isChannel10) {
      return {
        recommendedPart: 'Rhythm2',
        recommendationReason: isChannel10
          ? 'MIDI 通道 10 標準打擊樂通道，強烈推薦為主爵士鼓組 (Rhythm 2)'
          : `名稱或特徵符合爵士鼓組 (${track.name || 'Drums'})`,
        alternativeParts: [{ partId: 'Rhythm1', reason: '作為輔助次打擊樂 (Percussion)' }],
      };
    }

    if (cat === 'percussion') {
      return {
        recommendedPart: 'Rhythm1',
        recommendationReason: `偵測為打擊樂器 (${track.name || 'Percussion'})，推薦為次打擊樂聲部 (Rhythm 1)`,
        alternativeParts: [{ partId: 'Rhythm2', reason: '指派為主節奏鼓組' }],
      };
    }

    if (cat === 'bass') {
      return {
        recommendedPart: 'Bass',
        recommendationReason: `低音域 (平均音高 MIDI ${avgPitch}) 與貝斯音色，推薦為低音聲部 (Bass)`,
        alternativeParts: [{ partId: 'Phrase1', reason: '作為低音裝飾旋律短句' }],
      };
    }

    if (cat === 'pad' || (cat === 'strings' && avgDurationTicks >= division * 1.5)) {
      return {
        recommendedPart: 'Pad',
        recommendationReason: `長音音符 (${(avgDurationTicks / division).toFixed(1)} 拍) 且為鋪底音色，推薦為背景長音 (Pad)`,
        alternativeParts: [
          { partId: 'Chord2', reason: '作為副和弦聲部' },
          { partId: 'Chord1', reason: '作為主和弦聲部' },
        ],
      };
    }

    const nameLower = (track.name || '').toLowerCase();
    const isArpeggioOrRiff =
      nameLower.includes('arp') ||
      nameLower.includes('riff') ||
      nameLower.includes('lead') ||
      nameLower.includes('solo');

    if ((cat === 'piano' || cat === 'guitar') && (isArpeggioOrRiff || polyphonyRatio < 0.2)) {
      return {
        recommendedPart: 'Phrase1',
        recommendationReason: `分解琶音或單音短句 (${track.name || 'Arp'}, 多音比率 ${(polyphonyRatio * 100).toFixed(0)}%)，推薦為琶音裝飾短句 (Phrase 1)`,
        alternativeParts: [
          { partId: 'Phrase2', reason: '作為副裝飾句 (Phrase 2)' },
          { partId: 'Chord1', reason: '作為主和弦聲部' },
        ],
      };
    }

    if (cat === 'piano' || cat === 'guitar' || polyphonyRatio >= 0.25) {
      return {
        recommendedPart: 'Chord1',
        recommendationReason: `具備和弦演奏特徵 (多音同發比率 ${(polyphonyRatio * 100).toFixed(0)}%)，推薦為節奏主和弦 (Chord 1)`,
        alternativeParts: [
          { partId: 'Chord2', reason: '作為副和弦或管樂襯托' },
          { partId: 'Phrase1', reason: '作為分解琶音旋律短句' },
        ],
      };
    }

    if (cat === 'brass' || cat === 'reed') {
      return {
        recommendedPart: 'Chord2',
        recommendationReason: `管樂組或切分對位，推薦為副和弦/管樂組 (Chord 2)`,
        alternativeParts: [
          { partId: 'Phrase2', reason: '作為管樂加花裝飾句' },
          { partId: 'Phrase1', reason: '作為對位旋律' },
        ],
      };
    }

    // 預設為裝飾句 Phrase 1 / Phrase 2
    return {
      recommendedPart: 'Phrase1',
      recommendationReason: `單音樂句或裝飾旋律，推薦為對位主旋律短句 (Phrase 1)`,
      alternativeParts: [
        { partId: 'Phrase2', reason: '作為副裝飾句 (Phrase 2)' },
        { partId: 'Chord1', reason: '作為主和弦聲部' },
      ],
    };
  }

  /**
   * 8 聲部全域智慧裁決與防衝突分配演算法
   */
  private static allocateParts(tracks: StyleTrackAnalysis[]): Partial<Record<StylePartId, number>> {
    const allocation: Partial<Record<StylePartId, number>> = {};
    const usedTrackIndices = new Set<number>();

    // 優先度 1: 爵士鼓組 Rhythm 2 (Ch 10 優先)
    const rhythm2Track = tracks.find(
      (t) => !usedTrackIndices.has(t.trackIndex) && (t.channel === 9 || t.detectedCategory === 'drums')
    );
    if (rhythm2Track) {
      allocation['Rhythm2'] = rhythm2Track.trackIndex;
      usedTrackIndices.add(rhythm2Track.trackIndex);
    }

    // 優先度 2: 打擊樂 Rhythm 1 (次打擊樂或溢流鼓組)
    const rhythm1Track = tracks.find(
      (t) =>
        !usedTrackIndices.has(t.trackIndex) &&
        (t.detectedCategory === 'percussion' || t.recommendedPart === 'Rhythm1' || t.detectedCategory === 'drums')
    );
    if (rhythm1Track) {
      allocation['Rhythm1'] = rhythm1Track.trackIndex;
      usedTrackIndices.add(rhythm1Track.trackIndex);
    }

    // 優先度 3: 低音貝斯 Bass
    const bassTrack = tracks.find(
      (t) => !usedTrackIndices.has(t.trackIndex) && (t.detectedCategory === 'bass' || t.recommendedPart === 'Bass')
    );
    if (bassTrack) {
      allocation['Bass'] = bassTrack.trackIndex;
      usedTrackIndices.add(bassTrack.trackIndex);
    }

    // 優先度 4: 長音背景 Pad
    const padTrack = tracks.find(
      (t) => !usedTrackIndices.has(t.trackIndex) && (t.detectedCategory === 'pad' || t.recommendedPart === 'Pad')
    );
    if (padTrack) {
      allocation['Pad'] = padTrack.trackIndex;
      usedTrackIndices.add(padTrack.trackIndex);
    }

    // 優先度 5: 主和弦 Chord 1
    const chord1Track = tracks.find(
      (t) =>
        !usedTrackIndices.has(t.trackIndex) &&
        (t.recommendedPart === 'Chord1' || t.detectedCategory === 'piano' || t.detectedCategory === 'guitar')
    );
    if (chord1Track) {
      allocation['Chord1'] = chord1Track.trackIndex;
      usedTrackIndices.add(chord1Track.trackIndex);
    }

    // 優先度 6: 副和弦 Chord 2 (次和弦、管樂或溢流和弦)
    const chord2Track = tracks.find(
      (t) =>
        !usedTrackIndices.has(t.trackIndex) &&
        (t.recommendedPart === 'Chord2' ||
          t.detectedCategory === 'brass' ||
          t.detectedCategory === 'strings' ||
          t.recommendedPart === 'Chord1' ||
          t.polyphonyRatio >= 0.25)
    );
    if (chord2Track) {
      allocation['Chord2'] = chord2Track.trackIndex;
      usedTrackIndices.add(chord2Track.trackIndex);
    }

    // 優先度 7: 短句 Phrase 1
    const phrase1Track = tracks.find(
      (t) =>
        !usedTrackIndices.has(t.trackIndex) &&
        t.notes.length > 0 &&
        (t.recommendedPart === 'Phrase1' ||
          t.detectedCategory === 'lead' ||
          t.detectedCategory === 'reed')
    );
    if (phrase1Track) {
      allocation['Phrase1'] = phrase1Track.trackIndex;
      usedTrackIndices.add(phrase1Track.trackIndex);
    }

    // 優先度 8: 副短句 Phrase 2 (其他任何有音符的未分配軌道)
    const phrase2Track = tracks.find(
      (t) => !usedTrackIndices.has(t.trackIndex) && t.notes.length > 0
    );
    if (phrase2Track) {
      allocation['Phrase2'] = phrase2Track.trackIndex;
      usedTrackIndices.add(phrase2Track.trackIndex);
    }

    return allocation;
  }

  /**
   * 根據智慧映射與切片小節設定，合成標準 Yamaha Style (.sty)
   */
  public static synthesizeStyleFromImport(
    analysis: StyleSourceAnalysis,
    options: StyleImportOptions
  ): YamahaFileParsed {
    const division = analysis.division || 480;
    const bpm = options.bpm || analysis.bpm || 120;
    const timeSig = options.timeSignature || analysis.timeSignature || { numerator: 4, denominator: 4 };

    const startBar = Math.max(1, options.startBar || 1);
    const endBar = Math.max(startBar, options.endBar || 4);
    const measureLength = (endBar - startBar + 1);

    const ticksPerBeat = division;
    const beatsPerMeasure = timeSig.numerator * (4 / timeSig.denominator);
    const ticksPerMeasure = Math.round(ticksPerBeat * beatsPerMeasure);

    const sliceStartTick = (startBar - 1) * ticksPerMeasure;
    const sliceEndTick = endBar * ticksPerMeasure;

    // 構建 8 聲部設定與抽取音符
    const partsConfig: Record<StylePartId, StylePartConfig> = { ...DEFAULT_STYLE_PARTS };
    const sectionNotes: StyleNoteEvent[] = [];

    // 遍歷 8 大聲部映射
    for (const mapping of options.partMappings) {
      const partDef = partsConfig[mapping.partId];
      if (!partDef) continue;

      // 更新音色或混音參數 (若有覆寫)
      if (mapping.voice) {
        partsConfig[mapping.partId] = {
          ...partDef,
          msb: mapping.voice.msb ?? partDef.msb,
          lsb: mapping.voice.lsb ?? partDef.lsb,
          pc: mapping.voice.pc ?? partDef.pc,
          volume: mapping.voice.volume ?? partDef.volume,
          pan: mapping.voice.pan ?? partDef.pan,
          reverb: mapping.voice.reverb ?? partDef.reverb,
          chorus: mapping.voice.chorus ?? partDef.chorus,
        };
      }

      // 若有指定來源音軌，擷取該音軌在切片區間內的音符
      if (mapping.sourceTrackIndex !== null && mapping.sourceTrackIndex !== undefined) {
        const sourceTrack = analysis.tracks.find((t) => t.trackIndex === mapping.sourceTrackIndex);
        if (sourceTrack && sourceTrack.notes.length > 0) {
          const shift = mapping.transposeShift || 0;

          // 若來源軌道自帶音色資訊且設定中未手動指派，繼承來源音色
          if (!mapping.voice && sourceTrack.programChange !== undefined) {
            partsConfig[mapping.partId].pc = sourceTrack.programChange;
            if (sourceTrack.bankMsb !== undefined) partsConfig[mapping.partId].msb = sourceTrack.bankMsb;
            if (sourceTrack.bankLsb !== undefined) partsConfig[mapping.partId].lsb = sourceTrack.bankLsb;
          }

          for (const n of sourceTrack.notes) {
            // 檢查音符是否落在切片區間內
            if (n.startTick >= sliceStartTick && n.startTick < sliceEndTick) {
              const relTick = n.startTick - sliceStartTick;
              const transposedNote = Math.min(127, Math.max(0, n.note + shift));

              sectionNotes.push({
                partId: mapping.partId,
                note: transposedNote,
                velocity: n.velocity,
                startTick: relTick,
                durationTick: n.durationTick,
              });
            }
          }
        }
      }
    }

    const targetSection = options.targetSection || 'Main A';
    const sectionsConfig: StyleSectionConfig[] = [
      {
        name: targetSection,
        bars: measureLength,
        notes: sectionNotes,
      },
    ];

    // 調用 YamahaStyleSynthesizer 建立 Format 0 單軌 Style
    return YamahaStyleSynthesizer.createBlankStyle({
      styleName: options.projectName || 'My Style',
      bpm,
      timeSignature: timeSig,
      division,
      sections: sectionsConfig,
      parts: partsConfig,
    });
  }
}
