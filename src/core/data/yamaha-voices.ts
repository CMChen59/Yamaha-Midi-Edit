/**
 * Yamaha PSR-SX920 完整原廠 Data List 音色資料庫 (Voice Library Database)
 * 收錄 Yamaha PSR-SX920 官方 2,300+ 全套原廠樂器、音色三聯號身分證 (Bank MSB, Bank LSB, PC)
 * 以及琴端螢幕圖示代碼 (Icon Code)、樂器分類、Multi Pad 適用度與避坑標記。
 */

import rawVoiceData from './yamaha-sx920-datalist.json';

export interface YamahaVoice {
  id: string;
  name: string;             // 官方英文名稱 (如 'CFX Concert Grand', 'Kino Strings')
  chineseName: string;      // 繁體中文說明 (如 'CFX 音樂會旗艦三角鋼琴', '電影大片史詩弦樂')
  category: VoiceCategory;  // 樂器分類
  msb: number;              // Bank Select MSB (CC 0)
  lsb: number;              // Bank Select LSB (CC 32)
  pc: number;               // Program Change (0 ~ 127, 0-indexed)
  icon: string;             // Yamaha 琴端圖標 (如 S801, S809)
  type?: 'S.Art!' | 'Live!' | 'Sweet!' | 'Cool!' | 'MegaVoice' | 'OrganFlutes' | 'Standard' | 'Legacy';
  suitability?: 'recommended' | 'warning' | 'standard';
  suitabilityReason?: string;
}

export type VoiceCategory =
  | 'Piano'
  | 'E.Piano'
  | 'Organ'
  | 'Accordion'
  | 'Guitar'
  | 'Bass'
  | 'Strings'
  | 'Brass'
  | 'Saxophone'
  | 'Woodwind'
  | 'Synth'
  | 'Pad'
  | 'Choir'
  | 'Drums'
  | 'Percussion'
  | 'Legacy';

export type VoiceSuitabilityFilter =
  | 'ALL'
  | 'RECOMMENDED'
  | 'MEGAVOICE'
  | 'LIVE_SWEET_COOL'
  | 'SART'
  | 'DRUMS'
  | 'WARNING';

export const VOICE_CATEGORIES: Array<{ key: VoiceCategory | 'ALL'; label: string; icon: string }> = [
  { key: 'ALL', label: '全部音色', icon: '🌐' },
  { key: 'Piano', label: '鋼琴 (Piano)', icon: '🎹' },
  { key: 'E.Piano', label: '電鋼琴 (E.Piano)', icon: '⚡' },
  { key: 'Strings', label: '弦樂 (Strings)', icon: '🎻' },
  { key: 'Guitar', label: '吉他 (Guitar)', icon: '🎸' },
  { key: 'Bass', label: '貝斯 (Bass)', icon: '🎸' },
  { key: 'Saxophone', label: '薩克斯風 (Sax)', icon: '🎷' },
  { key: 'Brass', label: '銅管樂 (Brass)', icon: '🎺' },
  { key: 'Woodwind', label: '木管/長笛 (Wind)', icon: '🪈' },
  { key: 'Organ', label: '風琴 (Organ)', icon: '🎼' },
  { key: 'Accordion', label: '手風琴 (Accordion)', icon: '🪗' },
  { key: 'Synth', label: '合成主奏 (Synth)', icon: '🎛️' },
  { key: 'Pad', label: '溫暖鋪底 (Pad)', icon: '🌌' },
  { key: 'Choir', label: '人聲合唱 (Choir)', icon: '👼' },
  { key: 'Drums', label: '原廠鼓組 (Drums)', icon: '🥁' },
  { key: 'Percussion', label: '世界打擊 (Perc)', icon: '🔔' },
  { key: 'Legacy', label: 'GM/XG 經典 (Legacy)', icon: '📻' },
];

export const VOICE_SUITABILITY_FILTERS: Array<{ key: VoiceSuitabilityFilter; label: string; icon: string }> = [
  { key: 'ALL', label: '全部類型', icon: '📋' },
  { key: 'RECOMMENDED', label: '⭐ Multi Pad 推薦', icon: '⭐' },
  { key: 'MEGAVOICE', label: 'MegaVoice 伴奏極品', icon: '🎸' },
  { key: 'LIVE_SWEET_COOL', label: 'Live! / Sweet! / Cool!', icon: '💎' },
  { key: 'SART', label: 'S.Art! 超音色', icon: '🎷' },
  { key: 'DRUMS', label: '鼓組與打擊樂', icon: '🥁' },
  { key: 'WARNING', label: '⚠️ 避坑警示 (OrganFlutes)', icon: '⚠️' },
];

/**
 * Yamaha PSR-SX920 完整音色清單 (2,300+ 種官方完整 Data List 音色)
 */
export const YAMAHA_SX920_VOICES: YamahaVoice[] = rawVoiceData as YamahaVoice[];

// 快速索引表以實現 O(1) 毫秒級查找
interface VoiceIndex {
  exactMap: Map<string, YamahaVoice>;
  msbPcMap: Map<string, YamahaVoice>;
  pcMap: Map<number, YamahaVoice>;
  searchCache: Array<{ voice: YamahaVoice; searchStr: string }>;
}

let voiceIndex: VoiceIndex | null = null;

function getVoiceIndex(): VoiceIndex {
  if (voiceIndex) return voiceIndex;

  const exactMap = new Map<string, YamahaVoice>();
  const msbPcMap = new Map<string, YamahaVoice>();
  const pcMap = new Map<number, YamahaVoice>();
  const searchCache: Array<{ voice: YamahaVoice; searchStr: string }> = [];

  for (const voice of YAMAHA_SX920_VOICES) {
    const exactKey = `${voice.msb}-${voice.lsb}-${voice.pc}`;
    if (!exactMap.has(exactKey)) {
      exactMap.set(exactKey, voice);
    }

    const msbPcKey = `${voice.msb}-${voice.pc}`;
    if (!msbPcMap.has(msbPcKey)) {
      msbPcMap.set(msbPcKey, voice);
    }

    if (!pcMap.has(voice.pc)) {
      pcMap.set(voice.pc, voice);
    }

    // 預先建置小寫搜尋字串
    const searchTokens = [
      voice.name.toLowerCase(),
      voice.chineseName.toLowerCase(),
      voice.category.toLowerCase(),
      voice.type ? voice.type.toLowerCase() : '',
      `${voice.msb}-${voice.lsb}-${voice.pc}`,
      `pc:${voice.pc}`,
      `pc ${voice.pc}`,
      voice.pc.toString(),
      voice.icon.toLowerCase(),
      voice.suitability || '',
    ].join(' ');

    searchCache.push({ voice, searchStr: searchTokens });
  }

  voiceIndex = { exactMap, msbPcMap, pcMap, searchCache };
  return voiceIndex;
}

/**
 * 智慧音色搜尋引擎
 * 支援多關鍵字、樂器分類、Multi Pad 適用度篩選
 */
export function searchYamahaVoices(
  query: string = '',
  category: VoiceCategory | 'ALL' = 'ALL',
  suitabilityFilter: VoiceSuitabilityFilter = 'ALL'
): YamahaVoice[] {
  const { searchCache } = getVoiceIndex();
  const q = query.trim().toLowerCase();
  const queryTokens = q ? q.split(/\s+/).filter(t => t.length > 0) : [];

  const results: YamahaVoice[] = [];

  for (let i = 0; i < searchCache.length; i++) {
    const item = searchCache[i];
    const { voice, searchStr } = item;

    // 1. 分類過濾
    if (category !== 'ALL' && voice.category !== category) {
      continue;
    }

    // 2. 適用度 / 類型過濾
    if (suitabilityFilter !== 'ALL') {
      if (suitabilityFilter === 'RECOMMENDED' && voice.suitability !== 'recommended') {
        continue;
      }
      if (suitabilityFilter === 'MEGAVOICE' && voice.type !== 'MegaVoice') {
        continue;
      }
      if (suitabilityFilter === 'SART' && voice.type !== 'S.Art!') {
        continue;
      }
      if (
        suitabilityFilter === 'LIVE_SWEET_COOL' &&
        voice.type !== 'Live!' &&
        voice.type !== 'Sweet!' &&
        voice.type !== 'Cool!'
      ) {
        continue;
      }
      if (
        suitabilityFilter === 'DRUMS' &&
        voice.category !== 'Drums' &&
        voice.category !== 'Percussion'
      ) {
        continue;
      }
      if (suitabilityFilter === 'WARNING' && voice.suitability !== 'warning') {
        continue;
      }
    }

    // 3. 關鍵字模糊多條件比對 (所有輸入的詞都要命中)
    if (queryTokens.length > 0) {
      let matched = true;
      for (const token of queryTokens) {
        if (!searchStr.includes(token)) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
    }

    results.push(voice);
  }

  return results;
}

/**
 * 依據 MSB, LSB, PC 精確尋找或模糊配對最適原廠音色 (O(1) 高速查找)
 */
export function findYamahaVoice(msb: number, lsb: number, pc: number): YamahaVoice | undefined {
  const { exactMap, msbPcMap, pcMap } = getVoiceIndex();

  // 1. 三聯號完全吻合 (MSB, LSB, PC 均符合)
  const exact = exactMap.get(`${msb}-${lsb}-${pc}`);
  if (exact) return exact;

  // 2. 次要吻合：若 MSB 相同且 PC 相同 (忽略小改版 LSB)
  const msbPc = msbPcMap.get(`${msb}-${pc}`);
  if (msbPc) return msbPc;

  // 3. 通用備用：僅 PC 相同 (相容 GM/XG 標準樂器)
  return pcMap.get(pc);
}
