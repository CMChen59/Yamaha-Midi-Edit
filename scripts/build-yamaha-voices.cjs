const fs = require('fs');
const path = require('path');

// 讀取既有 48 種手動精選音色作為基準覆蓋
const existingPath = path.join(__dirname, '../src/core/data/yamaha-voices.ts');
const existingCode = fs.readFileSync(existingPath, 'utf8');

// 提取既有 YAMAHA_SX920_VOICES
const matchArray = existingCode.match(/export const YAMAHA_SX920_VOICES: YamahaVoice\[\] = (\[[\s\S]*?\]);/);
let existingVoices = [];
if (matchArray) {
  try {
    // 簡單替換型別標記轉成 JSON 可解析形式
    const jsonStr = matchArray[1]
      .replace(/\/\/.*$/gm, '')
      .replace(/'/g, '"')
      .replace(/(\w+):/g, '"$1":')
      .replace(/,\s*([\]}])/g, '$1');
    existingVoices = JSON.parse(jsonStr);
  } catch (e) {
    console.warn('Failed to parse existing voices with JSON, fallback regex', e.message);
  }
}

// 建立已有音色的 Map
const existingMap = new Map();
for (const v of existingVoices) {
  existingMap.set(`${v.msb}-${v.lsb}-${v.pc}`, v);
}
console.log('Preserved curated voices count:', existingMap.size);

// 解析 temp_ins/PSR-SX920.ins
const insPath = path.join(__dirname, '../temp_ins/PSR-SX920.ins');
const insContent = fs.readFileSync(insPath, 'utf8');
const lines = insContent.split(/\r?\n/);

const patchLists = {};
let inDefinitions = false;
let currentSection = null;
const rawPatches = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line || line.startsWith(';')) continue;
  if (line === '.Instrument Definitions') {
    inDefinitions = true;
    continue;
  }
  if (!inDefinitions) {
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      patchLists[currentSection] = {};
    } else if (currentSection && line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const pc = parseInt(line.slice(0, eqIdx).trim(), 10);
      const val = line.slice(eqIdx + 1).trim();
      patchLists[currentSection][pc] = val;
    }
  } else {
    if (line.includes('=')) {
      const eqIdx = line.indexOf('=');
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      const mSingle = key.match(/^Patch\[(\d+)\]$/);
      if (mSingle) {
        const bank = parseInt(mSingle[1], 10);
        const secName = val;
        const msb = Math.floor(bank / 128);
        const lsb = bank % 128;
        if (patchLists[secName]) {
          for (const [pcStr, rawVal] of Object.entries(patchLists[secName])) {
            const pc = parseInt(pcStr, 10);
            rawPatches.push({ msb, lsb, pc, rawVal, secName });
          }
        }
      }
      const mDouble = key.match(/^(?:Patch|Key)\[(\d+),\s*(\d+)\]$/);
      if (mDouble) {
        const bank = parseInt(mDouble[1], 10);
        const pc = parseInt(mDouble[2], 10);
        const msb = Math.floor(bank / 128);
        const lsb = bank % 128;
        rawPatches.push({ msb, lsb, pc, rawVal: val, secName: key });
      }
    }
  }
}

// 去重 Map
const voiceMap = new Map();

// 樂器分類檢測器
function detectCategory(name, type, msb, lsb, pc) {
  const n = name.toLowerCase();
  if (msb === 127 || msb === 126 || n.includes('kit') || n.includes('drum') || type.includes('Drum')) {
    if (n.includes('latin') || n.includes('perc') || n.includes('conga') || n.includes('bongo') || n.includes('timpani') || n.includes('steel drum')) return 'Percussion';
    return 'Drums';
  }
  if (n.includes('vibraphone') || n.includes('marimba') || n.includes('xylophone') || n.includes('glockenspiel') || n.includes('celesta') || n.includes('tubular') || n.includes('music box') || n.includes('dulcimer') || n.includes('kalimba') || n.includes('timpani')) {
    return 'Percussion';
  }
  if (n.includes('piano') || n.includes('grand') || n.includes('harpsi') || n.includes('clav') || n.includes('honky')) {
    if (n.includes('ep') || n.includes('electric piano') || n.includes('dx') || n.includes('suitcase') || n.includes('stage ep') || n.includes('wurli') || n.includes('tine') || n.includes('clav')) return 'E.Piano';
    return 'Piano';
  }
  if (n.includes('organ') || type.includes('OrganFlutes') || n.includes('drawbar') || n.includes('rotary') || n.includes('bars')) {
    return 'Organ';
  }
  if (n.includes('accord') || n.includes('harmonica') || n.includes('bandoneon') || n.includes('musette') || n.includes('melodica')) {
    return 'Accordion';
  }
  if (n.includes('guitar') || n.includes('gtr') || n.includes('nylon') || n.includes('steel') || n.includes('clean') || n.includes('overdrive') || n.includes('distort') || n.includes('flamenco') || n.includes('12 string') || n.includes('mandolin') || n.includes('ukulele') || n.includes('banjo') || n.includes('sitar') || n.includes('saz')) {
    return 'Guitar';
  }
  if (n.includes('bass')) {
    return 'Bass';
  }
  if (n.includes('string') || n.includes('violin') || n.includes('viola') || n.includes('cello') || n.includes('contrabass') || n.includes('pizz') || n.includes('spicc') || n.includes('harp') || n.includes('orchestra') || n.includes('ensemble') || n.includes('seattle')) {
    return 'Strings';
  }
  if (n.includes('sax') || n.includes('alto') || n.includes('tenor') || n.includes('baritone') || n.includes('soprano')) {
    return 'Saxophone';
  }
  if (n.includes('brass') || n.includes('trumpet') || n.includes('trombone') || n.includes('horn') || n.includes('cornet') || n.includes('tuba') || n.includes('flug') || n.includes('fanfare')) {
    return 'Brass';
  }
  if (n.includes('flute') || n.includes('clarinet') || n.includes('oboe') || n.includes('bassoon') || n.includes('pipe') || n.includes('whistle') || n.includes('recorder') || n.includes('piccolo') || n.includes('woodwind')) {
    return 'Woodwind';
  }
  if (n.includes('choir') || n.includes('vox') || n.includes('voice') || n.includes('vocal') || n.includes('aah') || n.includes('ooh') || n.includes('gospel') || n.includes('scat')) {
    return 'Choir';
  }
  if (n.includes('pad') || n.includes('warm') || n.includes('sweep') || n.includes('atmosphere') || n.includes('space') || n.includes('heaven') || n.includes('ambient')) {
    return 'Pad';
  }
  if (msb === 0 && lsb === 0) {
    return 'Legacy';
  }
  return 'Synth';
}

// 樂器分類圖標代碼
function getIconForCategory(cat) {
  switch (cat) {
    case 'Piano': return 'S801';
    case 'E.Piano': return 'S802';
    case 'Organ': return 'S803';
    case 'Guitar': return 'S804';
    case 'Bass': return 'S805';
    case 'Saxophone': return 'S806';
    case 'Brass': return 'S808';
    case 'Strings': return 'S809';
    case 'Woodwind': return 'S810';
    case 'Drums': return 'S815';
    case 'Accordion': return 'S818';
    case 'Synth': return 'S820';
    case 'Pad': return 'S821';
    case 'Choir': return 'S823';
    case 'Percussion': return 'S830';
    case 'Legacy': return 'S801';
    default: return 'S820';
  }
}

// 中文名稱翻譯映射
const termDict = {
  'grand': '三角鋼琴', 'piano': '鋼琴', 'upright': '直立鋼琴', 'honkytonk': '酒館復古鋼琴',
  'harpsichord': '大鍵琴', 'clavi': '放克鍵盤', 'celesta': '鋼片琴', 'glockenspiel': '鐵琴',
  'musicbox': '音樂盒', 'vibraphone': '顫音琴', 'marimba': '木琴', 'xylophone': '木琴',
  'tubularbells': '管鐘', 'dulcimer': '洋琴', 'organ': '風琴', 'accordion': '手風琴',
  'harmonica': '口琴', 'bandoneon': '班多鈕手風琴', 'guitar': '吉他', 'gtr': '吉他',
  'nylon': '古典尼龍弦', 'steel': '民謠鋼弦', 'clean': '清音', 'overdrive': '過載破音',
  'distortion': '失真破音', 'flamenco': '佛朗明哥', 'bass': '貝斯', 'finger': '指彈',
  'pick': '撥片', 'fretless': '無琴格', 'slap': '放克擊弦 (Slap)', 'synth': '合成器',
  'strings': '弦樂', 'violin': '小提琴', 'viola': '中提琴', 'cello': '大提琴',
  'contrabass': '低音大提琴', 'pizzicato': '撥弦', 'spiccato': '跳弓斷奏', 'tremolo': '震弓',
  'harp': '豎琴', 'orchestra': '管弦樂', 'ensemble': '合奏群', 'trumpet': '小號',
  'trombone': '長號', 'tuba': '低音號', 'horn': '法國號', 'cornet': '短號',
  'brass': '銅管', 'saxophone': '薩克斯風', 'sax': '薩克斯風', 'soprano': '高音',
  'alto': '中音', 'tenor': '次中音', 'baritone': '上低音', 'flute': '長笛',
  'panflute': '排簫', 'recorder': '木笛', 'oboe': '雙簧管', 'clarinet': '單簧管',
  'bassoon': '低音管', 'choir': '合唱團', 'vocal': '人聲', 'voices': '人聲',
  'lead': '主奏', 'pad': '鋪底', 'warm': '溫暖', 'bright': '明亮', 'dark': '暗色',
  'analog': '類比', 'digital': '數位', 'vintage': '復古', 'modern': '現代',
  'standard': '標準', 'rock': '搖滾', 'pop': '流行', 'jazz': '爵士',
  'latin': '拉丁', 'blues': '藍調', 'funk': '放克', 'dance': '舞曲',
  'house': '浩室', 'electro': '電音', 'hiphop': '嘻哈', 'edm': 'EDM舞曲',
  'brush': '刷鈸', 'kit': '套組', 'drums': '鼓組', 'percussion': '打擊樂',
  'timpani': '定音鼓', 'steeldrum': '加勒比鋼鼓', 'seattle': '西雅圖交響',
  'cocktail': '雞尾酒爵士', 'concert': '音樂會旗艦', 'suitcase': '經典手提箱',
  'stage': '舞臺演出', 'rotary': '旋轉喇叭', 'drawbar': '拉桿風琴'
};

function generateChineseName(name, type, cat) {
  let title = name;
  // 將駝峰命名分詞
  const spaced = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  const matchedTerms = [];
  for (const [en, zh] of Object.entries(termDict)) {
    if (spaced.includes(en)) {
      matchedTerms.push(zh);
    }
  }

  let zhBase = matchedTerms.slice(0, 2).join(' ');
  if (!zhBase) {
    zhBase = `${cat} 樂器音色`;
  }

  if (type === 'MegaVoice') return `${zhBase} (MegaVoice 伴奏吉他/貝斯)`;
  if (type === 'S.Art!') return `${zhBase} (S.Art! 超音色)`;
  if (type === 'Live!') return `${zhBase} (Live! 立體聲動態取樣)`;
  if (type === 'Sweet!') return `${zhBase} (Sweet! 甜美原聲獨奏)`;
  if (type === 'Cool!') return `${zhBase} (Cool! 經典電聲效果)`;
  if (type === 'OrganFlutes') return `${zhBase} (Organ Flutes 拉桿手彈)`;
  if (type === 'Drums') return `${zhBase} (原廠鼓組打擊)`;
  return `${zhBase}`;
}

// 整合既有音色優先放入
for (const [key, v] of existingMap.entries()) {
  voiceMap.set(key, {
    ...v,
    suitability: v.type === 'MegaVoice' || v.type === 'Live!' || v.type === 'Sweet!' || v.type === 'Cool!' || v.category === 'Drums'
      ? 'recommended'
      : (v.type === 'OrganFlutes' ? 'warning' : 'standard'),
    suitabilityReason: v.type === 'MegaVoice'
      ? '⭐ Yamaha 伴奏/Multi Pad 專用極品（具備琴格噪聲、切分與滑音技巧）'
      : (v.type === 'OrganFlutes' ? '⚠️ 避坑警示：琴端僅支援右手現場拉桿演奏，Multi Pad 不支援' : '')
  });
}

// 整合 ins 中的所有音色
for (const p of rawPatches) {
  const key = `${p.msb}-${p.lsb}-${p.pc}`;
  if (voiceMap.has(key)) {
    continue; // 保留手動精選中文名與標記
  }

  const parts = p.rawVal.split('-');
  let type = 'Standard';
  let name = p.rawVal;

  if (parts.length >= 3) {
    const rawType = parts[1];
    name = parts.slice(2).join('-');
    if (rawType.includes('MegaVoice')) type = 'MegaVoice';
    else if (rawType.includes('S.Art')) type = 'S.Art!';
    else if (rawType.includes('Live!')) type = 'Live!';
    else if (rawType.includes('Sweet!')) type = 'Sweet!';
    else if (rawType.includes('Cool!')) type = 'Cool!';
    else if (rawType.includes('OrganFlutes')) type = 'OrganFlutes';
    else if (rawType.includes('Drum')) type = 'Drums';
    else if (rawType.includes('SFX')) type = 'Drums';
    else type = 'Standard';
  } else if (parts.length === 2) {
    name = parts[1];
    if (p.secName && (p.secName.includes('GM/XG') || p.secName.includes('GM2'))) {
      type = 'Legacy';
    }
  }

  // 名稱清理
  name = name.trim();
  const cat = detectCategory(name, type, p.msb, p.lsb, p.pc);
  const icon = getIconForCategory(cat);
  const chineseName = generateChineseName(name, type, cat);

  let suitability = 'standard';
  let suitabilityReason = '';
  if (type === 'MegaVoice') {
    suitability = 'recommended';
    suitabilityReason = '⭐ Yamaha 伴奏/Multi Pad 專用極品（具備琴格噪聲、切分與滑音演奏技巧）';
  } else if (type === 'Live!' || type === 'Sweet!' || type === 'Cool!' || cat === 'Drums') {
    suitability = 'recommended';
    suitabilityReason = '⭐ 原廠優質取樣/電聲，表現力極佳';
  } else if (type === 'OrganFlutes') {
    suitability = 'warning';
    suitabilityReason = '⚠️ 避坑警示：琴端僅支援右手現場拉桿演奏，Multi Pad/伴奏不支援此音色';
  } else if (type === 'S.Art!') {
    suitabilityReason = 'ℹ️ 技巧限制：Multi Pad 播放無法觸發琴鍵 legato 技巧，以基本採樣發聲';
  }

  const id = `voice-${p.msb}-${p.lsb}-${p.pc}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  voiceMap.set(key, {
    id,
    name,
    chineseName,
    category: cat,
    msb: p.msb,
    lsb: p.lsb,
    pc: p.pc,
    icon,
    type,
    suitability,
    suitabilityReason
  });
}

const allVoices = Array.from(voiceMap.values());
console.log('Total consolidated Yamaha voices:', allVoices.length);

// 寫入 JSON 資料檔
const outPath = path.join(__dirname, '../src/core/data/yamaha-sx920-datalist.json');
fs.writeFileSync(outPath, JSON.stringify(allVoices, null, 2), 'utf8');
console.log('Successfully generated:', outPath);
