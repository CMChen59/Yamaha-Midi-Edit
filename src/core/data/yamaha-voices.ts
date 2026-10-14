/**
 * Yamaha PSR-SX920 原廠音色資料庫 (Voice Library Database)
 * 收錄 Yamaha PSR-SX920 / SX900 系列常用原廠樂器、音色三聯號身分證 (Bank MSB, Bank LSB, PC)
 * 以及琴端螢幕圖示代碼 (Icon Code) 與分類。
 */

export interface YamahaVoice {
  id: string;
  name: string;             // 官方英文名稱 (如 'ConcertGrand', 'Kino Strings')
  chineseName: string;      // 繁體中文說明 (如 '音樂會大三角鋼琴', '電影史詩弦樂')
  category: VoiceCategory;  // 樂器分類
  msb: number;              // Bank Select MSB (CC 0)
  lsb: number;              // Bank Select LSB (CC 32)
  pc: number;               // Program Change (0 ~ 127, 0-indexed)
  icon: string;             // Yamaha 琴端圖標 (如 S801, S809)
  type?: 'S.Art!' | 'Live!' | 'Sweet!' | 'Cool!' | 'MegaVoice' | 'Standard';
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
  | 'Percussion';

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
];

/**
 * Yamaha PSR-SX920 完整音色清單
 */
export const YAMAHA_SX920_VOICES: YamahaVoice[] = [
  // --- 1. Piano (鋼琴) ---
  { id: 'cfx-concert-grand', name: 'CFX Concert Grand', chineseName: 'CFX 音樂會旗艦三角鋼琴', category: 'Piano', msb: 104, lsb: 1, pc: 0, icon: 'S801', type: 'S.Art!' },
  { id: 'concert-grand', name: 'Concert Grand', chineseName: '標準音樂會大三角鋼琴', category: 'Piano', msb: 104, lsb: 0, pc: 0, icon: 'S801', type: 'Live!' },
  { id: 'pop-grand', name: 'Pop Grand', chineseName: '流行樂明亮鋼琴', category: 'Piano', msb: 104, lsb: 1, pc: 1, icon: 'S801', type: 'Live!' },
  { id: 'rock-piano', name: 'Rock Piano', chineseName: '搖滾衝擊鋼琴', category: 'Piano', msb: 104, lsb: 2, pc: 1, icon: 'S801', type: 'Live!' },
  { id: 'cocktail-piano', name: 'Cocktail Piano', chineseName: '爵士雞尾酒鋼琴', category: 'Piano', msb: 104, lsb: 3, pc: 0, icon: 'S801' },
  { id: 'honky-tonk', name: 'Honky-tonk Piano', chineseName: '酒館復古鋼琴', category: 'Piano', msb: 0, lsb: 112, pc: 3, icon: 'S801' },
  { id: 'midi-grand-piano', name: 'Grand Piano (Standard)', chineseName: '標準三角鋼琴 (GM/XG)', category: 'Piano', msb: 0, lsb: 112, pc: 0, icon: 'S801' },
  { id: 'bright-piano', name: 'Bright Piano', chineseName: '高亢明亮鋼琴', category: 'Piano', msb: 0, lsb: 112, pc: 1, icon: 'S801' },
  { id: 'harpsichord', name: 'Harpsichord', chineseName: '古典大鍵琴', category: 'Piano', msb: 0, lsb: 112, pc: 6, icon: 'S801' },

  // --- 2. E.Piano (電鋼琴) ---
  { id: 'suitcase-ep', name: 'Suitcase EP', chineseName: '經典手提箱電鋼琴', category: 'E.Piano', msb: 104, lsb: 2, pc: 4, icon: 'S802', type: 'S.Art!' },
  { id: 'stage-ep', name: 'Stage EP', chineseName: '舞臺電鋼琴', category: 'E.Piano', msb: 104, lsb: 1, pc: 4, icon: 'S802', type: 'Live!' },
  { id: 'dx-modern-ep', name: 'DX Modern EP', chineseName: 'DX7 經典數位水晶電鋼琴', category: 'E.Piano', msb: 104, lsb: 1, pc: 5, icon: 'S802', type: 'Sweet!' },
  { id: 'vintage-ep', name: 'Vintage EP', chineseName: '復古管球電鋼琴', category: 'E.Piano', msb: 0, lsb: 112, pc: 4, icon: 'S802' },
  { id: 'clavi', name: 'Clavi', chineseName: '放克鍵盤 (Clavinet)', category: 'E.Piano', msb: 0, lsb: 112, pc: 7, icon: 'S802' },

  // --- 3. Strings (弦樂) ---
  { id: 'kino-strings', name: 'Kino Strings', chineseName: '電影大片史詩弦樂 (Kino)', category: 'Strings', msb: 104, lsb: 0, pc: 48, icon: 'S809', type: 'S.Art!' },
  { id: 'concert-strings', name: 'Concert Strings', chineseName: '交響樂音樂會弦樂團', category: 'Strings', msb: 104, lsb: 1, pc: 48, icon: 'S809', type: 'Live!' },
  { id: 'live-strings', name: 'Live! Strings', chineseName: '動態現場弦樂團', category: 'Strings', msb: 8, lsb: 33, pc: 49, icon: 'S809', type: 'Live!' },
  { id: 'studio-strings', name: 'Studio Strings', chineseName: '錄音室精緻弦樂', category: 'Strings', msb: 8, lsb: 35, pc: 49, icon: 'S809' },
  { id: 'pizzicato-strings', name: 'Pizzicato Strings', chineseName: '跳躍撥弦 (Pizzicato)', category: 'Strings', msb: 0, lsb: 113, pc: 75, icon: 'S809', type: 'Sweet!' },
  { id: 'spiccato-strings', name: 'Spiccato Strings', chineseName: '跳弓斷奏短弦樂', category: 'Strings', msb: 104, lsb: 3, pc: 48, icon: 'S809', type: 'S.Art!' },
  { id: 'solo-violin', name: 'Solo Violin', chineseName: '獨奏小提琴', category: 'Strings', msb: 104, lsb: 1, pc: 40, icon: 'S809', type: 'S.Art!' },
  { id: 'solo-cello', name: 'Solo Cello', chineseName: '獨奏大提琴', category: 'Strings', msb: 104, lsb: 1, pc: 42, icon: 'S809', type: 'S.Art!' },
  { id: 'tremolo-strings', name: 'Tremolo Strings', chineseName: '震弓顫音弦樂', category: 'Strings', msb: 0, lsb: 112, pc: 44, icon: 'S809' },
  { id: 'synth-strings', name: 'Synth Strings', chineseName: '合成模擬弦樂', category: 'Strings', msb: 0, lsb: 112, pc: 50, icon: 'S809' },

  // --- 4. Guitar (吉他) ---
  { id: 'steel-guitar', name: 'Steel Guitar', chineseName: '民謠鋼弦吉他', category: 'Guitar', msb: 104, lsb: 1, pc: 25, icon: 'S804', type: 'S.Art!' },
  { id: 'nylon-guitar', name: 'Nylon Guitar', chineseName: '古典尼龍弦吉他', category: 'Guitar', msb: 104, lsb: 0, pc: 24, icon: 'S804', type: 'S.Art!' },
  { id: 'flamenco-guitar', name: 'Flamenco Guitar', chineseName: '佛朗明哥響亮吉他', category: 'Guitar', msb: 104, lsb: 2, pc: 24, icon: 'S804', type: 'Live!' },
  { id: 'clean-guitar', name: 'Clean Guitar', chineseName: '清音電吉他', category: 'Guitar', msb: 104, lsb: 0, pc: 27, icon: 'S804', type: 'S.Art!' },
  { id: 'overdriven-guitar', name: 'Overdriven Guitar', chineseName: '過載破音電吉他', category: 'Guitar', msb: 104, lsb: 0, pc: 29, icon: 'S804', type: 'S.Art!' },
  { id: 'distortion-guitar', name: 'Distortion Guitar', chineseName: '失真重金屬吉他', category: 'Guitar', msb: 104, lsb: 0, pc: 30, icon: 'S804' },
  { id: '12-string-guitar', name: '12 String Guitar', chineseName: '十二弦寬廣木吉他', category: 'Guitar', msb: 104, lsb: 3, pc: 25, icon: 'S804' },

  // --- 5. Bass (貝斯) ---
  { id: 'finger-bass', name: 'Finger Bass', chineseName: '指彈爵士電貝斯', category: 'Bass', msb: 104, lsb: 2, pc: 33, icon: 'S805', type: 'S.Art!' },
  { id: 'acoustic-bass', name: 'Acoustic Bass', chineseName: '原聲低音大提琴 (Upright)', category: 'Bass', msb: 104, lsb: 0, pc: 32, icon: 'S805', type: 'Live!' },
  { id: 'pick-bass', name: 'Pick Bass', chineseName: '撥片清脆電貝斯', category: 'Bass', msb: 104, lsb: 1, pc: 34, icon: 'S805' },
  { id: 'fretless-bass', name: 'Fretless Bass', chineseName: '無琴格滑音貝斯', category: 'Bass', msb: 0, lsb: 112, pc: 35, icon: 'S805' },
  { id: 'slap-bass', name: 'Slap Bass', chineseName: '放克擊弦重音貝斯 (Slap)', category: 'Bass', msb: 104, lsb: 0, pc: 36, icon: 'S805' },
  { id: 'synth-bass', name: 'Synth Bass', chineseName: '合成器低音砲 (Synth Bass)', category: 'Bass', msb: 0, lsb: 112, pc: 38, icon: 'S805' },

  // --- 6. Saxophone (薩克斯風) ---
  { id: 'tenor-sax', name: 'Tenor Sax', chineseName: '次中音薩克斯風 (Tenor)', category: 'Saxophone', msb: 104, lsb: 0, pc: 66, icon: 'S806', type: 'S.Art!' },
  { id: 'alto-sax', name: 'Alto Sax', chineseName: '中音薩克斯風 (Alto)', category: 'Saxophone', msb: 104, lsb: 0, pc: 65, icon: 'S806', type: 'S.Art!' },
  { id: 'soprano-sax', name: 'Soprano Sax', chineseName: '高音薩克斯風 (Soprano)', category: 'Saxophone', msb: 104, lsb: 0, pc: 64, icon: 'S806', type: 'Sweet!' },
  { id: 'baritone-sax', name: 'Baritone Sax', chineseName: '上低音薩克斯風 (Baritone)', category: 'Saxophone', msb: 0, lsb: 112, pc: 67, icon: 'S806' },
  { id: 'sax-section', name: 'Sax Section', chineseName: '大樂隊薩克斯風重奏組', category: 'Saxophone', msb: 104, lsb: 1, pc: 66, icon: 'S806', type: 'Live!' },

  // --- 7. Brass (銅管) ---
  { id: 'pop-brass', name: 'Pop Brass', chineseName: '流行樂強勁銅管組', category: 'Brass', msb: 104, lsb: 0, pc: 61, icon: 'S808', type: 'S.Art!' },
  { id: 'big-band-brass', name: 'Big Band Brass', chineseName: '大爵士樂隊齊奏銅管', category: 'Brass', msb: 104, lsb: 1, pc: 61, icon: 'S808', type: 'Live!' },
  { id: 'trumpet', name: 'Trumpet', chineseName: '獨奏小號 (Trumpet)', category: 'Brass', msb: 104, lsb: 0, pc: 56, icon: 'S807', type: 'S.Art!' },
  { id: 'muted-trumpet', name: 'Muted Trumpet', chineseName: '弱音器爵士小號', category: 'Brass', msb: 104, lsb: 0, pc: 59, icon: 'S807', type: 'Sweet!' },
  { id: 'trombone', name: 'Trombone', chineseName: '長號 (Trombone)', category: 'Brass', msb: 104, lsb: 0, pc: 57, icon: 'S808', type: 'S.Art!' },
  { id: 'french-horn', name: 'French Horn', chineseName: '法國號 (French Horn)', category: 'Brass', msb: 0, lsb: 112, pc: 60, icon: 'S808' },
  { id: 'brass-section', name: 'Brass Section', chineseName: '標準管樂重奏群', category: 'Brass', msb: 0, lsb: 112, pc: 61, icon: 'S808' },

  // --- 8. Woodwind (木管/長笛) ---
  { id: 'sweet-flute', name: 'Sweet! Flute', chineseName: '甜美呼吸長笛 (Sweet! Flute)', category: 'Woodwind', msb: 104, lsb: 0, pc: 73, icon: 'S810', type: 'Sweet!' },
  { id: 'pan-flute', name: 'Pan Flute', chineseName: '空靈排簫 (Pan Flute)', category: 'Woodwind', msb: 0, lsb: 112, pc: 75, icon: 'S810' },
  { id: 'clarinet', name: 'Clarinet', chineseName: '單簧管 / 黑管', category: 'Woodwind', msb: 104, lsb: 0, pc: 71, icon: 'S810', type: 'Sweet!' },
  { id: 'oboe', name: 'Oboe', chineseName: '雙簧管 (Oboe)', category: 'Woodwind', msb: 104, lsb: 0, pc: 68, icon: 'S810', type: 'Sweet!' },
  { id: 'recorder', name: 'Recorder', chineseName: '直笛 / 木笛', category: 'Woodwind', msb: 0, lsb: 112, pc: 74, icon: 'S810' },

  // --- 9. Organ & Accordion (風琴與手風琴) ---
  { id: 'jazz-organ', name: 'Jazz Organ', chineseName: '爵士旋轉風琴 (Rotary)', category: 'Organ', msb: 104, lsb: 0, pc: 16, icon: 'S803', type: 'Live!' },
  { id: 'drawbar-organ', name: 'Drawbar Organ', chineseName: '經典拉桿風琴 (B3)', category: 'Organ', msb: 0, lsb: 112, pc: 16, icon: 'S803' },
  { id: 'rock-organ', name: 'Rock Organ', chineseName: '搖滾過載風琴', category: 'Organ', msb: 0, lsb: 112, pc: 18, icon: 'S803' },
  { id: 'church-organ', name: 'Church Organ', chineseName: '教堂雄偉管風琴', category: 'Organ', msb: 0, lsb: 112, pc: 19, icon: 'S803' },
  { id: 'accordion', name: 'Accordion', chineseName: '法式傳統手風琴', category: 'Accordion', msb: 0, lsb: 112, pc: 21, icon: 'S818', type: 'Sweet!' },
  { id: 'bandoneon', name: 'Bandoneon', chineseName: '探戈班多鈕手風琴', category: 'Accordion', msb: 0, lsb: 112, pc: 23, icon: 'S818' },
  { id: 'harmonica', name: 'Harmonica', chineseName: '民謠十孔口琴', category: 'Accordion', msb: 104, lsb: 0, pc: 22, icon: 'S818', type: 'Sweet!' },

  // --- 10. Synth & Pad (合成器與鋪底) ---
  { id: 'square-lead', name: 'Square Lead', chineseName: '經典方波主奏 (8-Bit/Retro)', category: 'Synth', msb: 0, lsb: 112, pc: 80, icon: 'S820' },
  { id: 'sawtooth-lead', name: 'Sawtooth Lead', chineseName: '鋸齒波衝鋒主奏 (EDM Lead)', category: 'Synth', msb: 0, lsb: 112, pc: 81, icon: 'S820' },
  { id: 'warm-pad', name: 'Warm Pad', chineseName: '溫暖類比鋪底 (Warm Pad)', category: 'Pad', msb: 104, lsb: 0, pc: 89, icon: 'S821', type: 'Live!' },
  { id: 'analog-pad', name: 'Analog Pad', chineseName: '復古類比大氣鋪底', category: 'Pad', msb: 0, lsb: 112, pc: 89, icon: 'S821' },
  { id: 'brightness-synth', name: 'Brightness Synth', chineseName: '晶亮璀璨合成琶音', category: 'Synth', msb: 0, lsb: 112, pc: 100, icon: 'S820' },

  // --- 11. Choir (人聲合唱) ---
  { id: 'air-choir', name: 'Air Choir', chineseName: '空靈空界天使合唱', category: 'Choir', msb: 104, lsb: 0, pc: 52, icon: 'S823', type: 'Live!' },
  { id: 'gospel-voices', name: 'Gospel Voices', chineseName: '福音靈魂和聲組', category: 'Choir', msb: 104, lsb: 1, pc: 52, icon: 'S823' },
  { id: 'standard-choir', name: 'Choir Aahs', chineseName: '標準美聲大合唱 (Aahs)', category: 'Choir', msb: 0, lsb: 112, pc: 52, icon: 'S823' },
  { id: 'voice-oohs', name: 'Voice Oohs', chineseName: '柔美抒情弱音和聲 (Oohs)', category: 'Choir', msb: 0, lsb: 112, pc: 53, icon: 'S823' },

  // --- 12. Drums & Percussion (鼓組與打擊樂) ---
  { id: 'real-drums', name: 'Real Drums', chineseName: '真實動態錄音室鼓組', category: 'Drums', msb: 127, lsb: 0, pc: 0, icon: 'S815', type: 'Live!' },
  { id: 'standard-kit', name: 'Standard Kit 1', chineseName: '標準原廠流行鼓組 1', category: 'Drums', msb: 127, lsb: 0, pc: 1, icon: 'S815' },
  { id: 'pop-drum-kit', name: 'Pop Drum Kit', chineseName: '現代流行電台打擊鼓組', category: 'Drums', msb: 127, lsb: 0, pc: 89, icon: 'S815' },
  { id: 'rock-drum-kit', name: 'Rock Kit', chineseName: '重磅搖滾硬核鼓組', category: 'Drums', msb: 127, lsb: 0, pc: 16, icon: 'S815' },
  { id: 'jazz-brush-kit', name: 'Jazz Brush Kit', chineseName: '爵士輕柔刷鈸鼓組 (Brush)', category: 'Drums', msb: 127, lsb: 0, pc: 40, icon: 'S815' },
  { id: 'dance-drum-kit', name: 'EDM Dance Kit', chineseName: '電子舞曲合成鼓組 (909/808)', category: 'Drums', msb: 127, lsb: 0, pc: 25, icon: 'S815' },
  { id: 'latin-perc-kit', name: 'Latin Percussion Kit', chineseName: '拉丁熱情打擊樂組 (Conga/Bongo)', category: 'Percussion', msb: 127, lsb: 0, pc: 56, icon: 'S830' },
  { id: 'steel-drums', name: 'Steel Drums', chineseName: '加勒比海鋼鼓 (Steel Drums)', category: 'Percussion', msb: 0, lsb: 112, pc: 114, icon: 'S830' },
  { id: 'timpani', name: 'Timpani', chineseName: '管弦樂定音鼓 (Timpani)', category: 'Percussion', msb: 0, lsb: 112, pc: 47, icon: 'S830' },
];

/**
 * 智慧音色搜尋引擎
 */
export function searchYamahaVoices(query: string = '', category: VoiceCategory | 'ALL' = 'ALL'): YamahaVoice[] {
  const q = query.trim().toLowerCase();

  return YAMAHA_SX920_VOICES.filter(voice => {
    // 1. 分類過濾
    if (category !== 'ALL' && voice.category !== category) {
      return false;
    }

    if (!q) return true;

    // 2. 關鍵字模糊比對 (名稱、中文名、分類、MSB-LSB-PC)
    const matchName = voice.name.toLowerCase().includes(q);
    const matchChinese = voice.chineseName.toLowerCase().includes(q);
    const matchCat = voice.category.toLowerCase().includes(q);
    const matchCode = `${voice.msb}-${voice.lsb}-${voice.pc}`.includes(q);
    const matchPc = `pc ${voice.pc}`.includes(q) || `pc:${voice.pc}`.includes(q) || voice.pc.toString() === q;
    const matchIcon = voice.icon.toLowerCase().includes(q);

    return matchName || matchChinese || matchCat || matchCode || matchPc || matchIcon;
  });
}

/**
 * 依據 MSB, LSB, PC 精確尋找或模糊配對最適原廠音色
 */
export function findYamahaVoice(msb: number, lsb: number, pc: number): YamahaVoice | undefined {
  // 1. 三聯號完全吻合 (MSB, LSB, PC 均符合)
  let found = YAMAHA_SX920_VOICES.find(v => v.msb === msb && v.lsb === lsb && v.pc === pc);
  if (found) return found;

  // 2. 次要吻合：若 MSB 相同且 PC 相同 (忽略小改版 LSB)
  found = YAMAHA_SX920_VOICES.find(v => v.msb === msb && v.pc === pc);
  if (found) return found;

  // 3. 通用備用：僅 PC 相同 (相容 GM/XG 標準樂器)
  found = YAMAHA_SX920_VOICES.find(v => v.pc === pc);
  return found;
}
