/**
 * Yamaha PSR-SX920 官方貝斯 (Bass) 原廠音色庫對照表
 * 嚴格對齊 PSR-SX920 原廠數據手冊 (Data List)
 * 提供 0-based 底層 MIDI PC 與 1-based 琴端螢幕顯示代碼，徹底解決音色偏差疑惑
 */

export interface YamahaBassPreset {
  id: string;
  name: string;
  panelPc: number; // 琴端面板與說明書顯示代碼 (1-based: 1 ~ 128)
  pc: number;      // 底層 MIDI Program Change (0-based: 0 ~ 127)
  msb: number;     // CC 0 Bank Select MSB
  lsb: number;     // CC 32 Bank Select LSB
  icon: string;
  category: 'Electric' | 'Acoustic' | 'Synth';
  description: string;
}

export const YAMAHA_SX920_BASS_VOICES: YamahaBassPreset[] = [
  {
    id: 'finger-bass',
    name: 'Finger Bass (手指電貝斯)',
    panelPc: 34,
    pc: 33,
    msb: 0,
    lsb: 112,
    icon: '🎸',
    category: 'Electric',
    description: 'SX920 最經典泛用的標準電貝斯，圓潤沉穩，流行/民謠首選。',
  },
  {
    id: 'pick-bass',
    name: 'Pick Bass (撥片電貝斯)',
    panelPc: 35,
    pc: 34,
    msb: 0,
    lsb: 112,
    icon: '🎸',
    category: 'Electric',
    description: '顆粒分明、攻擊感強烈的撥片貝斯，搖滾與輕快曲風推薦。',
  },
  {
    id: 'acoustic-bass',
    name: 'Acoustic Bass (原聲低音大提琴)',
    panelPc: 33,
    pc: 32,
    msb: 0,
    lsb: 112,
    icon: '🎻',
    category: 'Acoustic',
    description: '爵士樂與不插電木吉他民謠必備的溫暖厚重木質低音。',
  },
  {
    id: 'fretless-bass',
    name: 'Fretless Bass (無琴格貝斯)',
    panelPc: 36,
    pc: 35,
    msb: 0,
    lsb: 112,
    icon: '🎸',
    category: 'Electric',
    description: '富有滑音歌唱性與抒情氛圍的無琴格電貝斯，抒情慢歌極佳。',
  },
  {
    id: 'slap-bass',
    name: 'Slap Bass (擊弦貝斯)',
    panelPc: 37,
    pc: 36,
    msb: 0,
    lsb: 112,
    icon: '⚡',
    category: 'Electric',
    description: '金屬打弦音響清脆高亢，Funk / Disco 與動感跳躍曲風必備。',
  },
  {
    id: 'synth-bass',
    name: 'Synth Bass (類比合成貝斯)',
    panelPc: 39,
    pc: 38,
    msb: 0,
    lsb: 112,
    icon: '🎛️',
    category: 'Synth',
    description: '80年代復古舞曲與 EDM 低頻肥厚的合成重低音。',
  },
];
