import { YamahaParser } from '../core/parser/yamaha-parser';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { audioEngine, ticksToSeconds } from '../core/audio/audio-engine';
import type { NoteEvent, PlaybackState } from '../core/audio/audio-engine';
import type { YamahaFileParsed, YamahaSection, MidiTrack } from '../core/models/types';
import {
  findYamahaVoice,
  searchYamahaVoices,
  VOICE_CATEGORIES,
  YamahaVoice,
  VoiceCategory,
} from '../core/data/yamaha-voices';

console.log('[Yamaha App] 系統腳本已載入');

let currentParsed: YamahaFileParsed | null = null;
let currentFileName: string = '';
let isModified: boolean = false;

// DOM 元素引用
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input') as HTMLInputElement | null;
const btnSelectFile = document.getElementById('btn-select-file');
const viewerContainer = document.getElementById('viewer-container');
const btnLoadSampleSty = document.getElementById('btn-load-sample-sty');
const btnLoadSamplePad = document.getElementById('btn-load-sample-pad');
const btnExport = document.getElementById('btn-export');

// 基本資訊卡片元素
const elFilename = document.getElementById('meta-filename');
const elFormat = document.getElementById('meta-format');
const elBpm = document.getElementById('meta-bpm');
const elTimesig = document.getElementById('meta-timesig');
const elCasm = document.getElementById('meta-casm');

// 清單容器
const sectionsList = document.getElementById('sections-list');
const sectionCount = document.getElementById('section-count');
const partsTbody = document.getElementById('parts-tbody');
const partsCount = document.getElementById('parts-count');

function showStatus(msg: string, isError: boolean = false) {
  console.log(`[Status] ${msg}`);
  const statusEl = document.getElementById('status-message');
  if (statusEl) {
    statusEl.innerHTML = msg;
    statusEl.style.display = 'block';
    statusEl.style.backgroundColor = isError ? '#ef4444' : '#3b82f6';
  }
}

function markModified(msg?: string) {
  isModified = true;
  const statusEl = document.getElementById('status-message');
  if (statusEl) {
    statusEl.innerHTML = `<span style="font-weight: bold;">● 檔案已修改 (未儲存)</span> ${msg ? `— <small>${msg}</small>` : ''}`;
    statusEl.style.display = 'block';
    statusEl.style.backgroundColor = '#d97706'; // 琥珀警示色
  }
  if (btnExport) {
    btnExport.textContent = '匯出修改後的檔案';
  }
}

export interface InstrumentPreset {
  id: string;
  label: string;
  icon: string;
  msb: number;
  lsb: number;
  pc: number;
}

export const PRESET_INSTRUMENTS: InstrumentPreset[] = [
  { id: 'piano', label: '🎹 鋼琴 (Concert Grand)', icon: 'S801', msb: 0, lsb: 112, pc: 0 },
  { id: 'epiano', label: '🎹 電鋼琴 (DX E.Piano)', icon: 'S802', msb: 0, lsb: 112, pc: 4 },
  { id: 'strings', label: '🎻 弦樂 (Live! Strings)', icon: 'S805', msb: 8, lsb: 33, pc: 49 },
  { id: 'kino_strings', label: '🎻 電影弦樂 (Kino Strings)', icon: 'S805', msb: 8, lsb: 35, pc: 49 },
  { id: 'pizzicato', label: '🎻 撥弦 (Pizzicato)', icon: 'S806', msb: 0, lsb: 113, pc: 75 },
  { id: 'steel_guitar', label: '🎸 鋼弦吉他 (Steel Guitar)', icon: 'S809', msb: 0, lsb: 112, pc: 25 },
  { id: 'nylon_guitar', label: '🎸 尼龍吉他 (Nylon Guitar)', icon: 'S809', msb: 0, lsb: 112, pc: 24 },
  { id: 'clean_guitar', label: '🎸 電吉他 (Clean Guitar)', icon: 'S810', msb: 0, lsb: 112, pc: 27 },
  { id: 'bass', label: '🎸 指彈貝斯 (Finger Bass)', icon: 'S811', msb: 0, lsb: 112, pc: 33 },
  { id: 'synth_bass', label: '🎛️ 合成貝斯 (Synth Bass)', icon: 'S812', msb: 0, lsb: 112, pc: 38 },
  { id: 'wind_sax', label: '🎷 薩克斯風 (Breathy Sax)', icon: 'S825', msb: 0, lsb: 112, pc: 66 },
  { id: 'flute', label: '🪈 長笛 (Sweet! Flute)', icon: 'S827', msb: 0, lsb: 112, pc: 73 },
  { id: 'brass', label: '🎺 銅管組 (Brass Section)', icon: 'S826', msb: 0, lsb: 112, pc: 61 },
  { id: 'accordion', label: '🪗 手風琴 (Accordion)', icon: 'S818', msb: 0, lsb: 112, pc: 21 },
  { id: 'choir', label: '👼 人聲合唱 (Choir)', icon: 'S823', msb: 0, lsb: 112, pc: 52 },
  { id: 'synth_lead', label: '🎛️ 合成主奏 (Square Lead)', icon: 'S820', msb: 0, lsb: 112, pc: 80 },
  { id: 'synth_pad', label: '🌌 溫暖鋪底 (Warm Pad)', icon: 'S821', msb: 0, lsb: 112, pc: 89 },
  { id: 'drums', label: '🥁 標準鼓組 (Standard Kit)', icon: 'S815', msb: 127, lsb: 0, pc: 0 },
  { id: 'perc_fx', label: '🔔 打擊音效 (Perc / FX)', icon: 'S830', msb: 0, lsb: 112, pc: 115 },
];

let currentActivePadNum: number = 1;

function updatePartsTableRowName(padNum: number, name: string) {
  const el = document.querySelector(`.part-name-text-${padNum}`);
  if (el) el.textContent = `Pad ${padNum} (${name})`;
}

function updatePartsTableRowVoice(padNum: number, msb: number, lsb: number, pc: number) {
  const msbInput = document.querySelector(`.bank-msb-${padNum}`) as HTMLInputElement | null;
  const lsbInput = document.querySelector(`.bank-lsb-${padNum}`) as HTMLInputElement | null;
  const pcInput = document.querySelector(`.pc-${padNum}`) as HTMLInputElement | null;
  if (msbInput) msbInput.value = `${msb}`;
  if (lsbInput) lsbInput.value = `${lsb}`;
  if (pcInput) pcInput.value = `${pc}`;
}

function updatePadCardInstrumentSelect(padNum: number, msb: number, lsb: number, pc: number) {
  const select = document.querySelector(`.pad-card-${padNum} .inst-select`) as HTMLSelectElement | null;
  if (!select) return;

  const yVoice = findYamahaVoice(msb, lsb, pc);
  const matched = PRESET_INSTRUMENTS.find(i => i.pc === pc && (msb === 0 || i.msb === msb))
    || PRESET_INSTRUMENTS.find(i => i.pc === pc);

  if (matched) {
    select.value = matched.id;
  } else {
    let customOpt = select.querySelector('option[value="custom"]') as HTMLOptionElement | null;
    if (!customOpt) {
      customOpt = document.createElement('option');
      customOpt.value = 'custom';
      select.appendChild(customOpt);
    }
    if (yVoice) {
      customOpt.textContent = `🎹 ${yVoice.name} (${yVoice.chineseName})`;
    } else {
      customOpt.textContent = `⚙️ 自訂音色 (PC ${pc}, Bank ${msb}-${lsb})`;
    }
    select.value = 'custom';
  }
}

// ========================================================
// Yamaha PSR-SX920 原廠音色搜尋與替換面板控制 (Voice Modal)
// ========================================================
let targetModalPadNum: number = 1;
let currentModalCategory: VoiceCategory | 'ALL' = 'ALL';
let currentModalSearchQuery: string = '';

function initVoiceSearchModal() {
  const modal = document.getElementById('voice-search-modal');
  const btnClose = document.getElementById('btn-close-voice-modal');
  const btnCloseFooter = document.getElementById('btn-close-modal-footer');
  const searchInput = document.getElementById('voice-search-input') as HTMLInputElement | null;
  const btnClearSearch = document.getElementById('btn-clear-voice-search');
  const pillsContainer = document.getElementById('voice-category-pills');

  if (!modal) return;

  const handleClose = () => closeVoiceModal();
  if (btnClose) btnClose.addEventListener('click', handleClose);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', handleClose);

  // 點選遮罩背景關閉
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeVoiceModal();
  });

  // 按下 ESC 鍵關閉
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      closeVoiceModal();
    }
  });

  // 即時搜尋輸入監聽
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentModalSearchQuery = searchInput.value.trim();
      if (btnClearSearch) {
        btnClearSearch.style.display = searchInput.value ? 'block' : 'none';
      }
      renderVoiceModalList();
    });
  }

  // 清除搜尋框內容
  if (btnClearSearch && searchInput) {
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      currentModalSearchQuery = '';
      btnClearSearch.style.display = 'none';
      searchInput.focus();
      renderVoiceModalList();
    });
  }

  // 動態渲染各分類標籤
  if (pillsContainer) {
    pillsContainer.innerHTML = '';
    VOICE_CATEGORIES.forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `cat-pill ${cat.key === currentModalCategory ? 'active' : ''}`;
      btn.innerHTML = `${cat.icon} ${cat.label}`;
      btn.addEventListener('click', () => {
        currentModalCategory = cat.key;
        pillsContainer.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        renderVoiceModalList();
      });
      pillsContainer.appendChild(btn);
    });
  }
}

function openVoiceModal(padNum: number) {
  const modal = document.getElementById('voice-search-modal');
  const badge = document.getElementById('modal-target-pad-badge');
  const searchInput = document.getElementById('voice-search-input') as HTMLInputElement | null;
  if (!modal) return;

  targetModalPadNum = padNum;
  if (badge) {
    badge.textContent = `Pad ${padNum}`;
  }

  modal.style.display = 'flex';
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 60);
  }
  renderVoiceModalList();
}

function closeVoiceModal() {
  const modal = document.getElementById('voice-search-modal');
  if (modal) modal.style.display = 'none';
}

function auditionSingleVoice(voice: YamahaVoice) {
  let pitch = 60; // C4
  let isDrum = false;

  if (voice.category === 'Bass') pitch = 48; // C3
  else if (voice.category === 'Woodwind') pitch = 72; // C5
  else if (voice.category === 'Drums' || voice.category === 'Percussion') {
    isDrum = true;
    pitch = 38; // Snare
  }

  let instrumentId = 'grand-piano';
  if (voice.category === 'Piano' || voice.category === 'E.Piano') {
    instrumentId = 'grand-piano';
  } else if (voice.category === 'Strings') {
    instrumentId = voice.id.includes('pizz') ? 'pizzicato' : 'strings';
  } else if (voice.category === 'Guitar') {
    instrumentId = 'guitar';
  } else if (voice.category === 'Bass') {
    instrumentId = 'bass';
  } else if (voice.category === 'Saxophone' || voice.category === 'Brass') {
    instrumentId = 'brass';
  } else if (voice.category === 'Woodwind') {
    instrumentId = 'flute';
  }

  audioEngine.playAuditionNote(pitch, 0.7, {
    instrumentId,
    pc: voice.pc,
    isDrum,
  });
}

function applyVoiceToPad(padNum: number, voice: YamahaVoice) {
  if (!currentParsed) return;

  // 1. 更新 Track 0 的 Yamaha 圖示代碼 (I1~I4)
  YamahaPadModifier.setPadIcon(currentParsed, padNum, voice.icon);

  // 2. 更新 Track 混音 Bank MSB, Bank LSB, Program Change
  YamahaPadModifier.setPadMixing(currentParsed, padNum, {
    bankMsb: voice.msb,
    bankLsb: voice.lsb,
    programChange: voice.pc,
  });

  // 3. 同步下方表格與卡片輸入框
  updatePartsTableRowVoice(padNum, voice.msb, voice.lsb, voice.pc);
  updatePadCardInstrumentSelect(padNum, voice.msb, voice.lsb, voice.pc);

  // 4. 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
  if (currentActivePadNum === padNum) {
    const sec = currentParsed.sections[padNum - 1];
    const nameInput = document.querySelector(`.pad-card-${padNum} .pad-name-input`) as HTMLInputElement | null;
    const currentName = nameInput ? nameInput.value : `Pad ${padNum}`;
    if (sec) showPadNotesDetail(currentParsed, sec, currentName, padNum);
  }

  // 5. 觸發試聽音
  auditionSingleVoice(voice);

  // 6. 標記變更
  markModified(`Pad ${padNum} 音色已更換為: ${voice.name} (${voice.chineseName}) [Bank ${voice.msb}-${voice.lsb}, PC ${voice.pc}]`);

  // 7. 關閉視窗
  closeVoiceModal();
}

function renderVoiceModalList() {
  const tbody = document.getElementById('voice-list-tbody');
  const countLabel = document.getElementById('voice-count-label');
  if (!tbody) return;

  const voices = searchYamahaVoices(currentModalSearchQuery, currentModalCategory);

  if (countLabel) {
    countLabel.textContent = `共 ${voices.length} 種音色符合`;
  }

  if (voices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 12px; color: #94a3b8;">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">🔍</div>
          <div>找不到符合條件的 Yamaha 原廠音色</div>
          <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">請嘗試更換關鍵字、樂器類別或清除搜尋篩選</div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = '';
  for (const voice of voices) {
    const tr = document.createElement('tr');
    tr.className = 'voice-row';

    const catMeta = VOICE_CATEGORIES.find(c => c.key === voice.category);
    const catIcon = catMeta ? catMeta.icon : '🎵';

    let typeClass = 'standard';
    if (voice.type === 'S.Art!') typeClass = 'sart';
    else if (voice.type === 'Live!') typeClass = 'live';
    else if (voice.type === 'Sweet!') typeClass = 'sweet';
    else if (voice.type === 'Cool!') typeClass = 'cool';
    else if (voice.type === 'MegaVoice') typeClass = 'megavoice';

    tr.innerHTML = `
      <td style="text-align: center; font-size: 1.2rem;">${catIcon}</td>
      <td>
        <div style="font-weight: 600; color: #fff;">${voice.name}</div>
        <div style="font-size: 0.74rem; color: #94a3b8;">${voice.chineseName}</div>
      </td>
      <td><span style="font-size: 0.78rem; color: #cbd5e1;">${voice.category}</span></td>
      <td style="text-align: center;">
        <span class="voice-type-badge voice-type-${typeClass}">${voice.type || 'Standard'}</span>
      </td>
      <td><code style="font-family: monospace; color: #38bdf8; font-size: 0.8rem;">${voice.msb} - ${voice.lsb}</code></td>
      <td><code style="font-family: monospace; color: #f59e0b; font-size: 0.8rem;">${voice.pc}</code></td>
      <td style="text-align: center; white-space: nowrap;">
        <button type="button" class="btn-preview-voice" title="試聽此音色發聲">▶ 試聽</button>
        <button type="button" class="btn-apply-voice" title="套用至 Pad ${targetModalPadNum}">套用</button>
      </td>
    `;

    const btnPreview = tr.querySelector('.btn-preview-voice') as HTMLButtonElement;
    btnPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      auditionSingleVoice(voice);
    });

    const btnApply = tr.querySelector('.btn-apply-voice') as HTMLButtonElement;
    btnApply.addEventListener('click', (e) => {
      e.stopPropagation();
      applyVoiceToPad(targetModalPadNum, voice);
    });

    tbody.appendChild(tr);
  }
}

function formatPan(pan: number): string {
  if (pan === 64) return 'C';
  if (pan < 64) return `L${64 - pan}`;
  return `R${pan - 64}`;
}

// 初始化事件監聽
function initEvents() {
  if (btnSelectFile && fileInput) {
    btnSelectFile.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  // 拖曳事件
  if (dropZone) {
    dropZone.addEventListener('click', () => {
      if (fileInput) fileInput.click();
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });
  }

  // 選擇檔案事件
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFile(fileInput.files[0]);
      }
    });
  }

  // 範例載入按鈕
  if (btnLoadSampleSty) {
    btnLoadSampleSty.addEventListener('click', () => {
      loadSampleFile('/samples/4006_SX900.T547.sty', '4006_SX900.T547.sty', 'STY');
    });
  }

  if (btnLoadSamplePad) {
    btnLoadSamplePad.addEventListener('click', () => {
      loadSampleFile('/samples/4006-1_PAD.PAD', '4006-1_PAD.PAD', 'PAD');
    });
  }

  // 導出檔案按鈕
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (!currentParsed) return;
      try {
        const bytes = YamahaWriter.write(currentParsed);
        const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const prefix = isModified ? 'edited_' : 'reconstructed_';
        a.download = `${prefix}${currentFileName}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        isModified = false;
        btnExport.textContent = '無損重新導出';
        showStatus(`✓ 已成功導出最新檔案: ${prefix}${currentFileName}`);
      } catch (err: any) {
        alert(`導出失敗: ${err.message}`);
      }
    });
  }

  // 試聽走帶控制器按鈕 (Audition Transport)
  const btnTransportPlay = document.getElementById('btn-transport-play');
  if (btnTransportPlay) {
    btnTransportPlay.addEventListener('click', () => {
      if (currentActivePadNum !== null) {
        togglePadAudition(currentActivePadNum);
      }
    });
  }

  const btnTransportStop = document.getElementById('btn-transport-stop');
  if (btnTransportStop) {
    btnTransportStop.addEventListener('click', () => {
      audioEngine.stop();
      updateAuditionUIState(null);
    });
  }

  // 初始化 Yamaha PSR-SX920 原廠音色庫搜尋彈窗
  initVoiceSearchModal();
}

// 處理本機檔案
async function handleFile(file: File) {
  showStatus(`正在解析: ${file.name}...`);
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const ext = file.name.split('.').pop()?.toUpperCase();
    const format: 'STY' | 'PAD' = ext === 'PAD' ? 'PAD' : 'STY';
    renderParsed(bytes, file.name, format);
  } catch (err: any) {
    showStatus(`讀取檔案錯誤: ${err.message}`, true);
    alert(`讀取檔案錯誤: ${err.message}`);
  }
}

// 載入伺服器端範例檔案
async function loadSampleFile(url: string, filename: string, format: 'STY' | 'PAD') {
  showStatus(`正在載入伺服器範例: ${filename}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const buffer = await res.arrayBuffer();
    renderParsed(new Uint8Array(buffer), filename, format);
  } catch (err: any) {
    showStatus(`無法載入範例檔案: ${err.message}`, true);
    alert(`無法載入範例檔案 (${url}): ${err.message}`);
  }
}

// 解析並渲染介面
function renderParsed(bytes: Uint8Array, filename: string, format: 'STY' | 'PAD') {
  try {
    currentFileName = filename;
    currentParsed = YamahaParser.parse(bytes, format);

    if (elFilename) elFilename.textContent = filename;
    if (elFormat) {
      const isSff2 = currentParsed.sections.some(s => s.name === 'SFF2');
      elFormat.textContent = `${currentParsed.format} (${isSff2 ? 'SFF2' : 'SFF1'})`;
    }
    if (elBpm) elBpm.textContent = `${currentParsed.bpm} BPM`;
    if (elTimesig) elTimesig.textContent = `${currentParsed.timeSignature.numerator}/${currentParsed.timeSignature.denominator}`;
    if (elCasm) {
      const casmChunk = currentParsed.customChunks.find(c => c.id === 'CASM');
      elCasm.innerHTML = currentParsed.hasCasm
        ? `<span style="color: #10b981;">✓ 正常 (${casmChunk?.data.length} Bytes)</span>`
        : `<span style="color: #8e96a4;">無 CASM 區塊</span>`;
    }

    // 停止任何正在播放的試聽
    audioEngine.stop();
    updateAuditionUIState(null);
    const bpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
    if (bpmInput && currentParsed.bpm) {
      bpmInput.value = `${currentParsed.bpm}`;
    }

    renderSections(currentParsed);
    renderParts(currentParsed);

    if (viewerContainer) {
      viewerContainer.style.display = 'block';
    }
    showStatus(`成功載入並解析: ${filename}`);
  } catch (err: any) {
    showStatus(`解析檔案失敗: ${err.message}`, true);
    alert(`解析檔案失敗: ${err.message}`);
    console.error(err);
  }
}

/**
 * 從指定 MidiTrack 提取所有 Note 事件 (轉化為 NoteEvent 結構)
 */
function extractTrackNotes(track: MidiTrack | undefined): NoteEvent[] {
  const notes: NoteEvent[] = [];
  if (!track) return notes;
  let curTick = 0;
  const activeNotes = new Map<number, { tick: number; velocity: number }>();

  for (const ev of track.events) {
    curTick += ev.delta;

    if (ev.type === 'noteOn' && ev.noteNumber !== undefined && ev.velocity && ev.velocity > 0) {
      activeNotes.set(ev.noteNumber, { tick: curTick, velocity: ev.velocity });
    } else if ((ev.type === 'noteOff' || (ev.type === 'noteOn' && ev.velocity === 0)) && ev.noteNumber !== undefined) {
      const start = activeNotes.get(ev.noteNumber);
      if (start) {
        notes.push({
          note: ev.noteNumber,
          velocity: start.velocity,
          startTick: start.tick,
          durationTick: Math.max(curTick - start.tick, 1),
        });
        activeNotes.delete(ev.noteNumber);
      }
    }
  }
  return notes;
}

/**
 * 更新所有 Pad 卡片與 Transport 播放按鈕的視覺播放中/停止狀態
 */
function updateAuditionUIState(playingPadNum: number | null) {
  for (let p = 1; p <= 4; p++) {
    const btn = document.querySelector(`.btn-audition-${p}`) as HTMLButtonElement | null;
    const card = document.querySelector(`.pad-card-${p}`) as HTMLElement | null;
    if (btn) {
      if (playingPadNum === p) {
        btn.textContent = '⏹ 停止';
        btn.classList.add('playing');
      } else {
        btn.textContent = '▶ 試聽';
        btn.classList.remove('playing');
      }
    }
    if (card) {
      if (playingPadNum === p) card.classList.add('pad-playing');
      else card.classList.remove('pad-playing');
    }
  }

  const transportPlayBtn = document.getElementById('btn-transport-play') as HTMLButtonElement | null;
  if (transportPlayBtn) {
    if (playingPadNum !== null && playingPadNum === currentActivePadNum) {
      transportPlayBtn.textContent = '⏹ 停止播放';
      transportPlayBtn.classList.add('playing');
    } else {
      transportPlayBtn.textContent = '▶ 播放此 Pad';
      transportPlayBtn.classList.remove('playing');
    }
  }
}

/**
 * 切換單一 Pad 的即時試聽發聲
 */
function togglePadAudition(padNum: number) {
  if (!currentParsed) return;

  if (audioEngine.isPlaying() && audioEngine.getPlayingPadNum() === padNum) {
    audioEngine.stop();
    updateAuditionUIState(null);
    return;
  }

  const track = currentParsed.tracks[padNum];
  if (!track) return;

  const notes = extractTrackNotes(track);
  if (notes.length === 0) {
    showStatus(`Pad ${padNum} 沒有可播放的音符事件`, false);
    return;
  }

  let currentPc = 0;
  let currentMsb = 0;
  let currentLsb = 0;
  let volume = 100;
  let pan = 64;
  let reverb = 40;

  for (const ev of track.events) {
    if (ev.type === 'programChange' && ev.program !== undefined) currentPc = ev.program;
    if (ev.type === 'controlChange') {
      if (ev.controller === 0 && ev.value !== undefined) currentMsb = ev.value;
      if (ev.controller === 32 && ev.value !== undefined) currentLsb = ev.value;
      if (ev.controller === 7 && ev.value !== undefined) volume = ev.value;
      if (ev.controller === 10 && ev.value !== undefined) pan = ev.value;
      if (ev.controller === 91 && ev.value !== undefined) reverb = ev.value;
    }
  }

  const padIdx = padNum - 1;
  const isRepeat = currentParsed.padConfig?.repeatFlags[padIdx] ?? false;
  const matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb) && (currentLsb === 0 || i.lsb === currentLsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc);
  const instrumentId = matchedInst ? matchedInst.id : 'grand-piano';

  const division = currentParsed.division || 96;
  const beatsPerBar = currentParsed.timeSignature?.numerator || 4;
  const ticksPerBar = division * beatsPerBar;
  const firstNoteTick = Math.min(...notes.map(n => n.startTick));
  const lastNoteTick = Math.max(...notes.map(n => n.startTick + n.durationTick));
  const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
  const totalBars = Math.max(1, Math.ceil((lastNoteTick - gridStartTick) / ticksPerBar));
  const totalTicks = totalBars * ticksPerBar;

  const bpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
  const bpm = bpmInput ? parseInt(bpmInput.value, 10) || currentParsed.bpm || 120 : currentParsed.bpm || 120;

  // 自動選取該 Pad 展開下方卷軸
  if (currentActivePadNum !== padNum) {
    const card = document.querySelector(`.pad-card-${padNum}`) as HTMLElement | null;
    if (card) card.click();
  }

  updateAuditionUIState(padNum);

  audioEngine.playSequence(padNum, notes, {
    bpm,
    division,
    beatsPerBar,
    loop: isRepeat,
    gridStartTick,
    totalTicks,
    channelParams: {
      volume,
      pan,
      reverb,
      instrumentId,
      pc: currentPc,
    },
    onProgress: (state: PlaybackState) => {
      const statusBadge = document.getElementById('transport-status-badge');
      if (statusBadge) {
        statusBadge.style.display = 'inline-block';
        statusBadge.textContent = `▶ 第 ${state.currentBar} 小節 第 ${state.currentBeat} 拍 (${state.activeNoteNumbers.length} 音符)`;
      }

      if (currentActivePadNum === padNum && currentCanvasRedrawWithPlayhead) {
        currentCanvasRedrawWithPlayhead(state.relTick, state.activeNoteNumbers);
      }
    },
    onEnded: () => {
      updateAuditionUIState(null);
      const statusBadge = document.getElementById('transport-status-badge');
      if (statusBadge) statusBadge.style.display = 'none';
      if (currentCanvasRedrawWithPlayhead) {
        currentCanvasRedrawWithPlayhead(null, []);
      }
    }
  });
}

function renderSections(parsed: YamahaFileParsed) {
  if (!sectionsList || !sectionCount) return;
  sectionsList.innerHTML = '';

  const isPad = parsed.format === 'PAD';
  const panelTitle = document.getElementById('panel-sections-title');
  if (panelTitle) {
    panelTitle.textContent = isPad ? '🥁 Multi Pad 打擊墊 (Pad 1 ~ 4)' : '🎼 伴奏段落結構 (Sections)';
  }

  sectionCount.textContent = isPad ? '4 組打擊墊設定' : `${parsed.sections.length} 個標記段落`;

  if (isPad) {
    sectionsList.className = 'section-grid pad-grid';
    // PAD 模式：固定渲染 4 顆打擊墊卡片 (Pad 1 ~ Pad 4)
    for (let padNum = 1; padNum <= 4; padNum++) {
      const padIdx = padNum - 1;
      const sec = parsed.sections[padIdx]; // 對應的 Section (若有)
      const track = parsed.tracks[padNum]; // 對應的 Track 1~4
      const customName = parsed.padConfig?.names[padIdx] || `Pad ${padNum}`;
      const isRepeat = parsed.padConfig?.repeatFlags[padIdx] ?? false;
      const isChordMatch = parsed.padConfig?.chordMatchFlags[padIdx] ?? false;

      // 計算該 Track 的真實音符數與小節數
      let padNoteCount = 0;
      let minT = Infinity;
      let maxT = 0;
      if (track) {
        let curT = 0;
        for (const e of track.events) {
          curT += e.delta;
          if (e.type === 'noteOn' && (e.velocity ?? 0) > 0) {
            padNoteCount++;
            if (curT < minT) minT = curT;
            if (curT > maxT) maxT = curT;
          }
        }
      }

      let barsText = '無音符';
      if (padNoteCount > 0) {
        const ticksPerBar = parsed.division * 4;
        const gridStart = Math.floor(minT / ticksPerBar) * ticksPerBar;
        const bars = Math.max(1, Math.ceil((maxT - gridStart) / ticksPerBar));
        barsText = `${padNoteCount} 顆音符 (${bars} 小節)`;
      } else if (sec) {
        barsText = sec.measureCount ? `${sec.measureCount} 小節` : '連續片段';
      }

      const item = document.createElement('div');
      item.className = `section-item pad-button-card pad-theme-${padNum} pad-card-${padNum}`;

      // 從該 Pad 的 Track 提取目前實際使用的 Bank MSB, Bank LSB, Program Change
      let currentPc = 0;
      let currentMsb = 0;
      let currentLsb = 0;
      if (track) {
        for (const ev of track.events) {
          if (ev.type === 'programChange' && ev.program !== undefined) currentPc = ev.program;
          if (ev.type === 'controlChange') {
            if (ev.controller === 0 && ev.value !== undefined) currentMsb = ev.value;
            if (ev.controller === 32 && ev.value !== undefined) currentLsb = ev.value;
          }
        }
      }

      // 檢查 Track 0 原始檔案所帶的 Yamaha Icon 代碼 (如 'S809')
      const currentIcon = parsed.padConfig?.icons[padIdx];

      // 智慧比對目前最符合的預設樂器或 Yamaha 原廠音色
      const yVoice = findYamahaVoice(currentMsb, currentLsb, currentPc);
      let matchedInst = PRESET_INSTRUMENTS.find(inst => inst.pc === currentPc && (currentMsb === 0 || inst.msb === currentMsb));
      if (!matchedInst) {
        matchedInst = PRESET_INSTRUMENTS.find(inst => inst.pc === currentPc);
      }
      if (!matchedInst && currentIcon) {
        matchedInst = PRESET_INSTRUMENTS.find(inst => inst.icon === currentIcon);
      }

      const isCustomVoice = !matchedInst;
      const selectedId = matchedInst ? matchedInst.id : 'custom';

      let iconOptionsHtml = PRESET_INSTRUMENTS
        .map(inst => `<option value="${inst.id}" ${inst.id === selectedId ? 'selected' : ''}>${inst.label}</option>`)
        .join('');
      if (isCustomVoice) {
        if (yVoice) {
          iconOptionsHtml += `<option value="custom" selected>🎹 ${yVoice.name} (${yVoice.chineseName})</option>`;
        } else {
          iconOptionsHtml += `<option value="custom" selected>⚙️ 自訂音色 (PC ${currentPc}, Bank ${currentMsb}-${currentLsb})</option>`;
        }
      }

      item.innerHTML = `
        <div class="pad-header">
          <input type="text" class="pad-name-input" value="${customName}" title="點擊修改名稱" />
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" class="btn-audition btn-audition-${padNum}" data-pad="${padNum}" title="點擊試聽此打擊墊旋律">▶ 試聽</button>
            <span class="pad-raw-tag" title="Yamaha 底層段落標記: ${sec ? sec.name : 'Track ' + padNum}">${sec ? sec.name : 'Track ' + padNum}</span>
          </div>
        </div>
        <div class="pad-body">
          <div class="pad-bars-text">${barsText}</div>
          <div class="section-details" style="display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; align-items: center;">
            <button type="button" class="toggle-btn btn-cm ${isChordMatch ? 'active-cm' : 'inactive'}" title="點擊切換和弦跟隨">
              ${isChordMatch ? '🎼 和弦跟隨: 開' : '🔒 固定音高: 關'}
            </button>
            <button type="button" class="toggle-btn btn-rp ${isRepeat ? 'active-rp' : 'inactive'}" title="點擊切換循環播放">
              ${isRepeat ? '🔁 循環: 開' : '▶️ 單次: 關'}
            </button>
            <select class="icon-select inst-select" title="更換演奏樂器與音色 (更換後下表與音軌將同步連動)">
              ${iconOptionsHtml}
            </select>
            <button type="button" class="btn-open-voice-modal" data-pad="${padNum}" title="開啟 Yamaha PSR-SX920 原廠音色庫搜尋視窗">🔍 音色庫</button>
          </div>
        </div>
      `;

      // 0. 試聽播放按鈕事件
      const btnAudition = item.querySelector(`.btn-audition-${padNum}`) as HTMLButtonElement | null;
      if (btnAudition) {
        btnAudition.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePadAudition(padNum);
        });
      }

      // 0.5 原廠音色庫搜尋按鈕事件
      const btnOpenVoice = item.querySelector(`.btn-open-voice-modal[data-pad="${padNum}"]`) as HTMLButtonElement | null;
      if (btnOpenVoice) {
        btnOpenVoice.addEventListener('click', (e) => {
          e.stopPropagation();
          openVoiceModal(padNum);
        });
      }

      // 1. 名稱編輯事件
      const nameInput = item.querySelector('.pad-name-input') as HTMLInputElement;
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      nameInput.addEventListener('change', () => {
        YamahaPadModifier.setPadName(parsed, padNum, nameInput.value);
        markModified(`已更新 Pad ${padNum} 名稱為: ${nameInput.value}`);
        updatePartsTableRowName(padNum, nameInput.value);
      });

      // 2. 和弦跟隨 (CM) 切換事件
      const btnCm = item.querySelector('.btn-cm') as HTMLButtonElement;
      btnCm.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentVal = parsed.padConfig?.chordMatchFlags[padIdx] ?? false;
        const newVal = !currentVal;
        YamahaPadModifier.setPadChordMatch(parsed, padNum, newVal);
        btnCm.className = `toggle-btn btn-cm ${newVal ? 'active-cm' : 'inactive'}`;
        btnCm.innerHTML = newVal ? '🎼 和弦跟隨: 開' : '🔒 固定音高: 關';
        markModified(`Pad ${padNum} 和弦跟隨已${newVal ? '開啟 (隨和弦轉調)' : '關閉 (固定音高)'}`);
      });

      // 3. 循環播放 (RP) 切換事件
      const btnRp = item.querySelector('.btn-rp') as HTMLButtonElement;
      btnRp.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentVal = parsed.padConfig?.repeatFlags[padIdx] ?? false;
        const newVal = !currentVal;
        YamahaPadModifier.setPadRepeat(parsed, padNum, newVal);
        btnRp.className = `toggle-btn btn-rp ${newVal ? 'active-rp' : 'inactive'}`;
        btnRp.innerHTML = newVal ? '🔁 循環: 開' : '▶️ 單次: 關';
        markModified(`Pad ${padNum} 循環播放已${newVal ? '開啟' : '關閉'}`);
      });

      // 4. 演奏樂器與音色選擇事件 (完整連動 Yamaha Icon 與 Track 混音 Bank/PC)
      const instSelect = item.querySelector('.inst-select') as HTMLSelectElement;
      instSelect.addEventListener('click', (e) => e.stopPropagation());
      instSelect.addEventListener('change', () => {
        const val = instSelect.value;
        const selected = PRESET_INSTRUMENTS.find(i => i.id === val);
        if (!selected) return;

        // A. 更新 Track 0 的 Yamaha 螢幕圖示代碼 (I1~I4)
        YamahaPadModifier.setPadIcon(parsed, padNum, selected.icon);

        // B. 更新該 Pad Track 內部的 Bank MSB, Bank LSB, Program Change
        YamahaPadModifier.setPadMixing(parsed, padNum, {
          bankMsb: selected.msb,
          bankLsb: selected.lsb,
          programChange: selected.pc,
        });

        // C. 連動更新下方「聲部混音與音色配置」表格中的對應欄位
        updatePartsTableRowVoice(padNum, selected.msb, selected.lsb, selected.pc);

        markModified(`Pad ${padNum} 演奏樂器已更換為: ${selected.label} (Bank ${selected.msb}-${selected.lsb}, PC ${selected.pc})`);

        // D. 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
        if (currentActivePadNum === padNum) {
          if (sec) showPadNotesDetail(parsed, sec, nameInput.value, padNum);
        }
      });

      // 5. 卡片點擊選取事件 (展開詳細音符卷軸)
      item.addEventListener('click', () => {
        currentActivePadNum = padNum;
        document.querySelectorAll('.pad-button-card').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.pad-table-row').forEach(el => el.classList.remove('active-row'));
        const matchingRow = document.querySelector(`.pad-table-row-${padNum}`);
        if (matchingRow) matchingRow.classList.add('active-row');
        if (sec) {
          showPadNotesDetail(parsed, sec, nameInput.value, padNum);
        } else {
          showEmptyPadDetail(nameInput.value, padNum);
        }
      });

      // 預設選取 Pad 1
      if (padNum === 1) {
        currentActivePadNum = 1;
        setTimeout(() => {
          item.classList.add('active');
          const matchingRow = document.querySelector('.pad-table-row-1');
          if (matchingRow) matchingRow.classList.add('active-row');
          if (sec) showPadNotesDetail(parsed, sec, customName, 1);
          else showEmptyPadDetail(customName, 1);
        }, 50);
      }

      sectionsList.appendChild(item);
    }
  } else {
    sectionsList.className = 'section-grid';
    // STY 模式：傳統伴奏積木
    for (const sec of parsed.sections) {
      const item = document.createElement('div');
      const lower = sec.name.toLowerCase();

      let typeClass = 'main';
      if (lower.includes('intro')) typeClass = 'intro';
      else if (lower.includes('fill')) typeClass = 'fill';
      else if (lower.includes('ending')) typeClass = 'ending';

      item.className = `section-item ${typeClass}`;
      item.innerHTML = `
        <div>
          <div class="section-name">${sec.name}</div>
          <div class="section-details">起點 Tick: ${sec.startTick}</div>
        </div>
        <div class="section-details" style="font-weight: 600; color: #a5b4fc;">
          ${sec.measureCount ? `${sec.measureCount} 小節` : ''}
        </div>
      `;
      sectionsList.appendChild(item);
    }
  }

  // 若為 STY 格式則隱藏 Pad 專屬面板
  const padDetailContainer = document.getElementById('pad-detail-container');
  if (padDetailContainer && !isPad) {
    padDetailContainer.style.display = 'none';
  }
}

function showEmptyPadDetail(customName: string, padNum: number) {
  const container = document.getElementById('pad-detail-container');
  const titleEl = document.getElementById('pad-detail-title');
  const summaryEl = document.getElementById('pad-detail-summary');
  const badgeEl = document.getElementById('pad-detail-badge');
  const canvas = document.getElementById('pad-note-canvas') as HTMLCanvasElement | null;

  if (!container || !titleEl || !summaryEl || !badgeEl || !canvas) return;
  container.style.display = 'block';

  titleEl.textContent = `${customName} (Pad ${padNum}) - 空白打擊墊`;
  badgeEl.textContent = '未分配音樂區段';
  summaryEl.textContent = '此打擊墊在當前檔案中未包含任何音樂音符或觸發標記';
  drawEmptyCanvas(canvas);
}

// 音符名稱輔助轉換 (MIDI Note Number ➔ 音名，如 60 ➔ C3)
function midiNoteToName(note: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return `${noteNames[note % 12]}${octave}`;
}

// 展開並繪製指定 Pad 的詳細音符
function showPadNotesDetail(parsed: YamahaFileParsed, sec: YamahaSection, padLabel: string, padNum: number) {
  const container = document.getElementById('pad-detail-container');
  const titleEl = document.getElementById('pad-detail-title');
  const summaryEl = document.getElementById('pad-detail-summary');
  const badgeEl = document.getElementById('pad-detail-badge');
  const canvas = document.getElementById('pad-note-canvas') as HTMLCanvasElement | null;

  if (!container || !titleEl || !summaryEl || !badgeEl || !canvas) return;
  container.style.display = 'block';

  // 重設小節捲動起點與懸停狀態
  rollStartBar = 1;
  resetHoverInfo();

  // 搜尋對應 Track 提取音符 (在 Yamaha PAD 中，Track 1~4 分別代表 Pad 1~4 的專屬音軌)
  const trackIdx = padNum; // Track 1~4
  const targetTrack = parsed.tracks[trackIdx];
  const notes = extractTrackNotes(targetTrack);

  // 同步試聽走帶控制器狀態
  updateAuditionUIState(audioEngine.isPlaying() ? audioEngine.getPlayingPadNum() : null);

  const secName = sec ? ` (底層標記: ${sec.name})` : '';
  titleEl.textContent = `${padLabel}${secName} 詳細內容`;

  if (notes.length === 0) {
    summaryEl.textContent = '此 Pad 無音符事件或使用特殊控制通道';
    badgeEl.textContent = '無音符';
    drawEmptyCanvas(canvas);
    return;
  }

  const minNote = Math.min(...notes.map(n => n.note));
  const maxNote = Math.max(...notes.map(n => n.note));
  const avgVel = Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length);

  const firstNoteTick = Math.min(...notes.map(n => n.startTick));
  const lastNoteTick = Math.max(...notes.map(n => n.startTick + n.durationTick));
  const ticksPerBar = (parsed.division || 96) * 4;
  const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
  const actualBars = Math.max(1, Math.ceil((lastNoteTick - gridStartTick) / ticksPerBar));

  // 提取目前 Track 的 Bank MSB, Bank LSB, PC 與預設樂器名稱
  let currentPc = 0;
  let currentMsb = 0;
  let currentLsb = 0;
  if (targetTrack) {
    for (const ev of targetTrack.events) {
      if (ev.type === 'programChange' && ev.program !== undefined) currentPc = ev.program;
      if (ev.type === 'controlChange') {
        if (ev.controller === 0 && ev.value !== undefined) currentMsb = ev.value;
        if (ev.controller === 32 && ev.value !== undefined) currentLsb = ev.value;
      }
    }
  }

  const yVoice = findYamahaVoice(currentMsb, currentLsb, currentPc);
  const matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc);
  const voiceName = yVoice
    ? `${yVoice.name} (${yVoice.chineseName})`
    : (matchedInst ? matchedInst.label : `自訂音色 (PC ${currentPc}, Bank ${currentMsb}-${currentLsb})`);

  let instId = 'grand-piano';
  if (yVoice) {
    if (yVoice.category === 'Strings') instId = yVoice.id.includes('pizz') ? 'pizzicato' : 'strings';
    else if (yVoice.category === 'Guitar') instId = 'guitar';
    else if (yVoice.category === 'Bass') instId = 'bass';
    else if (yVoice.category === 'Saxophone' || yVoice.category === 'Brass') instId = 'brass';
    else if (yVoice.category === 'Woodwind') instId = 'flute';
    else if (yVoice.category === 'Drums' || yVoice.category === 'Percussion') instId = 'drums';
  } else if (matchedInst) {
    instId = matchedInst.id;
  }
  currentCanvasPadInstrument = {
    instrumentId: instId,
    pc: currentPc,
    isDrum: (currentPc >= 120 || (yVoice && (yVoice.category === 'Drums' || yVoice.category === 'Percussion'))),
  };

  badgeEl.textContent = `音符範圍 Tick: ${firstNoteTick} ~ ${lastNoteTick} (共 ${actualBars} 小節)`;
  summaryEl.innerHTML = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; margin-right: 8px;">演奏音色: ${voiceName}</span> <span>共 ${notes.length} 顆音符</span> | <span>音域: ${midiNoteToName(minNote)} (${minNote}) ~ ${midiNoteToName(maxNote)} (${maxNote})</span> | <span>平均力度: ${avgVel}</span>`;

  drawNoteRoll(canvas, notes, padNum, parsed.division || 96, parsed.timeSignature?.numerator || 4);

  // 若當前有已選取的音符，重新在最新渲染方塊中比對並維持選取態
  if (selectedNoteBox) {
    const reFound = lastRenderedNoteBoxes.find(b => b.startTick === selectedNoteBox!.startTick && b.note === selectedNoteBox!.note);
    if (reFound) {
      selectedNoteBox = reFound;
      updateInspectorFields(reFound);
      if (currentCanvasRedraw) currentCanvasRedraw();
    } else {
      deselectNote();
    }
  }
}

function drawEmptyCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#64748b';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('無音符資料', canvas.width / 2, canvas.height / 2);
}

function formatNoteDuration(ticks: number, ticksPerBeat: number, beatsPerBar: number = 4): string {
  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const bars = ticks / ticksPerBar;
  const beats = ticks / ticksPerBeat;

  if (Math.abs(bars - 1) < 0.08) return '1 小節 (全音符 𝅝)';
  if (Math.abs(bars - 2) < 0.1) return '2 小節 (雙全音符)';
  if (Math.abs(beats - 2) < 0.08) return '半小節 / 2 拍 (二分音符 𝅗𝅥)';
  if (Math.abs(beats - 1) < 0.08) return '1/4 小節 / 1 拍 (四分音符 ♩)';
  if (Math.abs(beats - 0.5) < 0.05) return '1/8 小節 / 半拍 (八分音符 ♪)';
  if (Math.abs(beats - 0.25) < 0.03) return '1/16 小節 / 1/4 拍 (十六分音符 𝅘𝅥𝅯)';
  if (Math.abs(beats - 1.5) < 0.08) return '1.5 拍 (附點四分 ♩.)';
  if (Math.abs(beats - 0.75) < 0.05) return '0.75 拍 (附點八分 ♪.)';

  if (bars >= 1) {
    return `${bars.toFixed(1)} 小節 (${ticks} Ticks)`;
  }
  return `${beats.toFixed(1)} 拍 (${ticks} Ticks)`;
}

function formatShortDuration(ticks: number, ticksPerBeat: number, beatsPerBar: number = 4): string {
  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const bars = ticks / ticksPerBar;
  const beats = ticks / ticksPerBeat;

  if (Math.abs(bars - 1) < 0.08) return '1小節(全音符)';
  if (Math.abs(beats - 2) < 0.08) return '半小節(2拍)';
  if (Math.abs(beats - 1) < 0.08) return '1拍(四分)';
  if (Math.abs(beats - 0.5) < 0.05) return '半拍(八分)';
  if (bars >= 1) return `${bars.toFixed(1)}小節`;
  return `${beats.toFixed(1)}拍`;
}

function formatNotePosition(relTick: number, ticksPerBeat: number, beatsPerBar: number = 4): {
  chinese: string;
  standard: string;
  displayFull: string;
} {
  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const bar = Math.floor(relTick / ticksPerBar) + 1;
  const tickInBar = relTick % ticksPerBar;
  const beat = Math.floor(tickInBar / ticksPerBeat) + 1;
  const tickInBeat = tickInBar % ticksPerBeat;
  const fractionOfBeat = tickInBeat / ticksPerBeat;

  // 16分音符細分 (1 ~ 4) 與剩餘 Tick 數
  const ticksPer16th = ticksPerBeat / 4;
  const sub16th = Math.floor(tickInBeat / ticksPer16th) + 1;
  const tickRemainder = Math.round(tickInBeat % ticksPer16th);

  // 業界 DAW 標準標記 (Bar.Beat.16th.Ticks，例如 2.3.3.00)
  const standard = `${bar}.${beat}.${sub16th}.${tickRemainder.toString().padStart(2, '0')}`;

  // 直觀音樂中文與口語描述
  let beatDesc = '';
  if (tickInBeat === 0 || fractionOfBeat < 0.04) {
    beatDesc = `第 ${beat} 拍 (正拍)`;
  } else if (Math.abs(fractionOfBeat - 0.5) < 0.06) {
    beatDesc = `第 ${beat} 拍後半 (反拍 / 第 ${beat}.5 拍)`;
  } else if (Math.abs(fractionOfBeat - 0.25) < 0.05) {
    beatDesc = `第 ${beat} 拍第 2 個十六分音符 (1/4 拍處)`;
  } else if (Math.abs(fractionOfBeat - 0.75) < 0.05) {
    beatDesc = `第 ${beat} 拍第 4 個十六分音符 (3/4 拍處)`;
  } else {
    beatDesc = `第 ${beat} 拍 + ${tickInBeat} Ticks (約 ${(beat + fractionOfBeat).toFixed(2)} 拍)`;
  }

  const chinese = `第 ${bar} 小節 ${beatDesc}`;
  const displayFull = `<strong>${chinese}</strong> <small style="color: #94a3b8; font-weight: normal; margin-left: 4px;">[DAW標記: ${standard}]</small>`;

  return { chinese, standard, displayFull };
}

interface RenderedNoteBox {
  x: number;
  y: number;
  w: number;
  h: number;
  note: number;
  velocity: number;
  startTick: number;
  durationTick: number;
  posChinese: string;
  posStandard: string;
  posDisplayFull: string;
}

let lastRenderedNoteBoxes: RenderedNoteBox[] = [];
let hoveredNoteBox: RenderedNoteBox | null = null;
let selectedNoteBox: RenderedNoteBox | null = null;
let currentCanvasPadInstrument: { instrumentId?: string; pc?: number; isDrum?: boolean } = {};
let isInspectorEventsBound = false;
let currentCanvasRedraw: (() => void) | null = null;
let currentCanvasRedrawWithPlayhead: ((relTick: number | null, activeNotes?: number[]) => void) | null = null;
let currentPlayheadRelTick: number | null = null;
let currentActiveNoteNumbers: number[] = [];
let isCanvasHoverBound = false;
let isScrollEventsBound = false;
let currentTicksPerBeat = 96;
let currentBeatsPerBar = 4;
let currentCanvasPadNum = 1;
let currentTotalBars = 4;

// 視野模式: '4bars' (固定 4 小節標準視野，可滑動) 或 'all' (全景自適應)
let rollViewMode: '4bars' | 'all' = '4bars';
let rollStartBar: number = 1;

// 音符長度拖曳調整狀態 (Note Resize Dragging State)
let isResizingNote = false;
let resizingTargetNote: RenderedNoteBox | null = null;
let resizingStartMouseX = 0;
let resizingStartDuration = 0;
let currentResizingDuration = 0;
let isDragThresholdMet = false;
let hasJustDragged = false;
let resizingPreviewDuration: { startTick: number; note: number; durationTick: number } | null = null;
let currentPlotW = 1000;
let currentWindowTotalTicks = 384;

function isMouseNearRightEdge(b: RenderedNoteBox, mouseX: number, mouseY: number): boolean {
  if (mouseY < b.y - 2 || mouseY > b.y + b.h + 2) return false;
  const rightEdge = b.x + b.w;
  const edgeWidth = Math.min(12, Math.max(6, b.w * 0.4));
  return mouseX >= rightEdge - edgeWidth && mouseX <= rightEdge + 4;
}

function resetHoverInfo() {
  hoveredNoteBox = null;
  const hoverInfoEl = document.getElementById('canvas-hover-info');
  if (hoverInfoEl) {
    hoverInfoEl.textContent = '💡 點選任意音符可開啟屬性檢查器，移至音符右邊緣 ↔ 可拖曳縮放音長';
    hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
  }
}

function drawNoteRoll(
  canvas: HTMLCanvasElement,
  notes: Array<{ note: number; velocity: number; startTick: number; durationTick: number }>,
  padNum: number,
  ticksPerBeat: number = 96,
  beatsPerBar: number = 4
) {
  // 垂直音高基準 (保留適度邊距)
  const minNote = Math.min(...notes.map(n => n.note));
  const maxNote = Math.max(...notes.map(n => n.note));
  const displayMinNote = Math.max(0, minNote - 1);
  const displayMaxNote = Math.min(127, maxNote + 1);
  const noteRange = Math.max(displayMaxNote - displayMinNote + 1, 8);

  // 依音域跨度動態自適應畫布高度，保證每個半音至少有約 12.5px 舒適垂直空間，讓所有黑白鍵音名 100% 完整排下
  const rulerH = 26;
  const targetCanvasHeight = Math.max(220, Math.min(460, Math.round(noteRange * 12.5 + rulerH)));
  if (canvas.height !== targetCanvasHeight) {
    canvas.height = targetCanvasHeight;
    canvas.style.height = `${targetCanvasHeight}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  currentTicksPerBeat = ticksPerBeat;
  currentBeatsPerBar = beatsPerBar;

  if (currentCanvasPadNum !== padNum) {
    rollStartBar = 1;
    currentCanvasPadNum = padNum;
    currentPlayheadRelTick = null;
    currentActiveNoteNumbers = [];
  }

  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const firstNoteTick = Math.min(...notes.map(n => n.startTick));
  const lastNoteTick = Math.max(...notes.map(n => n.startTick + n.durationTick));

  // 時間基準：向左對齊至整數小節起點
  const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
  const totalDurationTicks = Math.max(lastNoteTick - gridStartTick, ticksPerBar);
  const totalBars = Math.max(1, Math.ceil(totalDurationTicks / ticksPerBar));
  currentTotalBars = totalBars;

  // 畫面區域配置 (Layout Margins)
  const scaleW = 54;   // 左側音名與琴鍵欄寬度 (擴展為 54px 提供鋼琴鍵與升降號完整空間)
  const plotW = w - scaleW;
  const plotH = h - rulerH;

  const redraw = (
    highlightedBox?: RenderedNoteBox | null,
    playheadRelTick?: number | null,
    activeNoteNumbers: number[] = []
  ) => {
    currentPlayheadRelTick = playheadRelTick ?? null;
    currentActiveNoteNumbers = activeNoteNumbers;

    // 播放中自動追隨走帶指針 (在 4bars 模式下翻頁)
    if (playheadRelTick !== null && playheadRelTick !== undefined && rollViewMode === '4bars' && totalBars > 4) {
      const curBar = Math.floor(playheadRelTick / ticksPerBar) + 1;
      const expectedStart = Math.floor((curBar - 1) / 4) * 4 + 1;
      if (curBar < rollStartBar || curBar > rollStartBar + 3) {
        rollStartBar = Math.max(1, Math.min(expectedStart, totalBars - 3));
        updateTimelineNavigationUI(totalBars);
      }
    }

    // 每次繪製時依據當前 rollViewMode 與 rollStartBar 動態計算可見小節範圍 (View Window)
    let viewStartBar = 1;
    let viewBars = totalBars;

    if (rollViewMode === '4bars' && totalBars > 4) {
      const visibleBars = 4;
      const maxStartBar = Math.max(1, totalBars - visibleBars + 1);
      rollStartBar = Math.max(1, Math.min(rollStartBar, maxStartBar));
      viewStartBar = rollStartBar;
      viewBars = visibleBars;
    } else {
      viewStartBar = 1;
      viewBars = totalBars;
    }

    const windowStartTick = gridStartTick + (viewStartBar - 1) * ticksPerBar;
    const windowTotalTicks = viewBars * ticksPerBar;
    const windowEndTick = windowStartTick + windowTotalTicks;

    currentPlotW = plotW;
    currentWindowTotalTicks = windowTotalTicks;

    ctx.clearRect(0, 0, w, h);

    // 1. Piano Roll 主體背景
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(scaleW, rulerH, plotW, plotH);

    // 2. 水平音高線 (黑白琴鍵交替底色)
    const semitoneH = plotH / noteRange;
    for (let n = displayMinNote; n <= displayMaxNote; n++) {
      const rowY = rulerH + (displayMaxNote - n) * semitoneH;
      const isBlackKey = [1, 3, 6, 8, 10].includes(n % 12);
      ctx.fillStyle = isBlackKey ? '#13151d' : '#181b24';
      ctx.fillRect(scaleW, rowY, plotW, semitoneH);

      ctx.strokeStyle = '#222633';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(scaleW, rowY + semitoneH);
      ctx.lineTo(w, rowY + semitoneH);
      ctx.stroke();
    }

    // 3. 垂直拍子線與反拍細線 (Beat & Offbeat Grid Lines)
    const totalBeats = viewBars * beatsPerBar;
    for (let b = 0; b <= totalBeats; b++) {
      const beatX = scaleW + (b / totalBeats) * plotW;
      const isBarLine = b % beatsPerBar === 0;

      if (!isBarLine) {
        // 拍子主線 (Beat Line)
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(beatX, rulerH);
        ctx.lineTo(beatX, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 拍內半拍反拍輔助線 (8分音符反拍線)
      if (b < totalBeats) {
        const halfBeatX = beatX + (0.5 / totalBeats) * plotW;
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.16)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([1, 3]);
        ctx.beginPath();
        ctx.moveTo(halfBeatX, rulerH);
        ctx.lineTo(halfBeatX, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 4. 垂直小節線 (Bar Lines) - 明確貫穿實線
    for (let bar = 0; bar <= viewBars; bar++) {
      const barX = scaleW + (bar / viewBars) * plotW;
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(barX, rulerH);
      ctx.lineTo(barX, h);
      ctx.stroke();
    }

    // 5. 頂部小節時間軸尺規 (Timeline Measure Ruler)
    ctx.fillStyle = '#1c1f2a';
    ctx.fillRect(0, 0, w, rulerH);
    ctx.strokeStyle = '#333846';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rulerH);
    ctx.lineTo(w, rulerH);
    ctx.stroke();

    for (let bar = 0; bar < viewBars; bar++) {
      const barX = scaleW + (bar / viewBars) * plotW;
      const nextBarX = scaleW + ((bar + 1) / viewBars) * plotW;
      const currentBarNum = viewStartBar + bar;

      // 小節標籤 (第 X 小節)
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`第 ${currentBarNum} 小節`, barX + 8, rulerH - 8);

      // 小節內的拍數刻度 (.2, .3, .4) 與半拍次刻度 (+)
      for (let beat = 0; beat < beatsPerBar; beat++) {
        const beatStartX = barX + (beat / beatsPerBar) * (nextBarX - barX);
        const beatMidX = barX + ((beat + 0.5) / beatsPerBar) * (nextBarX - barX);

        if (beat > 0) {
          ctx.fillStyle = '#94a3b8';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`.${beat + 1}`, beatStartX, rulerH - 8);
        }

        // 半拍反拍刻度 (+)
        ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+', beatMidX, rulerH - 8);
      }
    }

    // 6. 左側音名刻度欄與鋼琴鍵 (Pitch Ruler & Mini Piano Scale)
    ctx.fillStyle = '#161821';
    ctx.fillRect(0, 0, scaleW, h);
    ctx.strokeStyle = '#333846';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(scaleW, 0);
    ctx.lineTo(scaleW, h);
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('琴鍵/音名', scaleW / 2, rulerH - 8);

    const activePitches = new Set(notes.map(n => n.note));

    for (let n = displayMinNote; n <= displayMaxNote; n++) {
      const rowY = rulerH + (displayMaxNote - n) * semitoneH;
      const noteName = midiNoteToName(n);
      const isBlack = [1, 3, 6, 8, 10].includes(n % 12);
      const isC = n % 12 === 0;
      const hasNotesOnPitch = activePitches.has(n);

      // A. 繪製精緻鋼琴琴鍵紋理 (Mini Piano Keys)
      const keyW = scaleW - 6;
      if (isBlack) {
        // 黑鍵短塊 (Raised Black Key)
        ctx.fillStyle = '#1a1c24';
        ctx.fillRect(2, rowY + 1, keyW * 0.62, Math.max(semitoneH - 1, 2));
        ctx.strokeStyle = '#2d3345';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(2, rowY + 1, keyW * 0.62, Math.max(semitoneH - 1, 2));
      } else {
        // 白鍵底色 (White Key)
        ctx.fillStyle = isC ? '#232938' : '#1c202a';
        ctx.fillRect(2, rowY + 1, keyW, Math.max(semitoneH - 1, 2));
        ctx.strokeStyle = isC ? 'rgba(56, 189, 248, 0.4)' : '#292d3b';
        ctx.lineWidth = isC ? 1 : 0.5;
        ctx.strokeRect(2, rowY + 1, keyW, Math.max(semitoneH - 1, 2));
      }

      // B. 100% 完整音名標示 (黑鍵、白鍵與半音全數顯示，徹底消除黑色空白不一致現象)
      if (isC) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 9.5px sans-serif';
      } else if (hasNotesOnPitch) {
        ctx.fillStyle = isBlack ? '#c084fc' : '#ffffff';
        ctx.font = 'bold 9px sans-serif';
      } else if (isBlack) {
        ctx.fillStyle = '#64748b'; // 未演奏黑鍵：精緻沉穩灰
        ctx.font = '8.5px sans-serif';
      } else {
        ctx.fillStyle = '#cbd5e1'; // 未演奏白鍵：清晰淺灰白
        ctx.font = '9px sans-serif';
      }

      ctx.textAlign = 'right';
      ctx.fillText(noteName, scaleW - 6, rowY + semitoneH / 2 + 3);
    }

    // 7. 繪製音符方塊 (使用 Clip 限制在畫布主體區域內)
    ctx.save();
    ctx.beginPath();
    ctx.rect(scaleW, rulerH, plotW, plotH);
    ctx.clip();

    const themeColors = [
      { fill: '#3b82f6', border: '#60a5fa' }, // Pad 1 藍
      { fill: '#10b981', border: '#34d399' }, // Pad 2 綠
      { fill: '#f59e0b', border: '#fbbf24' }, // Pad 3 琥珀
      { fill: '#ec4899', border: '#f472b6' }, // Pad 4 粉紅
    ];
    const theme = themeColors[(padNum - 1) % themeColors.length];

    const boxes: RenderedNoteBox[] = [];

    for (const n of notes) {
      let currentDuration = n.durationTick;
      if (resizingPreviewDuration && resizingPreviewDuration.startTick === n.startTick && resizingPreviewDuration.note === n.note) {
        currentDuration = resizingPreviewDuration.durationTick;
      }
      const noteEndTick = n.startTick + currentDuration;
      // 排除視窗以外的音符
      if (noteEndTick <= windowStartTick || n.startTick >= windowEndTick) {
        continue;
      }

      const relTick = n.startTick - windowStartTick;
      const x = scaleW + (relTick / windowTotalTicks) * plotW;
      const noteW = Math.max((currentDuration / windowTotalTicks) * plotW, 5);
      const rowY = rulerH + (displayMaxNote - n.note) * semitoneH;
      const noteH = Math.max(semitoneH - 2, 6);
      const noteY = rowY + 1;

      // 絕對位置以全段 gridStartTick 為基準計算
      const absRelTick = n.startTick - gridStartTick;
      const pos = formatNotePosition(absRelTick, ticksPerBeat, beatsPerBar);

      const box: RenderedNoteBox = {
        x, y: noteY, w: noteW, h: noteH,
        note: n.note, velocity: n.velocity,
        startTick: n.startTick, durationTick: currentDuration,
        posChinese: pos.chinese,
        posStandard: pos.standard,
        posDisplayFull: pos.displayFull,
      };
      boxes.push(box);

      const isSelected = selectedNoteBox && selectedNoteBox.startTick === n.startTick && selectedNoteBox.note === n.note;
      const isHovered = highlightedBox && highlightedBox.startTick === n.startTick && highlightedBox.note === n.note;
      const isSounding = playheadRelTick !== null && playheadRelTick !== undefined &&
        (playheadRelTick >= (n.startTick - gridStartTick)) &&
        (playheadRelTick < (n.startTick + currentDuration - gridStartTick));

      // 依據 velocity 力度調整透明度
      const alpha = (isSelected || isHovered || isSounding) ? 1.0 : (0.55 + (n.velocity / 127) * 0.45);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = isSounding ? '#fde047' : (isSelected ? '#f59e0b' : (isHovered ? '#38bdf8' : theme.fill));

      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, noteY, noteW, noteH, 3);
      else ctx.rect(x, noteY, noteW, noteH);
      ctx.fill();

      // 邊框
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = isSounding ? '#ffffff' : (isSelected ? '#ffffff' : (isHovered ? '#ffffff' : theme.border));
      ctx.lineWidth = isSelected ? 2.5 : ((isHovered || isSounding) ? 2 : 1);
      ctx.stroke();

      // 右邊緣拖曳握把 (Grip Handle) 提示 (商業級 DAW 如 Logic/Ableton 的音符右端小握柄)
      if (noteW >= 14 && noteH >= 8) {
        ctx.fillStyle = isSelected ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.35)';
        ctx.fillRect(x + noteW - 3, noteY + 2, 1.5, Math.max(noteH - 4, 2));
      }

      // 懸停/選取/發聲光暈效果
      if (isSounding) {
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (isSelected) {
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (isHovered) {
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // 音符內部標籤 (若寬度允許，直接在音符上方標示長度與音名)
      if (noteW >= 46 && noteH >= 11) {
        const shortDur = formatShortDuration(currentDuration, ticksPerBeat, beatsPerBar);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(`${midiNoteToName(n.note)} · ${shortDur}`, Math.max(x + 4, scaleW + 4), noteY + noteH / 2 + 3);
      } else if (noteW >= 22 && noteH >= 11) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(midiNoteToName(n.note), Math.max(x + 3, scaleW + 3), noteY + noteH / 2 + 3);
      }
    }

    ctx.restore();
    lastRenderedNoteBoxes = boxes;

    // 8. 繪製走帶游標 (Playhead Cursor)
    if (playheadRelTick !== null && playheadRelTick !== undefined) {
      const playheadAbsTick = gridStartTick + playheadRelTick;
      if (playheadAbsTick >= windowStartTick && playheadAbsTick <= windowEndTick) {
        const playheadX = scaleW + ((playheadAbsTick - windowStartTick) / windowTotalTicks) * plotW;

        // 垂直雷射指針線
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(playheadX, rulerH);
        ctx.lineTo(playheadX, h);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#22c55e';
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.restore();

        // 頂部時間軸尺規上的倒三角形游標標記
        ctx.save();
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.moveTo(playheadX - 6, 2);
        ctx.lineTo(playheadX + 6, 2);
        ctx.lineTo(playheadX, rulerH - 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  };

  currentCanvasRedraw = () => redraw(hoveredNoteBox, currentPlayheadRelTick, currentActiveNoteNumbers);
  currentCanvasRedrawWithPlayhead = (relTick, activeNotes) => redraw(hoveredNoteBox, relTick, activeNotes);
  redraw(null, currentPlayheadRelTick, currentActiveNoteNumbers);

  // 註冊滑鼠懸停檢視事件
  setupCanvasHoverEvents(canvas);

  // 更新小節滑動條與縮放控制項
  updateTimelineNavigationUI(totalBars);
  setupScrollEvents(canvas);
}

function updateTimelineNavigationUI(totalBars: number) {
  const container = document.getElementById('canvas-scroll-container');
  const btn4Bars = document.getElementById('btn-zoom-4bars') as HTMLButtonElement | null;
  const btnAll = document.getElementById('btn-zoom-all') as HTMLButtonElement | null;
  const slider = document.getElementById('timeline-slider') as HTMLInputElement | null;
  const rangeLabel = document.getElementById('timeline-range-label');
  const scrollControls = document.getElementById('scroll-bar-controls');

  if (!container) return;

  if (totalBars <= 4) {
    if (btn4Bars) btn4Bars.style.display = 'none';
    if (btnAll) btnAll.style.display = 'none';
    if (scrollControls) scrollControls.style.display = 'none';
    return;
  }

  // 小節數大於 4，顯示控制項
  if (btn4Bars) btn4Bars.style.display = 'inline-block';
  if (btnAll) btnAll.style.display = 'inline-block';
  if (scrollControls) scrollControls.style.display = 'flex';

  if (rollViewMode === '4bars') {
    if (btn4Bars) { btn4Bars.className = 'toggle-btn active-rp'; }
    if (btnAll) { btnAll.className = 'toggle-btn inactive'; }
    if (slider) {
      slider.style.display = 'block';
      const maxStartBar = Math.max(1, totalBars - 4 + 1);
      slider.min = '1';
      slider.max = `${maxStartBar}`;
      if (slider.value !== `${rollStartBar}`) {
        slider.value = `${rollStartBar}`;
      }
    }
    if (rangeLabel) {
      const endBar = Math.min(rollStartBar + 3, totalBars);
      rangeLabel.textContent = `第 ${rollStartBar} ~ ${endBar} 小節 / 共 ${totalBars} 小節`;
    }
  } else {
    if (btn4Bars) { btn4Bars.className = 'toggle-btn inactive'; }
    if (btnAll) { btnAll.className = 'toggle-btn active-rp'; }
    if (slider) slider.style.display = 'none';
    if (rangeLabel) {
      rangeLabel.textContent = `第 1 ~ ${totalBars} 小節 (全景)`;
    }
  }
}

function setupScrollEvents(canvas: HTMLCanvasElement) {
  if (isScrollEventsBound) return;
  isScrollEventsBound = true;

  const btn4Bars = document.getElementById('btn-zoom-4bars');
  const btnAll = document.getElementById('btn-zoom-all');
  const slider = document.getElementById('timeline-slider') as HTMLInputElement | null;
  const btnPrev = document.getElementById('btn-prev-bars');
  const btnNext = document.getElementById('btn-next-bars');

  if (btn4Bars) {
    btn4Bars.addEventListener('click', () => {
      rollViewMode = '4bars';
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    });
  }

  if (btnAll) {
    btnAll.addEventListener('click', () => {
      rollViewMode = 'all';
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    });
  }

  if (slider) {
    const handleSliderChange = () => {
      rollStartBar = parseInt(slider.value, 10);
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    };
    slider.addEventListener('input', handleSliderChange);
    slider.addEventListener('change', handleSliderChange);
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      rollStartBar = Math.max(1, rollStartBar - 4);
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      const maxStartBar = Math.max(1, currentTotalBars - 4 + 1);
      rollStartBar = Math.min(maxStartBar, rollStartBar + 4);
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    });
  }

  // 支援滑鼠滾輪水平拖曳時間軸
  canvas.addEventListener('wheel', (e) => {
    if (rollViewMode === '4bars' && currentTotalBars > 4) {
      e.preventDefault();
      const maxStartBar = Math.max(1, currentTotalBars - 4 + 1);
      if (e.deltaY > 0 || e.deltaX > 0) {
        rollStartBar = Math.min(maxStartBar, rollStartBar + 1);
      } else {
        rollStartBar = Math.max(1, rollStartBar - 1);
      }
      resetHoverInfo();
      if (currentCanvasRedraw) currentCanvasRedraw();
      updateTimelineNavigationUI(currentTotalBars);
    }
  }, { passive: false });
}

function setupCanvasHoverEvents(canvas: HTMLCanvasElement) {
  if (isCanvasHoverBound) return;
  isCanvasHoverBound = true;

  const hoverInfoEl = document.getElementById('canvas-hover-info');

  canvas.addEventListener('mousemove', (e) => {
    if (isResizingNote) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // 搜尋滑鼠游標正下方的音符方塊 (反向搜尋以最上層音符優先)
    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const edgeHit = reversedBoxes.find(b => isMouseNearRightEdge(b, mouseX, mouseY));
    const bodyHit = edgeHit || reversedBoxes.find(b =>
      mouseX >= b.x && mouseX <= b.x + b.w &&
      mouseY >= b.y && mouseY <= b.y + b.h
    );

    if (edgeHit) {
      canvas.style.cursor = 'ew-resize';
    } else if (bodyHit) {
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = 'default';
    }

    const found = edgeHit || bodyHit || null;

    if (found !== hoveredNoteBox) {
      hoveredNoteBox = found;
      if (currentCanvasRedraw) currentCanvasRedraw();
    }

    if (hoverInfoEl) {
      if (edgeHit) {
        const durStr = formatNoteDuration(edgeHit.durationTick, currentTicksPerBeat, currentBeatsPerBar);
        hoverInfoEl.innerHTML = `↔ 拖曳縮放音長: <strong>${midiNoteToName(edgeHit.note)}</strong> (${edgeHit.note}) ｜ 位置: ${edgeHit.posDisplayFull} ｜ 目前音長: <strong>${durStr}</strong> (${edgeHit.durationTick} ticks)`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.16)';
      } else if (bodyHit) {
        const durStr = formatNoteDuration(bodyHit.durationTick, currentTicksPerBeat, currentBeatsPerBar);
        hoverInfoEl.innerHTML = `🎯 音符: <strong>${midiNoteToName(bodyHit.note)}</strong> (${bodyHit.note}) ｜ 位置: ${bodyHit.posDisplayFull} ｜ 音長: <strong>${durStr}</strong> ｜ 力度: <strong>${bodyHit.velocity}</strong>`;
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.16)';
      } else {
        hoverInfoEl.textContent = '💡 點選任意音符可開啟屬性檢查器，移至音符右邊緣 ↔ 可拖曳縮放音長';
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
      }
    }
  });

  // 音符右邊緣拖曳縮放開始 (Mousedown to start resize)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // 僅限滑鼠左鍵
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const edgeHit = reversedBoxes.find(b => isMouseNearRightEdge(b, mouseX, mouseY));
    if (edgeHit) {
      isResizingNote = true;
      resizingTargetNote = edgeHit;
      resizingStartMouseX = e.clientX;
      resizingStartDuration = edgeHit.durationTick;
      currentResizingDuration = edgeHit.durationTick;
      isDragThresholdMet = false;
      hasJustDragged = false;
      selectNote(edgeHit);
      document.body.style.cursor = 'ew-resize';
      canvas.style.cursor = 'ew-resize';
      e.preventDefault();
    }
  });

  // 全域滑鼠拖曳監聽 (Window Mousemove for smooth dragging outside canvas)
  window.addEventListener('mousemove', (e) => {
    if (!isResizingNote || !resizingTargetNote) return;

    const deltaClientX = e.clientX - resizingStartMouseX;
    if (Math.abs(deltaClientX) > 2) {
      isDragThresholdMet = true;
    }

    const rect = canvas.getBoundingClientRect();
    const canvasDeltaX = deltaClientX * (canvas.width / rect.width);
    const deltaTicks = (canvasDeltaX / currentPlotW) * currentWindowTotalTicks;

    let newDur = Math.round(resizingStartDuration + deltaTicks);

    // 網格對齊 (Grid Snap)：預設對齊 1/32 音符 (如 12 ticks 或 60 ticks)，按住 Shift 鍵可 1 Tick 自由微調
    const isFineTune = e.shiftKey;
    const snapStep = isFineTune ? 1 : Math.max(12, Math.round(currentTicksPerBeat / 8));
    newDur = Math.round(newDur / snapStep) * snapStep;
    newDur = Math.max(isFineTune ? 1 : snapStep, Math.min(newDur, currentWindowTotalTicks * 2));

    if (newDur !== currentResizingDuration) {
      currentResizingDuration = newDur;
      resizingPreviewDuration = {
        startTick: resizingTargetNote.startTick,
        note: resizingTargetNote.note,
        durationTick: newDur,
      };
      if (currentCanvasRedraw) currentCanvasRedraw();

      if (hoverInfoEl) {
        const durStr = formatNoteDuration(newDur, currentTicksPerBeat, currentBeatsPerBar);
        hoverInfoEl.innerHTML = `↔ 拖曳調整音長: <strong>${midiNoteToName(resizingTargetNote.note)}</strong> ｜ 新音長: <strong>${durStr}</strong> (${newDur} ticks)${isFineTune ? ' <span style="color:#f59e0b;font-weight:600;">[精細微調]</span>' : ' <span style="opacity:0.75">(按住 Shift 可 1 Tick 微調)</span>'}`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      }

      const durInput = document.getElementById('insp-duration-input') as HTMLInputElement | null;
      const durDescEl = document.getElementById('insp-duration-desc');
      if (durInput) durInput.value = `${newDur}`;
      if (durDescEl) durDescEl.textContent = `(${formatShortDuration(newDur, currentTicksPerBeat, currentBeatsPerBar)})`;
    }
  });

  // 全域滑鼠釋放監聽 (Window Mouseup to commit duration modification)
  window.addEventListener('mouseup', () => {
    if (!isResizingNote || !resizingTargetNote) return;

    const target = resizingTargetNote;
    const finalDuration = currentResizingDuration;
    const didChange = isDragThresholdMet && (finalDuration !== resizingStartDuration);

    isResizingNote = false;
    resizingTargetNote = null;
    resizingPreviewDuration = null;
    document.body.style.cursor = '';
    if (canvas) canvas.style.cursor = 'default';

    if (didChange) {
      hasJustDragged = true;
      try {
        if (currentParsed) {
          YamahaPadModifier.updateNoteEvent(
            currentParsed,
            currentCanvasPadNum,
            { note: target.note, startTick: target.startTick, oldDurationTick: resizingStartDuration },
            { durationTick: finalDuration }
          );
          markModified(`已拖曳微調 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(target.note)} 音長為 ${finalDuration} Ticks`);
          refreshCurrentPadDetail();
          auditionSelectedNote(target.note, finalDuration, target.velocity);
        }
      } catch (err: any) {
        console.error('Failed to update note duration by dragging:', err);
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `⚠️ <span style="color:#ef4444;">調整音長失敗: ${err.message}</span>`;
          hoverInfoEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
        }
      }
    }

    setTimeout(() => {
      hasJustDragged = false;
    }, 100);
  });

  canvas.addEventListener('mouseleave', () => {
    if (isResizingNote) return;
    if (hoveredNoteBox) {
      hoveredNoteBox = null;
      if (currentCanvasRedraw) currentCanvasRedraw();
      if (hoverInfoEl) {
        hoverInfoEl.textContent = '💡 點選任意音符可開啟屬性檢查器，移至音符右邊緣 ↔ 可拖曳縮放音長';
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
      }
    }
  });

  // 音符點選事件 (Note Selection)
  canvas.addEventListener('click', (e) => {
    if (hasJustDragged) {
      hasJustDragged = false;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    // 搜尋點選的音符方塊 (反向搜尋最上層優先)
    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const clicked = reversedBoxes.find(b =>
      clickX >= b.x && clickX <= b.x + b.w &&
      clickY >= b.y && clickY <= b.y + b.h
    );

    if (clicked) {
      selectNote(clicked);
    } else {
      // 點擊空白區域：取消選取
      deselectNote();
    }
  });

  initNoteInspectorEvents();
}

function selectNote(box: RenderedNoteBox) {
  selectedNoteBox = box;
  if (currentCanvasRedraw) currentCanvasRedraw();

  updateInspectorFields(box);

  // 點擊即時發聲試聽
  auditionSelectedNote(box.note, box.durationTick, box.velocity);
}

function updateInspectorFields(box: RenderedNoteBox) {
  const inspectorBar = document.getElementById('note-inspector-bar');
  const pitchEl = document.getElementById('insp-pitch-name');
  const posEl = document.getElementById('insp-position-text');
  const durInput = document.getElementById('insp-duration-input') as HTMLInputElement | null;
  const durDescEl = document.getElementById('insp-duration-desc');
  const velInput = document.getElementById('insp-velocity-input') as HTMLInputElement | null;

  if (inspectorBar) inspectorBar.style.display = 'flex';
  if (pitchEl) pitchEl.textContent = `${midiNoteToName(box.note)} (${box.note})`;
  if (posEl) posEl.textContent = box.posChinese;
  if (durInput) durInput.value = `${box.durationTick}`;
  if (durDescEl) durDescEl.textContent = `(${formatShortDuration(box.durationTick, currentTicksPerBeat, currentBeatsPerBar)})`;
  if (velInput) velInput.value = `${box.velocity}`;
}

function deselectNote() {
  if (!selectedNoteBox) return;
  selectedNoteBox = null;
  if (currentCanvasRedraw) currentCanvasRedraw();

  const inspectorBar = document.getElementById('note-inspector-bar');
  if (inspectorBar) inspectorBar.style.display = 'none';
}

function auditionSelectedNote(note: number, durTicks: number, velocity: number) {
  const durSec = Math.max(0.1, Math.min(2.0, ticksToSeconds(durTicks, 120, currentTicksPerBeat)));
  audioEngine.playAuditionNote(note, durSec, {
    ...currentCanvasPadInstrument,
    volume: velocity,
  });
}

function refreshCurrentPadDetail() {
  if (!currentParsed) return;
  const sec = currentParsed.sections[currentCanvasPadNum - 1];
  const nameInput = document.querySelector(`.pad-card-${currentCanvasPadNum} .pad-name-input`) as HTMLInputElement | null;
  const currentName = nameInput ? nameInput.value : `Pad ${currentCanvasPadNum}`;
  showPadNotesDetail(currentParsed, sec, currentName, currentCanvasPadNum);
}

function initNoteInspectorEvents() {
  if (isInspectorEventsBound) return;
  isInspectorEventsBound = true;

  const durInput = document.getElementById('insp-duration-input') as HTMLInputElement | null;
  const durDescEl = document.getElementById('insp-duration-desc');
  const velInput = document.getElementById('insp-velocity-input') as HTMLInputElement | null;
  const btnPreview = document.getElementById('btn-insp-preview');
  const btnClose = document.getElementById('btn-insp-close');

  if (btnClose) {
    btnClose.addEventListener('click', () => deselectNote());
  }

  if (btnPreview) {
    btnPreview.addEventListener('click', () => {
      if (selectedNoteBox) {
        auditionSelectedNote(selectedNoteBox.note, selectedNoteBox.durationTick, selectedNoteBox.velocity);
      }
    });
  }

  if (durInput) {
    durInput.addEventListener('change', () => {
      if (!selectedNoteBox || !currentParsed) return;
      const newDur = Math.max(1, parseInt(durInput.value, 10) || 24);
      durInput.value = `${newDur}`;
      if (durDescEl) {
        durDescEl.textContent = `(${formatShortDuration(newDur, currentTicksPerBeat, currentBeatsPerBar)})`;
      }

      const oldDur = selectedNoteBox.durationTick;
      const success = YamahaPadModifier.updateNoteEvent(
        currentParsed,
        currentCanvasPadNum,
        { note: selectedNoteBox.note, startTick: selectedNoteBox.startTick, oldDurationTick: oldDur },
        { durationTick: newDur }
      );

      if (success) {
        selectedNoteBox.durationTick = newDur;
        markModified(`已微調 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(selectedNoteBox.note)} 音長為 ${newDur} Ticks`);
        refreshCurrentPadDetail();
        auditionSelectedNote(selectedNoteBox.note, newDur, selectedNoteBox.velocity);
      }
    });
  }

  if (velInput) {
    velInput.addEventListener('change', () => {
      if (!selectedNoteBox || !currentParsed) return;
      const newVel = Math.max(1, Math.min(127, parseInt(velInput.value, 10) || 80));
      velInput.value = `${newVel}`;

      const success = YamahaPadModifier.updateNoteEvent(
        currentParsed,
        currentCanvasPadNum,
        { note: selectedNoteBox.note, startTick: selectedNoteBox.startTick, oldDurationTick: selectedNoteBox.durationTick },
        { velocity: newVel }
      );

      if (success) {
        selectedNoteBox.velocity = newVel;
        markModified(`已微調 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(selectedNoteBox.note)} 力度為 ${newVel}`);
        refreshCurrentPadDetail();
        auditionSelectedNote(selectedNoteBox.note, selectedNoteBox.durationTick, newVel);
      }
    });
  }
}

function renderParts(parsed: YamahaFileParsed) {
  if (!partsTbody || !partsCount) return;
  partsTbody.innerHTML = '';

  const isPad = parsed.format === 'PAD';
  const panelPartsTitle = document.getElementById('panel-parts-title');
  if (panelPartsTitle) {
    panelPartsTitle.textContent = isPad
      ? '🎛️ Multi Pad 混音器與音色細節 (Pad Mixer & Voices)'
      : '🎛️ 伴奏聲部與音色配置 (Parts & Voices)';
  }

  if (isPad) {
    // PAD 模式：精確對齊 4 個 Pad 的聲部 (依據 Track 1 ~ 4)
    partsCount.textContent = '4 組打擊墊聲部配置';

    const themeColors = [
      { bg: 'rgba(59, 130, 246, 0.15)', border: '#3b82f6', text: '#60a5fa' }, // Pad 1 藍
      { bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981', text: '#34d399' }, // Pad 2 綠
      { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b', text: '#fbbf24' }, // Pad 3 琥珀
      { bg: 'rgba(236, 72, 153, 0.15)', border: '#ec4899', text: '#f472b6' }, // Pad 4 粉紅
    ];

    for (let padNum = 1; padNum <= 4; padNum++) {
      const padIdx = padNum - 1;
      const track = parsed.tracks[padNum]; // Track 1 ~ 4
      const customName = parsed.padConfig?.names[padIdx] || `Pad ${padNum}`;
      const theme = themeColors[padIdx];
      const displayName = (!customName || customName === `Pad ${padNum}` || customName === `Pad${padNum}`)
        ? `Pad ${padNum}`
        : `Pad ${padNum} (${customName})`;

      // 提取該 Track 內部的 Controller 資訊
      let vol = 100;
      let pan = 64;
      let reverb: number | undefined;
      let bankMsb: number | undefined;
      let bankLsb: number | undefined;
      let pc: number | undefined;
      let channel = padIdx;

      if (track) {
        for (const ev of track.events) {
          if (ev.channel !== undefined) channel = ev.channel;
          if (ev.type === 'controlChange') {
            if (ev.controller === 7 && ev.value !== undefined) vol = ev.value;
            if (ev.controller === 10 && ev.value !== undefined) pan = ev.value;
            if (ev.controller === 91 && ev.value !== undefined) reverb = ev.value;
            if (ev.controller === 0 && ev.value !== undefined) bankMsb = ev.value;
            if (ev.controller === 32 && ev.value !== undefined) bankLsb = ev.value;
          }
          if (ev.type === 'programChange' && ev.program !== undefined) {
            pc = ev.program;
          }
        }
      }

      const tr = document.createElement('tr');
      tr.className = `pad-table-row pad-table-row-${padNum}`;
      if (currentActivePadNum === padNum) {
        tr.classList.add('active-row');
      }
      tr.title = `點擊展開並檢視 Pad ${padNum} 的詳細音符與小節`;
      tr.style.cursor = 'pointer';
      tr.innerHTML = `
        <td>
          <span class="part-badge part-name-text-${padNum}" style="display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 5px; background: ${theme.bg}; border: 1px solid ${theme.border}; color: ${theme.text}; font-weight: 600; font-size: 0.78rem;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${theme.border};"></span>
            ${displayName}
          </span>
        </td>
        <td><span style="color: #94a3b8; font-family: monospace;">Track ${padNum} (Ch ${channel + 1})</span></td>
        <td>
          <div style="display: flex; gap: 4px; align-items: center;">
            <input type="number" min="0" max="127" class="mixing-num-input bank-msb-${padNum}" value="${bankMsb ?? 0}" title="Bank MSB (CC0)" />
            <span>-</span>
            <input type="number" min="0" max="127" class="mixing-num-input bank-lsb-${padNum}" value="${bankLsb ?? 0}" title="Bank LSB (CC32)" />
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 4px; align-items: center;">
            <input type="number" min="0" max="127" class="mixing-num-input pc-${padNum}" value="${pc ?? 0}" title="Program Change (音色代碼 0~127)" />
            <button type="button" class="btn-open-voice-modal" data-pad="${padNum}" title="開啟 Yamaha PSR-SX920 原廠音色庫搜尋視窗" style="padding: 2px 6px;">🔍 庫</button>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${vol}" class="mixing-slider vol-range-${padNum}" title="音量 (0~127)" />
            <span class="vol-label-${padNum}" style="font-size: 0.8rem; width: 28px; text-align: right;">${vol}</span>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${pan}" class="mixing-slider pan-range-${padNum}" title="左右立體聲聲相 (L64~C~R63)" />
            <span class="pan-label-${padNum} pan-indicator">${formatPan(pan)}</span>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${reverb ?? 40}" class="mixing-slider rev-range-${padNum}" title="混響深度 (0~127)" />
            <span class="rev-label-${padNum}" style="font-size: 0.8rem; width: 28px; text-align: right;">${reverb ?? 40}</span>
          </div>
        </td>
      `;

      // 監聽音量推桿事件
      const volRange = tr.querySelector(`.vol-range-${padNum}`) as HTMLInputElement;
      const volLabel = tr.querySelector(`.vol-label-${padNum}`) as HTMLElement;
      volRange.addEventListener('input', () => {
        const val = parseInt(volRange.value, 10);
        volLabel.textContent = `${val}`;
        YamahaPadModifier.setPadMixing(parsed, padNum, { volume: val });
        markModified(`Pad ${padNum} 音量調整為: ${val}`);
      });

      // 監聽聲相推桿事件
      const panRange = tr.querySelector(`.pan-range-${padNum}`) as HTMLInputElement;
      const panLabel = tr.querySelector(`.pan-label-${padNum}`) as HTMLElement;
      panRange.addEventListener('input', () => {
        const val = parseInt(panRange.value, 10);
        panLabel.textContent = formatPan(val);
        YamahaPadModifier.setPadMixing(parsed, padNum, { pan: val });
        markModified(`Pad ${padNum} 聲相調整為: ${formatPan(val)}`);
      });

      // 監聽混響推桿事件
      const revRange = tr.querySelector(`.rev-range-${padNum}`) as HTMLInputElement;
      const revLabel = tr.querySelector(`.rev-label-${padNum}`) as HTMLElement;
      revRange.addEventListener('input', () => {
        const val = parseInt(revRange.value, 10);
        revLabel.textContent = `${val}`;
        YamahaPadModifier.setPadMixing(parsed, padNum, { reverb: val });
        markModified(`Pad ${padNum} 混響調整為: ${val}`);
      });

      // 監聽音色變更事件
      const inputMsb = tr.querySelector(`.bank-msb-${padNum}`) as HTMLInputElement;
      const inputLsb = tr.querySelector(`.bank-lsb-${padNum}`) as HTMLInputElement;
      const inputPc = tr.querySelector(`.pc-${padNum}`) as HTMLInputElement;

      const onVoiceChange = () => {
        const msb = parseInt(inputMsb.value, 10) || 0;
        const lsb = parseInt(inputLsb.value, 10) || 0;
        const program = parseInt(inputPc.value, 10) || 0;
        YamahaPadModifier.setPadMixing(parsed, padNum, {
          bankMsb: msb,
          bankLsb: lsb,
          programChange: program,
        });

        // 反向同步上方 Pad 卡片的樂器下拉選單
        updatePadCardInstrumentSelect(padNum, msb, lsb, program);

        // 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
        if (currentActivePadNum === padNum) {
          const sec = parsed.sections[padIdx];
          const nameInput = document.querySelector(`.pad-card-${padNum} .pad-name-input`) as HTMLInputElement | null;
          const currentName = nameInput ? nameInput.value : `Pad ${padNum}`;
          if (sec) showPadNotesDetail(parsed, sec, currentName, padNum);
        }

        markModified(`Pad ${padNum} 音色調整為: Bank ${msb}-${lsb}, PC ${program}`);
      };

      inputMsb.addEventListener('change', onVoiceChange);
      inputLsb.addEventListener('change', onVoiceChange);
      inputPc.addEventListener('change', onVoiceChange);

      const btnOpenMixerVoice = tr.querySelector(`.btn-open-voice-modal[data-pad="${padNum}"]`) as HTMLButtonElement | null;
      if (btnOpenMixerVoice) {
        btnOpenMixerVoice.addEventListener('click', (e) => {
          e.stopPropagation();
          openVoiceModal(padNum);
        });
      }

      // 點擊該列直接連動展開上方對應的 Pad 卡片
      tr.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.tagName === 'SELECT') return;
        const targetCard = document.querySelector(`.pad-card-${padNum}`) as HTMLElement | null;
        if (targetCard) targetCard.click();
      });

      partsTbody.appendChild(tr);
    }
  } else {
    // STY 模式：維持伴奏聲部列表
    partsCount.textContent = `${parsed.parts.length} 個作用中伴奏聲部`;
    for (const part of parsed.parts) {
      const tr = document.createElement('tr');
      const vol = part.volume ?? 100;
      const pan = part.pan ?? 64;

      tr.innerHTML = `
        <td><span class="part-badge">${part.partName}</span></td>
        <td>Ch ${part.channel + 1}</td>
        <td><code>${part.bankMsb ?? '-'}-${part.bankLsb ?? '-'}</code></td>
        <td><code>${part.programChange ?? '-'}</code></td>
        <td>
          <div class="volume-bar-bg">
            <div class="volume-bar-fill" style="width: ${(vol / 127) * 100}%"></div>
          </div>
          <span>${vol}</span>
        </td>
        <td>${pan === 64 ? 'C (置中)' : pan < 64 ? `L${64 - pan}` : `R${pan - 64}`}</td>
        <td>${part.reverb ?? '-'}</td>
      `;
      partsTbody.appendChild(tr);
    }
  }
}

// 註冊初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEvents);
} else {
  initEvents();
}
