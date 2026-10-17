import { YamahaParser } from '../core/parser/yamaha-parser';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { YamahaPadSynthesizer } from '../core/writer/pad-synthesizer';
import {
  MidiImporter,
  type MidiSourceAnalysis,
  type PadAssignmentOption,
} from '../core/writer/midi-importer';
import {
  StyleImporter,
  type StyleSourceAnalysis,
  type StylePartMappingItem,
  type StyleSectionSliceConfig,
  ROOT_TO_C_SHIFT,
} from '../core/writer/style-importer';
import { YamahaStyleSynthesizer } from '../core/writer/style-synthesizer';
import { YamahaStyleModifier } from '../core/writer/style-modifier';
import {
  StyleRemixer,
  type StylePoolEntry,
  type StyleRemixPartAssignment,
  type StyleRemixSectionSpec,
} from '../core/writer/style-remixer';
import {
  DEFAULT_STYLE_PARTS,
  type StylePartId,
  type StyleSectionType,
} from '../core/models/style-types';
import { audioEngine, ticksToSeconds } from '../core/audio/audio-engine';
import { midiManager, MidiDeviceInfo } from '../core/audio/midi-manager';
import type { NoteEvent, PlaybackState, BackingTrackItem } from '../core/audio/audio-engine';
import {
  PadRecorder,
  type RecordedNote,
  type QuantizeGrid,
} from '../core/writer/pad-recorder';
import {
  StepRecorder,
  type StepResolution,
  type StepRecordEntry,
} from '../core/writer/step-recorder';
import type { YamahaFileParsed, YamahaSection, MidiTrack } from '../core/models/types';
import {
  findYamahaVoice,
  searchYamahaVoices,
  YAMAHA_SX920_VOICES,
  VOICE_CATEGORIES,
  VOICE_SUITABILITY_FILTERS,
  type YamahaVoice,
  type VoiceCategory,
  type VoiceSuitabilityFilter,
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
const btnImportMidi = document.getElementById('btn-import-midi');
const btnLoadSampleMid = document.getElementById('btn-load-sample-mid');
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
let targetModalType: 'PAD' | 'STY' = 'PAD';
let targetModalPadNum: number = 1;
let targetModalStyChannel: number = 8;
let currentModalCategory: VoiceCategory | 'ALL' = 'ALL';
let currentModalSuitabilityFilter: VoiceSuitabilityFilter = 'ALL';
let currentModalSearchQuery: string = '';
let currentModalRenderLimit: number = 60;

// Yamaha STY 伴奏聲部主題與視覺配置 (支援 SFF1 Channel 0 ~ 7 與 SFF2 Channel 8 ~ 15)
const STY_PART_META: Record<number, { id: StylePartId; name: string; shortName: string; icon: string; color: string; bg: string; border: string }> = {
  // SFF1 傳統伴奏通道 (0~7，對應 MIDI Ch 1~8)
  0: { id: 'Rhythm1', name: 'Sub Rhythm (Rhythm 1)', shortName: 'Rhythm 1', icon: '🥁', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.35)' },
  1: { id: 'Bass', name: 'Bass', shortName: 'Bass', icon: '🎸', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)' },
  2: { id: 'Chord1', name: 'Chord 1', shortName: 'Chord 1', icon: '🎹', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.35)' },
  3: { id: 'Chord2', name: 'Chord 2', shortName: 'Chord 2', icon: '🎸', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.35)' },
  4: { id: 'Pad', name: 'Pad', shortName: 'Pad', icon: '🎻', color: '#10b981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)' },
  5: { id: 'Phrase1', name: 'Phrase 1', shortName: 'Phrase 1', icon: '🎺', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)' },
  6: { id: 'Phrase2', name: 'Phrase 2', shortName: 'Phrase 2', icon: '🎷', color: '#e11d48', bg: 'rgba(225,29,72,0.15)', border: 'rgba(225,29,72,0.35)' },
  7: { id: 'Phrase2', name: 'Extra Part', shortName: 'Extra', icon: '🎶', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', border: 'rgba(168,85,247,0.35)' },

  // SFF2 / 標準 Yamaha 伴奏通道 (8~15，對應 Yamaha Ch 9~16)
  8: { id: 'Rhythm1', name: 'Sub Rhythm (Rhythm 1)', shortName: 'Rhythm 1', icon: '🥁', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.35)' },
  9: { id: 'Rhythm2', name: 'Main Rhythm (Rhythm 2)', shortName: 'Rhythm 2', icon: '🥁', color: '#f43f5e', bg: 'rgba(244,63,94,0.15)', border: 'rgba(244,63,94,0.35)' },
  10: { id: 'Bass', name: 'Bass', shortName: 'Bass', icon: '🎸', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.35)' },
  11: { id: 'Chord1', name: 'Chord 1', shortName: 'Chord 1', icon: '🎹', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.35)' },
  12: { id: 'Chord2', name: 'Chord 2', shortName: 'Chord 2', icon: '🎸', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', border: 'rgba(6,182,212,0.35)' },
  13: { id: 'Pad', name: 'Pad', shortName: 'Pad', icon: '🎻', color: '#10b981', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.35)' },
  14: { id: 'Phrase1', name: 'Phrase 1', shortName: 'Phrase 1', icon: '🎺', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.35)' },
  15: { id: 'Phrase2', name: 'Phrase 2', shortName: 'Phrase 2', icon: '🎷', color: '#e11d48', bg: 'rgba(225,29,72,0.15)', border: 'rgba(225,29,72,0.35)' },
};

let stylePartMuteState: Record<number, boolean> = {};
let stylePartSoloChannel: number | null = null;

function getStylePartDisplayName(channel: number): string {
  const meta = STY_PART_META[channel];
  if (meta) return `${meta.icon} ${meta.name}`;
  const partDef = Object.values(DEFAULT_STYLE_PARTS).find((p) => p.channel === channel);
  return partDef ? partDef.name : `Part (Ch ${channel + 1})`;
}

function countPartTotalNotes(parsed: YamahaFileParsed, channel: number): number {
  if (!parsed || !parsed.tracks) return 0;
  let count = 0;
  for (const track of parsed.tracks) {
    for (const ev of track.events) {
      if (ev.channel === channel && ev.type === 'noteOn' && (ev.velocity ?? 0) > 0) {
        count++;
      }
    }
  }
  return count;
}

function updateAllStySoloVisuals() {
  for (let c = 0; c <= 15; c++) {
    const btnSolo = document.querySelector(`.btn-solo-sty-${c}`) as HTMLButtonElement | null;
    const row = document.querySelector(`.sty-table-row-${c}`) as HTMLElement | null;
    const isSolo = stylePartSoloChannel === c;
    const isSilencedBySolo = stylePartSoloChannel !== null && !isSolo;
    const isMuted = !!stylePartMuteState[c];

    if (btnSolo) {
      btnSolo.classList.toggle('active-solo', isSolo);
      btnSolo.title = isSolo ? '點擊解除獨奏 (恢復合奏)' : '獨奏此伴奏聲部 (Solo)';
    }
    if (row) {
      row.classList.toggle('row-solo', isSolo);
      row.classList.toggle('row-muted', isMuted || isSilencedBySolo);
      row.classList.toggle('row-silenced-by-solo', isSilencedBySolo);

      let soloBadge = row.querySelector('.badge-solo-indicator');
      if (isSolo) {
        if (!soloBadge) {
          const badgeContainer = row.querySelector('.part-badge')?.parentElement;
          if (badgeContainer) {
            soloBadge = document.createElement('span');
            soloBadge.className = 'badge-solo-indicator';
            soloBadge.textContent = '🎧 SOLO';
            badgeContainer.appendChild(soloBadge);
          }
        }
      } else if (soloBadge) {
        soloBadge.remove();
      }
    }
  }

  // 更新或插入表格上方的 Solo 獨奏提示條
  let soloBanner = document.getElementById('sty-solo-active-banner');
  const tableContainer = document.querySelector('.parts-table-container');
  if (stylePartSoloChannel !== null && tableContainer) {
    if (!soloBanner) {
      soloBanner = document.createElement('div');
      soloBanner.id = 'sty-solo-active-banner';
      soloBanner.className = 'sty-solo-active-banner';
      tableContainer.parentElement?.insertBefore(soloBanner, tableContainer);
    }
    const meta = STY_PART_META[stylePartSoloChannel];
    const partName = meta ? `${meta.icon} ${meta.name} (Ch ${stylePartSoloChannel + 1})` : `Ch ${stylePartSoloChannel + 1}`;
    soloBanner.style.display = 'flex';
    soloBanner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">🎧</span>
        <span><strong>獨奏模式 (Solo) 啟動中：</strong> 目前僅保留 <strong style="color: #fbbf24;">${partName}</strong> 演奏，其餘所有伴奏聲部已自動靜音。</span>
      </div>
      <button type="button" id="btn-clear-sty-solo" class="btn-clear-sty-solo" title="點擊取消獨奏，恢復所有伴奏聲部合奏">
        ✖ 解除獨奏 (全聲部合奏)
      </button>
    `;
    const btnClearSolo = soloBanner.querySelector('#btn-clear-sty-solo') as HTMLButtonElement | null;
    btnClearSolo?.addEventListener('click', () => {
      stylePartSoloChannel = null;
      updateAllStySoloVisuals();
      // 實體琴同步
      for (let c = 0; c <= 15; c++) {
        const inputEl = document.querySelector(`.vol-range-sty-${c}`) as HTMLInputElement | null;
        if (!inputEl) continue;
        const v = parseInt(inputEl.value, 10) || 100;
        const isM = !!stylePartMuteState[c];
        midiManager.sendMixerControllers(c, { volume: isM ? 0 : v });
      }
      restartCurrentStySectionAudition();
    });
  } else if (soloBanner) {
    soloBanner.style.display = 'none';
  }
}

function restartCurrentStySectionAudition() {
  if (currentAuditionStySection && audioEngine.isBackingTrackPlaying()) {
    const sec = currentAuditionStySection;
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    currentAuditionStySection = null;
    toggleStySectionAudition(sec);
  }
}

function initVoiceSearchModal() {
  const modal = document.getElementById('voice-search-modal');
  const btnClose = document.getElementById('btn-close-voice-modal');
  const btnCloseFooter = document.getElementById('btn-close-modal-footer');
  const searchInput = document.getElementById('voice-search-input') as HTMLInputElement | null;
  const btnClearSearch = document.getElementById('btn-clear-voice-search');
  const suitabilityPillsContainer = document.getElementById('voice-suitability-pills');
  const pillsContainer = document.getElementById('voice-category-pills');
  const btnLoadMore = document.getElementById('btn-load-more-voices');

  if (!modal) return;

  const handleClose = () => closeVoiceModal();
  if (btnClose) btnClose.addEventListener('click', handleClose);
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', handleClose);

  // 點選遮罩背景關閉 (避免拖曳選取文字時誤觸發關閉)
  let isVoiceBackdown = false;
  modal.addEventListener('mousedown', (e) => {
    isVoiceBackdown = (e.target === modal);
  });
  modal.addEventListener('click', (e) => {
    if (isVoiceBackdown && e.target === modal) closeVoiceModal();
    isVoiceBackdown = false;
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
      currentModalRenderLimit = 60; // 搜尋條件變更時重置分頁
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
      currentModalRenderLimit = 60;
      btnClearSearch.style.display = 'none';
      searchInput.focus();
      renderVoiceModalList();
    });
  }

  // 點擊載入更多音色
  if (btnLoadMore) {
    btnLoadMore.addEventListener('click', () => {
      currentModalRenderLimit += 60;
      renderVoiceModalList();
    });
  }

  // 動態渲染 Multi Pad 適用度與類型篩選標籤
  if (suitabilityPillsContainer) {
    suitabilityPillsContainer.innerHTML = '';
    VOICE_SUITABILITY_FILTERS.forEach((filter) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      let extraClass = '';
      if (filter.key === 'RECOMMENDED' || filter.key === 'MEGAVOICE') extraClass = 'pill-recommended';
      else if (filter.key === 'WARNING') extraClass = 'pill-warning';

      btn.className = `suit-pill ${extraClass} ${filter.key === currentModalSuitabilityFilter ? 'active' : ''}`;
      btn.innerHTML = `${filter.icon} ${filter.label}`;
      btn.addEventListener('click', () => {
        currentModalSuitabilityFilter = filter.key;
        currentModalRenderLimit = 60;
        suitabilityPillsContainer.querySelectorAll('.suit-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        renderVoiceModalList();
      });
      suitabilityPillsContainer.appendChild(btn);
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
        currentModalRenderLimit = 60;
        pillsContainer.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        renderVoiceModalList();
      });
      pillsContainer.appendChild(btn);
    });
  }
}

function openVoiceModal(targetNum: number, targetType: 'PAD' | 'STY' = 'PAD') {
  const modal = document.getElementById('voice-search-modal');
  const badge = document.getElementById('modal-target-pad-badge');
  const searchInput = document.getElementById('voice-search-input') as HTMLInputElement | null;
  if (!modal) return;

  targetModalType = targetType;
  if (targetType === 'STY') {
    targetModalStyChannel = targetNum;
    const meta = STY_PART_META[targetNum];
    const partName = meta?.name || `伴奏聲部 (Ch ${targetNum + 1})`;
    if (badge) {
      badge.textContent = `${meta ? `${meta.icon} ${meta.shortName}` : partName} (Ch ${targetNum + 1})`;
      badge.style.background = meta?.bg || '#1e293b';
      badge.style.color = meta?.color || '#38bdf8';
      badge.style.borderColor = meta?.border || '#475569';
    }
    // 智慧分類建議：鼓組聲部 (Ch 8/9) 自動切換至 Drums，貝斯 (Ch 10) 切換至 Bass
    if (targetNum === 8 || targetNum === 9) {
      currentModalCategory = 'Drums';
    } else if (targetNum === 10) {
      currentModalCategory = 'Bass';
    } else {
      currentModalCategory = 'ALL';
    }
  } else {
    targetModalPadNum = targetNum;
    if (badge) {
      badge.textContent = `Pad ${targetNum}`;
      badge.style.background = '';
      badge.style.color = '';
      badge.style.borderColor = '';
    }
  }

  // 刷新分類 pill 的 active 狀態
  const pillsContainer = document.getElementById('voice-category-pills');
  if (pillsContainer) {
    pillsContainer.querySelectorAll('.cat-pill').forEach((p, idx) => {
      const cat = VOICE_CATEGORIES[idx];
      if (cat) {
        p.classList.toggle('active', cat.key === currentModalCategory);
      }
    });
  }

  currentModalRenderLimit = 60;
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

function openNewPadModal() {
  const modal = document.getElementById('new-pad-modal');
  if (modal) {
    modal.style.display = 'flex';
    const nameInput = document.getElementById('new-pad-name') as HTMLInputElement | null;
    if (nameInput) {
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 60);
    }
  }
}

function closeNewPadModal() {
  const modal = document.getElementById('new-pad-modal');
  if (modal) modal.style.display = 'none';
}

// ========================================================
// Phase 2.7: Yamaha PSR-SX920 琴端即時錄音與智慧量化 (Mode A)
// ========================================================

const PIANO_KEY_MAP: Array<{
  pitch: number;
  noteName: string;
  isBlack: boolean;
  charKey: string;
  leftOffset?: number;
}> = [
  { pitch: 60, noteName: 'C4', isBlack: false, charKey: 'a' },
  { pitch: 61, noteName: 'C#4', isBlack: true, charKey: 'w', leftOffset: 26 },
  { pitch: 62, noteName: 'D4', isBlack: false, charKey: 's' },
  { pitch: 63, noteName: 'D#4', isBlack: true, charKey: 'e', leftOffset: 68 },
  { pitch: 64, noteName: 'E4', isBlack: false, charKey: 'd' },
  { pitch: 65, noteName: 'F4', isBlack: false, charKey: 'f' },
  { pitch: 66, noteName: 'F#4', isBlack: true, charKey: 't', leftOffset: 152 },
  { pitch: 67, noteName: 'G4', isBlack: false, charKey: 'g' },
  { pitch: 68, noteName: 'G#4', isBlack: true, charKey: 'y', leftOffset: 194 },
  { pitch: 69, noteName: 'A4', isBlack: false, charKey: 'h' },
  { pitch: 70, noteName: 'A#4', isBlack: true, charKey: 'u', leftOffset: 236 },
  { pitch: 71, noteName: 'B4', isBlack: false, charKey: 'j' },
  { pitch: 72, noteName: 'C5', isBlack: false, charKey: 'k' },
];

let padRecorder: PadRecorder = new PadRecorder();
let stepRecorder: StepRecorder = new StepRecorder();
let activeRecordMode: 'A' | 'B' = 'A';
let stepVelocityMode: 'as-played' | 'fixed' = 'as-played';
let stepTargetBars: number = 2;
let currentRecordPadNum: number = 1;
let recordedNotesBuffer: RecordedNote[] = [];
let isCountInEnabled: boolean = true;
let isAutoQuantizeEnabled: boolean = true;
let selectedQuantizeGrid: QuantizeGrid = '1/16';
let isAudioMonitorEnabled: boolean = true;
let metronomeVolumeRatio: number = 0.5;
let recordMidiUnsubs: Array<() => void> = [];
let isRecordModalEventsBound: boolean = false;
let recordedBarsCount: number = 2;
const activeSimKeys = new Set<string>();

// 嗅探與自動綁定音色狀態
let lastSniffedVoice: YamahaVoice | null = null;
let lastSniffedRawConfig: { msb: number; lsb: number; pc: number } | null = null;
let isAutoBindVoiceEnabled: boolean = true;

// 2.8-A 疊錄伴奏監聽 (Multi-Pad Overdub Backing Track) 狀態
let selectedBackingOption: string = 'none'; // 'none' | 'all' | '1' | '2' | '3' | '4'
let backingVolumeRatio: number = 0.6;
let isBackingPreviewEnabled: boolean = true;

// 畫布直接手彈步進輸入狀態
let isCanvasStepInputActive: boolean = false;
let canvasStepRecorder: StepRecorder = new StepRecorder({ ppq: 480, resolution: '1/4' });


function initPadRecordModal() {
  if (isRecordModalEventsBound) return;
  isRecordModalEventsBound = true;

  const modal = document.getElementById('pad-record-modal');
  const btnClose = document.getElementById('btn-close-record-modal');
  const btnCancel = document.getElementById('btn-rec-cancel');
  const btnAction = document.getElementById('btn-rec-action');
  const btnPreview = document.getElementById('btn-rec-preview');
  const btnApply = document.getElementById('btn-rec-apply');
  const toggleCountIn = document.getElementById('rec-toggle-countin');
  const toggleQuantize = document.getElementById('rec-toggle-quantize');
  const toggleMonitor = document.getElementById('rec-toggle-monitor');
  const volSlider = document.getElementById('rec-metronome-vol') as HTMLInputElement | null;
  const selectGrid = document.getElementById('rec-grid-select') as HTMLSelectElement | null;
  const selectTargetPad = document.getElementById('rec-target-pad-select') as HTMLSelectElement | null;
  const selectBars = document.getElementById('rec-bars-select') as HTMLSelectElement | null;

  // 錄音模式分頁切換 (Mode A / Mode B)
  const tabBtnModeA = document.getElementById('tab-btn-mode-a');
  const tabBtnModeB = document.getElementById('tab-btn-mode-b');
  if (tabBtnModeA) tabBtnModeA.addEventListener('click', () => switchRecordMode('A'));
  if (tabBtnModeB) tabBtnModeB.addEventListener('click', () => switchRecordMode('B'));

  // Mode B: 配置 stepRecorder 回呼
  stepRecorder.configure({
    onStepChange: (entry, currentTick) => {
      updateModeBStepUI(entry, currentTick);
    },
    onPositionChange: (pos) => {
      updateModeBPositionUI(pos);
    },
  });

  // Mode B: 步進時值切換按鈕群
  const stepResBtns = document.querySelectorAll('#step-res-group .step-res-btn');
  stepResBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      stepResBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const res = (btn as HTMLElement).dataset.res as StepResolution;
      if (res) {
        stepRecorder.setResolution(res);
      }
    });
  });

  // Mode B: 力度模式切換
  const stepToggleVelocity = document.getElementById('step-toggle-velocity');
  if (stepToggleVelocity) {
    stepToggleVelocity.addEventListener('click', () => {
      stepVelocityMode = stepVelocityMode === 'as-played' ? 'fixed' : 'as-played';
      stepRecorder.configure({ velocityMode: stepVelocityMode });
      if (stepVelocityMode === 'as-played') {
        stepToggleVelocity.className = 'toggle-btn active-rp';
        stepToggleVelocity.textContent = '⚡ 力度: 實彈原音';
      } else {
        stepToggleVelocity.className = 'toggle-btn active-cm';
        stepToggleVelocity.textContent = '🔒 力度: 固定 100';
      }
    });
  }

  // Mode B: 目標小節選擇
  const stepBarsSelect = document.getElementById('step-bars-select') as HTMLSelectElement | null;
  if (stepBarsSelect) {
    stepBarsSelect.addEventListener('change', () => {
      stepTargetBars = parseInt(stepBarsSelect.value, 10) || 2;
    });
  }

  // Mode B: 步進控制按鈕 (休止符, 延長前音, 後退, 開頭, 清空)
  const btnStepRest = document.getElementById('btn-step-rest');
  if (btnStepRest) {
    btnStepRest.addEventListener('click', () => {
      stepRecorder.insertRest();
    });
  }

  const btnStepTie = document.getElementById('btn-step-tie');
  if (btnStepTie) {
    btnStepTie.addEventListener('click', () => {
      const ok = stepRecorder.tiePreviousNote();
      if (!ok) {
        showStatus('目前無前置音符可供延長 (Tie)', true);
      }
    });
  }

  const btnStepBack = document.getElementById('btn-step-back');
  if (btnStepBack) {
    btnStepBack.addEventListener('click', () => {
      const ok = stepRecorder.stepBack();
      if (!ok) {
        showStatus('已經在開頭位置 (Tick 0)', true);
      }
    });
  }

  const btnStepRewind = document.getElementById('btn-step-rewind');
  if (btnStepRewind) {
    btnStepRewind.addEventListener('click', () => {
      stepRecorder.seekToTick(0);
      showStatus('步進游標已回到開頭 (Tick 0)');
    });
  }

  const btnStepClear = document.getElementById('btn-step-clear');
  if (btnStepClear) {
    btnStepClear.addEventListener('click', () => {
      stepRecorder.reset();
      updateModeBStepUI();
      updateModeBPositionUI(stepRecorder.getPosition());
      showStatus('已清空所有步進輸入');
    });
  }

  // Mode B: 試聽與寫入 (支援底部按鈕與上方操作列按鈕)
  const btnStepPreview = document.getElementById('btn-step-preview');
  if (btnStepPreview) {
    btnStepPreview.addEventListener('click', previewStepRecordedNotes);
  }
  const btnStepTopPreview = document.getElementById('btn-step-top-preview');
  if (btnStepTopPreview) {
    btnStepTopPreview.addEventListener('click', previewStepRecordedNotes);
  }

  const btnStepApply = document.getElementById('btn-step-apply');
  if (btnStepApply) {
    btnStepApply.addEventListener('click', applyStepRecordedNotes);
  }
  const btnStepTopApply = document.getElementById('btn-step-top-apply');
  if (btnStepTopApply) {
    btnStepTopApply.addEventListener('click', applyStepRecordedNotes);
  }

  if (btnClose) btnClose.addEventListener('click', closeRecordModal);
  if (btnCancel) btnCancel.addEventListener('click', closeRecordModal);

  // 開始 / 停止 錄音動作按鈕 (Mode A)
  if (btnAction) {
    btnAction.addEventListener('click', () => {
      const state = padRecorder.getState();
      if (state === 'countingIn' || state === 'recording') {
        stopLiveRecording();
      } else {
        startLiveRecording();
      }
    });
  }

  // 試聽按鈕 (Mode A)
  if (btnPreview) {
    btnPreview.addEventListener('click', () => {
      previewRecordedNotes();
    });
  }

  // 寫入 Pad (Mode A)
  if (btnApply) {
    btnApply.addEventListener('click', () => {
      applyRecordedNotes();
    });
  }

  // 切換 1 小節預備拍
  if (toggleCountIn) {
    toggleCountIn.addEventListener('click', () => {
      isCountInEnabled = !isCountInEnabled;
      toggleCountIn.className = `toggle-btn ${isCountInEnabled ? 'active-rp' : 'inactive'}`;
      toggleCountIn.textContent = isCountInEnabled ? '🔔 預備拍: 1 小節' : '🔕 預備拍: 關閉';
    });
  }

  // 切換智慧量化開關
  if (toggleQuantize) {
    toggleQuantize.addEventListener('click', () => {
      isAutoQuantizeEnabled = !isAutoQuantizeEnabled;
      toggleQuantize.className = `toggle-btn ${isAutoQuantizeEnabled ? 'active-cm' : 'inactive'}`;
      toggleQuantize.textContent = isAutoQuantizeEnabled ? '⚡ 自動量化: 開' : '🔒 自動量化: 關';
      if (selectGrid) {
        selectGrid.disabled = !isAutoQuantizeEnabled;
        selectGrid.style.opacity = isAutoQuantizeEnabled ? '1' : '0.5';
      }
    });
  }

  // 節拍器音量滑桿
  if (volSlider) {
    volSlider.addEventListener('input', () => {
      metronomeVolumeRatio = (parseInt(volSlider.value, 10) || 50) / 100;
    });
  }

  // 電腦喇叭監聽發聲開關
  if (toggleMonitor) {
    toggleMonitor.addEventListener('click', () => {
      isAudioMonitorEnabled = !isAudioMonitorEnabled;
      toggleMonitor.className = `toggle-btn ${isAudioMonitorEnabled ? 'active-rp' : 'inactive'}`;
      toggleMonitor.textContent = isAudioMonitorEnabled ? '🔊 電腦監聽: 開' : '🔇 電腦監聽: 關';
    });
  }

  // 量化網格選擇
  if (selectGrid) {
    selectGrid.addEventListener('change', () => {
      selectedQuantizeGrid = selectGrid.value as QuantizeGrid;
    });
  }

  // 目標 Pad 變更
  if (selectTargetPad) {
    selectTargetPad.addEventListener('change', () => {
      currentRecordPadNum = parseInt(selectTargetPad.value, 10) || 1;
      updateBackingTrackOptionsUI(currentRecordPadNum);
      const applyBtnA = document.getElementById('btn-rec-apply');
      if (applyBtnA) {
        applyBtnA.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
      }
      const applyBtnB = document.getElementById('btn-step-apply');
      if (applyBtnB) {
        applyBtnB.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
      }
      const applyBtnBTop = document.getElementById('btn-step-top-apply');
      if (applyBtnBTop) {
        applyBtnBTop.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
      }
    });
  }

  // 長度小節變更 (Mode A)
  if (selectBars) {
    selectBars.addEventListener('change', () => {
      recordedBarsCount = parseInt(selectBars.value, 10) || 2;
    });
  }

  // 自動綁定音色開關
  const toggleAutoBind = document.getElementById('rec-toggle-autobind-voice');
  if (toggleAutoBind) {
    toggleAutoBind.addEventListener('click', () => {
      isAutoBindVoiceEnabled = !isAutoBindVoiceEnabled;
      toggleAutoBind.className = `toggle-btn ${isAutoBindVoiceEnabled ? 'active-cm' : 'inactive'}`;
      toggleAutoBind.textContent = isAutoBindVoiceEnabled ? '🔗 自動綁定音色: 開' : '🔒 自動綁定音色: 關';
      showStatus(isAutoBindVoiceEnabled ? '已啟用：寫入 Pad 時將自動綁定琴端音色與圖標' : '已關閉自動綁定音色 (僅寫入音符)');
    });
  }

  // 2.8-A: 疊錄伴奏下拉切換監聽
  const backingSelect = document.getElementById('rec-backing-track-select') as HTMLSelectElement | null;
  const backingHint = document.getElementById('rec-backing-status-hint');
  if (backingSelect) {
    backingSelect.addEventListener('change', () => {
      selectedBackingOption = backingSelect.value;
      if (backingHint) {
        if (selectedBackingOption === 'none') {
          backingHint.textContent = '未啟用伴奏';
          backingHint.style.color = '#94a3b8';
        } else if (selectedBackingOption === 'all') {
          backingHint.textContent = '伴奏: 全軌混音';
          backingHint.style.color = '#c4b5fd';
        } else {
          backingHint.textContent = `伴奏: PAD ${selectedBackingOption}`;
          backingHint.style.color = '#a78bfa';
        }
      }
    });
  }

  // 2.8-A: 疊錄伴奏音量滑桿監聽
  const backingVolSlider = document.getElementById('rec-backing-vol') as HTMLInputElement | null;
  const backingVolLabel = document.getElementById('rec-backing-vol-label');
  if (backingVolSlider) {
    backingVolSlider.addEventListener('input', () => {
      const val = parseInt(backingVolSlider.value, 10);
      backingVolumeRatio = Math.max(0, Math.min(100, val)) / 100;
      if (backingVolLabel) backingVolLabel.textContent = `${val}%`;
      audioEngine.setBackingVolume(backingVolumeRatio);
    });
  }

  // 2.8-A: 含伴奏試聽切換按鈕監聽
  const toggleBackingPreview = document.getElementById('btn-toggle-backing-preview');
  if (toggleBackingPreview) {
    toggleBackingPreview.addEventListener('click', () => {
      isBackingPreviewEnabled = !isBackingPreviewEnabled;
      toggleBackingPreview.className = `toggle-btn ${isBackingPreviewEnabled ? 'active-rp' : 'inactive'}`;
      toggleBackingPreview.textContent = isBackingPreviewEnabled ? '🎧 含伴奏試聽: 開' : '🎧 含伴奏試聽: 關';
    });
  }

  // 模擬/指定琴端切換音色選單
  const simVoiceSelect = document.getElementById('rec-sim-voice-select') as HTMLSelectElement | null;
  if (simVoiceSelect) {
    simVoiceSelect.addEventListener('change', () => {
      const val = simVoiceSelect.value;
      if (!val) return;
      const v = YAMAHA_SX920_VOICES.find(item => item.name === val || item.name.toLowerCase().includes(val.toLowerCase())) || searchYamahaVoices(val)[0];
      if (v) {
        midiManager.simulateVoiceChange({ msb: v.msb, lsb: v.lsb, pc: v.pc }, currentRecordPadNum - 1);
        midiManager.sendVoiceChange(currentRecordPadNum - 1, { msb: v.msb, lsb: v.lsb, pc: v.pc });
        showStatus(`已指定錄音音色: ${v.name} (${v.chineseName}) [Bank ${v.msb}-${v.lsb}, PC ${v.pc}]`);
      }
      simVoiceSelect.value = '';
    });
  }

  // 錄音彈窗內的音色庫搜尋按鈕
  const btnRecOpenVoice = document.getElementById('btn-rec-open-voice-modal');
  if (btnRecOpenVoice) {
    btnRecOpenVoice.addEventListener('click', () => {
      openVoiceModal(currentRecordPadNum);
    });
  }

  // 渲染虛擬鋼琴琴鍵
  renderVirtualPianoKeys();

  // 電腦鍵盤演奏與控制監聽 (支援錄音視窗與畫布手彈步進)
  window.addEventListener('keydown', (e) => {
    const isModalOpen = modal && modal.style.display !== 'none';
    if (!isModalOpen && !isCanvasStepInputActive) return;
    if (e.repeat) return; // 忽略作業系統長按自動連發，防止重複重疊發聲
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    // 畫布步進專屬快捷鍵 (當錄音彈窗關閉且畫布步進開啟時)
    if (!isModalOpen && isCanvasStepInputActive) {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        canvasStepRecorder.insertRest();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleCanvasStepBack();
        return;
      }
      if (e.key === '+' || e.key === '=' || ((e.key === 't' || e.key === 'T') && (e.ctrlKey || e.altKey || e.shiftKey))) {
        e.preventDefault();
        handleCanvasStepTie();
        return;
      }
    }

    // 模式 B 快捷鍵：Space 插入休止符, Backspace 撤銷, +/=/Shift+T 延長前音 (Tie)
    if (isModalOpen && activeRecordMode === 'B') {
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        stepRecorder.insertRest();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        stepRecorder.stepBack();
        return;
      }
      if (e.key === '+' || e.key === '=' || ((e.key === 't' || e.key === 'T') && (e.ctrlKey || e.altKey || e.shiftKey))) {
        e.preventDefault();
        stepRecorder.tiePreviousNote();
        return;
      }
    }

    const key = e.key.toLowerCase();
    if (activeSimKeys.has(key)) return;
    const match = PIANO_KEY_MAP.find(k => k.charKey === key);
    if (match) {
      e.preventDefault();
      activeSimKeys.add(key);
      midiManager.simulateNoteOn(match.pitch, 100);
    }
  });

  window.addEventListener('keyup', (e) => {
    const isModalOpen = modal && modal.style.display !== 'none';
    if (!isModalOpen && !isCanvasStepInputActive) return;
    const key = e.key.toLowerCase();
    if (activeSimKeys.has(key)) {
      activeSimKeys.delete(key);
      const match = PIANO_KEY_MAP.find(k => k.charKey === key);
      if (match) {
        midiManager.simulateNoteOff(match.pitch);
      }
    }
  });
}

function renderVirtualPianoKeys() {
  const container = document.getElementById('sim-piano-keys');
  if (!container || container.children.length > 0) return;

  const whiteKeys = PIANO_KEY_MAP.filter(k => !k.isBlack);
  const blackKeys = PIANO_KEY_MAP.filter(k => k.isBlack);

  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.position = 'relative';

  whiteKeys.forEach(k => {
    const el = document.createElement('div');
    el.className = 'sim-key-white';
    el.dataset.pitch = String(k.pitch);
    el.dataset.key = k.charKey;
    el.innerHTML = `
      <span class="key-note">${k.noteName}</span>
      <span class="key-hint">[${k.charKey.toUpperCase()}]</span>
    `;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      midiManager.simulateNoteOn(k.pitch, 100);
    });
    el.addEventListener('mouseup', () => midiManager.simulateNoteOff(k.pitch));
    el.addEventListener('mouseleave', () => midiManager.simulateNoteOff(k.pitch));
    wrapper.appendChild(el);
  });

  blackKeys.forEach(k => {
    const el = document.createElement('div');
    el.className = 'sim-key-black';
    el.dataset.pitch = String(k.pitch);
    el.dataset.key = k.charKey;
    if (k.leftOffset !== undefined) {
      el.style.left = `${k.leftOffset}px`;
    }
    el.innerHTML = `
      <span class="key-note">${k.noteName}</span>
      <span class="key-hint">[${k.charKey.toUpperCase()}]</span>
    `;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      midiManager.simulateNoteOn(k.pitch, 100);
    });
    el.addEventListener('mouseup', () => midiManager.simulateNoteOff(k.pitch));
    el.addEventListener('mouseleave', () => midiManager.simulateNoteOff(k.pitch));
    wrapper.appendChild(el);
  });

  container.appendChild(wrapper);
}

function getPadVoiceConfig(parsed: YamahaFileParsed, padNum: number): { msb: number; lsb: number; pc: number } | null {
  const track = parsed.tracks[padNum];
  if (!track || !track.events) return null;
  let msb: number | undefined;
  let lsb: number | undefined;
  let pc: number | undefined;
  for (const ev of track.events) {
    if (ev.type === 'controlChange') {
      if (ev.controller === 0 && ev.value !== undefined) msb = ev.value;
      if (ev.controller === 32 && ev.value !== undefined) lsb = ev.value;
    }
    if (ev.type === 'programChange' && ev.program !== undefined) {
      pc = ev.program;
    }
  }
  if (msb !== undefined || pc !== undefined) {
    return { msb: msb ?? 0, lsb: lsb ?? 0, pc: pc ?? 0 };
  }
  return null;
}

/**
 * 2.8-A 提取單一 Pad 之疊錄伴奏音軌資訊 (音符、音色、混音、循環長度)
 */
function getPadBackingTrackItem(padNum: number): BackingTrackItem | null {
  if (!currentParsed) return null;
  const track = currentParsed.tracks[padNum];
  if (!track) return null;

  const notes = extractTrackNotes(track);
  if (notes.length === 0) return null;

  let currentPc = 0;
  let currentMsb = 0;
  let currentLsb = 0;
  let volume = 100;
  let pan = 64;
  let reverb = 40;
  let chorus = 0;

  for (const ev of track.events) {
    if (ev.type === 'programChange' && ev.program !== undefined) currentPc = ev.program;
    if (ev.type === 'controlChange') {
      if (ev.controller === 0 && ev.value !== undefined) currentMsb = ev.value;
      if (ev.controller === 32 && ev.value !== undefined) currentLsb = ev.value;
      if (ev.controller === 7 && ev.value !== undefined) volume = ev.value;
      if (ev.controller === 10 && ev.value !== undefined) pan = ev.value;
      if (ev.controller === 91 && ev.value !== undefined) reverb = ev.value;
      if (ev.controller === 93 && ev.value !== undefined) chorus = ev.value;
    }
  }

  const matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb) && (currentLsb === 0 || i.lsb === currentLsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc);
  const instrumentId = matchedInst ? matchedInst.id : 'grand-piano';

  const division = currentParsed.division || 480;
  const beatsPerBar = currentParsed.timeSignature?.numerator || 4;
  const ticksPerBar = division * beatsPerBar;
  const padBars = YamahaPadModifier.getPadBarLength(currentParsed, padNum);
  const totalTicks = Math.max(1, padBars) * ticksPerBar;

  return {
    padNum,
    notes,
    totalTicks,
    channelParams: {
      volume,
      pan,
      reverb,
      chorus,
      instrumentId,
      msb: currentMsb,
      lsb: currentLsb,
      pc: currentPc,
      channel: padNum - 1,
    }
  };
}

/**
 * 2.8-A 依使用者選擇提取所有伴奏音軌項目
 */
function getSelectedBackingTrackItems(option: string, excludePadNum: number): BackingTrackItem[] {
  if (option === 'none' || !currentParsed) return [];

  if (option === 'all') {
    const items: BackingTrackItem[] = [];
    for (let p = 1; p <= 4; p++) {
      if (p !== excludePadNum) {
        const item = getPadBackingTrackItem(p);
        if (item) items.push(item);
      }
    }
    return items;
  }

  const targetPad = parseInt(option, 10);
  if (!isNaN(targetPad) && targetPad >= 1 && targetPad <= 4 && targetPad !== excludePadNum) {
    const item = getPadBackingTrackItem(targetPad);
    return item ? [item] : [];
  }

  return [];
}

/**
 * 2.8-A 動態更新伴奏選單下拉項目與狀態標籤
 */
function updateBackingTrackOptionsUI(excludePadNum: number) {
  const select = document.getElementById('rec-backing-track-select') as HTMLSelectElement | null;
  const hintEl = document.getElementById('rec-backing-status-hint');
  if (!select) return;

  const prevValue = select.value || selectedBackingOption;
  select.innerHTML = '';

  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = '無 (不播放伴奏)';
  select.appendChild(noneOpt);

  const availablePads: Array<{ padNum: number; voiceName: string; bars: number; notesCount: number }> = [];

  if (currentParsed) {
    for (let p = 1; p <= 4; p++) {
      if (p === excludePadNum) continue;
      const track = currentParsed.tracks[p];
      if (!track) continue;
      const notes = extractTrackNotes(track);
      if (notes.length === 0) continue;

      const padVoice = getPadVoiceConfig(currentParsed, p);
      let vName = 'Piano';
      if (padVoice) {
        const found = findYamahaVoice(padVoice.msb, padVoice.lsb, padVoice.pc);
        vName = found?.chineseName || found?.name || `Bank ${padVoice.msb}-${padVoice.lsb}`;
      }
      const bars = YamahaPadModifier.getPadBarLength(currentParsed, p);
      availablePads.push({ padNum: p, voiceName: vName, bars, notesCount: notes.length });
    }
  }

  if (availablePads.length > 1) {
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = `所有已錄製 Pads (${availablePads.map(ap => `Pad ${ap.padNum}`).join('+')} 混音)`;
    select.appendChild(allOpt);
  }

  for (const ap of availablePads) {
    const opt = document.createElement('option');
    opt.value = String(ap.padNum);
    opt.textContent = `PAD ${ap.padNum} (${ap.voiceName} - ${ap.bars} 小節 / ${ap.notesCount} 音)`;
    select.appendChild(opt);
  }

  // 自動智慧選擇：若先前的選擇在可選項中則沿用；否則若只有1個有內容的Pad且先前非明確選none，自動選該Pad
  let chosenValue = 'none';
  const validValues = Array.from(select.options).map(o => o.value);
  if (validValues.includes(prevValue)) {
    chosenValue = prevValue;
  } else if (availablePads.length === 1 && prevValue !== 'none') {
    chosenValue = String(availablePads[0].padNum);
  }

  select.value = chosenValue;
  selectedBackingOption = chosenValue;

  // 更新提示標籤
  if (hintEl) {
    if (chosenValue === 'none') {
      hintEl.textContent = '未啟用伴奏';
      hintEl.style.color = '#94a3b8';
    } else if (chosenValue === 'all') {
      hintEl.textContent = `伴奏: 全軌混音 (${availablePads.length} 個 Pad)`;
      hintEl.style.color = '#c4b5fd';
    } else {
      const match = availablePads.find(ap => String(ap.padNum) === chosenValue);
      hintEl.textContent = match ? `伴奏: PAD ${match.padNum} (${match.voiceName})` : `伴奏: PAD ${chosenValue}`;
      hintEl.style.color = '#a78bfa';
    }
  }
}

function openRecordModal(padNum: number = 1) {
  initPadRecordModal();
  const modal = document.getElementById('pad-record-modal');
  if (!modal) return;

  currentRecordPadNum = padNum;
  recordedNotesBuffer = [];

  // 目標 Pad 設定
  const selectTargetPad = document.getElementById('rec-target-pad-select') as HTMLSelectElement | null;
  if (selectTargetPad) selectTargetPad.value = String(padNum);

  // 2.8-A: 動態刷新伴奏音軌選單 (排除當前錄音 Pad)
  updateBackingTrackOptionsUI(padNum);

  // 速度同步
  const bpmInput = document.getElementById('rec-bpm-input') as HTMLInputElement | null;
  if (bpmInput) {
    bpmInput.value = String(currentParsed?.bpm || 120);
  }

  // 小節數同步
  const selectBars = document.getElementById('rec-bars-select') as HTMLSelectElement | null;
  if (selectBars) {
    const existingBars = currentParsed ? YamahaPadModifier.getPadBarLength(currentParsed, padNum) : 2;
    const matchedOpt = [1, 2, 4, 8].includes(existingBars) ? existingBars : 2;
    selectBars.value = String(matchedOpt);
    recordedBarsCount = matchedOpt;

    const stepBarsSelect = document.getElementById('step-bars-select') as HTMLSelectElement | null;
    if (stepBarsSelect) {
      stepBarsSelect.value = String(matchedOpt);
      stepTargetBars = matchedOpt;
    }
  }

  const applyBtnA = document.getElementById('btn-rec-apply');
  if (applyBtnA) {
    applyBtnA.textContent = `💾 寫入 Pad ${padNum}`;
  }
  const applyBtnB = document.getElementById('btn-step-apply');
  if (applyBtnB) {
    applyBtnB.textContent = `💾 寫入 Pad ${padNum}`;
  }
  const applyBtnBTop = document.getElementById('btn-step-top-apply');
  if (applyBtnBTop) {
    applyBtnBTop.textContent = `💾 寫入 Pad ${padNum}`;
  }

  // 重置 Mode B 步進狀態
  stepRecorder.reset();
  updateModeBStepUI();
  updateModeBPositionUI(stepRecorder.getPosition());

  // 重置 UI 狀態
  resetRecorderUI();

  // 嗅探音色狀態同步 (若目標 Pad 已有音色，優先載入顯示；否則提示待命中)
  const snifferLabel = document.getElementById('rec-voice-sniffer-label');
  const simVoiceSelect = document.getElementById('rec-sim-voice-select') as HTMLSelectElement | null;
  if (simVoiceSelect) simVoiceSelect.value = '';

  if (currentParsed) {
    const padVoice = getPadVoiceConfig(currentParsed, padNum);
    if (padVoice) {
      const existingV = findYamahaVoice(padVoice.msb, padVoice.lsb, padVoice.pc);
      lastSniffedRawConfig = { msb: padVoice.msb, lsb: padVoice.lsb, pc: padVoice.pc };
      lastSniffedVoice = existingV || null;
      if (snifferLabel) {
        if (existingV) {
          snifferLabel.textContent = `${existingV.name} (${existingV.chineseName || ''}) [現有]`;
        } else {
          snifferLabel.textContent = `Bank ${padVoice.msb}-${padVoice.lsb} PC ${padVoice.pc} [現有]`;
        }
        snifferLabel.style.color = '#94a3b8';
      }
    } else {
      lastSniffedVoice = null;
      lastSniffedRawConfig = null;
      if (snifferLabel) {
        snifferLabel.textContent = '--- (未偵測到)';
        snifferLabel.style.color = '#94a3b8';
      }
    }
  }

  // 掃描 MIDI 設備
  midiManager.requestAccess().then(() => {
    updateMidiDeviceStatusUI();
  }).catch(() => {
    updateMidiDeviceStatusUI();
  });

  // 綁定 MIDI 訊息監聽器
  bindRecordMidiListeners();

  modal.style.display = 'flex';
}

function updateMidiDeviceStatusUI() {
  const label = document.getElementById('rec-midi-device-label');
  const toggleMonitor = document.getElementById('rec-toggle-monitor');
  if (!label) return;
  const inDev = midiManager.getSelectedInput();
  if (inDev) {
    label.textContent = `🟢 ${inDev.name}`;
    label.style.color = '#34d399';
    // 實體琴已連線：預設關閉電腦即時監聽，享受琴端原廠音色零延遲，並徹底防止 USB Audio 雙重發聲疊音
    isAudioMonitorEnabled = false;
    if (toggleMonitor) {
      toggleMonitor.className = 'toggle-btn inactive';
      toggleMonitor.textContent = '🔇 電腦監聽: 關';
    }
  } else {
    label.textContent = '⚪ 未連線 (已啟用電腦鍵盤模擬)';
    label.style.color = '#94a3b8';
    // 無實體琴時啟用電腦發聲模擬
    isAudioMonitorEnabled = true;
    if (toggleMonitor) {
      toggleMonitor.className = 'toggle-btn active-rp';
      toggleMonitor.textContent = '🔊 電腦監聽: 開';
    }
  }
}

function bindRecordMidiListeners() {
  // 清理舊的監聽
  recordMidiUnsubs.forEach(un => un());
  recordMidiUnsubs = [];

  // 1. Note 事件監聽
  const unNote = midiManager.onNoteInput((type, pitch, velocity) => {
    const keyEl = document.querySelector(`#sim-piano-keys [data-pitch="${pitch}"]`);
    if (type === 'noteon') {
      if (keyEl) keyEl.classList.add('active');
      if (activeRecordMode === 'A') {
        if (padRecorder.getState() === 'recording') {
          padRecorder.handleNoteOn(pitch, velocity);
          const countLabel = document.getElementById('rec-notes-counter-label');
          if (countLabel) {
            countLabel.textContent = `已捕捉 ${padRecorder.getRecordedNotes().length + 1} 個音符`;
          }
        }
      } else {
        stepRecorder.handleNoteOn(pitch, velocity);
      }
      // 即時發聲監聽 (若有啟用電腦監聽)
      if (isAudioMonitorEnabled) {
        audioEngine.playAuditionNote(pitch, 0.35, { volume: Math.min(127, Math.max(30, velocity)) });
      }
    } else {
      if (keyEl) keyEl.classList.remove('active');
      if (activeRecordMode === 'A') {
        if (padRecorder.getState() === 'recording') {
          padRecorder.handleNoteOff(pitch);
        }
      } else {
        stepRecorder.handleNoteOff(pitch);
      }
    }
  });
  recordMidiUnsubs.push(unNote);

  // 2. 音色嗅探監聽 (Voice Sniffer)
  const unVoice = midiManager.onVoiceInput((config) => {
    lastSniffedRawConfig = { msb: config.msb, lsb: config.lsb, pc: config.pc };
    lastSniffedVoice = findYamahaVoice(config.msb, config.lsb, config.pc) || null;
    const snifferLabel = document.getElementById('rec-voice-sniffer-label');
    if (snifferLabel) {
      if (lastSniffedVoice) {
        snifferLabel.textContent = `${lastSniffedVoice.name} (${lastSniffedVoice.chineseName || ''})`;
        snifferLabel.style.color = '#38bdf8';
      } else {
        snifferLabel.textContent = `Bank ${config.msb}-${config.lsb} PC ${config.pc}`;
        snifferLabel.style.color = '#fbbf24';
      }
    }
  });
  recordMidiUnsubs.push(unVoice);

  // 3. 活動指示燈監聽
  const unAct = midiManager.onMidiActivity(() => {
    const led = document.getElementById('rec-midi-activity-led');
    if (led) {
      led.classList.add('active');
      setTimeout(() => led.classList.remove('active'), 90);
    }
  });
  recordMidiUnsubs.push(unAct);
}

function resetRecorderUI() {
  const badge = document.getElementById('rec-status-badge');
  const textEl = document.getElementById('rec-status-text');
  const progBar = document.getElementById('rec-progress-bar');
  const barBeatLabel = document.getElementById('rec-bar-beat-label');
  const counterLabel = document.getElementById('rec-notes-counter-label');
  const actionBtn = document.getElementById('btn-rec-action') as HTMLButtonElement | null;
  const previewBtn = document.getElementById('btn-rec-preview') as HTMLButtonElement | null;
  const applyBtn = document.getElementById('btn-rec-apply') as HTMLButtonElement | null;
  const summaryEl = document.getElementById('rec-summary-text');

  if (badge) badge.className = 'rec-status-badge status-idle';
  if (textEl) textEl.textContent = '待命中 (請點擊下方開始錄音)';
  if (progBar) progBar.style.width = '0%';
  if (barBeatLabel) barBeatLabel.textContent = '小節 -- / --';
  if (counterLabel) counterLabel.textContent = '已捕捉 0 個音符';

  if (actionBtn) {
    actionBtn.className = 'btn btn-record-primary';
    actionBtn.textContent = isCountInEnabled ? '🔴 開始錄音 (1小節預備拍)' : '🔴 開始錄音 (無預備拍)';
  }
  if (previewBtn) previewBtn.style.display = 'none';
  if (applyBtn) applyBtn.style.display = 'none';
  if (summaryEl) summaryEl.textContent = '等待開始錄音...';

  // 清除燈號
  document.querySelectorAll('.beat-lamp').forEach(l => l.classList.remove('active-downbeat', 'active-weak'));
}

function closeRecordModal() {
  const modal = document.getElementById('pad-record-modal');
  if (modal) modal.style.display = 'none';

  padRecorder.stop();
  stepRecorder.reset();
  audioEngine.stop();
  audioEngine.stopBackingTrack();

  // 清除所有虛擬鋼琴按壓狀態
  document.querySelectorAll('#sim-piano-keys .active').forEach(el => el.classList.remove('active'));
  activeSimKeys.clear();

  recordMidiUnsubs.forEach(un => un());
  recordMidiUnsubs = [];
}

// ==========================================
// Mode B (單步步進輸入) 核心 UI 控制函式群
// ==========================================

function switchRecordMode(mode: 'A' | 'B') {
  activeRecordMode = mode;

  const tabA = document.getElementById('tab-btn-mode-a');
  const tabB = document.getElementById('tab-btn-mode-b');
  const panelA = document.getElementById('rec-mode-a-panel');
  const panelB = document.getElementById('rec-mode-b-panel');
  const actionsA = document.getElementById('rec-mode-a-actions');
  const actionsB = document.getElementById('rec-mode-b-actions');
  const subtitle = document.getElementById('rec-modal-subtitle');

  if (mode === 'A') {
    if (tabA) tabA.classList.add('active');
    if (tabB) tabB.classList.remove('active');
    if (panelA) panelA.style.display = 'block';
    if (panelB) panelB.style.display = 'none';
    if (actionsA) actionsA.style.display = 'flex';
    if (actionsB) actionsB.style.display = 'none';
    if (subtitle) {
      subtitle.textContent = '模式 A：即時節拍器錄音與智慧量化對齊 (支援實體鍵盤 USB-MIDI 與電腦鍵盤模擬)';
    }
  } else {
    // Mode B: 若正在進行即時錄音則停止
    if (padRecorder.getState() === 'recording' || padRecorder.getState() === 'countingIn') {
      stopLiveRecording();
    }
    if (tabA) tabA.classList.remove('active');
    if (tabB) tabB.classList.add('active');
    if (panelA) panelA.style.display = 'none';
    if (panelB) panelB.style.display = 'block';
    if (actionsA) actionsA.style.display = 'none';
    if (actionsB) actionsB.style.display = 'flex';
    if (subtitle) {
      subtitle.textContent = '模式 B：單步步進輸入與和弦辨識 (依自身節奏輸入，支援休止符、延音 Tie 與單步撤銷)';
    }

    updateModeBStepUI();
    updateModeBPositionUI(stepRecorder.getPosition());
    const stepApply = document.getElementById('btn-step-apply');
    if (stepApply) {
      stepApply.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
    }
    const stepTopApply = document.getElementById('btn-step-top-apply');
    if (stepTopApply) {
      stepTopApply.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
    }
  }
}

function updateModeBStepUI(entry?: StepRecordEntry, _currentTick?: number) {
  const chordBadge = document.getElementById('step-chord-badge');
  const summaryBadge = document.getElementById('step-count-summary');
  const history = stepRecorder.getHistory();
  const allNotes = stepRecorder.getAllNoteEvents();

  if (chordBadge) {
    if (!entry) {
      chordBadge.textContent = '♪ 最新輸入: 等待彈入...';
    } else if (entry.type === 'rest') {
      chordBadge.textContent = '♪ 最新輸入: ⏩ 休止符 (Rest)';
    } else {
      const chordName = entry.chordName || '音符';
      const pitchNames = entry.notes.map(n => StepRecorder.noteNumberToName(n.note)).join(' + ');
      chordBadge.textContent = `♪ 最新輸入: ${chordName} (${pitchNames})`;
    }
  }

  if (summaryBadge) {
    summaryBadge.textContent = `${history.length} 筆步進 (共 ${allNotes.length} 顆音符)`;
  }

  renderStepHistoryRoll();
}

function updateModeBPositionUI(pos?: { bar: number; beat: number; subBeat: number; tick: number; label: string }) {
  const currentPos = pos || stepRecorder.getPosition();
  const posBadge = document.getElementById('step-position-badge');
  if (posBadge) {
    posBadge.textContent = `📍 游標: ${currentPos.label} (Tick ${currentPos.tick})`;
  }
  renderStepHistoryRoll();
}

function renderStepHistoryRoll() {
  const rollContainer = document.getElementById('step-history-roll');
  if (!rollContainer) return;

  const history = stepRecorder.getHistory();
  rollContainer.innerHTML = '';

  history.forEach((entry) => {
    const card = document.createElement('div');
    const pos = stepRecorder.getPosition(entry.startTick);

    if (entry.type === 'rest') {
      card.className = 'step-card rest';
      card.innerHTML = `
        <span class="step-card-tick">${pos.bar}.${pos.beat}</span>
        <span class="step-card-text" style="color: #94a3b8;">休止</span>
        <span class="step-card-dur">${entry.durationTick}t</span>
      `;
    } else {
      const isTied = entry.durationTick > stepRecorder.getStepTicks();
      card.className = `step-card notes ${isTied ? 'tied' : ''}`;
      const chordTitle = entry.chordName || entry.notes.map(n => StepRecorder.noteNumberToName(n.note)).join('/');
      card.innerHTML = `
        <span class="step-card-tick">${pos.bar}.${pos.beat}</span>
        <span class="step-card-text">${chordTitle}</span>
        <span class="step-card-dur">${entry.durationTick}t${isTied ? ' (Tie)' : ''}</span>
      `;
    }
    rollContainer.appendChild(card);
  });

  // 游標指示卡片
  const curPos = stepRecorder.getPosition();
  const cursorCard = document.createElement('div');
  cursorCard.className = 'step-card-cursor';
  cursorCard.innerHTML = `
    <span class="step-card-tick">📍 第 ${curPos.bar}.${curPos.beat} 拍</span>
    <span class="step-card-text">下一步</span>
  `;
  rollContainer.appendChild(cursorCard);

  // 自動水平平滑滾動到最右端
  rollContainer.scrollLeft = rollContainer.scrollWidth;
}

function previewStepRecordedNotes() {
  const notes = stepRecorder.getAllNoteEvents();
  if (notes.length === 0) {
    showStatus('目前尚無步進輸入音符可供試聽', true);
    return;
  }

  // 若目前正在試聽播放中，點擊可立即停止
  if (audioEngine.isPlaying() || audioEngine.isBackingTrackPlaying()) {
    audioEngine.stop();
    audioEngine.stopBackingTrack();
    showStatus('已停止試聽');
    return;
  }

  const bpmInput = document.getElementById('rec-bpm-input') as HTMLInputElement | null;
  const bpm = parseInt(bpmInput?.value || '120', 10) || 120;
  const totalTicks = stepTargetBars * 4 * 480;

  // 2.8-A: 若有開啟含伴奏試聽且選中了伴奏，同步啟動伴奏音軌
  if (isBackingPreviewEnabled && selectedBackingOption !== 'none') {
    const backingItems = getSelectedBackingTrackItems(selectedBackingOption, currentRecordPadNum);
    if (backingItems.length > 0) {
      audioEngine.startBackingTrack(backingItems, {
        bpm,
        division: 480,
        volumeRatio: backingVolumeRatio,
        loop: false,
      });
    }
  }

  const voiceCfg = lastSniffedRawConfig || (currentParsed ? getPadVoiceConfig(currentParsed, currentRecordPadNum) : null);
  const matched = voiceCfg ? (PRESET_INSTRUMENTS.find(i => i.pc === voiceCfg.pc && (voiceCfg.msb === 0 || i.msb === voiceCfg.msb)) || PRESET_INSTRUMENTS.find(i => i.pc === voiceCfg.pc)) : null;
  const instrumentId = matched ? matched.id : 'grand-piano';

  audioEngine.playSequence(currentRecordPadNum, notes, {
    bpm,
    division: 480,
    beatsPerBar: 4,
    loop: false,
    gridStartTick: 0,
    totalTicks,
    channelParams: {
      instrumentId,
      msb: voiceCfg?.msb ?? 0,
      lsb: voiceCfg?.lsb ?? 0,
      pc: voiceCfg?.pc ?? 0,
      channel: currentRecordPadNum - 1,
    },
    onEnded: () => {
      audioEngine.stopBackingTrack();
    },
  });
  showStatus(`🔊 正在試聽 Pad ${currentRecordPadNum} 步進錄入旋律 (${notes.length} 顆音符)...`);
}

/**
 * 將指定音色或 Bank/PC 設定綁定至 Pad (同步圖示、混音、實體琴、聲部混音表與卡片)
 */
function bindVoiceToPad(
  padNum: number,
  voiceOrConfig: YamahaVoice | { msb: number; lsb: number; pc: number; name?: string; icon?: string; suitability?: string; chineseName?: string },
  options?: { skipAudition?: boolean; skipConfirm?: boolean; logChange?: boolean }
): boolean {
  if (!currentParsed) return false;

  const voiceName = voiceOrConfig.name || `Bank ${voiceOrConfig.msb}-${voiceOrConfig.lsb} PC ${voiceOrConfig.pc}`;

  if (!options?.skipConfirm && voiceOrConfig.suitability === 'warning') {
    const confirmApply = window.confirm(
      `⚠️ 避坑提醒：\n音色「${voiceName}」屬於 Organ Flutes 拉桿音色。\nYamaha PSR-SX920 琴端僅支援右手現場演奏此類即時拉桿音色，在 Multi Pad 序列中播放可能無聲音或不支援！\n\n確定仍要套用至 Pad ${padNum} 嗎？`
    );
    if (!confirmApply) return false;
  }

  // 1. 若有 Yamaha 圖示代碼 (I1~I4)，更新 Track 0
  if (voiceOrConfig.icon) {
    YamahaPadModifier.setPadIcon(currentParsed, padNum, voiceOrConfig.icon);
  }

  // 2. 更新 Track 混音 Bank MSB, Bank LSB, Program Change
  YamahaPadModifier.setPadMixing(currentParsed, padNum, {
    bankMsb: voiceOrConfig.msb,
    bankLsb: voiceOrConfig.lsb,
    programChange: voiceOrConfig.pc,
  });

  // 3. 實體琴即時同步原廠音色
  midiManager.sendVoiceChange(padNum - 1, {
    msb: voiceOrConfig.msb,
    lsb: voiceOrConfig.lsb,
    pc: voiceOrConfig.pc,
  });

  // 4. 同步下方表格與卡片輸入框
  updatePartsTableRowVoice(padNum, voiceOrConfig.msb, voiceOrConfig.lsb, voiceOrConfig.pc);
  updatePadCardInstrumentSelect(padNum, voiceOrConfig.msb, voiceOrConfig.lsb, voiceOrConfig.pc);

  // 4.5 若此 Pad 正在錄音工作台編輯中，同步更新錄音工作台的音色狀態
  if (currentRecordPadNum === padNum) {
    lastSniffedRawConfig = { msb: voiceOrConfig.msb, lsb: voiceOrConfig.lsb, pc: voiceOrConfig.pc };
    const yvSniff = (voiceOrConfig as YamahaVoice).category ? (voiceOrConfig as YamahaVoice) : findYamahaVoice(voiceOrConfig.msb, voiceOrConfig.lsb, voiceOrConfig.pc);
    lastSniffedVoice = yvSniff || null;
    const snifferLabel = document.getElementById('rec-voice-sniffer-label');
    if (snifferLabel) {
      if (yvSniff) {
        snifferLabel.textContent = `${yvSniff.name} (${yvSniff.chineseName || ''})`;
        snifferLabel.style.color = '#38bdf8';
      } else {
        snifferLabel.textContent = `Bank ${voiceOrConfig.msb}-${voiceOrConfig.lsb} PC ${voiceOrConfig.pc}`;
        snifferLabel.style.color = '#fbbf24';
      }
    }
  }

  // 5. 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
  if (currentActivePadNum === padNum) {
    const sec = currentParsed.sections[padNum - 1];
    const nameInput = document.querySelector(`.pad-card-${padNum} .pad-name-input`) as HTMLInputElement | null;
    const currentName = nameInput ? nameInput.value : `Pad ${padNum}`;
    if (sec) showPadNotesDetail(currentParsed, sec, currentName, padNum);
  }

  // 6. 試聽 (可選)
  if (!options?.skipAudition) {
    const yv = (voiceOrConfig as YamahaVoice).category ? (voiceOrConfig as YamahaVoice) : findYamahaVoice(voiceOrConfig.msb, voiceOrConfig.lsb, voiceOrConfig.pc);
    if (yv) auditionSingleVoice(yv);
  }

  // 7. 變更紀錄 (可選)
  if (options?.logChange) {
    markModified(`Pad ${padNum} 音色已設定為: ${voiceName} [Bank ${voiceOrConfig.msb}-${voiceOrConfig.lsb}, PC ${voiceOrConfig.pc}]`);
  }

  return true;
}

function applyStepRecordedNotes() {
  if (!currentParsed) {
    showStatus('請先載入或建立 Yamaha PAD 專案', true);
    return;
  }

  const notes = stepRecorder.getAllNoteEvents();
  if (notes.length === 0) {
    showStatus('步進錄音為空，請先輸入音符或和弦', true);
    return;
  }

  const success = YamahaPadModifier.replacePadNotes(
    currentParsed,
    currentRecordPadNum,
    notes,
    stepTargetBars
  );

  if (success) {
    let boundVoiceDesc = '';
    if (isAutoBindVoiceEnabled && (lastSniffedVoice || lastSniffedRawConfig)) {
      const v = lastSniffedVoice || lastSniffedRawConfig!;
      bindVoiceToPad(currentRecordPadNum, v, { skipAudition: true, skipConfirm: true, logChange: false });
      boundVoiceDesc = lastSniffedVoice ? ` (同步綁定音色: ${lastSniffedVoice.name})` : ` (同步綁定音色 Bank ${lastSniffedRawConfig!.msb}-${lastSniffedRawConfig!.lsb})`;
    }

    markModified(`已將單步步進輸入 (${notes.length} 顆音符) 寫入 Pad ${currentRecordPadNum}${boundVoiceDesc}`);
    renderSections(currentParsed);
    if (currentCanvasPadNum === currentRecordPadNum) {
      refreshCurrentPadDetail();
    }
    showStatus(`✨ 成功將 ${notes.length} 顆步進錄入音符套用至 Pad ${currentRecordPadNum}${boundVoiceDesc}！`);
    closeRecordModal();
  } else {
    showStatus(`寫入 Pad ${currentRecordPadNum} 失敗，請檢查專案狀態`, true);
  }
}

function startLiveRecording() {
  const bpmInput = document.getElementById('rec-bpm-input') as HTMLInputElement | null;
  const selectBars = document.getElementById('rec-bars-select') as HTMLSelectElement | null;
  const actionBtn = document.getElementById('btn-rec-action') as HTMLButtonElement | null;
  const previewBtn = document.getElementById('btn-rec-preview') as HTMLButtonElement | null;
  const applyBtn = document.getElementById('btn-rec-apply') as HTMLButtonElement | null;
  const summaryEl = document.getElementById('rec-summary-text');

  const bpm = Math.max(30, Math.min(280, parseInt(bpmInput?.value || '120', 10) || 120));
  const bars = Math.max(1, Math.min(16, parseInt(selectBars?.value || '2', 10) || 2));
  recordedBarsCount = bars;
  recordedNotesBuffer = [];

  if (actionBtn) {
    actionBtn.className = 'btn btn-record-stop';
    actionBtn.textContent = '⏹ 停止錄音';
  }
  if (previewBtn) previewBtn.style.display = 'none';
  if (applyBtn) applyBtn.style.display = 'none';
  if (summaryEl) summaryEl.textContent = `錄音進行中 (長度: ${bars} 小節, 速度: ${bpm} BPM)...`;

  padRecorder.start({
    bpm,
    bars,
    countInBars: isCountInEnabled ? 1 : 0,
    isAutoQuantize: isAutoQuantizeEnabled,
    quantizeGrid: selectedQuantizeGrid,
    onTick: (info) => {
      // 1. 播放節拍器聲音 (強拍高音，弱拍低音)
      if (metronomeVolumeRatio > 0) {
        audioEngine.playMetronomeClick(info.isDownbeat, metronomeVolumeRatio);
      }

      // 2. 點亮對應節拍燈
      document.querySelectorAll('.beat-lamp').forEach(l => l.classList.remove('active-downbeat', 'active-weak'));
      const targetLamp = document.querySelector(`.beat-lamp-${info.beat}`);
      if (targetLamp) {
        targetLamp.classList.add(info.isDownbeat ? 'active-downbeat' : 'active-weak');
        setTimeout(() => {
          targetLamp.classList.remove('active-downbeat', 'active-weak');
        }, 180);
      }

      // 3. 更新標籤與進度條
      const badge = document.getElementById('rec-status-badge');
      const textEl = document.getElementById('rec-status-text');
      const barBeatLabel = document.getElementById('rec-bar-beat-label');
      const progBar = document.getElementById('rec-progress-bar');

      if (info.isCountIn) {
        if (badge) badge.className = 'rec-status-badge status-countin';
        if (textEl) textEl.textContent = `⏳ 預備拍倒數 (第 ${info.beat} 拍 / 共 4 拍)`;
        if (barBeatLabel) barBeatLabel.textContent = `預備拍倒數: 第 ${info.beat} 拍`;
      } else {
        if (badge) badge.className = 'rec-status-badge status-recording';
        if (textEl) textEl.textContent = `🔴 錄音中 (第 ${info.bar} 小節 / 第 ${info.beat} 拍)`;
        if (barBeatLabel) barBeatLabel.textContent = `錄製進度: 第 ${info.bar} / ${bars} 小節 (第 ${info.beat} 拍)`;
      }

      if (progBar) {
        progBar.style.width = `${(info.progress * 100).toFixed(1)}%`;
      }
    },
    onStateChange: (state) => {
      if (state === 'recording') {
        const badge = document.getElementById('rec-status-badge');
        if (badge) badge.className = 'rec-status-badge status-recording';

        // 2.8-A: 若有啟用疊錄伴奏，在真正錄音開始時啟動伴奏循環
        if (selectedBackingOption !== 'none') {
          const backingItems = getSelectedBackingTrackItems(selectedBackingOption, currentRecordPadNum);
          if (backingItems.length > 0) {
            audioEngine.startBackingTrack(backingItems, {
              bpm,
              division: currentParsed?.division || 480,
              volumeRatio: backingVolumeRatio,
              loop: true,
            });
          }
        }
      }
    },
    onFinish: (notes) => {
      finishLiveRecording(notes, bars);
    },
  });
}

function stopLiveRecording() {
  padRecorder.stop();
  audioEngine.stopBackingTrack();
}

function finishLiveRecording(notes: RecordedNote[], bars: number) {
  audioEngine.stopBackingTrack();
  recordedNotesBuffer = notes;
  const badge = document.getElementById('rec-status-badge');
  const textEl = document.getElementById('rec-status-text');
  const actionBtn = document.getElementById('btn-rec-action') as HTMLButtonElement | null;
  const previewBtn = document.getElementById('btn-rec-preview') as HTMLButtonElement | null;
  const applyBtn = document.getElementById('btn-rec-apply') as HTMLButtonElement | null;
  const summaryEl = document.getElementById('rec-summary-text');
  const progBar = document.getElementById('rec-progress-bar');
  const barBeatLabel = document.getElementById('rec-bar-beat-label');
  const counterLabel = document.getElementById('rec-notes-counter-label');

  if (badge) badge.className = 'rec-status-badge status-finished';
  if (textEl) textEl.textContent = `✅ 錄音完成 (共捕捉 ${notes.length} 顆音符)`;
  if (progBar) progBar.style.width = '100%';
  if (barBeatLabel) barBeatLabel.textContent = `錄製完畢 (共 ${bars} 小節)`;
  if (counterLabel) counterLabel.textContent = `已捕捉 ${notes.length} 個音符`;

  if (actionBtn) {
    actionBtn.className = 'btn btn-record-primary';
    actionBtn.textContent = '🔴 重新錄音';
  }
  if (previewBtn) previewBtn.style.display = 'inline-flex';
  if (applyBtn) {
    applyBtn.style.display = 'inline-flex';
    applyBtn.textContent = `💾 寫入 Pad ${currentRecordPadNum}`;
  }

  if (summaryEl) {
    const quantizeInfo = isAutoQuantizeEnabled ? `已智慧量化 (${selectedQuantizeGrid})` : '原始無量化';
    summaryEl.textContent = `共捕捉 ${notes.length} 顆音符 | 長度: ${bars} 小節 | ${quantizeInfo}`;
  }

  // 熄滅所有節拍燈
  document.querySelectorAll('.beat-lamp').forEach(l => l.classList.remove('active-downbeat', 'active-weak'));
}

function previewRecordedNotes() {
  if (recordedNotesBuffer.length === 0) {
    showStatus('目前尚無錄製音符可供試聽', true);
    return;
  }

  // 若目前正在試聽播放中，點擊可立即停止
  if (audioEngine.isPlaying() || audioEngine.isBackingTrackPlaying()) {
    audioEngine.stop();
    audioEngine.stopBackingTrack();
    showStatus('已停止試聽');
    return;
  }

  const bpmInput = document.getElementById('rec-bpm-input') as HTMLInputElement | null;
  const bpm = parseInt(bpmInput?.value || '120', 10) || 120;
  const noteEvents = PadRecorder.toNoteEvents(recordedNotesBuffer);
  const totalTicks = recordedBarsCount * 4 * 480;

  // 2.8-A: 若有開啟含伴奏試聽且選中了伴奏，同步啟動伴奏音軌
  if (isBackingPreviewEnabled && selectedBackingOption !== 'none') {
    const backingItems = getSelectedBackingTrackItems(selectedBackingOption, currentRecordPadNum);
    if (backingItems.length > 0) {
      audioEngine.startBackingTrack(backingItems, {
        bpm,
        division: 480,
        volumeRatio: backingVolumeRatio,
        loop: false,
      });
    }
  }

  const voiceCfg = lastSniffedRawConfig || (currentParsed ? getPadVoiceConfig(currentParsed, currentRecordPadNum) : null);
  const matched = voiceCfg ? (PRESET_INSTRUMENTS.find(i => i.pc === voiceCfg.pc && (voiceCfg.msb === 0 || i.msb === voiceCfg.msb)) || PRESET_INSTRUMENTS.find(i => i.pc === voiceCfg.pc)) : null;
  const instrumentId = matched ? matched.id : 'grand-piano';

  audioEngine.playSequence(currentRecordPadNum, noteEvents, {
    bpm,
    division: 480,
    beatsPerBar: 4,
    loop: false,
    gridStartTick: 0,
    totalTicks,
    channelParams: {
      instrumentId,
      msb: voiceCfg?.msb ?? 0,
      lsb: voiceCfg?.lsb ?? 0,
      pc: voiceCfg?.pc ?? 0,
      channel: currentRecordPadNum - 1,
    },
    onEnded: () => {
      audioEngine.stopBackingTrack();
    },
  });
}

function applyRecordedNotes() {
  if (!currentParsed) {
    showStatus('請先載入或建立 Yamaha PAD 專案', true);
    return;
  }

  if (recordedNotesBuffer.length === 0) {
    showStatus('錄製音符為空，請先進行錄音', true);
    return;
  }

  const noteEvents = PadRecorder.toNoteEvents(recordedNotesBuffer);
  const success = YamahaPadModifier.replacePadNotes(
    currentParsed,
    currentRecordPadNum,
    noteEvents,
    recordedBarsCount
  );

  if (success) {
    let boundVoiceDesc = '';
    if (isAutoBindVoiceEnabled && (lastSniffedVoice || lastSniffedRawConfig)) {
      const v = lastSniffedVoice || lastSniffedRawConfig!;
      bindVoiceToPad(currentRecordPadNum, v, { skipAudition: true, skipConfirm: true, logChange: false });
      boundVoiceDesc = lastSniffedVoice ? ` (同步綁定音色: ${lastSniffedVoice.name})` : ` (同步綁定音色 Bank ${lastSniffedRawConfig!.msb}-${lastSniffedRawConfig!.lsb})`;
    }

    markModified(`已將琴端即時錄音 (${noteEvents.length} 顆音符) 寫入 Pad ${currentRecordPadNum}${boundVoiceDesc}`);
    renderSections(currentParsed);
    if (currentCanvasPadNum === currentRecordPadNum) {
      refreshCurrentPadDetail();
    }
    showStatus(`✨ 成功將 ${noteEvents.length} 顆即時錄製音符套用至 Pad ${currentRecordPadNum}${boundVoiceDesc}！`);
    closeRecordModal();
  } else {
    showStatus(`寫入 Pad ${currentRecordPadNum} 失敗，請重試`, true);
  }
}

// ========================================================
// Phase 2.3: 外部標準 MIDI 匯入與切片分配精靈 (MIDI Import Wizard)
// ========================================================
let refreshMidiControlsUI: (devices?: MidiDeviceInfo[]) => void = () => {};
let currentMidiAnalysis: MidiSourceAnalysis | null = null;
let currentAuditioningTrackIndex: number | null = null;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function openMidiImportModal(bytes: Uint8Array, fileName: string) {
  const modal = document.getElementById('midi-import-modal');
  if (!modal) return;

  try {
    currentMidiAnalysis = MidiImporter.analyzeMidi(bytes, fileName);
  } catch (err: any) {
    alert(`解析 MIDI 檔案失敗: ${err.message}`);
    return;
  }

  // 1. 更新精靈標題資訊
  const subtitle = document.getElementById('midi-import-subtitle');
  if (subtitle) {
    subtitle.textContent = `來源檔案: ${fileName} | ${currentMidiAnalysis.division} PPQ | ${currentMidiAnalysis.bpm} BPM | ${currentMidiAnalysis.timeSignature.numerator}/${currentMidiAnalysis.timeSignature.denominator} 拍 | 共 ${currentMidiAnalysis.totalMeasures} 小節 (${currentMidiAnalysis.tracks.length} 音軌)`;
  }

  // 2. 設定專案名稱與速度預設值
  const projNameInput = document.getElementById('midi-import-proj-name') as HTMLInputElement | null;
  const bpmInput = document.getElementById('midi-import-bpm') as HTMLInputElement | null;
  if (projNameInput) {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    projNameInput.value = `${baseName} Pad`;
  }
  if (bpmInput) {
    bpmInput.value = `${currentMidiAnalysis.bpm}`;
  }

  // 3. 渲染左側來源軌道清單
  renderMidiSourceTracksList();

  // 4. 渲染右側 Pad 1~4 切片分配卡片 (預設智慧分配)
  renderPadAssignmentsGrid();

  // 5. 同步發聲路由與實體琴連線控制項
  refreshMidiControlsUI();

  // 6. 顯示彈窗
  modal.style.display = 'flex';
}

function closeMidiImportModal() {
  const modal = document.getElementById('midi-import-modal');
  if (modal) modal.style.display = 'none';

  // 停止正在試聽的音軌
  if (currentAuditioningTrackIndex !== null) {
    audioEngine.stop();
    currentAuditioningTrackIndex = null;
  }

  // 同步更新記憶體中已載入 MIDI 快速喚回狀態
  updateResumeMidiUI();
}

function renderMidiSourceTracksList() {
  const container = document.getElementById('midi-source-tracks-list');
  const badge = document.getElementById('midi-tracks-summary-badge');
  if (!container || !currentMidiAnalysis) return;

  if (badge) {
    badge.textContent = `${currentMidiAnalysis.tracks.length} 軌`;
  }

  container.innerHTML = '';
  currentMidiAnalysis.tracks.forEach((track) => {
    const card = document.createElement('div');
    card.className = 'midi-source-track-item';
    card.style.cssText = 'background: #181b24; border: 1px solid #2d3240; border-radius: 6px; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;';

    const hasNotes = track.noteCount > 0;
    const isAuditioning = currentAuditioningTrackIndex === track.trackIndex;

    card.innerHTML = `
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 0.84rem; font-weight: 600; color: ${hasNotes ? '#f1f5f9' : '#64748b'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          <span style="color: #38bdf8;">[軌道 ${track.trackIndex + 1}]</span> ${escapeHtml(track.name)}
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; display: flex; gap: 8px; margin-top: 2px; flex-wrap: wrap;">
          <span>Ch ${track.channel + 1}</span>
          <span>音符: ${track.noteCount} 顆</span>
          <span>長度: ${track.measureCount} 小節</span>
          ${track.programChange !== undefined ? `<span style="color: #cbd5e1;">PC: ${track.programChange}</span>` : ''}
        </div>
      </div>
      <div>
        ${
          hasNotes
            ? `<button type="button" class="btn-audition btn-audition-track ${isAuditioning ? 'playing' : ''}" data-track="${track.trackIndex}" style="padding: 2px 8px; font-size: 0.74rem;">
                ${isAuditioning ? '⏹ 停止' : '▶ 試聽'}
              </button>`
            : `<span style="font-size: 0.7rem; color: #64748b;">(無音符)</span>`
        }
      </div>
    `;

    const btnAudition = card.querySelector('.btn-audition-track') as HTMLButtonElement | null;
    if (btnAudition) {
      btnAudition.addEventListener('click', () => {
        toggleTrackAudition(track.trackIndex);
      });
    }

    container.appendChild(card);
  });
}

function toggleTrackAudition(trackIndex: number) {
  if (!currentMidiAnalysis) return;
  const track = currentMidiAnalysis.tracks.find((t) => t.trackIndex === trackIndex);
  if (!track || track.noteCount === 0) return;

  if (currentAuditioningTrackIndex === trackIndex) {
    audioEngine.stop();
    currentAuditioningTrackIndex = null;
    renderMidiSourceTracksList();
    return;
  }

  audioEngine.stop();
  currentAuditioningTrackIndex = trackIndex;
  renderMidiSourceTracksList();

  audioEngine.playSequence(track.trackIndex + 1, track.notes, {
    bpm: currentMidiAnalysis.bpm,
    division: currentMidiAnalysis.division,
    loop: false,
    gridStartTick: 0,
    totalTicks: track.totalTicks,
    channelParams: {
      msb: track.bankMsb ?? 0,
      lsb: track.bankLsb ?? 112,
      pc: track.programChange ?? 0,
      channel: track.channel,
    },
    onEnded: () => {
      currentAuditioningTrackIndex = null;
      renderMidiSourceTracksList();
    },
  });
}

const PAD_THEME_COLORS = [
  { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)', text: '#60a5fa', title: 'Pad 1 (主旋律/和弦)' },
  { border: '#10b981', bg: 'rgba(16, 185, 129, 0.08)', text: '#34d399', title: 'Pad 2 (副奏/弦樂)' },
  { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.08)', text: '#fbbf24', title: 'Pad 3 (節奏/吉他)' },
  { border: '#ec4899', bg: 'rgba(236, 72, 153, 0.08)', text: '#f472b6', title: 'Pad 4 (貝斯/打擊)' },
];

function renderPadAssignmentsGrid() {
  const container = document.getElementById('pad-assignments-grid');
  if (!container || !currentMidiAnalysis) return;

  const noteTracks = currentMidiAnalysis.tracks.filter((t) => t.noteCount > 0);
  const totalMeasures = currentMidiAnalysis.totalMeasures;
  const defaultBars = Math.min(4, totalMeasures);

  container.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const padNum = i + 1;
    const theme = PAD_THEME_COLORS[i];
    // 預設來源軌：若有足夠音符音軌則 1:1 分配，否則使用 null
    const initialTrack = noteTracks[i] ?? null;
    const initialTrackIdx = initialTrack ? initialTrack.trackIndex : -1;
    const initialName = initialTrack ? initialTrack.name : `Pad ${padNum}`;

    const card = document.createElement('div');
    card.className = `wizard-pad-card wizard-pad-card-${padNum}`;
    card.style.cssText = `background: #181b24; border: 1px solid ${theme.border}; border-radius: 8px; padding: 10px 14px; display: flex; flex-direction: column; gap: 8px;`;

    // 建立下拉選單 options
    let trackOptionsHtml = `<option value="-1">-- 不使用此 Pad (空白) --</option>`;
    currentMidiAnalysis.tracks.forEach((t) => {
      const isSelected = t.trackIndex === initialTrackIdx ? 'selected' : '';
      trackOptionsHtml += `<option value="${t.trackIndex}" ${isSelected}>[軌道 ${t.trackIndex + 1}] ${escapeHtml(t.name)} (${t.noteCount} 音符, ${t.measureCount} 小節)</option>`;
    });

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-weight: 700; font-size: 0.88rem; color: ${theme.text};">${theme.title}</span>
          <span class="badge wizard-pad-bars-badge" data-pad="${i}" style="background: rgba(255, 255, 255, 0.08); font-size: 0.72rem; color: #cbd5e1;">共 ${defaultBars} 小節</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.78rem;">
          <label style="display: flex; align-items: center; gap: 4px; color: #e2e8f0; cursor: pointer;">
            <input type="checkbox" class="wizard-pad-repeat" data-pad="${i}" checked style="accent-color: #3b82f6;" /> 循環播放 (RP)
          </label>
          <label style="display: flex; align-items: center; gap: 4px; color: #e2e8f0; cursor: pointer;">
            <input type="checkbox" class="wizard-pad-cm" data-pad="${i}" checked style="accent-color: #10b981;" /> 和弦跟隨 (CM)
          </label>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 10px; align-items: center;">
        <div>
          <label style="font-size: 0.74rem; color: #94a3b8; display: block; margin-bottom: 2px;">來源音軌：</label>
          <select class="wizard-pad-track" data-pad="${i}" style="width: 100%; background: #11131a; border: 1px solid #333846; border-radius: 4px; color: #fff; padding: 4px 6px; font-size: 0.8rem;">
            ${trackOptionsHtml}
          </select>
        </div>
        <div>
          <label style="font-size: 0.74rem; color: #94a3b8; display: block; margin-bottom: 2px;">Pad 名稱：</label>
          <input type="text" class="wizard-pad-name" data-pad="${i}" value="${escapeHtml(initialName)}" style="width: 100%; background: #11131a; border: 1px solid #333846; border-radius: 4px; color: #fff; padding: 4px 8px; font-size: 0.8rem;" />
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px; font-size: 0.78rem;">
        <span style="color: #94a3b8;">切片區間：</span>
        <div style="display: inline-flex; align-items: center; gap: 4px;">
          <span>第</span>
          <input type="number" class="wizard-pad-start" data-pad="${i}" min="1" max="${totalMeasures}" value="1" style="width: 50px; background: #11131a; border: 1px solid #333846; border-radius: 4px; color: #fff; text-align: center; padding: 2px 4px; font-size: 0.78rem;" />
          <span>小節</span>
        </div>
        <span style="color: #64748b;">至</span>
        <div style="display: inline-flex; align-items: center; gap: 4px;">
          <span>第</span>
          <input type="number" class="wizard-pad-end" data-pad="${i}" min="1" max="${totalMeasures}" value="${defaultBars}" style="width: 50px; background: #11131a; border: 1px solid #333846; border-radius: 4px; color: #fff; text-align: center; padding: 2px 4px; font-size: 0.78rem;" />
          <span>小節</span>
        </div>
      </div>
    `;

    // 綁定動態事件：修改軌道時自動帶入名稱
    const selTrack = card.querySelector('.wizard-pad-track') as HTMLSelectElement | null;
    const nameInput = card.querySelector('.wizard-pad-name') as HTMLInputElement | null;
    const startInput = card.querySelector('.wizard-pad-start') as HTMLInputElement | null;
    const endInput = card.querySelector('.wizard-pad-end') as HTMLInputElement | null;
    const badgeBars = card.querySelector('.wizard-pad-bars-badge') as HTMLElement | null;

    const updateBarsBadge = () => {
      const s = parseInt(startInput?.value || '1', 10);
      const e = parseInt(endInput?.value || '4', 10);
      const bars = Math.max(1, e - s + 1);
      if (badgeBars) {
        badgeBars.textContent = `共 ${bars} 小節`;
      }
    };

    if (selTrack && nameInput) {
      selTrack.addEventListener('change', () => {
        const val = parseInt(selTrack.value, 10);
        if (val >= 0 && currentMidiAnalysis) {
          const t = currentMidiAnalysis.tracks.find((trk) => trk.trackIndex === val);
          if (t) {
            nameInput.value = t.name;
          }
        }
      });
    }

    if (startInput) startInput.addEventListener('input', updateBarsBadge);
    if (endInput) endInput.addEventListener('input', updateBarsBadge);

    container.appendChild(card);
  }
}

function initMidiImportModal() {
  const modal = document.getElementById('midi-import-modal');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-midi-import-modal');
  const btnCancel = document.getElementById('btn-cancel-midi-import');
  const btnConfirm = document.getElementById('btn-confirm-midi-import');

  if (btnClose) btnClose.addEventListener('click', closeMidiImportModal);
  if (btnCancel) btnCancel.addEventListener('click', closeMidiImportModal);

  // 點擊背景遮罩防誤觸：不關閉視窗，給予柔和焦點回彈提示
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      const dialog = modal.querySelector('.modal-dialog') as HTMLElement | null;
      if (dialog) {
        dialog.classList.remove('modal-dialog-pulse');
        void dialog.offsetWidth;
        dialog.classList.add('modal-dialog-pulse');
      }
    }
  });

  // 阻止 dialog 內部點擊穿透冒泡
  const dialog = modal.querySelector('.modal-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => e.stopPropagation());
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 快捷預設按鈕 1: 1~4 軌自動對應
  const btnPreset1to1 = document.getElementById('btn-wizard-preset-1to1');
  if (btnPreset1to1) {
    btnPreset1to1.addEventListener('click', () => {
      if (!currentMidiAnalysis) return;
      const noteTracks = currentMidiAnalysis.tracks.filter((t) => t.noteCount > 0);
      for (let i = 0; i < 4; i++) {
        const sel = document.querySelector(`.wizard-pad-track[data-pad="${i}"]`) as HTMLSelectElement | null;
        const nameInput = document.querySelector(`.wizard-pad-name[data-pad="${i}"]`) as HTMLInputElement | null;
        const t = noteTracks[i] ?? currentMidiAnalysis.tracks[i + 1];
        if (sel && t) {
          sel.value = `${t.trackIndex}`;
          if (nameInput) nameInput.value = t.name;
        }
      }
      showStatus('⚡ 已自動將音軌 1~4 對應分配至 Pad 1~4');
    });
  }

  // 快捷預設按鈕 2: 前 4 小節切片
  const btnPresetFirst4 = document.getElementById('btn-wizard-preset-first4bars');
  if (btnPresetFirst4) {
    btnPresetFirst4.addEventListener('click', () => {
      if (!currentMidiAnalysis) return;
      const totalMeasures = currentMidiAnalysis.totalMeasures;
      const targetEnd = Math.min(4, totalMeasures);
      for (let i = 0; i < 4; i++) {
        const startInput = document.querySelector(`.wizard-pad-start[data-pad="${i}"]`) as HTMLInputElement | null;
        const endInput = document.querySelector(`.wizard-pad-end[data-pad="${i}"]`) as HTMLInputElement | null;
        const badgeBars = document.querySelector(`.wizard-pad-bars-badge[data-pad="${i}"]`) as HTMLElement | null;
        if (startInput) startInput.value = '1';
        if (endInput) endInput.value = `${targetEnd}`;
        if (badgeBars) badgeBars.textContent = `共 ${targetEnd} 小節`;
      }
      showStatus(`⚡ 已設定所有 Pad 切片範圍為第 1 至第 ${targetEnd} 小節`);
    });
  }

  // 快捷預設按鈕 3: 全部開啟和弦跟隨
  const btnPresetAllCm = document.getElementById('btn-wizard-preset-allcm');
  if (btnPresetAllCm) {
    btnPresetAllCm.addEventListener('click', () => {
      for (let i = 0; i < 4; i++) {
        const cmBox = document.querySelector(`.wizard-pad-cm[data-pad="${i}"]`) as HTMLInputElement | null;
        if (cmBox) cmBox.checked = true;
      }
      showStatus('⚡ 已啟用所有 Pad 和弦跟隨 (CM)');
    });
  }

  // 確定匯入建立專案按鈕
  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!currentMidiAnalysis) return;

      const projNameInput = document.getElementById('midi-import-proj-name') as HTMLInputElement | null;
      const bpmInput = document.getElementById('midi-import-bpm') as HTMLInputElement | null;
      const injectCasmBox = document.getElementById('midi-import-inject-casm') as HTMLInputElement | null;

      const projectName = projNameInput?.value.trim() || 'Imported Pad';
      const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));
      const injectCasm = injectCasmBox ? injectCasmBox.checked : true;

      const padAssignments: PadAssignmentOption[] = [];
      let assignedCount = 0;

      for (let i = 0; i < 4; i++) {
        const sel = document.querySelector(`.wizard-pad-track[data-pad="${i}"]`) as HTMLSelectElement | null;
        const nameInput = document.querySelector(`.wizard-pad-name[data-pad="${i}"]`) as HTMLInputElement | null;
        const startInput = document.querySelector(`.wizard-pad-start[data-pad="${i}"]`) as HTMLInputElement | null;
        const endInput = document.querySelector(`.wizard-pad-end[data-pad="${i}"]`) as HTMLInputElement | null;
        const rpBox = document.querySelector(`.wizard-pad-repeat[data-pad="${i}"]`) as HTMLInputElement | null;
        const cmBox = document.querySelector(`.wizard-pad-cm[data-pad="${i}"]`) as HTMLInputElement | null;

        const trackIdx = parseInt(sel?.value || '-1', 10);
        const name = nameInput?.value.trim() || `Pad ${i + 1}`;
        const startBar = Math.max(1, parseInt(startInput?.value || '1', 10));
        const endBar = Math.max(startBar, parseInt(endInput?.value || '4', 10));
        const repeat = rpBox ? rpBox.checked : false;
        const chordMatch = cmBox ? cmBox.checked : false;

        if (trackIdx >= 0) assignedCount++;

        padAssignments.push({
          padIndex: i,
          sourceTrackIndex: trackIdx >= 0 ? trackIdx : null,
          name,
          startBar,
          endBar,
          repeat,
          chordMatch,
        });
      }

      if (assignedCount === 0) {
        alert('請至少為一個 Pad 指派來源音軌！');
        return;
      }

      showStatus(`正在將外部 MIDI 切片合成為 Yamaha Multi Pad: ${projectName}...`);

      try {
        const padProject = MidiImporter.convertMidiToPadProject(currentMidiAnalysis, {
          projectName,
          bpm,
          timeSignature: currentMidiAnalysis.timeSignature,
          targetDivision: 480,
          padAssignments,
          injectCasm,
        });

        // 停止試聽並關閉視窗
        closeMidiImportModal();

        // 寫入二進位並在主畫面完整載入渲染
        const binaryBytes = YamahaWriter.write(padProject);
        renderParsed(binaryBytes, `${projectName}.pad`, 'PAD');
        markModified(`從外部 MIDI [${currentMidiAnalysis.fileName}] 成功匯入並合成 4-Pad 專案`);

        showStatus(`✨ 成功將外部 MIDI 切片匯入為 Yamaha Multi Pad 專案: ${projectName}`);
      } catch (err: any) {
        alert(`合成 Multi Pad 專案失敗: ${err.message}`);
        showStatus(`合成失敗: ${err.message}`, true);
      }
    });
  }
}

// ==========================================
// Phase 3.2: 外部 MIDI 匯入分流導航 (Import Mode Router)
// ==========================================

let pendingMidiBytes: Uint8Array | null = null;
let pendingMidiFileName: string = '';

function selectMidiFileFromDisk() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.mid,.midi,.MID,.MIDI';
  input.onchange = () => {
    if (input.files && input.files[0]) {
      handleFile(input.files[0]);
    }
  };
  input.click();
}

function updateResumeMidiUI() {
  const btnResume = document.getElementById('btn-resume-imported-midi');
  const lblResumeName = document.getElementById('resume-midi-filename');
  const cardResume = document.getElementById('drop-zone-resume-card');
  const lblCardName = document.getElementById('drop-zone-resume-filename');

  if (pendingMidiBytes && pendingMidiFileName) {
    if (btnResume) {
      btnResume.style.display = 'inline-flex';
      btnResume.style.alignItems = 'center';
      btnResume.style.gap = '6px';
    }
    if (lblResumeName) lblResumeName.textContent = pendingMidiFileName;
    if (cardResume) {
      cardResume.style.display = 'flex';
    }
    if (lblCardName) lblCardName.textContent = pendingMidiFileName;
  } else {
    if (btnResume) btnResume.style.display = 'none';
    if (cardResume) cardResume.style.display = 'none';
  }
}

function openMidiModeRouterModal(bytes: Uint8Array, fileName: string) {
  pendingMidiBytes = bytes;
  pendingMidiFileName = fileName;
  updateResumeMidiUI();

  const modal = document.getElementById('midi-mode-router-modal');
  const subtitle = document.getElementById('midi-router-subtitle');
  if (subtitle) {
    subtitle.textContent = `來源檔案：${escapeHtml(fileName)} (${bytes.length} Bytes)`;
  }
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeMidiModeRouterModal() {
  const modal = document.getElementById('midi-mode-router-modal');
  if (modal) modal.style.display = 'none';
  updateResumeMidiUI();
}

function initMidiModeRouterModal() {
  const modal = document.getElementById('midi-mode-router-modal');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-midi-router-modal');
  const btnCancel = document.getElementById('btn-cancel-midi-router');
  const btnChoosePad = document.getElementById('btn-router-choose-pad');
  const btnChooseStyle = document.getElementById('btn-router-choose-style');
  const btnChooseAnother = document.getElementById('btn-router-choose-another');

  btnClose?.addEventListener('click', closeMidiModeRouterModal);
  btnCancel?.addEventListener('click', closeMidiModeRouterModal);

  btnChooseAnother?.addEventListener('click', () => {
    closeMidiModeRouterModal();
    selectMidiFileFromDisk();
  });

  // 點擊背景遮罩防誤觸：不關閉視窗，給予柔和焦點回彈提示
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      const dialog = modal.querySelector('.modal-dialog') as HTMLElement | null;
      if (dialog) {
        dialog.classList.remove('modal-dialog-pulse');
        void dialog.offsetWidth;
        dialog.classList.add('modal-dialog-pulse');
      }
    }
  });

  const dialog = modal.querySelector('.modal-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => e.stopPropagation());
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  btnChoosePad?.addEventListener('click', () => {
    closeMidiModeRouterModal();
    if (pendingMidiBytes) {
      openMidiImportModal(pendingMidiBytes, pendingMidiFileName);
    }
  });

  btnChooseStyle?.addEventListener('click', () => {
    closeMidiModeRouterModal();
    if (pendingMidiBytes) {
      openStyleImportModal(pendingMidiBytes, pendingMidiFileName);
    }
  });
}

// ==========================================
// Phase 3.2: Yamaha Style 8 聲部智慧映射與合成精靈 (Style Import Wizard)
// ==========================================

let currentStyleAnalysis: StyleSourceAnalysis | null = null;
let currentStyleMappings: StylePartMappingItem[] = [];
let currentStyleAuditionTrackIndex: number | null = null;

const STYLE_PART_ORDER: { id: StylePartId; title: string; defaultCh: number; color: string; icon: string }[] = [
  { id: 'Rhythm1', title: 'Rhythm 1 (次打擊樂)', defaultCh: 9, color: '#f97316', icon: '🪘' },
  { id: 'Rhythm2', title: 'Rhythm 2 (主爵士鼓組)', defaultCh: 10, color: '#ef4444', icon: '🥁' },
  { id: 'Bass', title: 'Bass (低音貝斯)', defaultCh: 11, color: '#f59e0b', icon: '🎸' },
  { id: 'Chord1', title: 'Chord 1 (節奏主和弦)', defaultCh: 12, color: '#3b82f6', icon: '🎹' },
  { id: 'Chord2', title: 'Chord 2 (副和弦/管樂組)', defaultCh: 13, color: '#06b6d4', icon: '🎺' },
  { id: 'Pad', title: 'Pad (長音弦樂背景)', defaultCh: 14, color: '#a855f7', icon: '🎻' },
  { id: 'Phrase1', title: 'Phrase 1 (對位旋律/琶音)', defaultCh: 15, color: '#10b981', icon: '✨' },
  { id: 'Phrase2', title: 'Phrase 2 (副裝飾旋律)', defaultCh: 16, color: '#14b8a6', icon: '🎵' },
];

let currentSlicerMode: 'multi' | 'single' = 'multi';
let currentStyleSlices: StyleSectionSliceConfig[] = [];
let currentAuditionSliceIndex: number | null = null;
let currentFocusedSliceIndex: number = 0;
let isCNormEnabled: boolean = true;
let selectedKeyOverride: string = 'auto';

function updateSlicerCardFocusUI() {
  document.querySelectorAll('.slicer-section-card').forEach((card, idx) => {
    if (idx === currentFocusedSliceIndex) {
      card.classList.add('active');
    } else {
      card.classList.remove('active');
    }
  });
}

function updateAuditionAllButtonText() {
  const btnAll = document.getElementById('btn-style-audition-all');
  if (!btnAll) return;

  if (isStyleEnsemblePlaying) {
    const targetSectionSelect = document.getElementById('style-import-target-section') as HTMLSelectElement | null;
    const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
    const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;
    const secName = targetSectionSelect?.value || 'Main A';
    const sBar = startBarInput?.value || '1';
    const eBar = endBarInput?.value || '4';
    btnAll.innerHTML = `⏹ 停止 ${secName} (第 ${sBar}~${eBar} 節) 試聽`;
    btnAll.style.background = '#dc2626';
    btnAll.style.borderColor = '#ef4444';
    return;
  }

  if (currentAuditionSliceIndex !== null && currentStyleSlices[currentAuditionSliceIndex]) {
    const slice = currentStyleSlices[currentAuditionSliceIndex];
    btnAll.innerHTML = `⏹ 停止 ${slice.sectionName} (第 ${slice.startBar}~${slice.endBar} 節) 試聽`;
    btnAll.style.background = '#dc2626';
    btnAll.style.borderColor = '#ef4444';
    return;
  }

  btnAll.style.background = '';
  btnAll.style.borderColor = '';

  if (currentSlicerMode === 'multi') {
    const slice = currentStyleSlices[currentFocusedSliceIndex] || currentStyleSlices[0];
    if (slice) {
      btnAll.innerHTML = `🎧 試聽 ${slice.sectionName} (第 ${slice.startBar}~${slice.endBar} 節) 合奏`;
      btnAll.title = `點擊循環試聽目前選定段落 [${slice.sectionName}] (第 ${slice.startBar} ~ ${slice.endBar} 小節) 之多軌伴奏合奏`;
    } else {
      btnAll.innerHTML = `🎧 試聽所選段落合奏`;
      btnAll.title = `點擊試聽伴奏段落合奏`;
    }
  } else {
    const targetSectionSelect = document.getElementById('style-import-target-section') as HTMLSelectElement | null;
    const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
    const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;
    const secName = targetSectionSelect?.value || 'Main A';
    const sBar = startBarInput?.value || '1';
    const eBar = endBarInput?.value || '4';
    btnAll.innerHTML = `🎧 試聽 ${secName} (第 ${sBar}~${eBar} 節) 合奏`;
    btnAll.title = `點擊循環試聽單一段落 [${secName}] (第 ${sBar} ~ ${eBar} 小節) 之多軌伴奏合奏`;
  }
}

function initDefaultStyleSlices(totalMeasures: number): StyleSectionSliceConfig[] {
  const tot = Math.max(4, totalMeasures);
  if (tot <= 8) {
    return [
      { id: 'sec-1', sectionName: 'Intro A', startBar: 1, endBar: Math.min(2, tot) },
      { id: 'sec-2', sectionName: 'Main A', startBar: Math.min(3, tot), endBar: Math.min(6, tot) },
      { id: 'sec-3', sectionName: 'Fill In AA', startBar: Math.min(7, tot), endBar: Math.min(7, tot) },
      { id: 'sec-4', sectionName: 'Ending A', startBar: Math.min(8, tot), endBar: tot },
    ];
  } else if (tot <= 24) {
    const mainBars = Math.max(4, Math.floor((tot - 4) / 2));
    return [
      { id: 'sec-1', sectionName: 'Intro A', startBar: 1, endBar: 4 },
      { id: 'sec-2', sectionName: 'Main A', startBar: 5, endBar: 4 + mainBars },
      { id: 'sec-3', sectionName: 'Fill In AA', startBar: 5 + mainBars, endBar: 5 + mainBars },
      { id: 'sec-4', sectionName: 'Main B', startBar: 6 + mainBars, endBar: Math.min(tot - 4, 5 + mainBars * 2) },
      { id: 'sec-5', sectionName: 'Ending A', startBar: Math.max(6 + mainBars, tot - 3), endBar: tot },
    ];
  } else {
    return [
      { id: 'sec-1', sectionName: 'Intro A', startBar: 1, endBar: 4 },
      { id: 'sec-2', sectionName: 'Main A', startBar: 5, endBar: 12 },
      { id: 'sec-3', sectionName: 'Fill In AA', startBar: 13, endBar: 13 },
      { id: 'sec-4', sectionName: 'Main B', startBar: 14, endBar: 21 },
      { id: 'sec-5', sectionName: 'Fill In BB', startBar: 22, endBar: 22 },
      { id: 'sec-6', sectionName: 'Main C', startBar: 23, endBar: 30 },
      { id: 'sec-7', sectionName: 'Ending A', startBar: 31, endBar: 34 },
    ];
  }
}

function updateCNormUI() {
  const checkbox = document.getElementById('style-import-c-norm-enable') as HTMLInputElement | null;
  const select = document.getElementById('style-import-key-override') as HTMLSelectElement | null;
  const badge = document.getElementById('style-import-c-norm-badge');
  const keyText = document.getElementById('style-import-detected-key-text');

  if (!currentStyleAnalysis) return;

  const detected = currentStyleAnalysis.detectedKey || StyleImporter.detectKeySignature(currentStyleAnalysis.tracks, currentStyleAnalysis.division);

  if (keyText) {
    const shiftSign = detected.semitonesToC > 0 ? '+' : '';
    keyText.textContent = `✨ 偵測調性: ${detected.key} (移調 ${shiftSign}${detected.semitonesToC} 半音至 C 基準)`;
  }

  isCNormEnabled = checkbox ? checkbox.checked : true;
  selectedKeyOverride = select ? select.value : 'auto';

  let effectiveShift = 0;
  if (isCNormEnabled) {
    if (selectedKeyOverride === 'auto') {
      effectiveShift = detected.semitonesToC;
    } else {
      effectiveShift = ROOT_TO_C_SHIFT[selectedKeyOverride] ?? 0;
    }
  }

  if (badge) {
    const shiftSign = effectiveShift > 0 ? '+' : '';
    badge.textContent = isCNormEnabled
      ? `移調: ${shiftSign}${effectiveShift} 半音`
      : '未啟用 (保留原曲音高)';
    badge.style.background = isCNormEnabled ? '#0284c7' : '#64748b';
  }
}

function renderStyleSlicerUI() {
  const track = document.getElementById('style-slicer-timeline-track');
  const cardsContainer = document.getElementById('style-slicer-cards-container');
  const summaryBadge = document.getElementById('style-slicer-summary-badge');
  const totalBarsLabel = document.getElementById('style-slicer-timeline-total-bars');
  if (!currentStyleAnalysis) return;

  const totalMeasures = Math.max(1, currentStyleAnalysis.totalMeasures);
  if (totalBarsLabel) totalBarsLabel.textContent = `共 ${totalMeasures} 小節`;
  if (summaryBadge) summaryBadge.textContent = `${currentStyleSlices.length} 個切片段落`;

  // 1. 渲染時間軸彩色區塊
  if (track) {
    track.innerHTML = '';
    currentStyleSlices.forEach((slice, idx) => {
      const bars = Math.max(1, slice.endBar - slice.startBar + 1);
      const widthPct = Math.max(3, (bars / totalMeasures) * 100);
      const leftPct = ((slice.startBar - 1) / totalMeasures) * 100;

      const block = document.createElement('div');
      const lower = slice.sectionName.toLowerCase();
      let colorClass = 'slicer-main';
      if (lower.includes('intro')) colorClass = 'slicer-intro';
      else if (lower.includes('fill')) colorClass = 'slicer-fill';
      else if (lower.includes('ending')) colorClass = 'slicer-ending';
      else if (lower.includes('break')) colorClass = 'slicer-break';

      block.className = `slicer-timeline-block ${colorClass}`;
      block.style.width = `${widthPct}%`;
      block.style.marginLeft = idx === 0 ? `${leftPct}%` : '0';
      block.title = `${slice.sectionName}: 小節 ${slice.startBar} ~ ${slice.endBar} (${bars} 小節)`;
      block.textContent = `${slice.sectionName} (${bars}m)`;

      block.addEventListener('click', () => {
        currentFocusedSliceIndex = idx;
        const card = document.getElementById(`slicer-card-${idx}`);
        if (card && cardsContainer) {
          card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          document.querySelectorAll('.slicer-section-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
        }
        updateAuditionAllButtonText();
      });

      track.appendChild(block);
    });
  }

  // 2. 渲染下方切片卡片列表
  if (cardsContainer) {
    cardsContainer.innerHTML = '';
    const sectionTypes: StyleSectionType[] = [
      'Intro A', 'Intro B', 'Intro C',
      'Main A', 'Main B', 'Main C', 'Main D',
      'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD', 'Fill In BA',
      'Ending A', 'Ending B', 'Ending C',
      'Break'
    ];

    currentStyleSlices.forEach((slice, idx) => {
      const card = document.createElement('div');
      card.id = `slicer-card-${idx}`;
      const isFocused = currentFocusedSliceIndex === idx;
      card.className = `slicer-section-card ${isFocused ? 'active' : ''}`;

      const bars = Math.max(1, slice.endBar - slice.startBar + 1);
      const isAuditioning = currentAuditionSliceIndex === idx;

      // 計算該段落切片中的鼓組音符數與總音符數
      const division = currentStyleAnalysis?.division || 480;
      const timeSig = currentStyleAnalysis?.timeSignature || { numerator: 4, denominator: 4 };
      const ticksPerMeasure = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));
      const sliceStartTick = (slice.startBar - 1) * ticksPerMeasure;
      const sliceEndTick = slice.endBar * ticksPerMeasure;

      let sliceDrumNotesCount = 0;
      let hasDrumTrackAssigned = false;
      currentStyleMappings.forEach((m) => {
        if (m.partId === 'Rhythm1' || m.partId === 'Rhythm2') {
          if (m.sourceTrackIndex !== null && m.sourceTrackIndex !== undefined) {
            hasDrumTrackAssigned = true;
            const trk = currentStyleAnalysis?.tracks.find((t) => t.trackIndex === m.sourceTrackIndex);
            if (trk) {
              for (const n of trk.notes) {
                if (n.startTick >= sliceStartTick && n.startTick < sliceEndTick) {
                  sliceDrumNotesCount++;
                }
              }
            }
          }
        }
      });

      let drumBadgeHtml = '';
      if (hasDrumTrackAssigned) {
        if (sliceDrumNotesCount > 0) {
          drumBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); font-size: 0.68rem; padding: 1px 5px;" title="此小節區間內包含 ${sliceDrumNotesCount} 顆鼓組/打擊音符">🥁 ${sliceDrumNotesCount} 鼓音符</span>`;
        } else {
          drumBadgeHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.68rem; padding: 1px 5px;" title="注意：原曲在此小節區間內無鼓組音符 (原曲鼓組可能在後續小節進場)">⚠️ 無鼓聲 (原曲無鼓)</span>`;
        }
      }

      const typeOptions = sectionTypes.map(st =>
        `<option value="${st}" ${st === slice.sectionName ? 'selected' : ''}>${st}</option>`
      ).join('');

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
          <select class="slicer-sec-name-select" data-idx="${idx}" style="background: #11131a; border: 1px solid #3d4660; border-radius: 4px; color: #38bdf8; font-weight: 700; font-size: 0.8rem; padding: 2px 6px;">
            ${typeOptions}
          </select>
          <button type="button" class="btn-slicer-del" data-idx="${idx}" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 0.85rem; padding: 0 4px;" title="刪除此段落切片">&times;</button>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; font-size: 0.76rem; color: #cbd5e1; flex-wrap: wrap;">
          <span>小節:</span>
          <input type="number" class="slicer-start-bar" data-idx="${idx}" min="1" max="${totalMeasures}" value="${slice.startBar}" style="width: 44px; background: #11131a; border: 1px solid #333846; border-radius: 3px; color: #fff; padding: 2px 4px; font-size: 0.76rem; text-align: center;" />
          <span style="color: #64748b;">~</span>
          <input type="number" class="slicer-end-bar" data-idx="${idx}" min="1" max="${totalMeasures}" value="${slice.endBar}" style="width: 44px; background: #11131a; border: 1px solid #333846; border-radius: 3px; color: #fff; padding: 2px 4px; font-size: 0.76rem; text-align: center;" />
          <span class="badge" style="background: #1e293b; color: #94a3b8; font-size: 0.7rem; padding: 1px 6px;">${bars}m</span>
          ${drumBadgeHtml}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 2px;">
          <button type="button" class="btn-audition btn-slicer-audition ${isAuditioning ? 'playing' : ''}" data-idx="${idx}" style="padding: 2px 8px; font-size: 0.72rem;">
            ${isAuditioning ? '⏹ 停止' : '▶ 試聽段落'}
          </button>
        </div>
      `;

      // 點擊卡片本體聚焦此段落
      card.addEventListener('click', (e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT') {
          currentFocusedSliceIndex = idx;
          updateSlicerCardFocusUI();
          updateAuditionAllButtonText();
        }
      });

      // 監聽段落名稱變更
      const nameSelect = card.querySelector('.slicer-sec-name-select') as HTMLSelectElement | null;
      nameSelect?.addEventListener('change', () => {
        slice.sectionName = nameSelect.value;
        currentFocusedSliceIndex = idx;
        renderStyleSlicerUI();
      });

      // 監聽小節變更 (input 即時連動頂部按鈕，change 觸發整塊重繪)
      const startInput = card.querySelector('.slicer-start-bar') as HTMLInputElement | null;
      const endInput = card.querySelector('.slicer-end-bar') as HTMLInputElement | null;
      startInput?.addEventListener('input', () => {
        const val = Math.max(1, Math.min(totalMeasures, parseInt(startInput.value || '1', 10)));
        slice.startBar = val;
        if (slice.endBar < val) slice.endBar = val;
        currentFocusedSliceIndex = idx;
        updateSlicerCardFocusUI();
        updateAuditionAllButtonText();
      });
      startInput?.addEventListener('change', () => {
        renderStyleSlicerUI();
      });

      endInput?.addEventListener('input', () => {
        const val = Math.max(slice.startBar, Math.min(totalMeasures, parseInt(endInput.value || '1', 10)));
        slice.endBar = val;
        currentFocusedSliceIndex = idx;
        updateSlicerCardFocusUI();
        updateAuditionAllButtonText();
      });
      endInput?.addEventListener('change', () => {
        renderStyleSlicerUI();
      });

      // 監聽刪除
      const btnDel = card.querySelector('.btn-slicer-del') as HTMLButtonElement | null;
      btnDel?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentStyleSlices.length <= 1) {
          alert('請至少保留一個伴奏段落！');
          return;
        }
        currentStyleSlices.splice(idx, 1);
        if (currentFocusedSliceIndex >= currentStyleSlices.length) {
          currentFocusedSliceIndex = Math.max(0, currentStyleSlices.length - 1);
        }
        renderStyleSlicerUI();
      });

      // 監聽段落試聽
      const btnAudition = card.querySelector('.btn-slicer-audition') as HTMLButtonElement | null;
      btnAudition?.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStyleSliceAudition(idx);
      });

      cardsContainer.appendChild(card);
    });
  }

  updateAuditionAllButtonText();
}

function toggleStyleSliceAudition(sliceIdx: number) {
  if (!currentStyleAnalysis) return;

  currentFocusedSliceIndex = sliceIdx;

  if (currentAuditionSliceIndex === sliceIdx && (audioEngine.isPlaying() || audioEngine.isBackingTrackPlaying())) {
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    currentAuditionSliceIndex = null;
    renderStyleSlicerUI();
    updateAuditionAllButtonText();
    showStatus('已停止段落試聽');
    return;
  }

  audioEngine.stopBackingTrack();
  audioEngine.stop();
  currentStyleAuditionTrackIndex = null;
  isStyleEnsemblePlaying = false;

  const slice = currentStyleSlices[sliceIdx];
  if (!slice) return;

  const activeMappings = currentStyleMappings.filter((m) => m.sourceTrackIndex !== null);
  if (activeMappings.length === 0) {
    showStatus('請至少指派一個伴奏聲部以供試聽', true);
    return;
  }

  const division = currentStyleAnalysis.division || 480;
  const timeSig = currentStyleAnalysis.timeSignature || { numerator: 4, denominator: 4 };
  const ticksPerBeat = division;
  const beatsPerMeasure = timeSig.numerator * (4 / timeSig.denominator);
  const ticksPerMeasure = Math.round(ticksPerBeat * beatsPerMeasure);

  const startBar = Math.max(1, slice.startBar);
  const endBar = Math.max(startBar, slice.endBar);
  const startTick = (startBar - 1) * ticksPerMeasure;
  const endTick = endBar * ticksPerMeasure;
  const totalTicks = (endBar - startBar + 1) * ticksPerMeasure;

  const backingItems: BackingTrackItem[] = [];

  for (const mapping of activeMappings) {
    const track = currentStyleAnalysis.tracks.find((t) => t.trackIndex === mapping.sourceTrackIndex);
    if (!track || track.notes.length === 0) continue;

    const sliceNotes: NoteEvent[] = [];
    for (const n of track.notes) {
      if (n.startTick >= startTick && n.startTick < endTick) {
        sliceNotes.push({
          note: n.note,
          velocity: n.velocity,
          startTick: n.startTick - startTick,
          durationTick: n.durationTick,
        });
      }
    }

    if (sliceNotes.length > 0) {
      const isDrum = mapping.partId === 'Rhythm1' || mapping.partId === 'Rhythm2';
      backingItems.push({
        padNum: DEFAULT_STYLE_PARTS[mapping.partId].channel,
        notes: sliceNotes,
        totalTicks,
        channelParams: {
          instrumentId: isDrum ? 'standard-drum-kit' : 'grand-piano',
          channel: DEFAULT_STYLE_PARTS[mapping.partId].channel,
          isDrum,
          msb: isDrum ? 127 : 0,
          lsb: 0,
          pc: track.programChange ?? 0,
          volume: isDrum ? 110 : 95,
        },
      });
    }
  }

  if (backingItems.length === 0) {
    showStatus(`段落 [${slice.sectionName}] 在小節 ${startBar}~${endBar} 區間內無音符可供試聽`, false);
    return;
  }

  currentAuditionSliceIndex = sliceIdx;
  renderStyleSlicerUI();
  updateAuditionAllButtonText();

  const bpmInput = document.getElementById('style-import-bpm') as HTMLInputElement | null;
  const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));

  audioEngine.startBackingTrack(backingItems, {
    bpm,
    division,
    beatsPerBar: timeSig.numerator,
    volumeRatio: 1.0,
    loop: true,
    onEnded: () => {
      currentAuditionSliceIndex = null;
      renderStyleSlicerUI();
      updateAuditionAllButtonText();
    },
  });

  const hasDrumInAudition = backingItems.some((b) => b.channelParams?.isDrum);
  const drumNoteCountInAudition = backingItems
    .filter((b) => b.channelParams?.isDrum)
    .reduce((sum, b) => sum + b.notes.length, 0);

  const drumNoteTip = hasDrumInAudition
    ? `(含 ${drumNoteCountInAudition} 顆鼓組音符)`
    : `(⚠️ 提示：此段落小節區間內原曲無鼓聲)`;

  showStatus(`▶ 正在試聽切片段落: [${slice.sectionName}] (小節 ${startBar}~${endBar}) ${drumNoteTip}...`);
}

function openStyleImportModal(bytes: Uint8Array, fileName: string) {
  pendingMidiBytes = bytes;
  pendingMidiFileName = fileName;
  updateResumeMidiUI();

  const modal = document.getElementById('style-import-modal');
  if (!modal) return;

  try {
    currentStyleAnalysis = StyleImporter.analyzeForStyle(bytes, fileName);
  } catch (err: any) {
    alert(`分析外部 MIDI 伴奏結構失敗: ${err.message}`);
    return;
  }

  // 1. 設定副標題摘要
  const subtitle = document.getElementById('style-import-subtitle');
  if (subtitle) {
    subtitle.textContent = `來源檔案: ${fileName} | ${currentStyleAnalysis.division} PPQ | ${currentStyleAnalysis.bpm} BPM | ${currentStyleAnalysis.timeSignature.numerator}/${currentStyleAnalysis.timeSignature.denominator} 拍 | 共 ${currentStyleAnalysis.totalMeasures} 小節 (${currentStyleAnalysis.tracks.length} 軌)`;
  }

  // 2. 初始化名稱與速度
  const projNameInput = document.getElementById('style-import-proj-name') as HTMLInputElement | null;
  const bpmInput = document.getElementById('style-import-bpm') as HTMLInputElement | null;
  const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
  const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;

  if (projNameInput) {
    const baseName = fileName.replace(/\.[^/.]+$/, '');
    projNameInput.value = `${baseName} Style`;
  }
  if (bpmInput) {
    bpmInput.value = `${currentStyleAnalysis.bpm}`;
  }
  if (startBarInput) {
    startBarInput.value = '1';
  }
  if (endBarInput) {
    endBarInput.value = `${Math.min(8, Math.max(4, currentStyleAnalysis.totalMeasures))}`;
  }

  // 3. 套用 8 聲部初始推薦映射
  resetStyleMappingsToSmartRecommendation();

  // 3.1 初始化多段落切片與 C 調基準校正 (Phase 3.3)
  currentStyleSlices = initDefaultStyleSlices(currentStyleAnalysis.totalMeasures);
  currentSlicerMode = 'multi';
  currentFocusedSliceIndex = 0;
  currentAuditionSliceIndex = null;
  renderStyleSlicerUI();
  updateCNormUI();

  // 同步切換按鈕視覺
  const btnMulti = document.getElementById('btn-slicer-mode-multi');
  const btnSingle = document.getElementById('btn-slicer-mode-single');
  const slicerPanel = document.getElementById('style-slicer-panel');
  const singlePanel = document.getElementById('style-single-section-panel');
  if (btnMulti && btnSingle && slicerPanel && singlePanel) {
    btnMulti.classList.add('active-rp');
    btnSingle.classList.remove('active-rp');
    slicerPanel.style.display = 'flex';
    singlePanel.style.display = 'none';
  }

  // 4. 渲染左側來源音軌特徵與右側 8 聲部映射網格
  renderStyleSourceTracksList();
  renderStylePartMappingsGrid();

  // 5. 同步發聲路由與實體琴連線控制項
  refreshMidiControlsUI();

  // 6. 同步頂部試聽按鈕文字
  updateAuditionAllButtonText();

  // 7. 顯示彈窗
  modal.style.display = 'flex';
}

function closeStyleImportModal() {
  const modal = document.getElementById('style-import-modal');
  if (modal) modal.style.display = 'none';

  audioEngine.stopBackingTrack();
  audioEngine.stop();
  currentStyleAuditionTrackIndex = null;
  currentAuditionSliceIndex = null;
  isStyleEnsemblePlaying = false;
  updateAuditionAllButtonText();

  // 同步更新記憶體中已載入 MIDI 快速喚回狀態
  updateResumeMidiUI();
}

function resetStyleMappingsToSmartRecommendation() {
  if (!currentStyleAnalysis) return;
  currentStyleMappings = STYLE_PART_ORDER.map((part) => {
    const recommendedTrackIdx = currentStyleAnalysis?.autoMapping[part.id] ?? null;
    return {
      partId: part.id,
      sourceTrackIndex: recommendedTrackIdx,
      transposeShift: 0,
    };
  });
}

function renderStyleSourceTracksList() {
  const container = document.getElementById('style-source-tracks-list');
  const badge = document.getElementById('style-tracks-summary-badge');
  if (!container || !currentStyleAnalysis) return;

  if (badge) {
    badge.textContent = `${currentStyleAnalysis.styleTracks.length} 軌`;
  }

  container.innerHTML = '';
  currentStyleAnalysis.styleTracks.forEach((track) => {
    const card = document.createElement('div');
    card.className = 'style-track-card';

    const hasNotes = track.notes.length > 0;
    const isAuditioning = currentStyleAuditionTrackIndex === track.trackIndex;

    const categoryIcons: Record<string, string> = {
      drums: '🥁 爵士鼓組',
      percussion: '🪘 打擊樂器',
      bass: '🎸 貝斯低音',
      piano: '🎹 鋼琴鍵盤',
      guitar: '🎸 吉他',
      strings: '🎻 弦樂群',
      pad: '🌌 長音背景 Pad',
      brass: '🎺 銅管群',
      reed: '🎷 木管/薩克斯',
      lead: '✨ 主奏旋律',
      other: '🎼 其他樂器',
    };
    const catLabel = categoryIcons[track.detectedCategory] || '🎼 其他';

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.82rem; font-weight: 700; color: ${hasNotes ? '#f8fafc' : '#64748b'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <span style="color: #6366f1;">[軌 ${track.trackIndex + 1}]</span> ${escapeHtml(track.name)}
          </div>
          <div style="font-size: 0.72rem; color: #94a3b8; display: flex; gap: 6px; margin-top: 2px; flex-wrap: wrap;">
            <span class="badge" style="background: #1e293b; color: #cbd5e1; padding: 1px 5px; font-size: 0.68rem;">${catLabel}</span>
            <span>Ch ${track.channel + 1}</span>
            <span>${track.noteCount} 音符</span>
            ${track.programChange !== undefined ? `<span>PC ${track.programChange}</span>` : ''}
          </div>
          ${
            hasNotes
              ? `<div style="font-size: 0.7rem; color: #38bdf8; margin-top: 3px; line-height: 1.3;">
                  💡 推薦：${track.recommendedPart || '留空'}
                  <span style="color: #64748b;">(${track.recommendationReason})</span>
                </div>`
              : `<div style="font-size: 0.7rem; color: #64748b; margin-top: 2px;">(無音符事件)</div>`
          }
        </div>
        <div>
          ${
            hasNotes
              ? `<button type="button" class="btn-audition btn-style-audition-track ${isAuditioning ? 'playing' : ''}" data-track="${track.trackIndex}" style="padding: 2px 8px; font-size: 0.74rem;">
                  ${isAuditioning ? '⏹ 停止' : '▶ 試聽'}
                </button>`
              : ''
          }
        </div>
      </div>
    `;

    const btnAudition = card.querySelector('.btn-style-audition-track') as HTMLButtonElement | null;
    if (btnAudition) {
      btnAudition.addEventListener('click', () => {
        toggleStyleTrackAudition(track.trackIndex);
      });
    }

    container.appendChild(card);
  });
}

let isStyleEnsemblePlaying: boolean = false;

function toggleStyleTrackAudition(trackIndex: number) {
  if (!currentStyleAnalysis) return;
  const track = currentStyleAnalysis.tracks.find((t) => t.trackIndex === trackIndex);
  if (!track || track.noteCount === 0) return;

  // 停止合奏試聽
  if (isStyleEnsemblePlaying) {
    audioEngine.stopBackingTrack();
    isStyleEnsemblePlaying = false;
    const btnAll = document.getElementById('btn-style-audition-all');
    if (btnAll) btnAll.innerHTML = '🎧 試聽所選小節合奏';
  }

  if (currentStyleAuditionTrackIndex === trackIndex) {
    audioEngine.stop();
    currentStyleAuditionTrackIndex = null;
    renderStyleSourceTracksList();
    renderStylePartMappingsGrid();
    return;
  }

  audioEngine.stop();
  currentStyleAuditionTrackIndex = trackIndex;
  renderStyleSourceTracksList();
  renderStylePartMappingsGrid();

  // 取得使用者設定的切片小節區間
  const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
  const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;
  const startBar = Math.max(1, parseInt(startBarInput?.value || '1', 10));
  const endBar = Math.max(startBar, parseInt(endBarInput?.value || '4', 10));

  const division = currentStyleAnalysis.division;
  const ticksPerBar = division * 4;
  const sliceStartTick = (startBar - 1) * ticksPerBar;
  const sliceEndTick = endBar * ticksPerBar;
  const sliceTotalTicks = (endBar - startBar + 1) * ticksPerBar;

  // 優先過濾出當前選定切片小節內的音符
  let notesToPlay = track.notes.filter((n) => n.startTick >= sliceStartTick && n.startTick < sliceEndTick);
  let playStartTick = sliceStartTick;
  let playTotalTicks = sliceTotalTicks;

  // 若該軌在選定小節內尚未開口進場 (例如副歌才進場的樂器)，自動跳至該軌第一顆音符所在的真正開口小節，避免數十秒的乾等無聲
  if (notesToPlay.length === 0) {
    const firstNoteTick = track.notes[0].startTick;
    const firstBar = Math.floor(firstNoteTick / ticksPerBar);
    playStartTick = firstBar * ticksPerBar;
    playTotalTicks = Math.min(sliceTotalTicks, track.totalTicks - playStartTick);
    notesToPlay = track.notes.filter((n) => n.startTick >= playStartTick && n.startTick < playStartTick + playTotalTicks);
  }

  // 轉為從 0 開始的相對 Tick
  const relNotes = notesToPlay.map((n) => ({
    note: n.note,
    velocity: n.velocity,
    startTick: Math.max(0, n.startTick - playStartTick),
    durationTick: n.durationTick,
  }));

  // 樂器合成音色與鼓組判定
  const styleTrack = currentStyleAnalysis.styleTracks.find((st) => st.trackIndex === trackIndex);
  const cat = styleTrack?.detectedCategory || 'other';
  const isDrum = cat === 'drums' || cat === 'percussion' || track.channel === 9;

  let instrumentId = 'grand-piano';
  if (cat === 'bass') instrumentId = 'bass';
  else if (cat === 'guitar') instrumentId = 'guitar';
  else if (cat === 'strings' || cat === 'pad') instrumentId = 'strings';
  else if (cat === 'brass') instrumentId = 'brass';
  else if (cat === 'reed') instrumentId = 'flute';

  const midiChannel = isDrum ? 9 : (track.channel !== undefined && track.channel !== 9 ? track.channel : 0);

  audioEngine.playSequence(track.trackIndex + 1, relNotes, {
    bpm: currentStyleAnalysis.bpm,
    division: currentStyleAnalysis.division,
    loop: false,
    gridStartTick: 0,
    totalTicks: Math.max(playTotalTicks, 1),
    channelParams: {
      msb: isDrum ? 127 : (track.bankMsb ?? 0),
      lsb: isDrum ? 0 : (track.bankLsb ?? 112),
      pc: track.programChange ?? 0,
      channel: midiChannel,
      isDrum,
      instrumentId,
    },
    onEnded: () => {
      currentStyleAuditionTrackIndex = null;
      renderStyleSourceTracksList();
      renderStylePartMappingsGrid();
    },
  });
}

function toggleStyleEnsembleAudition() {
  if (!currentStyleAnalysis) return;

  if (currentSlicerMode === 'multi') {
    // 多段落模式下，點擊頂部按鈕直接觸發目前選定段落的試聽/停止
    const targetIdx = currentFocusedSliceIndex < currentStyleSlices.length ? currentFocusedSliceIndex : 0;
    toggleStyleSliceAudition(targetIdx);
    return;
  }

  if (isStyleEnsemblePlaying) {
    audioEngine.stopBackingTrack();
    isStyleEnsemblePlaying = false;
    updateAuditionAllButtonText();
    return;
  }

  // 停止單軌試聽
  if (currentStyleAuditionTrackIndex !== null) {
    audioEngine.stop();
    currentStyleAuditionTrackIndex = null;
    renderStyleSourceTracksList();
    renderStylePartMappingsGrid();
  }

  const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
  const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;
  const startBar = Math.max(1, parseInt(startBarInput?.value || '1', 10));
  const endBar = Math.max(startBar, parseInt(endBarInput?.value || '4', 10));

  const division = currentStyleAnalysis.division;
  const ticksPerBar = division * 4;
  const sliceStartTick = (startBar - 1) * ticksPerBar;
  const sliceEndTick = endBar * ticksPerBar;
  const sliceTotalTicks = (endBar - startBar + 1) * ticksPerBar;

  const backingTracks: BackingTrackItem[] = [];

  for (let i = 0; i < currentStyleMappings.length; i++) {
    const mapping = currentStyleMappings[i];
    if (mapping.sourceTrackIndex === null || mapping.sourceTrackIndex === undefined) continue;

    const track = currentStyleAnalysis.tracks.find((t) => t.trackIndex === mapping.sourceTrackIndex);
    if (!track || track.notes.length === 0) continue;

    const sliceNotes = track.notes.filter((n) => n.startTick >= sliceStartTick && n.startTick < sliceEndTick);
    if (sliceNotes.length === 0) continue;

    const shift = mapping.transposeShift || 0;
    const relNotes: NoteEvent[] = sliceNotes.map((n) => ({
      note: Math.min(127, Math.max(0, n.note + shift)),
      velocity: n.velocity,
      startTick: Math.max(0, n.startTick - sliceStartTick),
      durationTick: n.durationTick,
    }));

    const styleTrack = currentStyleAnalysis.styleTracks.find((st) => st.trackIndex === mapping.sourceTrackIndex);
    const cat = styleTrack?.detectedCategory || 'other';
    const isDrum = cat === 'drums' || cat === 'percussion' || track.channel === 9;

    let instrumentId = 'grand-piano';
    if (cat === 'bass') instrumentId = 'bass';
    else if (cat === 'guitar') instrumentId = 'guitar';
    else if (cat === 'strings' || cat === 'pad') instrumentId = 'strings';
    else if (cat === 'brass') instrumentId = 'brass';
    else if (cat === 'reed') instrumentId = 'flute';

    const partConfig = DEFAULT_STYLE_PARTS[mapping.partId];
    const targetChannel = partConfig ? partConfig.channel : (8 + i);

    backingTracks.push({
      padNum: i + 1,
      notes: relNotes,
      totalTicks: sliceTotalTicks,
      channelParams: {
        msb: isDrum ? 127 : (track.bankMsb ?? 0),
        lsb: isDrum ? 0 : (track.bankLsb ?? 112),
        pc: track.programChange ?? 0,
        channel: targetChannel,
        isDrum,
        instrumentId,
      },
    });
  }

  if (backingTracks.length === 0) {
    alert(`在第 ${startBar} ~ ${endBar} 小節內，所有已指派的伴奏聲部均無音符事件！請確認小節設定或更換區間。`);
    return;
  }

  isStyleEnsemblePlaying = true;
  updateAuditionAllButtonText();

  audioEngine.startBackingTrack(backingTracks, {
    bpm: currentStyleAnalysis.bpm,
    division: currentStyleAnalysis.division,
    loop: true,
    volumeRatio: 0.8,
    onEnded: () => {
      isStyleEnsemblePlaying = false;
      updateAuditionAllButtonText();
    },
  });
}

function renderStylePartMappingsGrid() {
  const container = document.getElementById('style-parts-mapping-grid');
  if (!container || !currentStyleAnalysis) return;

  container.innerHTML = '';

  STYLE_PART_ORDER.forEach((part) => {
    const mapping = currentStyleMappings.find((m) => m.partId === part.id);
    const assignedTrackIdx = mapping?.sourceTrackIndex ?? null;
    const assignedTrack = assignedTrackIdx !== null ? currentStyleAnalysis?.tracks.find((t) => t.trackIndex === assignedTrackIdx) : null;
    const isAuditioning = assignedTrackIdx !== null && currentStyleAuditionTrackIndex === assignedTrackIdx;

    const card = document.createElement('div');
    card.className = 'style-part-card';
    card.style.borderLeft = `3px solid ${part.color}`;

    // 構建來源音軌下拉選單選項
    let optionsHtml = `<option value="-1">(無 / 留空不指派)</option>`;
    currentStyleAnalysis?.styleTracks.forEach((t) => {
      if (t.notes.length === 0) return; // 忽略無音符的導引軌
      const isSelected = assignedTrackIdx === t.trackIndex ? 'selected' : '';
      optionsHtml += `<option value="${t.trackIndex}" ${isSelected}>[軌道 ${t.trackIndex + 1}] ${escapeHtml(t.name)} (Ch ${t.channel + 1}, ${t.noteCount} 音符)</option>`;
    });

    const smartTrackIdx = currentStyleAnalysis?.autoMapping[part.id];
    const isAutoMatched = smartTrackIdx !== undefined && smartTrackIdx === assignedTrackIdx;

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 1rem;">${part.icon}</span>
          <span style="font-size: 0.82rem; font-weight: 700; color: ${part.color};">${part.title}</span>
        </div>
        <span class="badge" style="background: #1e222d; color: #94a3b8; font-size: 0.68rem; padding: 2px 6px;">
          MIDI Ch ${part.defaultCh}
        </span>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <label style="font-size: 0.72rem; color: #94a3b8;">來源 MIDI 音軌：</label>
        <select class="style-part-source-select" data-part="${part.id}" style="background: #11131a; border: 1px solid #333846; border-radius: 4px; color: ${assignedTrack ? '#f8fafc' : '#64748b'}; padding: 4px 6px; font-size: 0.78rem;">
          ${optionsHtml}
        </select>
      </div>

      ${
        isAutoMatched
          ? `<div style="font-size: 0.68rem; color: #34d399; display: flex; align-items: center; gap: 4px;">
              <span>⚡ 智慧推薦已套用</span>
            </div>`
          : ''
      }

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 2px; padding-top: 6px; border-top: 1px dashed #262936;">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span style="font-size: 0.7rem; color: #94a3b8;">移調：</span>
          <input type="number" class="style-part-shift-input" data-part="${part.id}" value="${mapping?.transposeShift || 0}" min="-36" max="36" style="width: 44px; background: #11131a; border: 1px solid #333846; border-radius: 3px; color: #fff; padding: 2px 4px; font-size: 0.72rem; text-align: center;" />
          <button type="button" class="btn-shift-quick" data-part="${part.id}" data-val="-12" style="background: #1e222d; border: 1px solid #333846; border-radius: 3px; color: #94a3b8; padding: 2px 4px; font-size: 0.65rem; cursor: pointer;">-12</button>
          <button type="button" class="btn-shift-quick" data-part="${part.id}" data-val="0" style="background: #1e222d; border: 1px solid #333846; border-radius: 3px; color: #94a3b8; padding: 2px 4px; font-size: 0.65rem; cursor: pointer;">0</button>
          <button type="button" class="btn-shift-quick" data-part="${part.id}" data-val="12" style="background: #1e222d; border: 1px solid #333846; border-radius: 3px; color: #94a3b8; padding: 2px 4px; font-size: 0.65rem; cursor: pointer;">+12</button>
        </div>

        <div>
          ${
            assignedTrack
              ? `<button type="button" class="btn-audition btn-style-audition-part ${isAuditioning ? 'playing' : ''}" data-track="${assignedTrack.trackIndex}" style="padding: 2px 6px; font-size: 0.7rem;">
                  ${isAuditioning ? '⏹ 停止' : '▶ 試聽'}
                </button>`
              : `<span style="font-size: 0.68rem; color: #64748b;">(未指定)</span>`
          }
        </div>
      </div>
    `;

    // 監聽下拉選單變更
    const sel = card.querySelector('.style-part-source-select') as HTMLSelectElement | null;
    sel?.addEventListener('change', () => {
      const trackIdx = parseInt(sel.value, 10);
      if (mapping) {
        mapping.sourceTrackIndex = trackIdx >= 0 ? trackIdx : null;
      }
      renderStylePartMappingsGrid();
    });

    // 監聽移調數值變更
    const shiftInput = card.querySelector('.style-part-shift-input') as HTMLInputElement | null;
    shiftInput?.addEventListener('change', () => {
      const shiftVal = parseInt(shiftInput.value || '0', 10);
      if (mapping) {
        mapping.transposeShift = shiftVal;
      }
    });

    // 監聽快捷移調按鈕
    card.querySelectorAll('.btn-shift-quick').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt((btn as HTMLElement).dataset.val || '0', 10);
        if (mapping && shiftInput) {
          mapping.transposeShift = val;
          shiftInput.value = `${val}`;
        }
      });
    });

    // 監聽試聽按鈕
    const btnPartAudition = card.querySelector('.btn-style-audition-part') as HTMLButtonElement | null;
    btnPartAudition?.addEventListener('click', () => {
      if (assignedTrack) {
        toggleStyleTrackAudition(assignedTrack.trackIndex);
      }
    });

    container.appendChild(card);
  });
}

function initStyleImportModal() {
  const modal = document.getElementById('style-import-modal');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-style-import-modal');
  const btnCancel = document.getElementById('btn-cancel-style-import');
  const btnAuditionAll = document.getElementById('btn-style-audition-all');
  const btnSmartAssign = document.getElementById('btn-style-smart-assign');
  const btnClearAssign = document.getElementById('btn-style-clear-assign');
  const btnConfirm = document.getElementById('btn-confirm-style-import');

  btnClose?.addEventListener('click', closeStyleImportModal);
  btnCancel?.addEventListener('click', closeStyleImportModal);
  btnAuditionAll?.addEventListener('click', toggleStyleEnsembleAudition);

  // 點擊背景遮罩防誤觸：不關閉視窗，給予柔和焦點回彈提示
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      const dialog = modal.querySelector('.modal-dialog') as HTMLElement | null;
      if (dialog) {
        dialog.classList.remove('modal-dialog-pulse');
        void dialog.offsetWidth;
        dialog.classList.add('modal-dialog-pulse');
      }
    }
  });

  // 阻止 dialog 內部點擊穿透冒泡
  const dialog = modal.querySelector('.modal-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => e.stopPropagation());
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  btnSmartAssign?.addEventListener('click', () => {
    resetStyleMappingsToSmartRecommendation();
    renderStylePartMappingsGrid();
    showStatus('⚡ 已重新套用 8 聲部智慧推薦映射！');
  });

  btnClearAssign?.addEventListener('click', () => {
    currentStyleMappings.forEach((m) => {
      m.sourceTrackIndex = null;
    });
    renderStylePartMappingsGrid();
    showStatus('🔄 已清空所有聲部來源映射。');
  });

  // Phase 3.3 切片模式切換 (多段落 vs 單一段落)
  const btnMulti = document.getElementById('btn-slicer-mode-multi');
  const btnSingle = document.getElementById('btn-slicer-mode-single');
  const slicerPanel = document.getElementById('style-slicer-panel');
  const singlePanel = document.getElementById('style-single-section-panel');

  btnMulti?.addEventListener('click', () => {
    currentSlicerMode = 'multi';
    btnMulti.classList.add('active-rp');
    btnSingle?.classList.remove('active-rp');
    if (slicerPanel) slicerPanel.style.display = 'flex';
    if (singlePanel) singlePanel.style.display = 'none';
    updateAuditionAllButtonText();
  });

  btnSingle?.addEventListener('click', () => {
    currentSlicerMode = 'single';
    btnSingle.classList.add('active-rp');
    btnMulti?.classList.remove('active-rp');
    if (slicerPanel) slicerPanel.style.display = 'none';
    if (singlePanel) singlePanel.style.display = 'flex';
    updateAuditionAllButtonText();
  });

  // 單一段落模式輸入框即時連動頂部試聽按鈕文字
  const singleSecSelect = document.getElementById('style-import-target-section');
  const singleStartInput = document.getElementById('style-import-start-bar');
  const singleEndInput = document.getElementById('style-import-end-bar');
  singleSecSelect?.addEventListener('change', updateAuditionAllButtonText);
  singleStartInput?.addEventListener('input', updateAuditionAllButtonText);
  singleEndInput?.addEventListener('input', updateAuditionAllButtonText);

  // Phase 3.3 快速曲式範本
  const btnTplSingle = document.getElementById('btn-slicer-template-single');
  const btnTplClassic4 = document.getElementById('btn-slicer-template-classic4');
  const btnTplFull = document.getElementById('btn-slicer-template-full');
  const btnAddSection = document.getElementById('btn-slicer-add-section');

  btnTplSingle?.addEventListener('click', () => {
    const tot = currentStyleAnalysis?.totalMeasures || 8;
    currentStyleSlices = [
      { id: 'sec-1', sectionName: 'Main A', startBar: 1, endBar: Math.min(4, tot) }
    ];
    currentFocusedSliceIndex = 0;
    renderStyleSlicerUI();
    updateAuditionAllButtonText();
    showStatus('⚡ 已套用「單段 Main A」切片範本');
  });

  btnTplClassic4?.addEventListener('click', () => {
    const tot = currentStyleAnalysis?.totalMeasures || 8;
    const m = Math.max(1, Math.floor(tot / 4));
    currentStyleSlices = [
      { id: 'sec-1', sectionName: 'Main A', startBar: 1, endBar: Math.min(tot, m) },
      { id: 'sec-2', sectionName: 'Fill In AA', startBar: Math.min(tot, m + 1), endBar: Math.min(tot, m + 1) },
      { id: 'sec-3', sectionName: 'Main B', startBar: Math.min(tot, m + 2), endBar: Math.min(tot, m * 2 + 1) },
      { id: 'sec-4', sectionName: 'Ending A', startBar: Math.min(tot, m * 2 + 2), endBar: tot },
    ];
    currentFocusedSliceIndex = 0;
    renderStyleSlicerUI();
    updateAuditionAllButtonText();
    showStatus('⚡ 已套用「經典 4 段 (Main A/B + Fill + Ending)」切片範本');
  });

  btnTplFull?.addEventListener('click', () => {
    const tot = currentStyleAnalysis?.totalMeasures || 16;
    currentStyleSlices = [
      { id: 'sec-1', sectionName: 'Intro A', startBar: 1, endBar: Math.min(tot, 4) },
      { id: 'sec-2', sectionName: 'Main A', startBar: Math.min(tot, 5), endBar: Math.min(tot, 8) },
      { id: 'sec-3', sectionName: 'Fill In AA', startBar: Math.min(tot, 9), endBar: Math.min(tot, 9) },
      { id: 'sec-4', sectionName: 'Main B', startBar: Math.min(tot, 10), endBar: Math.min(tot, 13) },
      { id: 'sec-5', sectionName: 'Fill In BB', startBar: Math.min(tot, 14), endBar: Math.min(tot, 14) },
      { id: 'sec-6', sectionName: 'Main C', startBar: Math.min(tot, 15), endBar: Math.min(tot, 18) },
      { id: 'sec-7', sectionName: 'Ending A', startBar: Math.min(tot, 19), endBar: Math.min(tot, 22) },
    ];
    currentFocusedSliceIndex = 0;
    renderStyleSlicerUI();
    updateAuditionAllButtonText();
    showStatus('⚡ 已套用「完整曲式 (Intro + 3 Main + 2 Fills + Ending)」切片範本');
  });

  btnAddSection?.addEventListener('click', () => {
    const tot = currentStyleAnalysis?.totalMeasures || 8;
    const lastSlice = currentStyleSlices[currentStyleSlices.length - 1];
    let nextStart = lastSlice ? lastSlice.endBar + 1 : 1;
    if (nextStart > tot) nextStart = 1;
    const nextEnd = Math.min(tot, nextStart + 3);
    const names: StyleSectionType[] = ['Main B', 'Main C', 'Main D', 'Fill In BB', 'Fill In CC', 'Ending B', 'Break'];
    const usedNames = new Set(currentStyleSlices.map(s => s.sectionName));
    const nextName = names.find(n => !usedNames.has(n)) || 'Main B';

    currentStyleSlices.push({
      id: `sec-${Date.now()}`,
      sectionName: nextName,
      startBar: nextStart,
      endBar: nextEnd,
    });
    currentFocusedSliceIndex = currentStyleSlices.length - 1;
    renderStyleSlicerUI();
    updateAuditionAllButtonText();
    showStatus(`➕ 已新增段落切片: [${nextName}] (小節 ${nextStart} ~ ${nextEnd})`);
  });

  // Phase 3.3 C 調基準自動校正監聽
  const cNormCheckbox = document.getElementById('style-import-c-norm-enable') as HTMLInputElement | null;
  const keyOverrideSelect = document.getElementById('style-import-key-override') as HTMLSelectElement | null;
  cNormCheckbox?.addEventListener('change', updateCNormUI);
  keyOverrideSelect?.addEventListener('change', updateCNormUI);

  btnConfirm?.addEventListener('click', () => {
    if (!currentStyleAnalysis) return;

    const projNameInput = document.getElementById('style-import-proj-name') as HTMLInputElement | null;
    const bpmInput = document.getElementById('style-import-bpm') as HTMLInputElement | null;
    const targetSectionSelect = document.getElementById('style-import-target-section') as HTMLSelectElement | null;
    const startBarInput = document.getElementById('style-import-start-bar') as HTMLInputElement | null;
    const endBarInput = document.getElementById('style-import-end-bar') as HTMLInputElement | null;

    const projectName = projNameInput?.value.trim() || 'My Style';
    const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));
    const targetSection = (targetSectionSelect?.value || 'Main A') as StyleSectionType;
    const startBar = Math.max(1, parseInt(startBarInput?.value || '1', 10));
    const endBar = Math.max(startBar, parseInt(endBarInput?.value || '4', 10));

    // 檢查是否有至少一個聲部有指派
    const activeAssignments = currentStyleMappings.filter((m) => m.sourceTrackIndex !== null);
    if (activeAssignments.length === 0) {
      alert('請至少為一個伴奏聲部指派來源 MIDI 軌道！');
      return;
    }

    const cNormEnableInput = document.getElementById('style-import-c-norm-enable') as HTMLInputElement | null;
    const keyOverrideSel = document.getElementById('style-import-key-override') as HTMLSelectElement | null;
    const normalizeToCRoot = cNormEnableInput ? cNormEnableInput.checked : true;
    const rootKeyOverride = keyOverrideSel && keyOverrideSel.value !== 'auto' ? keyOverrideSel.value : undefined;

    showStatus(`正在將外部 MIDI 8 聲部合成為 Yamaha Style: ${projectName}...`);

    try {
      const styleProject = StyleImporter.synthesizeStyleFromImport(currentStyleAnalysis, {
        projectName,
        bpm,
        timeSignature: currentStyleAnalysis.timeSignature,
        startBar,
        endBar,
        targetSection,
        sections: currentSlicerMode === 'multi' ? currentStyleSlices : undefined,
        partMappings: currentStyleMappings,
        normalizeToCRoot,
        rootKeyOverride,
      });

      closeStyleImportModal();

      // 序列化為 .sty 二進位 Uint8Array 並載入至工作區
      const binaryBytes = YamahaStyleSynthesizer.serializeToStyleFile(styleProject);
      renderParsed(binaryBytes, `${projectName}.sty`, 'STY');
      markModified(`從外部 MIDI [${currentStyleAnalysis.fileName}] 成功合成 Yamaha SFF2 Style 伴奏專案 (含 ${styleProject.sections.length} 個曲式段落)`);

      showStatus(`✨ 成功將外部 MIDI 合成為 Yamaha Style 伴奏專案: ${projectName}.sty (${styleProject.sections.length} 個段落)`);
    } catch (err: any) {
      alert(`合成 Yamaha Style 專案失敗: ${err.message}`);
      showStatus(`合成失敗: ${err.message}`, true);
    }
  });
}

// ==========================================
// Phase 3.3: 跨 STY 聲部混搭重組精靈 (Style Remixer)
// ==========================================

let remixerPool: StylePoolEntry[] = [];
let currentRemixerSectionTab: StyleSectionType = 'Main A';
let remixerSectionAssignments: Record<string, Record<StylePartId, StyleRemixPartAssignment>> = {};
let isRemixerAuditionPlaying = false;
let currentRemixerSoloPartId: StylePartId | null = null;

const REMIXER_SECTIONS_LIST: StyleSectionType[] = [
  'Main A',
  'Main B',
  'Main C',
  'Main D',
  'Fill In AA',
  'Fill In BB',
  'Fill In CC',
  'Fill In DD',
  'Intro A',
  'Intro B',
  'Ending A',
  'Ending B',
  'Break',
];

const REMIXER_PARTS_CONFIG: Array<{ id: StylePartId; title: string; defaultCh: number; color: string; icon: string }> = [
  { id: 'Rhythm1', title: 'Rhythm 1 (副節奏 / 擊樂打擊)', defaultCh: 9, color: '#06b6d4', icon: '🪘' },
  { id: 'Rhythm2', title: 'Rhythm 2 (主節奏 / 原廠鼓組)', defaultCh: 10, color: '#3b82f6', icon: '🥁' },
  { id: 'Bass', title: 'Bass (低音貝斯)', defaultCh: 11, color: '#10b981', icon: '🎸' },
  { id: 'Chord1', title: 'Chord 1 (主要和弦 / 鋼琴鍵盤)', defaultCh: 12, color: '#f59e0b', icon: '🎹' },
  { id: 'Chord2', title: 'Chord 2 (副和弦 / 吉他節奏)', defaultCh: 13, color: '#fb923c', icon: '🪕' },
  { id: 'Pad', title: 'Pad (鋪底弦樂 / 背景合成)', defaultCh: 14, color: '#a855f7', icon: '🎻' },
  { id: 'Phrase1', title: 'Phrase 1 (對位旋律 / 裝飾管樂)', defaultCh: 15, color: '#ec4899', icon: '🎺' },
  { id: 'Phrase2', title: 'Phrase 2 (動態副歌樂句 / 合唱)', defaultCh: 16, color: '#14b8a6', icon: '🎷' },
];

function autoInitRemixerAssignmentsIfEmpty() {
  if (remixerPool.length === 0) return;
  const firstPool = remixerPool[0];

  for (const secName of REMIXER_SECTIONS_LIST) {
    if (!remixerSectionAssignments[secName]) {
      remixerSectionAssignments[secName] = {} as any;
      for (const p of REMIXER_PARTS_CONFIG) {
        remixerSectionAssignments[secName][p.id] = {
          partId: p.id,
          sourceStyleId: firstPool.id,
          sourceSectionName: secName,
          transposeShift: 0,
        };
      }
    }
  }
}

function openStyleRemixerModal() {
  const modal = document.getElementById('style-remixer-modal');
  if (!modal) return;

  // 若當前工作區中有開啟的 STY，且伴奏庫尚為空，自動載入當前 STY
  if (remixerPool.length === 0 && currentParsed && currentParsed.format === 'STY') {
    remixerPool.push({
      id: `pool-curr-${Date.now()}`,
      name: currentFileName || 'Workspace.sty',
      parsed: currentParsed,
    });
  }

  autoInitRemixerAssignmentsIfEmpty();

  modal.style.display = 'flex';
  renderRemixerPoolUI();
  renderRemixerSectionTabsUI();
  renderRemixerPartsMatrixUI();
}

function closeStyleRemixerModal() {
  const modal = document.getElementById('style-remixer-modal');
  if (!modal) return;

  if (isRemixerAuditionPlaying || currentRemixerSoloPartId) {
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    isRemixerAuditionPlaying = false;
    currentRemixerSoloPartId = null;
    updateRemixerAuditionUI();
  }

  modal.style.display = 'none';
}

function renderRemixerPoolUI() {
  const countBadge = document.getElementById('remixer-pool-count-badge');
  const chipsContainer = document.getElementById('remixer-pool-chips');
  const drumSel = document.getElementById('remixer-global-drum-src') as HTMLSelectElement | null;
  const bassSel = document.getElementById('remixer-global-bass-src') as HTMLSelectElement | null;
  const chordSel = document.getElementById('remixer-global-chord-src') as HTMLSelectElement | null;

  if (countBadge) {
    countBadge.textContent = `${remixerPool.length} 個來源`;
  }

  if (chipsContainer) {
    chipsContainer.innerHTML = '';
    if (remixerPool.length === 0) {
      chipsContainer.innerHTML = `
        <span style="font-size: 0.78rem; color: #64748b; font-style: italic;">
          尚未載入任何 STY 伴奏檔。請點擊右上角按鈕載入示範或本機 STY。
        </span>
      `;
    } else {
      for (const item of remixerPool) {
        const chip = document.createElement('div');
        chip.style.cssText =
          'background: #1e2230; border: 1px solid #333a4d; border-radius: 6px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 8px; font-size: 0.78rem;';
        chip.innerHTML = `
          <span style="color: #f1f5f9; font-weight: 500;">🎵 ${escapeHtml(item.name)}</span>
          <span style="color: #94a3b8; font-size: 0.7rem;">(${item.parsed.sections.length} 個段落)</span>
          <button type="button" class="btn-remove-pool-item" data-id="${item.id}" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.95rem; font-weight: bold; line-height: 1; padding: 0 2px;" title="從伴奏庫移除">&times;</button>
        `;

        const btnRemove = chip.querySelector('.btn-remove-pool-item') as HTMLButtonElement | null;
        btnRemove?.addEventListener('click', (e) => {
          e.stopPropagation();
          remixerPool = remixerPool.filter((p) => p.id !== item.id);
          for (const sec of Object.keys(remixerSectionAssignments)) {
            for (const pId of Object.keys(remixerSectionAssignments[sec])) {
              if (remixerSectionAssignments[sec][pId as StylePartId]?.sourceStyleId === item.id) {
                remixerSectionAssignments[sec][pId as StylePartId].sourceStyleId = '';
              }
            }
          }
          renderRemixerPoolUI();
          renderRemixerPartsMatrixUI();
          showStatus(`已從伴奏庫移除: ${item.name}`);
        });

        chipsContainer.appendChild(chip);
      }
    }
  }

  // 更新 3 個快速全域套用下拉選單
  const globalSelects = [drumSel, bassSel, chordSel].filter(Boolean) as HTMLSelectElement[];
  for (const sel of globalSelects) {
    const curVal = sel.value;
    sel.innerHTML = '<option value="">(保留各段原設定)</option>';
    for (const item of remixerPool) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      if (curVal === item.id) opt.selected = true;
      sel.appendChild(opt);
    }
  }
}

function renderRemixerSectionTabsUI() {
  const container = document.getElementById('remixer-section-tabs');
  if (!container) return;

  container.innerHTML = '';
  for (const secName of REMIXER_SECTIONS_LIST) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `toggle-btn ${secName === currentRemixerSectionTab ? 'active-rp' : ''}`;
    btn.style.cssText = 'padding: 3px 10px; font-size: 0.76rem; border-radius: 4px;';
    btn.textContent = secName;

    btn.addEventListener('click', () => {
      if (isRemixerAuditionPlaying || currentRemixerSoloPartId) {
        audioEngine.stopBackingTrack();
        audioEngine.stop();
        isRemixerAuditionPlaying = false;
        currentRemixerSoloPartId = null;
        updateRemixerAuditionUI();
      }
      currentRemixerSectionTab = secName;
      renderRemixerSectionTabsUI();
      renderRemixerPartsMatrixUI();
    });

    container.appendChild(btn);
  }
}

function renderRemixerPartsMatrixUI() {
  const container = document.getElementById('remixer-parts-matrix');
  if (!container) return;

  if (!remixerSectionAssignments[currentRemixerSectionTab]) {
    remixerSectionAssignments[currentRemixerSectionTab] = {} as any;
    for (const p of REMIXER_PARTS_CONFIG) {
      remixerSectionAssignments[currentRemixerSectionTab][p.id] = {
        partId: p.id,
        sourceStyleId: remixerPool[0]?.id || '',
        sourceSectionName: currentRemixerSectionTab,
        transposeShift: 0,
      };
    }
  }

  container.innerHTML = '';

  for (const p of REMIXER_PARTS_CONFIG) {
    const assign = remixerSectionAssignments[currentRemixerSectionTab][p.id];
    const srcStyle = assign?.sourceStyleId ? remixerPool.find((entry) => entry.id === assign.sourceStyleId) : null;
    const srcSecName = assign?.sourceSectionName || currentRemixerSectionTab;

    let noteCount = 0;
    let voiceName = '預設音色';
    if (srcStyle) {
      const notes = StyleRemixer.extractSectionPartNotes(srcStyle.parsed, srcSecName, p.id);
      noteCount = notes.length;
      const voice = StyleRemixer.extractPartVoiceConfig(srcStyle.parsed, p.id);
      const yv = findYamahaVoice(voice.msb ?? 0, voice.lsb ?? 0, voice.pc ?? 0);
      voiceName = yv ? yv.name : `PC ${voice.pc ?? 0}`;
    }

    const isSoloing = currentRemixerSoloPartId === p.id;
    const isDrum = p.id === 'Rhythm1' || p.id === 'Rhythm2';

    const card = document.createElement('div');
    card.className = `remixer-part-card ${isSoloing ? 'section-playing' : ''}`;
    card.style.cssText = `background: #181b26; border: 1px solid ${p.color}40; border-left: 4px solid ${p.color}; border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px;`;

    // 來源段落選項
    let secOptionsHtml = `<option value="${currentRemixerSectionTab}">同名段落 (${currentRemixerSectionTab})</option>`;
    if (srcStyle) {
      const musicalSecs = StyleRemixer.getMusicalSections(srcStyle.parsed);
      for (const ms of musicalSecs) {
        const isSel = assign?.sourceSectionName === ms.name;
        secOptionsHtml += `<option value="${escapeHtml(ms.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(ms.name)}</option>`;
      }
    }

    // 來源伴奏選項
    let styleOptionsHtml = '<option value="">(無 / 靜音)</option>';
    for (const poolItem of remixerPool) {
      const isSel = assign?.sourceStyleId === poolItem.id;
      styleOptionsHtml += `<option value="${poolItem.id}" ${isSel ? 'selected' : ''}>${escapeHtml(poolItem.name)}</option>`;
    }

    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.95rem;">${p.icon}</span>
          <span style="font-size: 0.82rem; font-weight: 700; color: #f1f5f9;">${p.title}</span>
          <span style="font-size: 0.68rem; color: #94a3b8; background: #222736; padding: 1px 5px; border-radius: 3px;">Ch ${p.defaultCh}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="remixer-part-summary-badge" style="font-size: 0.7rem; color: ${srcStyle ? '#38bdf8' : '#64748b'}; background: #131620; padding: 2px 6px; border-radius: 4px; border: 1px solid #23293a;">
            ${srcStyle ? `${noteCount} 音符 | ${voiceName}` : '🔇 靜音'}
          </span>
          <button type="button" class="btn-remixer-solo toggle-btn" data-part="${p.id}" style="padding: 2px 8px; font-size: 0.7rem; ${isSoloing ? 'background: #dc2626; color: #fff; border-color: #ef4444;' : ''}" title="獨奏試聽此聲部">
            ${isSoloing ? '⏹ 停止' : '▶ 獨奏'}
          </button>
        </div>
      </div>
      <div style="display: grid; grid-template-columns: 1fr 1fr ${isDrum ? '' : 'auto'}; gap: 8px; align-items: center;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <label style="font-size: 0.68rem; color: #94a3b8;">來源伴奏 (Style)</label>
          <select class="remixer-sel-style" data-part="${p.id}" style="background: #12141c; color: #f1f5f9; border: 1px solid #333a4d; border-radius: 4px; font-size: 0.74rem; padding: 3px 6px;">
            ${styleOptionsHtml}
          </select>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <label style="font-size: 0.68rem; color: #94a3b8;">來源段落 (Section)</label>
          <select class="remixer-sel-sec" data-part="${p.id}" style="background: #12141c; color: #f1f5f9; border: 1px solid #333a4d; border-radius: 4px; font-size: 0.74rem; padding: 3px 6px;">
            ${secOptionsHtml}
          </select>
        </div>
        ${!isDrum ? `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <label style="font-size: 0.68rem; color: #94a3b8;">移調 (半音)</label>
          <input type="number" class="remixer-inp-shift" data-part="${p.id}" min="-12" max="12" value="${assign?.transposeShift ?? 0}" style="width: 54px; background: #12141c; color: #f1f5f9; border: 1px solid #333a4d; border-radius: 4px; font-size: 0.74rem; padding: 3px 4px; text-align: center;" />
        </div>
        ` : ''}
      </div>
    `;

    // 事件綁定
    const selStyle = card.querySelector('.remixer-sel-style') as HTMLSelectElement | null;
    const selSec = card.querySelector('.remixer-sel-sec') as HTMLSelectElement | null;
    const inpShift = card.querySelector('.remixer-inp-shift') as HTMLInputElement | null;
    const btnSolo = card.querySelector('.btn-remixer-solo') as HTMLButtonElement | null;

    selStyle?.addEventListener('change', () => {
      if (!assign) return;
      assign.sourceStyleId = selStyle.value;
      renderRemixerPartsMatrixUI();
    });

    selSec?.addEventListener('change', () => {
      if (!assign) return;
      assign.sourceSectionName = selSec.value;
      renderRemixerPartsMatrixUI();
    });

    inpShift?.addEventListener('change', () => {
      if (!assign) return;
      assign.transposeShift = parseInt(inpShift.value, 10) || 0;
    });

    btnSolo?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleRemixerSoloPart(p.id);
    });

    container.appendChild(card);
  }
}

function applyRemixerGlobalSources() {
  const drumStyleId = (document.getElementById('remixer-global-drum-src') as HTMLSelectElement)?.value || '';
  const bassStyleId = (document.getElementById('remixer-global-bass-src') as HTMLSelectElement)?.value || '';
  const chordStyleId = (document.getElementById('remixer-global-chord-src') as HTMLSelectElement)?.value || '';

  if (!drumStyleId && !bassStyleId && !chordStyleId) {
    showStatus('請先在快速全域選單中選取至少一個伴奏來源', true);
    return;
  }

  for (const secName of REMIXER_SECTIONS_LIST) {
    if (!remixerSectionAssignments[secName]) {
      remixerSectionAssignments[secName] = {} as any;
    }
    if (drumStyleId) {
      remixerSectionAssignments[secName]['Rhythm1'] = {
        partId: 'Rhythm1',
        sourceStyleId: drumStyleId,
        sourceSectionName: secName,
        transposeShift: 0,
      };
      remixerSectionAssignments[secName]['Rhythm2'] = {
        partId: 'Rhythm2',
        sourceStyleId: drumStyleId,
        sourceSectionName: secName,
        transposeShift: 0,
      };
    }
    if (bassStyleId) {
      remixerSectionAssignments[secName]['Bass'] = {
        partId: 'Bass',
        sourceStyleId: bassStyleId,
        sourceSectionName: secName,
        transposeShift: 0,
      };
    }
    if (chordStyleId) {
      const chordParts: StylePartId[] = ['Chord1', 'Chord2', 'Pad', 'Phrase1', 'Phrase2'];
      for (const cp of chordParts) {
        remixerSectionAssignments[secName][cp] = {
          partId: cp,
          sourceStyleId: chordStyleId,
          sourceSectionName: secName,
          transposeShift: 0,
        };
      }
    }
  }

  renderRemixerPartsMatrixUI();
  showStatus(`⚡ 已將全域配置成功套用至所有 13 個曲式段落！`);
}

function toggleRemixerSectionAudition() {
  if (isRemixerAuditionPlaying) {
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    isRemixerAuditionPlaying = false;
    currentRemixerSoloPartId = null;
    updateRemixerAuditionUI();
    showStatus('已停止混搭段落試聽');
    return;
  }

  audioEngine.stopBackingTrack();
  audioEngine.stop();
  currentRemixerSoloPartId = null;

  const secAssign = remixerSectionAssignments[currentRemixerSectionTab];
  if (!secAssign) {
    showStatus('當前段落尚未配置任何伴奏聲部', true);
    return;
  }

  const backingItems: BackingTrackItem[] = [];
  let maxTick = 480 * 16;

  for (const p of REMIXER_PARTS_CONFIG) {
    const assign = secAssign[p.id];
    if (!assign || !assign.sourceStyleId) continue;

    const srcStyle = remixerPool.find((entry) => entry.id === assign.sourceStyleId);
    if (!srcStyle) continue;

    const srcSecName = assign.sourceSectionName || currentRemixerSectionTab;
    const notes = StyleRemixer.extractSectionPartNotes(srcStyle.parsed, srcSecName, p.id);
    if (notes.length === 0) continue;

    const voice = StyleRemixer.extractPartVoiceConfig(srcStyle.parsed, p.id);
    const def = DEFAULT_STYLE_PARTS[p.id];
    const isDrum = p.id === 'Rhythm1' || p.id === 'Rhythm2';
    const shift = (!isDrum && assign.transposeShift) ? assign.transposeShift : 0;

    let matchedInst = PRESET_INSTRUMENTS.find((i) => i.pc === voice.pc && (voice.msb === 0 || i.msb === voice.msb));
    if (!matchedInst) matchedInst = PRESET_INSTRUMENTS.find((i) => i.pc === voice.pc);
    const instId = isDrum ? 'standard-drum-kit' : (matchedInst ? matchedInst.id : (p.id === 'Bass' ? 'electric-bass' : 'grand-piano'));

    const range = StyleRemixer.getSectionTickRange(srcStyle.parsed, srcSecName);
    const totalTicks = range ? range.endTick - range.startTick : 480 * 16;
    if (totalTicks > maxTick) maxTick = totalTicks;

    backingItems.push({
      padNum: def.channel,
      notes: notes.map((n) => ({
        note: shift ? Math.max(0, Math.min(127, n.note + shift)) : n.note,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTick: n.durationTick,
      })),
      totalTicks,
      channelParams: {
        volume: voice.volume ?? def.volume,
        pan: voice.pan ?? def.pan,
        reverb: voice.reverb ?? def.reverb,
        chorus: voice.chorus ?? def.chorus,
        instrumentId: instId,
        msb: voice.msb ?? def.msb,
        lsb: voice.lsb ?? def.lsb,
        pc: voice.pc ?? def.pc,
        channel: def.channel,
        isDrum,
      },
    });
  }

  if (backingItems.length === 0) {
    showStatus(`段落 [${currentRemixerSectionTab}] 中無音符可供試聽。請確認來源 Style 是否包含此段落。`, false);
    return;
  }

  const bpmInput = document.getElementById('remixer-bpm') as HTMLInputElement | null;
  const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));

  isRemixerAuditionPlaying = true;
  updateRemixerAuditionUI();

  audioEngine.startBackingTrack(backingItems, {
    bpm,
    division: 480,
    beatsPerBar: 4,
    loop: true,
    volumeRatio: 1.0,
    onEnded: () => {
      isRemixerAuditionPlaying = false;
      updateRemixerAuditionUI();
    },
  });

  showStatus(`▶ 正在試聽混搭段落: [${currentRemixerSectionTab}] (含 ${backingItems.length} 個聲部合奏)...`);
}

function toggleRemixerSoloPart(partId: StylePartId) {
  if (currentRemixerSoloPartId === partId && (audioEngine.isPlaying() || audioEngine.isBackingTrackPlaying())) {
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    currentRemixerSoloPartId = null;
    isRemixerAuditionPlaying = false;
    updateRemixerAuditionUI();
    renderRemixerPartsMatrixUI();
    showStatus(`已停止聲部 [${partId}] 獨奏`);
    return;
  }

  audioEngine.stopBackingTrack();
  audioEngine.stop();
  isRemixerAuditionPlaying = false;
  currentRemixerSoloPartId = null;

  const assign = remixerSectionAssignments[currentRemixerSectionTab]?.[partId];
  if (!assign || !assign.sourceStyleId) {
    showStatus(`聲部 [${partId}] 尚未指派來源伴奏`, true);
    return;
  }

  const srcStyle = remixerPool.find((p) => p.id === assign.sourceStyleId);
  if (!srcStyle) return;

  const srcSecName = assign.sourceSectionName || currentRemixerSectionTab;
  const notes = StyleRemixer.extractSectionPartNotes(srcStyle.parsed, srcSecName, partId);
  if (notes.length === 0) {
    showStatus(`聲部 [${partId}] 在來源段落 [${srcSecName}] 中無音符`, false);
    return;
  }

  const voice = StyleRemixer.extractPartVoiceConfig(srcStyle.parsed, partId);
  const def = DEFAULT_STYLE_PARTS[partId];
  const isDrum = partId === 'Rhythm1' || partId === 'Rhythm2';
  const shift = (!isDrum && assign.transposeShift) ? assign.transposeShift : 0;

  let matchedInst = PRESET_INSTRUMENTS.find((i) => i.pc === voice.pc && (voice.msb === 0 || i.msb === voice.msb));
  if (!matchedInst) matchedInst = PRESET_INSTRUMENTS.find((i) => i.pc === voice.pc);
  const instId = isDrum ? 'standard-drum-kit' : (matchedInst ? matchedInst.id : (partId === 'Bass' ? 'electric-bass' : 'grand-piano'));

  const range = StyleRemixer.getSectionTickRange(srcStyle.parsed, srcSecName);
  const totalTicks = range ? range.endTick - range.startTick : 480 * 16;

  const bpmInput = document.getElementById('remixer-bpm') as HTMLInputElement | null;
  const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));

  currentRemixerSoloPartId = partId;
  updateRemixerAuditionUI();
  renderRemixerPartsMatrixUI();

  audioEngine.startBackingTrack([
    {
      padNum: def.channel,
      notes: notes.map((n) => ({
        note: shift ? Math.max(0, Math.min(127, n.note + shift)) : n.note,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTick: n.durationTick,
      })),
      totalTicks,
      channelParams: {
        volume: voice.volume ?? def.volume,
        pan: voice.pan ?? def.pan,
        reverb: voice.reverb ?? def.reverb,
        chorus: voice.chorus ?? def.chorus,
        instrumentId: instId,
        msb: voice.msb ?? def.msb,
        lsb: voice.lsb ?? def.lsb,
        pc: voice.pc ?? def.pc,
        channel: def.channel,
        isDrum,
      },
    },
  ], {
    bpm,
    division: 480,
    beatsPerBar: 4,
    loop: true,
    volumeRatio: 1.0,
    onEnded: () => {
      currentRemixerSoloPartId = null;
      updateRemixerAuditionUI();
      renderRemixerPartsMatrixUI();
    },
  });

  showStatus(`▶ 正在獨奏試聽: [${partId}] (${notes.length} 音符)...`);
}

function updateRemixerAuditionUI() {
  const btnAudition = document.getElementById('btn-remixer-audition-section');
  if (btnAudition) {
    if (isRemixerAuditionPlaying) {
      btnAudition.textContent = '⏹ 停止合奏試聽';
      btnAudition.style.background = '#dc2626';
      btnAudition.style.borderColor = '#ef4444';
    } else {
      btnAudition.textContent = '🎧 試聽此段落混搭合奏';
      btnAudition.style.background = '#0284c7';
      btnAudition.style.borderColor = '#38bdf8';
    }
  }
}

function confirmStyleRemix() {
  if (remixerPool.length === 0) {
    alert('請至少載入一個 STY 伴奏來源至伴奏庫！');
    return;
  }

  const activeSections: StyleRemixSectionSpec[] = [];
  for (const secName of REMIXER_SECTIONS_LIST) {
    const secAssign = remixerSectionAssignments[secName];
    if (!secAssign) continue;

    const hasAnyPart = Object.values(secAssign).some((a) => a && a.sourceStyleId);
    if (hasAnyPart) {
      activeSections.push({
        targetSectionName: secName,
        parts: secAssign,
      });
    }
  }

  if (activeSections.length === 0) {
    alert('請至少為一個曲式段落指派伴奏聲部！');
    return;
  }

  const projNameInput = document.getElementById('remixer-proj-name') as HTMLInputElement | null;
  const bpmInput = document.getElementById('remixer-bpm') as HTMLInputElement | null;
  const projectName = projNameInput?.value.trim() || 'My Hybrid Style';
  const bpm = Math.max(30, Math.min(300, parseInt(bpmInput?.value || '120', 10)));

  showStatus(`正在混搭合成 Yamaha Style: ${projectName}...`);

  try {
    const hybridParsed = StyleRemixer.remixStyles({
      projectName,
      bpm,
      division: 480,
      timeSignature: { numerator: 4, denominator: 4 },
      pool: remixerPool,
      sections: activeSections,
    });

    closeStyleRemixerModal();

    // 序列化為 .sty 二進位 Uint8Array 並載入至工作區
    const binaryBytes = YamahaStyleSynthesizer.serializeToStyleFile(hybridParsed);
    renderParsed(binaryBytes, `${projectName}.sty`, 'STY');
    markModified(`透過跨 STY 混搭精靈成功合成全新 Yamaha SFF2 Style 伴奏專案 (含 ${hybridParsed.sections.length} 個曲式段落)`);

    showStatus(`✨ 成功合成跨 STY 混搭伴奏專案: ${projectName}.sty (${hybridParsed.sections.length} 個段落)`);
  } catch (err: any) {
    alert(`混搭合成 Yamaha Style 專案失敗: ${err.message}`);
    showStatus(`混搭合成失敗: ${err.message}`, true);
  }
}

function initStyleRemixerModal() {
  const modal = document.getElementById('style-remixer-modal');
  if (!modal) return;

  const btnClose = document.getElementById('btn-close-style-remixer-modal');
  const btnCancel = document.getElementById('btn-cancel-style-remixer');
  const btnConfirm = document.getElementById('btn-confirm-style-remixer');
  const btnHeaderRemixer = document.getElementById('btn-header-style-remixer');
  const btnOpenRemixer = document.getElementById('btn-open-style-remixer');
  const btnLoadSample = document.getElementById('btn-remixer-load-sample-sty');
  const btnAddSty = document.getElementById('btn-remixer-add-sty');
  const fileInput = document.getElementById('remixer-file-input') as HTMLInputElement | null;
  const btnApplyGlobal = document.getElementById('btn-remixer-apply-global');
  const btnAuditionSection = document.getElementById('btn-remixer-audition-section');

  btnClose?.addEventListener('click', closeStyleRemixerModal);
  btnCancel?.addEventListener('click', closeStyleRemixerModal);
  btnHeaderRemixer?.addEventListener('click', openStyleRemixerModal);
  btnOpenRemixer?.addEventListener('click', openStyleRemixerModal);

  // 點擊背景遮罩防誤觸
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      const dialog = modal.querySelector('.modal-dialog') as HTMLElement | null;
      if (dialog) {
        dialog.classList.remove('modal-dialog-pulse');
        void dialog.offsetWidth;
        dialog.classList.add('modal-dialog-pulse');
      }
    }
  });

  const dialog = modal.querySelector('.modal-dialog');
  if (dialog) {
    dialog.addEventListener('click', (e) => e.stopPropagation());
    dialog.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // 載入示範 / 當前 STY
  btnLoadSample?.addEventListener('click', async () => {
    let addedCount = 0;
    if (currentParsed && currentParsed.format === 'STY') {
      const curName = currentFileName || 'Workspace.sty';
      if (!remixerPool.some((p) => p.name === curName)) {
        remixerPool.push({
          id: `pool-curr-${Date.now()}`,
          name: curName,
          parsed: currentParsed,
        });
        addedCount++;
      }
    }

    try {
      const resp = await fetch('./samples/4006_SX900.T547.sty');
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        const parsed = YamahaParser.parse(new Uint8Array(buf), 'STY');
        if (!remixerPool.some((p) => p.name === '4006_SX900.T547.sty')) {
          remixerPool.push({
            id: `pool-sample-${Date.now()}`,
            name: '4006_SX900.T547.sty',
            parsed,
          });
          addedCount++;
        }
      }
    } catch (e) {
      console.warn('無法從網路載入 samples/4006_SX900.T547.sty', e);
    }

    if (addedCount > 0) {
      autoInitRemixerAssignmentsIfEmpty();
      renderRemixerPoolUI();
      renderRemixerSectionTabsUI();
      renderRemixerPartsMatrixUI();
      showStatus(`🎵 已成功載入 ${addedCount} 個示範 STY 伴奏檔至伴奏庫！`);
    } else {
      showStatus('伴奏庫中已有該示範伴奏檔。');
    }
  });

  // 瀏覽本機 STY 檔案
  btnAddSty?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', async (e) => {
    const files = Array.from((e.target as HTMLInputElement).files || []);
    if (files.length === 0) return;

    let successCount = 0;
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const parsed = YamahaParser.parse(new Uint8Array(buf), 'STY');
        remixerPool.push({
          id: `pool-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: file.name,
          parsed,
        });
        successCount++;
      } catch (err: any) {
        console.error(`解析檔案 ${file.name} 失敗:`, err);
        showStatus(`檔案 ${file.name} 不是有效的 Yamaha STY 伴奏檔`, true);
      }
    }

    fileInput.value = '';
    if (successCount > 0) {
      autoInitRemixerAssignmentsIfEmpty();
      renderRemixerPoolUI();
      renderRemixerSectionTabsUI();
      renderRemixerPartsMatrixUI();
      showStatus(`📂 成功匯入 ${successCount} 個 STY 伴奏檔至伴奏庫！`);
    }
  });

  // 快速全域套用
  btnApplyGlobal?.addEventListener('click', applyRemixerGlobalSources);

  // 試聽此段落混搭合奏
  btnAuditionSection?.addEventListener('click', toggleRemixerSectionAudition);

  // 確認合成混搭 Style
  btnConfirm?.addEventListener('click', confirmStyleRemix);
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
    msb: voice.msb,
    lsb: voice.lsb,
    pc: voice.pc,
    isDrum,
  });
}

function applyVoiceToPad(padNum: number, voice: YamahaVoice) {
  const ok = bindVoiceToPad(padNum, voice, { skipAudition: false, skipConfirm: false, logChange: true });
  if (ok) {
    closeVoiceModal();
  }
}

function applyVoiceToStylePart(channel: number, voice: YamahaVoice) {
  if (!currentParsed || currentParsed.format !== 'STY') return;

  const isDrum = channel === 8 || channel === 9;
  const meta = STY_PART_META[channel];
  const partName = meta?.name || `伴奏聲部 (Ch ${channel + 1})`;

  if (voice.suitability === 'warning') {
    const confirmApply = window.confirm(
      `⚠️ 避坑提醒：\n音色「${voice.name}」屬於 Organ Flutes 拉桿音色。\nYamaha PSR-SX920 琴端僅支援右手現場演奏此類即時拉桿音色，在伴奏風格中播放可能無聲音或不支援！\n\n確定仍要套用至 ${partName} 嗎？`
    );
    if (!confirmApply) return;
  }

  // 鼓組聲部 (Ch 8/9) Bank MSB 自動保護 (127: Drum Kit, 126: SFX Kit)
  let msb = voice.msb;
  if (isDrum && msb !== 126 && msb !== 127) {
    msb = 127;
  }

  // 1. 調用 YamahaStyleModifier 更新 Track 0 與 parsed.parts
  YamahaStyleModifier.setPartMixing(currentParsed, channel, {
    bankMsb: msb,
    bankLsb: voice.lsb,
    programChange: voice.pc,
  });

  // 2. 實體琴即時同步音色
  midiManager.sendVoiceChange(channel, {
    msb,
    lsb: voice.lsb,
    pc: voice.pc,
  });

  // 3. 更新畫面上的輸入框
  const inputMsb = document.querySelector(`.bank-msb-sty-${channel}`) as HTMLInputElement | null;
  const inputLsb = document.querySelector(`.bank-lsb-sty-${channel}`) as HTMLInputElement | null;
  const inputPc = document.querySelector(`.pc-sty-${channel}`) as HTMLInputElement | null;
  if (inputMsb) inputMsb.value = `${msb}`;
  if (inputLsb) inputLsb.value = `${voice.lsb}`;
  if (inputPc) inputPc.value = `${voice.pc}`;

  // 4. 試聽音色發聲
  auditionSingleVoice({ ...voice, msb });

  // 5. 變更紀錄
  markModified(`伴奏聲部 ${partName} (Ch ${channel + 1}) 音色已更換為: ${voice.name} [Bank ${msb}-${voice.lsb}, PC ${voice.pc}]`);

  // 6. 關閉視窗
  closeVoiceModal();

  // 7. 若當前正在試聽伴奏段落，重啟試聽以套用新音色
  restartCurrentStySectionAudition();
}

function renderVoiceModalList() {
  const tbody = document.getElementById('voice-list-tbody');
  const countLabel = document.getElementById('voice-count-label');
  const loadMoreContainer = document.getElementById('voice-load-more-container');
  const remainingLabel = document.getElementById('voice-remaining-count');
  if (!tbody) return;

  const voices = searchYamahaVoices(currentModalSearchQuery, currentModalCategory, currentModalSuitabilityFilter);

  if (countLabel) {
    countLabel.textContent = `共 ${voices.length} 種音色符合`;
  }

  if (voices.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 36px 12px; color: #94a3b8;">
          <div style="font-size: 1.8rem; margin-bottom: 8px;">🔍</div>
          <div>找不到符合條件的 Yamaha 原廠音色</div>
          <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">請嘗試更換關鍵字、樂器類別或切換適用度標籤</div>
        </td>
      </tr>
    `;
    if (loadMoreContainer) loadMoreContainer.style.display = 'none';
    return;
  }

  const visibleVoices = voices.slice(0, currentModalRenderLimit);

  if (loadMoreContainer && remainingLabel) {
    const remaining = voices.length - visibleVoices.length;
    if (remaining > 0) {
      loadMoreContainer.style.display = 'block';
      remainingLabel.textContent = remaining.toString();
    } else {
      loadMoreContainer.style.display = 'none';
    }
  }

  tbody.innerHTML = '';
  for (const voice of visibleVoices) {
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
    else if (voice.type === 'OrganFlutes') typeClass = 'organflutes';
    else if (voice.type === 'Legacy') typeClass = 'legacy';

    // 適用度標籤
    let suitabilityHtml = '<span class="voice-suitability-badge voice-suitability-standard">一般</span>';
    if (voice.suitability === 'recommended') {
      suitabilityHtml = `<span class="voice-suitability-badge voice-suitability-recommended" title="${escapeHtml(voice.suitabilityReason || '推薦音色')}">⭐ 推薦</span>`;
    } else if (voice.suitability === 'warning') {
      suitabilityHtml = `<span class="voice-suitability-badge voice-suitability-warning" title="${escapeHtml(voice.suitabilityReason || '避坑警示')}">⚠️ 避坑</span>`;
    }

    const targetTitle = targetModalType === 'STY'
      ? `套用至 ${getStylePartDisplayName(targetModalStyChannel)} (Ch ${targetModalStyChannel + 1})`
      : `套用至 Pad ${targetModalPadNum}`;

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
      <td style="text-align: center;">
        ${suitabilityHtml}
      </td>
      <td><code style="font-family: monospace; color: #38bdf8; font-size: 0.8rem;">${voice.msb} - ${voice.lsb}</code></td>
      <td><code style="font-family: monospace; color: #f59e0b; font-size: 0.8rem;">${voice.pc}</code></td>
      <td style="text-align: center; white-space: nowrap;">
        <button type="button" class="btn-preview-voice" title="試聽此音色發聲">▶ 試聽</button>
        <button type="button" class="btn-apply-voice" title="${targetTitle}">套用</button>
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
      if (targetModalType === 'STY') {
        applyVoiceToStylePart(targetModalStyChannel, voice);
      } else {
        applyVoiceToPad(targetModalPadNum, voice);
      }
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
    dropZone.addEventListener('click', (e) => {
      // 若點擊的是喚回卡片內的按鈕，不要觸發本地檔案選擇視窗
      if ((e.target as HTMLElement).closest('#drop-zone-resume-card')) return;
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

  // Phase 2.4: 新建空白 Multi Pad 專案按鈕與彈窗監聽
  const btnNewPad = document.getElementById('btn-new-pad');
  if (btnNewPad) {
    btnNewPad.addEventListener('click', openNewPadModal);
  }

  // Phase 4.1: 新建空白 Yamaha 伴奏風格 (.STY) 專案
  const btnNewStyle = document.getElementById('btn-new-style');
  if (btnNewStyle) {
    btnNewStyle.addEventListener('click', () => {
      const styleName = window.prompt('請輸入新伴奏風格名稱 (如: Pop Beat):', 'New Style') || 'New Style';
      const newStyle = YamahaStyleSynthesizer.createBlankStyle({ styleName });
      const bytes = YamahaStyleSynthesizer.serializeToStyleFile(newStyle);
      renderParsed(bytes, `${styleName}.sty`, 'STY');
      markModified(`已建立全新 Yamaha 伴奏風格專案: ${styleName}`);
    });
  }

  const btnCloseNewPadModal = document.getElementById('btn-close-new-pad-modal');
  if (btnCloseNewPadModal) {
    btnCloseNewPadModal.addEventListener('click', closeNewPadModal);
  }

  const btnCancelNewPad = document.getElementById('btn-cancel-new-pad');
  if (btnCancelNewPad) {
    btnCancelNewPad.addEventListener('click', closeNewPadModal);
  }

  const newPadModal = document.getElementById('new-pad-modal');
  if (newPadModal) {
    // 阻止彈窗本體 (modal-dialog) 事件冒泡
    const dialog = newPadModal.querySelector('.modal-dialog');
    if (dialog) {
      dialog.addEventListener('click', (e) => e.stopPropagation());
      dialog.addEventListener('mousedown', (e) => e.stopPropagation());
    }
  }

  // BPM 與專案名稱輸入框：焦點自動全選 (點選即全選，免手動塗抹拖曳) + Enter 鍵直接建立專案
  const newPadNameInput = document.getElementById('new-pad-name') as HTMLInputElement | null;
  const newPadBpmInput = document.getElementById('new-pad-bpm') as HTMLInputElement | null;

  const handleEnterConfirmNewPad = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const btnConfirm = document.getElementById('btn-confirm-new-pad');
      if (btnConfirm) btnConfirm.click();
    }
  };

  if (newPadNameInput) {
    newPadNameInput.addEventListener('focus', () => newPadNameInput.select());
    newPadNameInput.addEventListener('keydown', handleEnterConfirmNewPad);
  }

  if (newPadBpmInput) {
    newPadBpmInput.addEventListener('focus', () => newPadBpmInput.select());
    newPadBpmInput.addEventListener('keydown', handleEnterConfirmNewPad);
  }

  // 鍵盤 Escape 鍵支援關閉建立視窗
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (newPadModal && newPadModal.style.display !== 'none') {
        closeNewPadModal();
      }
    }
  });

  const btnConfirmNewPad = document.getElementById('btn-confirm-new-pad');
  if (btnConfirmNewPad) {
    btnConfirmNewPad.addEventListener('click', () => {
      const nameInput = document.getElementById('new-pad-name') as HTMLInputElement | null;
      const bpmInput = document.getElementById('new-pad-bpm') as HTMLInputElement | null;
      const timeSigSelect = document.getElementById('new-pad-timesig') as HTMLSelectElement | null;
      const barsSelect = document.getElementById('new-pad-bars') as HTMLSelectElement | null;
      const divisionSelect = document.getElementById('new-pad-division') as HTMLSelectElement | null;
      const casmCheckbox = document.getElementById('new-pad-inject-casm') as HTMLInputElement | null;

      const projectName = nameInput?.value.trim() || 'New Multi Pad';
      const bpm = parseInt(bpmInput?.value || '120', 10) || 120;
      const timeSigVal = timeSigSelect?.value || '4/4';
      const [numStr, denStr] = timeSigVal.split('/');
      const numerator = parseInt(numStr, 10) || 4;
      const denominator = parseInt(denStr, 10) || 4;
      const bars = parseInt(barsSelect?.value || '4', 10) || 4;
      const division = parseInt(divisionSelect?.value || '480', 10) || 480;
      const injectCasm = casmCheckbox?.checked ?? true;

      const newParsed = YamahaPadSynthesizer.createBlankProject({
        projectName,
        bpm,
        timeSignature: { numerator, denominator },
        bars,
        division,
        injectCasm,
      });

      currentParsed = newParsed;
      currentFileName = `${projectName.replace(/[\/\\?%*:|"<>]/g, '_')}.PAD`;
      isModified = true;

      if (elFilename) elFilename.textContent = currentFileName;
      if (elFormat) elFormat.textContent = 'PAD';
      if (elBpm) elBpm.textContent = `${bpm} BPM`;
      if (elTimesig) elTimesig.textContent = `${numerator}/${denominator}`;
      if (elCasm) elCasm.textContent = newParsed.hasCasm ? '已包含 (SFF2 轉調表)' : '無 (原生純淨)';

      // 停止任何舊試聽並即時同步試聽走帶控制器速度
      audioEngine.stop();
      updateAuditionUIState(null);
      const playbackBpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
      if (playbackBpmInput) {
        playbackBpmInput.value = `${bpm}`;
      }

      if (btnExport) {
        btnExport.textContent = '💾 導出 PAD 檔案';
      }

      if (viewerContainer) viewerContainer.style.display = 'block';

      renderSections(newParsed);
      renderParts(newParsed);

      // 自動展開並聚焦 Pad 1
      currentActivePadNum = 1;
      showPadNotesDetail(newParsed, newParsed.sections[0], 'Pad 1', 1);
      const pad1Card = document.querySelector('.pad-card-1') as HTMLElement | null;
      if (pad1Card) {
        document.querySelectorAll('.pad-button-card').forEach(el => el.classList.remove('active'));
        pad1Card.classList.add('active');
      }

      closeNewPadModal();
      showStatus(`🎉 已成功建立全新空白 PAD 專案「${projectName}」（共 ${bars} 小節），可直接於鋼琴卷軸畫布創作並導出！`);
    });
  }

  // Phase 2.3 & 3.2: MIDI 匯入與續接按鈕
  if (btnImportMidi) {
    btnImportMidi.addEventListener('click', () => {
      if (pendingMidiBytes) {
        openMidiModeRouterModal(pendingMidiBytes, pendingMidiFileName);
      } else {
        selectMidiFileFromDisk();
      }
    });
  }

  const btnResumeMidi = document.getElementById('btn-resume-imported-midi');
  btnResumeMidi?.addEventListener('click', () => {
    if (pendingMidiBytes) {
      openStyleImportModal(pendingMidiBytes, pendingMidiFileName);
    }
  });

  const btnDropzoneResumeStyle = document.getElementById('btn-dropzone-resume-style');
  btnDropzoneResumeStyle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pendingMidiBytes) {
      openStyleImportModal(pendingMidiBytes, pendingMidiFileName);
    }
  });

  const btnDropzoneResumePad = document.getElementById('btn-dropzone-resume-pad');
  btnDropzoneResumePad?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pendingMidiBytes) {
      openMidiImportModal(pendingMidiBytes, pendingMidiFileName);
    }
  });

  if (btnLoadSampleMid) {
    btnLoadSampleMid.addEventListener('click', () => {
      loadSampleMidi('/samples/demo_groove.mid', 'demo_groove.mid');
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

  const btnTransportPlayAll = document.getElementById('btn-transport-play-all');
  if (btnTransportPlayAll) {
    btnTransportPlayAll.addEventListener('click', () => {
      togglePlayAllPads();
    });
  }

  // 2.8-A 合奏 Pad 選擇晶片 (P1 ~ P4) 點擊切換事件
  const ensembleChips = document.querySelectorAll('.ensemble-pad-chip');
  ensembleChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const padNum = parseInt((chip as HTMLElement).dataset.pad || '0', 10);
      if (padNum < 1 || padNum > 4) return;
      if (chip.classList.contains('disabled')) {
        showStatus(`Pad ${padNum} 目前無音符可供合奏播放`, true);
        return;
      }

      if (ensembleSelectedPads.has(padNum)) {
        ensembleSelectedPads.delete(padNum);
        chip.classList.remove('active');
      } else {
        ensembleSelectedPads.add(padNum);
        chip.classList.add('active');
      }

      updateEnsembleChipsUI();

      // 若當前正在合奏中，即刻無縫刷新合奏軌道
      if (isAllPadsPlaying) {
        togglePlayAllPads(); // 停止目前合奏
        if (ensembleSelectedPads.size > 0) {
          togglePlayAllPads(); // 以新選取的 Pad 組合重新啟動
        }
      }
    });
  });

  const btnTransportStop = document.getElementById('btn-transport-stop');
  if (btnTransportStop) {
    btnTransportStop.addEventListener('click', () => {
      audioEngine.stop();
      audioEngine.stopBackingTrack();
      isAllPadsPlaying = false;
      updateEnsembleChipsUI();
      const statusBadge = document.getElementById('transport-status-badge');
      if (statusBadge) statusBadge.style.display = 'none';
      if (currentCanvasRedrawWithPlayhead) {
        currentCanvasRedrawWithPlayhead(null, []);
      }
      updateAuditionUIState(null);
    });
  }

  const btnTransportRecord = document.getElementById('btn-transport-record');
  if (btnTransportRecord) {
    btnTransportRecord.addEventListener('click', () => {
      openRecordModal(currentCanvasPadNum || 1);
    });
  }

  // 初始化 Yamaha PSR-SX920 原廠音色庫搜尋彈窗
  initVoiceSearchModal();

  // Phase 2.3: 初始化 MIDI 匯入與切片分配精靈彈窗
  initMidiImportModal();

  // Phase 3.2: 初始化 MIDI 匯入分流導航與 Style 伴奏精靈彈窗
  initMidiModeRouterModal();
  initStyleImportModal();

  // Phase 3.3: 初始化跨 STY 聲部混搭重組精靈彈窗
  initStyleRemixerModal();

  // Phase 2.7: 初始化琴端即時錄音視窗 (Live Pad Recorder)
  initPadRecordModal();

  // Phase 2.2-F: 初始化 Web MIDI 實體琴直連控制
  setupWebMidiControls();
}

/**
 * Phase 2.2-F & 3.2: 初始化 Web MIDI 實體琴直連控制與狀態燈號 (支援多處視窗聯動同步)
 */
function setupWebMidiControls() {
  // 0. 全域頂部導航列發聲路由
  const headerSelectRouting = document.getElementById('header-select-audio-routing') as HTMLSelectElement | null;

  // 1. 頂部導航列控制項
  const headerStatusLed = document.getElementById('midi-status-led');
  const headerStatusText = document.getElementById('midi-status-text');
  const headerSelectOutput = document.getElementById('select-midi-output') as HTMLSelectElement | null;
  const headerBtnConnect = document.getElementById('btn-midi-connect');
  const headerBtnTestChime = document.getElementById('btn-header-test-chime');

  // 1.5 STY 主編輯畫面伴奏發聲與走帶控制項
  const styMainAudioRouting = document.getElementById('sty-main-audio-routing') as HTMLSelectElement | null;
  const styMainMidiLed = document.getElementById('sty-main-midi-led');
  const styMainMidiText = document.getElementById('sty-main-midi-text');
  const styMainSelectOutput = document.getElementById('sty-main-select-midi-out') as HTMLSelectElement | null;
  const styMainBtnConnect = document.getElementById('btn-sty-main-connect-midi');
  const styMainBtnTestChime = document.getElementById('btn-sty-main-test-chime');
  const styPlaybackBpm = document.getElementById('sty-playback-bpm') as HTMLInputElement | null;
  const btnStyStopAll = document.getElementById('btn-sty-stop-all');

  // 2. 主走帶列路由控制項 (Pad 模式)
  const mainSelectRouting = document.getElementById('select-audio-routing') as HTMLSelectElement | null;
  const mainBtnTestChime = document.getElementById('btn-midi-test-chime');

  // 3. Style 伴奏匯入彈窗控制項 (Phase 3.2)
  const styleSelectRouting = document.getElementById('style-import-audio-routing') as HTMLSelectElement | null;
  const styleStatusLed = document.getElementById('style-import-midi-led');
  const styleStatusText = document.getElementById('style-import-midi-text');
  const styleSelectOutput = document.getElementById('style-import-select-midi-out') as HTMLSelectElement | null;
  const styleBtnConnect = document.getElementById('btn-style-import-connect-midi');
  const styleBtnTestChime = document.getElementById('btn-style-import-test-chime');

  // 4. MIDI 切片匯入彈窗控制項 (Phase 2.3)
  const midiModalSelectRouting = document.getElementById('midi-import-audio-routing') as HTMLSelectElement | null;
  const midiModalStatusLed = document.getElementById('midi-import-midi-led');
  const midiModalStatusText = document.getElementById('midi-import-midi-text');
  const midiModalSelectOutput = document.getElementById('midi-import-select-midi-out') as HTMLSelectElement | null;
  const midiModalBtnConnect = document.getElementById('btn-midi-import-connect-midi');
  const midiModalBtnTestChime = document.getElementById('btn-midi-import-test-chime');

  // 5. 跨 STY 混搭精靈發聲路由 (Phase 3.3)
  const remixerSelectRouting = document.getElementById('remixer-audio-routing') as HTMLSelectElement | null;

  const statusLeds = [headerStatusLed, styMainMidiLed, styleStatusLed, midiModalStatusLed].filter(Boolean) as HTMLElement[];
  const statusTexts = [headerStatusText, styMainMidiText, styleStatusText, midiModalStatusText].filter(Boolean) as HTMLElement[];
  const outputSelects = [headerSelectOutput, styMainSelectOutput, styleSelectOutput, midiModalSelectOutput].filter(Boolean) as HTMLSelectElement[];
  const connectBtns = [headerBtnConnect, styMainBtnConnect, styleBtnConnect, midiModalBtnConnect].filter(Boolean) as HTMLElement[];
  const testChimeBtns = [headerBtnTestChime, styMainBtnTestChime, mainBtnTestChime, styleBtnTestChime, midiModalBtnTestChime].filter(Boolean) as HTMLElement[];
  const routingSelects = [headerSelectRouting, styMainAudioRouting, mainSelectRouting, styleSelectRouting, midiModalSelectRouting, remixerSelectRouting].filter(Boolean) as HTMLSelectElement[];

  const updateMidiUI = (devices: MidiDeviceInfo[]) => {
    const selected = midiManager.getSelectedOutput();
    const currentMode = midiManager.getRoutingMode();

    // 同步所有發聲路由下拉選單
    for (const sel of routingSelects) {
      sel.value = currentMode;
    }

    if (devices.length === 0 || !selected) {
      for (const led of statusLeds) {
        led.style.background = '#94a3b8';
        led.style.boxShadow = 'none';
      }
      for (const txt of statusTexts) {
        txt.textContent = '實體琴: 未連線';
      }
      for (const sel of outputSelects) {
        sel.style.display = 'none';
      }
      for (const btn of connectBtns) {
        btn.style.display = 'inline-block';
        btn.textContent = '連接實體琴';
      }
      if (headerBtnTestChime) headerBtnTestChime.style.display = 'none';
      if (styMainBtnTestChime) styMainBtnTestChime.style.display = 'none';
      if (styleBtnTestChime) styleBtnTestChime.style.display = 'none';
      if (midiModalBtnTestChime) midiModalBtnTestChime.style.display = 'none';
    } else {
      for (const led of statusLeds) {
        led.style.background = '#22c55e';
        led.style.boxShadow = '0 0 8px #22c55e';
      }
      for (const txt of statusTexts) {
        txt.textContent = '實體琴:';
      }
      for (const sel of outputSelects) {
        sel.style.display = 'inline-block';
        sel.innerHTML = '';
        for (const d of devices) {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = `${d.isRecommended ? '🎹 ' : ''}${d.name}`;
          if (d.id === selected.id) opt.selected = true;
          sel.appendChild(opt);
        }
      }
      for (const btn of connectBtns) {
        btn.textContent = '🔄 重新整理';
      }
      if (headerBtnTestChime) headerBtnTestChime.style.display = 'inline-block';
      if (styMainBtnTestChime) styMainBtnTestChime.style.display = 'inline-block';
      if (styleBtnTestChime) styleBtnTestChime.style.display = 'inline-block';
      if (midiModalBtnTestChime) midiModalBtnTestChime.style.display = 'inline-block';
    }
  };

  refreshMidiControlsUI = (devices?: MidiDeviceInfo[]) => {
    updateMidiUI(devices || midiManager.getAvailableOutputs());
  };

  const handleConnect = async () => {
    const res = await midiManager.requestAccess();
    if (res.success) {
      updateMidiUI(res.devices);
      const sel = midiManager.getSelectedOutput();
      if (sel) {
        showStatus(`🎹 已成功連線至 Yamaha PSR-SX920: ${sel.name}！已自動啟用琴端發聲。`, false);
        midiManager.playTestChime();
      } else {
        showStatus('已開啟 MIDI 權限，但未偵測到 MIDI 輸出設備。請確認 USB 線已連接電腦與 PSR-SX920。', true);
      }
    } else {
      for (const led of statusLeds) {
        led.style.background = '#ef4444';
        led.style.boxShadow = '0 0 6px #ef4444';
      }
      showStatus(`⚠️ MIDI 連線失敗: ${res.error}`, true);
    }
  };

  for (const btn of connectBtns) {
    btn.addEventListener('click', handleConnect);
  }

  const handleOutputSelect = (id: string) => {
    midiManager.selectOutput(id);
    for (const sel of outputSelects) {
      sel.value = id;
    }
    const sel = midiManager.getSelectedOutput();
    if (sel) {
      showStatus(`🎹 已切換 MIDI 輸出埠: ${sel.name}`, false);
      midiManager.playTestChime();
    }
  };

  for (const sel of outputSelects) {
    sel.addEventListener('change', () => handleOutputSelect(sel.value));
  }

  const handleRoutingChange = async (mode: 'audio' | 'midi' | 'both') => {
    midiManager.setRoutingMode(mode);
    for (const sel of routingSelects) {
      sel.value = mode;
    }

    // 若使用者主動切換至實體琴或雙出，且尚未取得 MIDI 權限，主動請求存取
    if ((mode === 'midi' || mode === 'both') && !midiManager.getSelectedOutput()) {
      const res = await midiManager.requestAccess();
      if (res.success) {
        updateMidiUI(res.devices);
      }
    }

    const modeNames = {
      audio: '🔊 僅電腦喇叭',
      both: '🔊+🎹 雙出 (電腦+實體琴)',
      midi: '🎹 僅實體琴 (原廠音源)',
    };
    showStatus(`已切換發聲路由為: ${modeNames[mode]}`, false);
  };

  for (const sel of routingSelects) {
    sel.addEventListener('change', () => handleRoutingChange(sel.value as 'audio' | 'midi' | 'both'));
  }

  const triggerTestChime = () => {
    if (!midiManager.getSelectedOutput()) {
      showStatus('請先點選上方 [連接實體琴] 建立 USB 連線', true);
      handleConnect();
      return;
    }
    midiManager.playTestChime();
    showStatus('🔔 正在向 PSR-SX920 傳送測試音階 (C4-E4-G4-C5)...', false);
  };

  for (const btn of testChimeBtns) {
    btn.addEventListener('click', triggerTestChime);
  }

  if (btnStyStopAll) {
    btnStyStopAll.addEventListener('click', () => {
      audioEngine.stopBackingTrack();
      audioEngine.stop();
      currentAuditionStySection = null;
      updateStySectionAuditionButtons();
      showStatus('已停止所有伴奏段落試聽');
    });
  }

  if (styPlaybackBpm) {
    styPlaybackBpm.addEventListener('change', () => {
      const inputPlaybackBpm = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
      if (inputPlaybackBpm) {
        inputPlaybackBpm.value = styPlaybackBpm.value;
      }
      restartCurrentStySectionAudition();
    });
  }

  // 監聽設備插拔熱插拔事件
  midiManager.onDeviceChange((devices) => {
    updateMidiUI(devices);
    const sel = midiManager.getSelectedOutput();
    if (sel) {
      showStatus(`🔌 偵測到 MIDI 設備插拔: 目前使用 [${sel.name}]`, false);
    }
  });

  // 如果瀏覽器支援且已有授權，嘗試無感初始化
  if (midiManager.isSupported()) {
    midiManager.requestAccess().then((res) => {
      if (res.success && res.devices.length > 0) {
        updateMidiUI(res.devices);
      }
    }).catch(() => {});
  }
}

// 處理本機檔案
async function handleFile(file: File) {
  showStatus(`正在解析: ${file.name}...`);
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const ext = file.name.split('.').pop()?.toUpperCase();

    // Phase 2.3 & 3.2: 偵測到 .mid / .midi 檔案時開啟分流導航精靈
    if (ext === 'MID' || ext === 'MIDI') {
      openMidiModeRouterModal(bytes, file.name);
      return;
    }

    const format: 'STY' | 'PAD' = ext === 'PAD' ? 'PAD' : 'STY';
    renderParsed(bytes, file.name, format);
  } catch (err: any) {
    showStatus(`讀取檔案錯誤: ${err.message}`, true);
    alert(`讀取檔案錯誤: ${err.message}`);
  }
}

// Phase 2.3 & 3.2: 載入伺服器端示範 MIDI 檔案
async function loadSampleMidi(url: string, filename: string) {
  showStatus(`正在載入示範 MIDI: ${filename}...`);
  try {
    let bytes: Uint8Array;
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        bytes = new Uint8Array(buffer);
      } else {
        bytes = MidiImporter.createDemoGrooveMidi();
      }
    } catch {
      bytes = MidiImporter.createDemoGrooveMidi();
    }
    openMidiModeRouterModal(bytes, filename);
  } catch (err: any) {
    showStatus(`無法載入示範 MIDI: ${err.message}`, true);
    alert(`無法載入示範 MIDI: ${err.message}`);
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
    audioEngine.stopBackingTrack();
    currentAuditionStySection = null;
    if (format === 'STY') {
      const musicalSections = StyleRemixer.getMusicalSections(currentParsed);
      const sectionsToUse = musicalSections.length > 0 ? musicalSections : currentParsed.sections;
      const mainA = sectionsToUse.find(s => s.name.toUpperCase().includes('MAIN A') || s.name.toUpperCase() === 'MAIN A');
      currentActiveStySection = mainA ? mainA.name : (sectionsToUse[0]?.name || null);
    } else {
      currentActiveStySection = null;
    }
    updateAuditionUIState(null);
    stylePartMuteState = {};
    stylePartSoloChannel = null;
    const bpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
    const styBpmInput = document.getElementById('sty-playback-bpm') as HTMLInputElement | null;
    if (bpmInput && currentParsed.bpm) {
      bpmInput.value = `${currentParsed.bpm}`;
    }
    if (styBpmInput && currentParsed.bpm) {
      styBpmInput.value = `${currentParsed.bpm}`;
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

  // 防禦性去重：若同一音高且同一起始 Tick 出現多次，僅保留第一個
  const deduplicated: NoteEvent[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    const key = `${n.note}_${n.startTick}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(n);
    }
  }

  return deduplicated;
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

let isAllPadsPlaying: boolean = false;
let ensembleSelectedPads: Set<number> = new Set([1, 2, 3, 4]);

/**
 * 2.8-A 更新合奏 Pad 晶片選擇器 UI 狀態 (包含空音軌禁用與按鈕文字)
 */
function updateEnsembleChipsUI() {
  const btnPlayAll = document.getElementById('btn-transport-play-all') as HTMLButtonElement | null;
  const chips = document.querySelectorAll('.ensemble-pad-chip');

  chips.forEach(chip => {
    const p = parseInt((chip as HTMLElement).dataset.pad || '0', 10);
    if (p < 1 || p > 4) return;

    const track = currentParsed?.tracks[p];
    const notes = track ? extractTrackNotes(track) : [];
    const hasNotes = notes.length > 0;

    if (!hasNotes) {
      chip.classList.add('disabled');
      chip.classList.remove('active');
      ensembleSelectedPads.delete(p);
      (chip as HTMLElement).title = `Pad ${p} (無音符)`;
    } else {
      chip.classList.remove('disabled');
      if (ensembleSelectedPads.has(p)) {
        chip.classList.add('active');
        (chip as HTMLElement).title = `Pad ${p} 已加入合奏 (點擊排除)`;
      } else {
        chip.classList.remove('active');
        (chip as HTMLElement).title = `Pad ${p} 未加入合奏 (點擊加入)`;
      }
    }
  });

  if (btnPlayAll) {
    if (isAllPadsPlaying) {
      btnPlayAll.textContent = '⏹ 停止合奏';
      btnPlayAll.classList.add('playing');
    } else {
      btnPlayAll.classList.remove('playing');
      const count = ensembleSelectedPads.size;
      if (count === 4) {
        btnPlayAll.textContent = '🎼 4-Pad 合奏';
      } else if (count > 0) {
        btnPlayAll.textContent = `🎼 合奏 (${count}軌)`;
      } else {
        btnPlayAll.textContent = '🎼 合奏 (未選)';
      }
    }
  }
}

/**
 * 2.8-A 全打擊墊自選合奏播放切換 (Play Selected Ensemble Pads)
 */
function togglePlayAllPads() {
  if (!currentParsed) {
    showStatus('請先載入或建立 Yamaha PAD 專案', true);
    return;
  }

  const statusBadge = document.getElementById('transport-status-badge');

  if (isAllPadsPlaying || audioEngine.isBackingTrackPlaying()) {
    audioEngine.stop();
    audioEngine.stopBackingTrack();
    isAllPadsPlaying = false;
    updateEnsembleChipsUI();
    if (statusBadge) statusBadge.style.display = 'none';
    if (currentCanvasRedrawWithPlayhead) {
      currentCanvasRedrawWithPlayhead(null, []);
    }
    showStatus('已停止合奏播放');
    return;
  }

  // 先停止單軌試聽
  audioEngine.stop();
  updateAuditionUIState(null);

  // 收集使用者選取且具有音符的 Pads
  const allTracks: BackingTrackItem[] = [];
  for (const p of [1, 2, 3, 4]) {
    if (ensembleSelectedPads.has(p)) {
      const item = getPadBackingTrackItem(p);
      if (item) allTracks.push(item);
    }
  }

  if (allTracks.length === 0) {
    showStatus('請至少選取一個具備音符的 Pad 進行合奏 (點擊 P1~P4 晶片按鈕切換)', true);
    return;
  }

  const division = currentParsed.division || 480;
  const beatsPerBar = currentParsed.timeSignature?.numerator || 4;
  const ticksPerBar = division * beatsPerBar;
  const bpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
  const bpm = bpmInput ? parseInt(bpmInput.value, 10) || currentParsed.bpm || 120 : currentParsed.bpm || 120;

  // 計算合奏總長度小節數
  let maxTotalTicks = ticksPerBar;
  for (const track of allTracks) {
    if (track.totalTicks && track.totalTicks > 0) {
      maxTotalTicks = Math.max(maxTotalTicks, track.totalTicks);
    }
  }
  const totalBars = Math.max(1, Math.round(maxTotalTicks / ticksPerBar));

  isAllPadsPlaying = true;
  updateEnsembleChipsUI();

  const activePadList = allTracks.map(t => `P${t.padNum}`).join('+');

  audioEngine.startBackingTrack(allTracks, {
    bpm,
    division,
    beatsPerBar,
    volumeRatio: 1.0,
    loop: true,
    onProgress: (state: PlaybackState) => {
      // 即時小節與拍子狀態標籤更新 (清楚呈現目前播放至第幾小節第幾拍)
      if (statusBadge) {
        statusBadge.style.display = 'inline-block';
        statusBadge.textContent = `🎼 合奏 [${activePadList}]: 第 ${state.currentBar} / ${totalBars} 小節 第 ${state.currentBeat} 拍`;
      }

      // 畫布聯動：若目前鋼琴卷軸畫面所顯示的 Pad 參與了合奏，同步繪製走帶游標 (Playhead cursor)！
      if (currentActivePadNum !== null && ensembleSelectedPads.has(currentActivePadNum) && currentCanvasRedrawWithPlayhead) {
        currentCanvasRedrawWithPlayhead(state.relTick, []);
      }
    },
    onEnded: () => {
      isAllPadsPlaying = false;
      updateEnsembleChipsUI();
      if (statusBadge) statusBadge.style.display = 'none';
      if (currentCanvasRedrawWithPlayhead) {
        currentCanvasRedrawWithPlayhead(null, []);
      }
    }
  });

  showStatus(`🎼 正在播放 ${allTracks.length} 個 Pad 合奏 (${activePadList} 同步發聲)...`);
}

/**
 * 切換單一 Pad 的即時試聽發聲
 */
function togglePadAudition(padNum: number) {
  if (!currentParsed) return;

  if (isAllPadsPlaying) {
    audioEngine.stopBackingTrack();
    isAllPadsPlaying = false;
    updateEnsembleChipsUI();
  }

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
  let chorus = 0;

  for (const ev of track.events) {
    if (ev.type === 'programChange' && ev.program !== undefined) currentPc = ev.program;
    if (ev.type === 'controlChange') {
      if (ev.controller === 0 && ev.value !== undefined) currentMsb = ev.value;
      if (ev.controller === 32 && ev.value !== undefined) currentLsb = ev.value;
      if (ev.controller === 7 && ev.value !== undefined) volume = ev.value;
      if (ev.controller === 10 && ev.value !== undefined) pan = ev.value;
      if (ev.controller === 91 && ev.value !== undefined) reverb = ev.value;
      if (ev.controller === 93 && ev.value !== undefined) chorus = ev.value;
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
      chorus,
      instrumentId,
      msb: currentMsb,
      lsb: currentLsb,
      pc: currentPc,
      channel: padNum - 1,
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

let currentAuditionStySection: string | null = null;
let currentActiveStySection: string | null = null;

function selectStySection(sectionName: string) {
  if (!currentParsed || currentParsed.format !== 'STY') return;
  currentActiveStySection = sectionName;
  updateStySectionCardsSelection();
  updateStyPartsSectionLinkage(currentParsed, currentActiveStySection);
}

function updateStySectionCardsSelection() {
  document.querySelectorAll<HTMLElement>('.section-item[data-sec-name]').forEach(card => {
    const secName = card.dataset.secName;
    const isSelected = currentActiveStySection !== null && currentActiveStySection === secName;
    card.classList.toggle('section-selected', isSelected);

    let focusBadge = card.querySelector('.badge-section-selected');
    if (isSelected) {
      if (!focusBadge) {
        const titleContainer = card.querySelector('.section-header-title') || card.querySelector('.section-name')?.parentElement;
        if (titleContainer) {
          const badge = document.createElement('span');
          badge.className = 'badge-section-selected';
          badge.textContent = '🎯 聚焦段落';
          titleContainer.appendChild(badge);
        }
      }
    } else if (focusBadge) {
      focusBadge.remove();
    }
  });
}

function toggleStySectionAudition(sectionName: string) {
  if (!currentParsed || currentParsed.format !== 'STY') return;

  if (currentAuditionStySection === sectionName && (audioEngine.isPlaying() || audioEngine.isBackingTrackPlaying())) {
    audioEngine.stopBackingTrack();
    audioEngine.stop();
    currentAuditionStySection = null;
    updateStySectionAuditionButtons();
    showStatus(`已停止伴奏段落 [${sectionName}] 試聽`);
    return;
  }

  // 停止先前的播放
  audioEngine.stopBackingTrack();
  audioEngine.stop();
  currentAuditionStySection = null;

  const range = StyleRemixer.getSectionTickRange(currentParsed, sectionName);
  if (!range) {
    showStatus(`無法取得段落 [${sectionName}] 的時間軸範圍`, true);
    return;
  }

  const division = currentParsed.division || 480;
  const timeSig = currentParsed.timeSignature || { numerator: 4, denominator: 4 };
  const totalTicks = Math.max(division * 4, range.endTick - range.startTick);

  // 提取該段落中所有伴奏聲部的音符與音色 (直接對應混音台聲部通道與 Mute/Solo 狀態)
  const backingItems: BackingTrackItem[] = [];

  for (const part of currentParsed.parts) {
    const ch = part.channel;

    // 伴奏聲部 Mute / Solo 過濾 (直接對應混音台各列的 channel)
    if (stylePartSoloChannel !== null) {
      if (ch !== stylePartSoloChannel) continue;
    } else if (stylePartMuteState[ch]) {
      continue;
    }

    const notes = StyleRemixer.extractSectionChannelNotes(currentParsed, range.startTick, range.endTick, ch);
    if (notes.length === 0) continue;

    // 取得該通道在此段落的音色、音量與聲相設定 (優先使用本段專屬 override)
    const override = StyleRemixer.getSectionChannelOverride(currentParsed, range.startTick, range.endTick, ch);
    const msb = override.bankMsb ?? part.bankMsb ?? (ch === 8 || ch === 9 ? 127 : 0);
    const lsb = override.bankLsb ?? part.bankLsb ?? 0;
    const pc = override.pc ?? part.programChange ?? 0;
    const vol = override.volume ?? part.volume ?? 100;
    const pan = override.pan ?? part.pan ?? 64;
    const reverb = part.reverb ?? 40;
    const chorus = part.chorus ?? 0;

    // 判定是否為打擊樂器 (MIDI Ch 10 即 ch 9 固定為鼓組，或 Bank MSB 為 127/126)
    const isDrum = ch === 9 || msb === 127 || msb === 126;

    let matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === pc && (msb === 0 || i.msb === msb));
    if (!matchedInst) matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === pc);
    const meta = STY_PART_META[ch];
    const defaultInst = meta?.id === 'Bass' ? 'electric-bass' : 'grand-piano';
    const instId = isDrum ? 'standard-drum-kit' : (matchedInst ? matchedInst.id : defaultInst);

    backingItems.push({
      padNum: ch + 1,
      notes: notes.map(n => ({
        note: n.note,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTick: n.durationTick,
      })),
      totalTicks,
      channelParams: {
        volume: vol,
        pan,
        reverb,
        chorus,
        instrumentId: instId,
        msb,
        lsb,
        pc,
        channel: ch,
        isDrum,
      }
    });
  }

  if (backingItems.length === 0) {
    showStatus(`伴奏段落 [${sectionName}] 內無可試聽音符`, false);
    return;
  }

  currentAuditionStySection = sectionName;
  updateStySectionAuditionButtons();

  const styBpmInput = document.getElementById('sty-playback-bpm') as HTMLInputElement | null;
  const bpmInput = document.getElementById('input-playback-bpm') as HTMLInputElement | null;
  const bpm = styBpmInput ? (parseInt(styBpmInput.value, 10) || currentParsed.bpm || 120) : (bpmInput ? (parseInt(bpmInput.value, 10) || currentParsed.bpm || 120) : (currentParsed.bpm || 120));

  audioEngine.startBackingTrack(backingItems, {
    bpm,
    division,
    beatsPerBar: timeSig.numerator,
    volumeRatio: 1.0,
    loop: true,
    onEnded: () => {
      currentAuditionStySection = null;
      updateStySectionAuditionButtons();
    },
  });

  showStatus(`▶ 正在試聽 STY 伴奏段落: [${sectionName}] (${range.measureCount} 小節，共 ${backingItems.length} 個發聲聲部)...`);
}

function updateStySectionAuditionButtons() {
  document.querySelectorAll<HTMLButtonElement>('.btn-sty-section-audition').forEach(btn => {
    const secName = btn.dataset.sec;
    const isPlaying = currentAuditionStySection !== null && currentAuditionStySection === secName;
    const card = btn.closest('.section-item');
    if (isPlaying) {
      btn.textContent = '⏹ 停止';
      btn.style.background = '#dc2626';
      btn.style.borderColor = '#ef4444';
      card?.classList.add('section-playing');
    } else {
      btn.textContent = '▶ 試聽';
      btn.style.background = '';
      btn.style.borderColor = '';
      card?.classList.remove('section-playing');
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

  const styAuditionBar = document.getElementById('sty-audition-bar');
  if (styAuditionBar) {
    styAuditionBar.style.display = isPad ? 'none' : 'flex';
  }

  const btnOpenRemixer = document.getElementById('btn-open-style-remixer');
  if (btnOpenRemixer) {
    btnOpenRemixer.style.display = isPad ? 'none' : 'inline-flex';
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
      let startTagHtml = '';
      if (padNoteCount > 0) {
        const ticksPerBeat = parsed.division || 96;
        const beatsPerBar = parsed.timeSignature?.numerator || 4;
        const ticksPerBar = ticksPerBeat * beatsPerBar;
        const gridStart = Math.floor(minT / ticksPerBar) * ticksPerBar;
        const bars = Math.max(1, Math.ceil((maxT - gridStart) / ticksPerBar));
        barsText = `${padNoteCount} 顆音符 (${bars} 小節)`;

        const startBar = Math.floor(minT / ticksPerBar) + 1;
        const endBar = maxT % ticksPerBar === 0 ? (maxT / ticksPerBar) : (Math.floor(maxT / ticksPerBar) + 1);
        startTagHtml = `<span style="font-size: 0.72rem; color: #34d399; font-weight: 600; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 4px; padding: 1px 6px;" title="全曲時間軸絕對位置: 第 ${startBar} 小節起">📍 M${startBar} 起 (${startBar}~${endBar}節)</span>`;
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

      const padThemes = [
        { text: '#60a5fa', bg: 'rgba(59, 130, 246, 0.18)', border: 'rgba(59, 130, 246, 0.4)' },
        { text: '#34d399', bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.4)' },
        { text: '#fbbf24', bg: 'rgba(245, 158, 11, 0.18)', border: 'rgba(245, 158, 11, 0.4)' },
        { text: '#f472b6', bg: 'rgba(236, 72, 153, 0.18)', border: 'rgba(236, 72, 153, 0.4)' },
      ];
      const curTheme = padThemes[padIdx] || padThemes[0];

      item.innerHTML = `
        <div class="pad-header">
          <div class="pad-header-top">
            <div class="pad-badge-group">
              <span class="pad-number-badge" style="color: ${curTheme.text}; background: ${curTheme.bg}; border: 1px solid ${curTheme.border};">PAD ${padNum}</span>
              <span class="pad-raw-tag" title="Yamaha 底層段落標記: ${sec ? sec.name : 'Track ' + padNum}">${sec ? sec.name : 'Track ' + padNum}</span>
            </div>
            <button type="button" class="btn-audition btn-audition-${padNum}" data-pad="${padNum}" title="點擊試聽此打擊墊旋律">▶ 試聽</button>
          </div>
          <input type="text" class="pad-name-input" value="${escapeHtml(customName)}" title="點擊修改名稱 (Enter 儲存)" />
        </div>
        <div class="pad-body">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 6px;">
            <div class="pad-bars-text" style="margin-bottom: 0;">${barsText}</div>
            ${startTagHtml}
          </div>
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
            <button type="button" class="btn-open-record-modal" data-pad="${padNum}" title="開啟 PSR-SX920 琴端即時錄音視窗 (支援電腦鍵盤模擬)" style="background: linear-gradient(135deg, #ef4444, #dc2626); color: #fff; border: 1px solid #ef4444; border-radius: 4px; padding: 3px 8px; font-size: 0.72rem; cursor: pointer; font-weight: 600;">🔴 琴端錄音</button>
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

      // 0.6 琴端即時錄音按鈕事件
      const btnOpenRecord = item.querySelector(`.btn-open-record-modal[data-pad="${padNum}"]`) as HTMLButtonElement | null;
      if (btnOpenRecord) {
        btnOpenRecord.addEventListener('click', (e) => {
          e.stopPropagation();
          openRecordModal(padNum);
        });
      }

      // 1. 名稱編輯事件
      const nameInput = item.querySelector('.pad-name-input') as HTMLInputElement;
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      nameInput.addEventListener('focus', () => nameInput.select());
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur();
      });
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

        // C. 實體琴即時同步音色
        midiManager.sendVoiceChange(padNum - 1, {
          msb: selected.msb,
          lsb: selected.lsb,
          pc: selected.pc,
        });

        // D. 連動更新下方「聲部混音與音色配置」表格中的對應欄位
        updatePartsTableRowVoice(padNum, selected.msb, selected.lsb, selected.pc);

        markModified(`Pad ${padNum} 演奏樂器已更換為: ${selected.label} (Bank ${selected.msb}-${selected.lsb}, PC ${selected.pc})`);

        // E. 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
        if (currentActivePadNum === padNum) {
          showPadNotesDetail(parsed, sec || null, nameInput.value, padNum);
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
        showPadNotesDetail(parsed, sec || null, nameInput.value, padNum);
      });

      // 預設選取 Pad 1
      if (padNum === 1) {
        currentActivePadNum = 1;
        setTimeout(() => {
          item.classList.add('active');
          const matchingRow = document.querySelector('.pad-table-row-1');
          if (matchingRow) matchingRow.classList.add('active-row');
          showPadNotesDetail(parsed, sec || null, customName, 1);
        }, 50);
      }

      sectionsList.appendChild(item);
    }
    // 2.8-A 同步更新合奏晶片選擇狀態
    updateEnsembleChipsUI();
  } else {
    sectionsList.className = 'section-grid';
    // STY 模式：Yamaha 原廠伴奏段落卡片 (支援即時試聽、小節範圍與聲部統計)
    const musicalSections = StyleRemixer.getMusicalSections(parsed);
    const sectionsToRender = musicalSections.length > 0 ? musicalSections : parsed.sections;

    for (const sec of sectionsToRender) {
      const item = document.createElement('div');
      const lower = sec.name.toLowerCase();

      let typeClass = 'main';
      if (lower.includes('intro')) typeClass = 'intro';
      else if (lower.includes('fill')) typeClass = 'fill';
      else if (lower.includes('ending')) typeClass = 'ending';
      else if (lower.includes('break')) typeClass = 'break';

      const range = StyleRemixer.getSectionTickRange(parsed, sec.name);
      const startTick = range ? range.startTick : sec.startTick;
      const endTick = range ? range.endTick : (sec.endTick ?? startTick + (sec.measureCount || 4) * (parsed.division || 480) * 4);
      const bars = range ? range.measureCount : (sec.measureCount || Math.max(1, Math.round((endTick - startTick) / ((parsed.division || 480) * 4))));

      const isPlaying = currentAuditionStySection === sec.name;
      const isSelected = currentActiveStySection === sec.name;

      item.className = `section-item ${typeClass} interactive ${isSelected ? 'section-selected' : ''} ${isPlaying ? 'section-playing' : ''}`;
      item.dataset.secName = sec.name;
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
          <div>
            <div class="section-header-title" style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span class="section-name" style="font-size: 1rem; font-weight: 700; color: #f8fafc;">${escapeHtml(sec.name)}</span>
              ${isSelected ? '<span class="badge-section-selected">🎯 聚焦段落</span>' : ''}
            </div>
            <div class="section-details" style="font-size: 0.74rem; color: #94a3b8; margin-top: 2px;">Tick: ${startTick} ~ ${endTick}</div>
          </div>
          <button type="button" class="btn-audition btn-sty-section-audition" data-sec="${escapeHtml(sec.name)}" title="點擊試聽此段落伴奏合奏" style="padding: 3px 10px; font-size: 0.74rem; ${isPlaying ? 'background: #dc2626; border-color: #ef4444;' : ''}">
            ${isPlaying ? '⏹ 停止' : '▶ 試聽'}
          </button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.06);">
          <span style="font-size: 0.76rem; font-weight: 600; color: #a5b4fc;">
            ${bars} 小節
          </span>
          <span style="font-size: 0.72rem; color: #38bdf8; background: rgba(56, 189, 248, 0.12); padding: 1px 6px; border-radius: 4px;">
            Yamaha Section
          </span>
        </div>
      `;

      const btnAudition = item.querySelector('.btn-sty-section-audition') as HTMLButtonElement | null;
      btnAudition?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectStySection(sec.name);
        toggleStySectionAudition(sec.name);
      });

      // 點擊卡片本體聚焦選取該段落
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.btn-sty-section-audition')) return;
        selectStySection(sec.name);
      });

      sectionsList.appendChild(item);
    }
  }

  // 若為 STY 格式則隱藏 Pad 專屬面板
  const padDetailContainer = document.getElementById('pad-detail-container');
  if (padDetailContainer && !isPad) {
    padDetailContainer.style.display = 'none';
  }
}

// 音符名稱輔助轉換 (MIDI Note Number ➔ 音名，如 60 ➔ C3)
function midiNoteToName(note: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  return `${noteNames[note % 12]}${octave}`;
}

// 格式化全曲絕對音樂位置 (小節、拍、細分)
function formatAbsolutePosition(
  absTick: number,
  ticksPerBeat: number = 96,
  beatsPerBar: number = 4
): {
  bar: number;
  beat: number;
  tickInBeat: number;
  fractionOfBeat: number;
  beatText: string;
  summary: string;
  standard: string;
} {
  const ticksPerBar = ticksPerBeat * beatsPerBar;
  const bar = Math.floor(absTick / ticksPerBar) + 1;
  const tickInBar = absTick % ticksPerBar;
  const beat = Math.floor(tickInBar / ticksPerBeat) + 1;
  const tickInBeat = tickInBar % ticksPerBeat;
  const fractionOfBeat = tickInBeat / ticksPerBeat;

  let beatText = `第 ${beat} 拍`;
  if (tickInBeat === 0 || fractionOfBeat < 0.04) {
    beatText = `第 ${beat} 拍`;
  } else if (Math.abs(fractionOfBeat - 0.5) < 0.06) {
    beatText = `第 ${beat}.5 拍`;
  } else if (Math.abs(fractionOfBeat - 0.25) < 0.05) {
    beatText = `第 ${beat} 拍 1/4 處`;
  } else if (Math.abs(fractionOfBeat - 0.75) < 0.05) {
    beatText = `第 ${beat} 拍 3/4 處`;
  } else {
    beatText = `第 ${beat} 拍 (+${tickInBeat}T)`;
  }

  const ticksPer16th = ticksPerBeat / 4;
  const sub16th = Math.floor(tickInBeat / ticksPer16th) + 1;
  const tickRemainder = Math.round(tickInBeat % ticksPer16th);
  const standard = `${bar}.${beat}.${sub16th}.${tickRemainder.toString().padStart(2, '0')}`;
  const summary = `第 ${bar} 小節 ${beatText}`;

  return { bar, beat, tickInBeat, fractionOfBeat, beatText, summary, standard };
}

// 展開並繪製指定 Pad 的詳細音符
function showPadNotesDetail(parsed: YamahaFileParsed, sec: YamahaSection | null | undefined, padLabel: string, padNum: number) {
  const container = document.getElementById('pad-detail-container');
  const titleEl = document.getElementById('pad-detail-title');
  const summaryEl = document.getElementById('pad-detail-summary');
  const badgeEl = document.getElementById('pad-detail-badge');
  const startBadgeEl = document.getElementById('pad-detail-start-badge');
  const canvas = document.getElementById('pad-note-canvas') as HTMLCanvasElement | null;

  if (!container || !titleEl || !summaryEl || !badgeEl || !canvas) return;
  container.style.display = 'block';

  // 僅在切換不同 Pad 時才重設視野起始小節，編輯同一個 Pad 時保留當前檢視小節
  if (currentCanvasPadNum !== padNum) {
    rollStartBar = 1;
    selectedRulerBar = null;
  }
  resetHoverInfo();

  // 搜尋對應 Track 提取音符 (在 Yamaha PAD 中，Track 1~4 分別代表 Pad 1~4 的專屬音軌)
  const trackIdx = padNum; // Track 1~4
  const targetTrack = parsed.tracks[trackIdx];
  if (targetTrack) {
    YamahaPadModifier.sanitizeTrackDuplicateNotes(targetTrack);
  }
  const notes = extractTrackNotes(targetTrack);

  // 同步試聽走帶控制器狀態
  updateAuditionUIState(audioEngine.isPlaying() ? audioEngine.getPlayingPadNum() : null);

  const secName = sec ? ` (底層標記: ${sec.name})` : '';
  titleEl.textContent = `${padLabel}${secName} 詳細內容`;

  const explicitBars = YamahaPadModifier.getPadBarLength(parsed, padNum);
  const ticksPerBeat = parsed.division || 96;
  const beatsPerBar = parsed.timeSignature?.numerator || 4;
  const ticksPerBar = ticksPerBeat * beatsPerBar;

  let actualBars = explicitBars;
  let firstNoteTick = 0;
  let lastNoteTick = explicitBars * ticksPerBar;
  let minNote = 48; // C3
  let maxNote = 72; // C5
  let avgVel = 100;

  if (notes.length > 0) {
    minNote = Math.min(...notes.map(n => n.note));
    maxNote = Math.max(...notes.map(n => n.note));
    avgVel = Math.round(notes.reduce((sum, n) => sum + n.velocity, 0) / notes.length);
    firstNoteTick = Math.min(...notes.map(n => n.startTick));
    lastNoteTick = Math.max(...notes.map(n => n.startTick + n.durationTick));
    const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
    actualBars = Math.max(1, Math.ceil((lastNoteTick - gridStartTick) / ticksPerBar), explicitBars);
  }

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
    msb: currentMsb,
    lsb: currentLsb,
    channel: padNum - 1,
    isDrum: (currentPc >= 120 || (yVoice && (yVoice.category === 'Drums' || yVoice.category === 'Percussion'))),
  };

  if (notes.length === 0) {
    if (startBadgeEl) {
      startBadgeEl.textContent = `📍 全曲起點: 第 1 小節 第 1 拍 (全曲第 1 ~ ${explicitBars} 小節)`;
      startBadgeEl.title = '此 Pad 目前為空白小節，可直接點擊畫布或新增音符開始創作';
    }
    badgeEl.textContent = `共 ${explicitBars} 小節 (空白)`;
    summaryEl.innerHTML = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; margin-right: 8px;">演奏音色: ${voiceName}</span> <span>共 0 顆音符 (空白)</span> | <span>音域: C3 (48) ~ C5 (72)</span> | <span style="color: #fbbf24; font-weight: 600;">💡 雙擊畫布或使用畫筆新增音符</span>`;
  } else {
    const absStart = formatAbsolutePosition(firstNoteTick, ticksPerBeat, beatsPerBar);
    const absEndBar = lastNoteTick % ticksPerBar === 0 ? (lastNoteTick / ticksPerBar) : (Math.floor(lastNoteTick / ticksPerBar) + 1);

    if (startBadgeEl) {
      startBadgeEl.textContent = `📍 全曲起點: ${absStart.summary} (全曲第 ${absStart.bar} ~ ${absEndBar} 小節)`;
      startBadgeEl.title = `絕對音符起始位置: DAW標記 ${absStart.standard}，相對於全曲時間軸第 ${absStart.bar} 小節 ${absStart.beatText}`;
    }
    badgeEl.textContent = `⏱️ 音符範圍 Tick: ${firstNoteTick} ~ ${lastNoteTick} (共 ${actualBars} 小節)`;
    summaryEl.innerHTML = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; margin-right: 8px;">演奏音色: ${voiceName}</span> <span>共 ${notes.length} 顆音符</span> | <span>音域: ${midiNoteToName(minNote)} (${minNote}) ~ ${midiNoteToName(maxNote)} (${maxNote})</span> | <span>平均力度: ${avgVel}</span>`;
  }

  drawNoteRoll(canvas, notes, padNum, ticksPerBeat, beatsPerBar);
  setupMeasureControls();
  setupOctaveAndQuantizeControls();
  updateMeasureControlsUI(actualBars);

  // 若當前有已選取的音符，重新在最新渲染方塊中比對並維持選取態
  if (selectedNoteBoxes.length > 0) {
    const reFoundList: RenderedNoteBox[] = [];
    for (const prev of selectedNoteBoxes) {
      const found = lastRenderedNoteBoxes.find(b => b.startTick === prev.startTick && b.note === prev.note);
      if (found) reFoundList.push(found);
    }
    selectedNoteBoxes = reFoundList;
    if (selectedNoteBoxes.length === 1) {
      selectedNoteBox = selectedNoteBoxes[0];
      updateInspectorFields(selectedNoteBox);
    } else if (selectedNoteBoxes.length > 1) {
      selectedNoteBox = selectedNoteBoxes[0];
      updateBatchInspectorUI();
    } else {
      deselectNote();
    }
  } else if (selectedNoteBox) {
    const reFound = lastRenderedNoteBoxes.find(b => b.startTick === selectedNoteBox!.startTick && b.note === selectedNoteBox!.note);
    if (reFound) {
      selectedNoteBox = reFound;
      selectedNoteBoxes = [reFound];
      updateInspectorFields(reFound);
    } else {
      deselectNote();
    }
  }
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
let selectedNoteBoxes: RenderedNoteBox[] = [];
let isMarqueeSelecting = false;
let marqueeStart: { x: number; y: number; clientX: number; clientY: number } | null = null;
let marqueeCurrent: { x: number; y: number } | null = null;
let currentCanvasPadInstrument: {
  instrumentId?: string;
  pc?: number;
  msb?: number;
  lsb?: number;
  channel?: number;
  isDrum?: boolean;
} = {};
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
let potentialResizeTarget: RenderedNoteBox | null = null;
let resizingStartMouseX = 0;
let resizingStartDuration = 0;
let currentResizingDuration = 0;
let hasJustDragged = false;
let resizingPreviewDuration: { startTick: number; note: number; durationTick: number } | null = null;
let currentPlotW = 1000;
let currentWindowTotalTicks = 384;
let currentWindowStartTick = 0;
let currentDisplayMaxNote = 72;
let currentSemitoneH = 15;
let isDrawMode = false;
let isCreationControlsBound = false;
let isMeasureControlsBound = false;
interface RenderedRulerBox {
  barNum: number;
  x: number;
  w: number;
}
let lastRenderedRulerBoxes: RenderedRulerBox[] = [];
let selectedRulerBar: number | null = null;
let clipboardCopiedBar: number | null = null;
let lastNoteCreationTimestamp = 0;

// 音符平移調整狀態 (Note Position Moving State)
let isMovingNote = false;
let potentialMoveTarget: RenderedNoteBox | null = null;
let movingStartMouseX = 0;
let movingStartMouseY = 0;
let movingStartTick = 0;
let currentMovingStartTick = 0;
let movingPreviewStartTick: { oldStartTick: number; note: number; newStartTick: number } | null = null;
let currentGridStartTick = 0;

// 力度軌道 (Velocity Lane) 調整狀態
interface RenderedVelocityStalk {
  x: number;
  topY: number;
  baseY: number;
  note: number;
  velocity: number;
  startTick: number;
  durationTick: number;
}

let isVelocityLaneVisible = false;
let isDraggingVelocity = false;
let velocityDragTarget: RenderedVelocityStalk | null = null;
let velocityStartMouseY = 0;
let velocityStartVal = 0;
let currentVelocityDragVal = 0;
let velocityPreviewOverride: { startTick: number; note: number; velocity: number } | null = null;
let lastRenderedVelocityStalks: RenderedVelocityStalk[] = [];
let hoveredVelocityStalk: RenderedVelocityStalk | null = null;
let isVelocityEventsBound = false;
let isVelocityToggleBound = false;

function isMouseNearRightEdge(b: RenderedNoteBox, mouseX: number, mouseY: number): boolean {
  if (mouseY < b.y - 2 || mouseY > b.y + b.h + 2) return false;
  const rightEdge = b.x + b.w;
  const edgeWidth = Math.min(10, Math.max(5, b.w * 0.35));
  return mouseX >= rightEdge - edgeWidth && mouseX <= rightEdge + 4;
}

function resetHoverInfo() {
  hoveredNoteBox = null;
  hoveredVelocityStalk = null;
  const hoverInfoEl = document.getElementById('canvas-hover-info');
  if (hoverInfoEl) {
    hoverInfoEl.textContent = '💡 雙擊空白處新增音符 ｜ 點選音符微調音高 (▲/▼ 或方向鍵 ↑/↓)、平移 (↔ 或 ◀/▶)、Delete 鍵刪除 ｜ 下方 📊 力度軌道可調力度';
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
  // 垂直音高基準 (保留適度邊距；若為空白 Pad 預設顯示舒適雙八度 C3 ~ C5)
  const hasNotes = notes.length > 0;
  const minNote = hasNotes ? Math.min(...notes.map(n => n.note)) : 48; // C3
  const maxNote = hasNotes ? Math.max(...notes.map(n => n.note)) : 72; // C5
  const displayMinNote = hasNotes ? Math.max(0, minNote - 1) : 48;
  const displayMaxNote = hasNotes ? Math.min(127, maxNote + 1) : 72;
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
  const explicitBars = currentParsed ? YamahaPadModifier.getPadBarLength(currentParsed, padNum) : 4;
  const firstNoteTick = notes.length > 0 ? Math.min(...notes.map(n => n.startTick)) : 0;
  const lastNoteTick = notes.length > 0 ? Math.max(...notes.map(n => n.startTick + n.durationTick)) : explicitBars * ticksPerBar;

  // 時間基準：向左對齊至整數小節起點
  const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
  currentGridStartTick = gridStartTick;
  const totalDurationTicks = Math.max(lastNoteTick - gridStartTick, ticksPerBar);
  const notesBars = Math.max(1, Math.ceil(totalDurationTicks / ticksPerBar));
  const totalBars = Math.max(notesBars, explicitBars);
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
    let viewBars = 4;

    if (rollViewMode === '4bars') {
      const visibleBars = 4;
      if (totalBars > 4) {
        const maxStartBar = Math.max(1, totalBars - visibleBars + 1);
        rollStartBar = Math.max(1, Math.min(rollStartBar, maxStartBar));
        viewStartBar = rollStartBar;
        viewBars = visibleBars;
      } else {
        viewStartBar = 1;
        viewBars = 4;
      }
    } else {
      // rollViewMode === 'all'
      viewStartBar = 1;
      viewBars = Math.max(4, totalBars);
    }

    const windowStartTick = gridStartTick + (viewStartBar - 1) * ticksPerBar;
    const windowTotalTicks = viewBars * ticksPerBar;
    const windowEndTick = windowStartTick + windowTotalTicks;

    currentPlotW = plotW;
    currentWindowTotalTicks = windowTotalTicks;
    currentWindowStartTick = windowStartTick;
    currentDisplayMaxNote = displayMaxNote;

    ctx.clearRect(0, 0, w, h);

    // 1. Piano Roll 主體背景
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(scaleW, rulerH, plotW, plotH);

    // 2. 水平音高線 (黑白琴鍵交替底色)
    const semitoneH = plotH / noteRange;
    currentSemitoneH = semitoneH;
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

    // 4.1 若總小節數小於當前視野所涵蓋小節 (例如手動設定為 2 小節，但在 4 小節標準視野下)，繪製循環終點標線與非循環區遮罩
    if (totalBars < viewStartBar + viewBars) {
      const activeEndBar = Math.max(0, totalBars - viewStartBar + 1);
      if (activeEndBar > 0 && activeEndBar < viewBars) {
        const activeEndX = scaleW + (activeEndBar / viewBars) * plotW;
        // 非循環區背景遮罩 (暗化休止/非循環區)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.fillRect(activeEndX, rulerH, plotW - (activeEndX - scaleW), plotH);

        // 循環終點標記線 (Pad Loop End)
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(activeEndX, rulerH);
        ctx.lineTo(activeEndX, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // 提示標籤
        ctx.fillStyle = '#fbbf24';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`⮜ Pad 循環結尾 (共 ${totalBars} 小節)`, activeEndX - 6, rulerH + 16);
      }
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

    lastRenderedRulerBoxes = [];
    for (let bar = 0; bar < viewBars; bar++) {
      const barX = scaleW + (bar / viewBars) * plotW;
      const nextBarX = scaleW + ((bar + 1) / viewBars) * plotW;
      const currentBarNum = viewStartBar + bar;

      lastRenderedRulerBoxes.push({
        barNum: currentBarNum,
        x: barX,
        w: nextBarX - barX,
      });

      // 小節標籤選取高亮背景
      if (selectedRulerBar === currentBarNum) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.28)';
        ctx.fillRect(barX, 0, nextBarX - barX, rulerH);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX, 0, nextBarX - barX, rulerH);
      }

      // 小節標籤 (第 X 小節)
      const isPastLoop = currentBarNum > totalBars;
      ctx.fillStyle = selectedRulerBar === currentBarNum ? '#fbbf24' : (isPastLoop ? '#64748b' : '#f8fafc');
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      const absBarNum = Math.floor(gridStartTick / ticksPerBar) + currentBarNum;
      const absSuffix = (gridStartTick > 0) ? ` [M${absBarNum}]` : '';
      ctx.fillText(`第 ${currentBarNum} 小節${absSuffix}${isPastLoop ? ' (未啟用)' : ''}`, barX + 8, rulerH - 8);

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
      let currentStartTick = n.startTick;
      let currentDuration = n.durationTick;

      // 邊緣拖曳縮放預覽
      if (resizingPreviewDuration && resizingPreviewDuration.startTick === n.startTick && resizingPreviewDuration.note === n.note) {
        currentDuration = resizingPreviewDuration.durationTick;
      }

      // 本體拖曳平移預覽
      if (movingPreviewStartTick && movingPreviewStartTick.oldStartTick === n.startTick && movingPreviewStartTick.note === n.note) {
        currentStartTick = movingPreviewStartTick.newStartTick;
      }

      const noteEndTick = currentStartTick + currentDuration;
      // 排除視窗以外的音符
      if (noteEndTick <= windowStartTick || currentStartTick >= windowEndTick) {
        continue;
      }

      const relTick = currentStartTick - windowStartTick;
      const x = scaleW + (relTick / windowTotalTicks) * plotW;
      const noteW = Math.max((currentDuration / windowTotalTicks) * plotW, 5);
      const rowY = rulerH + (displayMaxNote - n.note) * semitoneH;
      const noteH = Math.max(semitoneH - 2, 6);
      const noteY = rowY + 1;

      // 絕對位置以全段 gridStartTick 為基準計算
      const absRelTick = currentStartTick - gridStartTick;
      const pos = formatNotePosition(absRelTick, ticksPerBeat, beatsPerBar);

      const box: RenderedNoteBox = {
        x, y: noteY, w: noteW, h: noteH,
        note: n.note, velocity: n.velocity,
        startTick: currentStartTick, durationTick: currentDuration,
        posChinese: pos.chinese,
        posStandard: pos.standard,
        posDisplayFull: pos.displayFull,
      };
      boxes.push(box);

      let currentVelocity = n.velocity;
      if (velocityPreviewOverride && velocityPreviewOverride.startTick === n.startTick && velocityPreviewOverride.note === n.note) {
        currentVelocity = velocityPreviewOverride.velocity;
      }

      const isSelected = selectedNoteBoxes.some(b => b.startTick === n.startTick && b.note === n.note) ||
                         (selectedNoteBox !== null && selectedNoteBox.startTick === n.startTick && selectedNoteBox.note === n.note);
      const isHovered = (highlightedBox && highlightedBox.startTick === n.startTick && highlightedBox.note === n.note) ||
                        (hoveredVelocityStalk && hoveredVelocityStalk.startTick === n.startTick && hoveredVelocityStalk.note === n.note);
      const isSounding = playheadRelTick !== null && playheadRelTick !== undefined &&
        (playheadRelTick >= (currentStartTick - gridStartTick)) &&
        (playheadRelTick < (currentStartTick + currentDuration - gridStartTick));

      // 依據 velocity 力度調整透明度
      const alpha = (isSelected || isHovered || isSounding) ? 1.0 : (0.55 + (currentVelocity / 127) * 0.45);
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

    // 8.5 繪製滑鼠拖曳框選虛線方框 (Marquee Box Selection)
    if (isMarqueeSelecting && marqueeStart && marqueeCurrent) {
      ctx.save();
      const rx = Math.min(marqueeStart.x, marqueeCurrent.x);
      const ry = Math.min(marqueeStart.y, marqueeCurrent.y);
      const rw = Math.abs(marqueeCurrent.x - marqueeStart.x);
      const rh = Math.abs(marqueeCurrent.y - marqueeStart.y);

      ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
      ctx.fillRect(rx, ry, rw, rh);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    // 9. 同步繪製下方 DAW 力度軌道 (Velocity Lane)
    const velocityCanvas = document.getElementById('pad-velocity-canvas') as HTMLCanvasElement | null;
    if (velocityCanvas && isVelocityLaneVisible) {
      drawVelocityLane(
        velocityCanvas,
        notes,
        padNum,
        viewStartBar,
        viewBars,
        ticksPerBar,
        gridStartTick,
        playheadRelTick,
        hoveredVelocityStalk
      );
      setupVelocityLaneEvents(velocityCanvas);
    }
  };

  currentCanvasRedraw = () => redraw(hoveredNoteBox, currentPlayheadRelTick, currentActiveNoteNumbers);
  currentCanvasRedrawWithPlayhead = (relTick, activeNotes) => redraw(hoveredNoteBox, relTick, activeNotes);
  redraw(null, currentPlayheadRelTick, currentActiveNoteNumbers);

  // 註冊滑鼠懸停檢視事件
  setupCanvasHoverEvents(canvas);
  setupVelocityToggle();
  setupNoteCreationControls();

  // 更新小節滑動條與縮放控制項
  updateTimelineNavigationUI(totalBars);
  setupScrollEvents(canvas);
}

/**
 * 繪製下方專業 DAW 力度軌道 (Velocity Lane)
 */
function drawVelocityLane(
  canvas: HTMLCanvasElement,
  notes: Array<{ note: number; velocity: number; startTick: number; durationTick: number }>,
  padNum: number,
  viewStartBar: number,
  viewBars: number,
  ticksPerBar: number,
  gridStartTick: number,
  playheadRelTick: number | null = null,
  highlightedStalk: RenderedVelocityStalk | null = null
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  const scaleW = 54;
  const plotW = w - scaleW;
  const windowStartTick = gridStartTick + (viewStartBar - 1) * ticksPerBar;
  const windowTotalTicks = viewBars * ticksPerBar;
  const windowEndTick = windowStartTick + windowTotalTicks;

  ctx.clearRect(0, 0, w, h);

  // 1. 背景底色
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(scaleW, 0, plotW, h);

  // 2. 左側標尺欄
  ctx.fillStyle = '#161821';
  ctx.fillRect(0, 0, scaleW, h);
  ctx.strokeStyle = '#333846';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(scaleW, 0);
  ctx.lineTo(scaleW, h);
  ctx.stroke();

  // 左側文字標示 VELOCITY
  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 8.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VELOCITY', scaleW / 2, 12);

  // 水平參考刻度線 (127, 64)
  const stalkBaseY = h - 6;
  const stalkMaxH = h - 18;
  const refLevels = [
    { val: 127, label: '127' },
    { val: 64, label: '64' },
  ];
  for (const ref of refLevels) {
    const y = stalkBaseY - (ref.val / 127) * stalkMaxH;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.25)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(scaleW, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#64748b';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(ref.label, scaleW - 4, y + 3);
  }

  // 3. 垂直小節線與拍子線 (Beat & Bar Grid Lines)
  for (let bar = 0; bar <= viewBars; bar++) {
    const barX = scaleW + (bar / viewBars) * plotW;
    ctx.strokeStyle = '#333846';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(barX, 0);
    ctx.lineTo(barX, h);
    ctx.stroke();
  }

  const totalBeats = viewBars * currentBeatsPerBar;
  for (let b = 0; b <= totalBeats; b++) {
    if (b % currentBeatsPerBar === 0) continue;
    const beatX = scaleW + (b / totalBeats) * plotW;
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.2)';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(beatX, 0);
    ctx.lineTo(beatX, h);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 4. 繪製音符對應之力度柱狀 Stalks
  const themeColors = [
    { stalk: '#3b82f6', handle: '#60a5fa' },
    { stalk: '#10b981', handle: '#34d399' },
    { stalk: '#f59e0b', handle: '#fbbf24' },
    { stalk: '#ec4899', handle: '#f472b6' },
  ];
  const theme = themeColors[(padNum - 1) % themeColors.length];

  const stalks: RenderedVelocityStalk[] = [];

  // Group notes by startTick to handle chords (offset overlapping stalks slightly)
  const notesAtTick = new Map<number, typeof notes>();
  for (const n of notes) {
    let currentStart = n.startTick;
    if (movingPreviewStartTick && movingPreviewStartTick.oldStartTick === n.startTick && movingPreviewStartTick.note === n.note) {
      currentStart = movingPreviewStartTick.newStartTick;
    }
    const arr = notesAtTick.get(currentStart) || [];
    arr.push(n);
    notesAtTick.set(currentStart, arr);
  }

  for (const [tick, chordNotes] of notesAtTick.entries()) {
    if (tick < windowStartTick || tick >= windowEndTick) continue;

    const relTick = tick - windowStartTick;
    const baseX = scaleW + (relTick / windowTotalTicks) * plotW;

    chordNotes.forEach((n, idx) => {
      let currentVel = n.velocity;
      if (velocityPreviewOverride && velocityPreviewOverride.startTick === n.startTick && velocityPreviewOverride.note === n.note) {
        currentVel = velocityPreviewOverride.velocity;
      }

      // If multiple notes in chord, offset by 5px each so all are distinct and clickable
      const offset = chordNotes.length > 1 ? (idx - (chordNotes.length - 1) / 2) * 5 : 0;
      const stalkX = Math.round(baseX + 3 + offset);

      const stalkH = Math.max(3, Math.round((currentVel / 127) * stalkMaxH));
      const stalkTopY = stalkBaseY - stalkH;

      const isSelected = selectedNoteBoxes.some(b => b.startTick === n.startTick && b.note === n.note) ||
                         (selectedNoteBox !== null && selectedNoteBox.startTick === n.startTick && selectedNoteBox.note === n.note);
      const isHovered = (hoveredNoteBox && hoveredNoteBox.startTick === n.startTick && hoveredNoteBox.note === n.note) ||
                        (highlightedStalk && highlightedStalk.startTick === n.startTick && highlightedStalk.note === n.note);

      // Stalk vertical line
      ctx.beginPath();
      ctx.moveTo(stalkX, stalkBaseY);
      ctx.lineTo(stalkX, stalkTopY);
      ctx.strokeStyle = isSelected ? '#fbbf24' : (isHovered ? '#38bdf8' : theme.stalk);
      ctx.lineWidth = isSelected ? 3 : (isHovered ? 2.5 : 1.8);
      ctx.globalAlpha = isSelected || isHovered ? 1.0 : 0.4 + (currentVel / 127) * 0.6;
      ctx.stroke();

      // Top handle (Circle dot)
      const radius = isSelected ? 4.5 : (isHovered ? 4 : 3);
      ctx.beginPath();
      ctx.arc(stalkX, stalkTopY, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#fbbf24' : (isHovered ? '#38bdf8' : theme.handle);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.stroke();

      // If selected or hovered, show the exact velocity number badge above handle
      if (isSelected || isHovered) {
        ctx.fillStyle = isSelected ? '#fbbf24' : '#38bdf8';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${currentVel}`, stalkX, Math.max(10, stalkTopY - 5));
      }

      ctx.globalAlpha = 1.0;

      stalks.push({
        x: stalkX,
        topY: stalkTopY,
        baseY: stalkBaseY,
        note: n.note,
        velocity: currentVel,
        startTick: n.startTick,
        durationTick: n.durationTick,
      });
    });
  }

  lastRenderedVelocityStalks = stalks;

  // 5. 走帶游標 (Playhead Cursor) 同步繪製
  if (playheadRelTick !== null && playheadRelTick !== undefined) {
    const playheadAbsTick = gridStartTick + playheadRelTick;
    if (playheadAbsTick >= windowStartTick && playheadAbsTick <= windowEndTick) {
      const playheadX = scaleW + ((playheadAbsTick - windowStartTick) / windowTotalTicks) * plotW;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, h);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function setupVelocityLaneEvents(canvas: HTMLCanvasElement) {
  if (isVelocityEventsBound) return;
  isVelocityEventsBound = true;

  const hoverInfoEl = document.getElementById('canvas-hover-info');

  canvas.addEventListener('mousemove', (e) => {
    if (isDraggingVelocity) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    // Hit test: Find stalk within 8px horizontal distance
    const hitStalk = lastRenderedVelocityStalks.find(s =>
      Math.abs(mouseX - s.x) <= 8 && mouseY >= s.topY - 8 && mouseY <= s.baseY + 4
    );

    if (hitStalk) {
      canvas.style.cursor = 'ns-resize';
      if (hitStalk !== hoveredVelocityStalk) {
        hoveredVelocityStalk = hitStalk;
        if (currentCanvasRedraw) currentCanvasRedraw();
      }
      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `📊 力度調節: <strong>${midiNoteToName(hitStalk.note)}</strong> (${hitStalk.note}) ｜ 力度: <strong>${hitStalk.velocity}</strong> / 127 ｜ ↕ 上下拖曳可即時微調力度`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.16)';
      }
    } else {
      canvas.style.cursor = 'default';
      if (hoveredVelocityStalk) {
        hoveredVelocityStalk = null;
        if (currentCanvasRedraw) currentCanvasRedraw();
        if (hoverInfoEl) {
          hoverInfoEl.textContent = '💡 點選任意音符可開啟屬性檢查器，拖曳音符可平移位置，右邊緣 ↔ 縮放音長，下方 📊 力度軌道可直接上下微調力度';
          hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
        }
      }
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const hitStalk = lastRenderedVelocityStalks.find(s =>
      Math.abs(mouseX - s.x) <= 8 && mouseY >= s.topY - 8 && mouseY <= s.baseY + 4
    );

    if (hitStalk) {
      isDraggingVelocity = true;
      velocityDragTarget = hitStalk;
      velocityStartMouseY = e.clientY;
      velocityStartVal = hitStalk.velocity;
      currentVelocityDragVal = hitStalk.velocity;

      // Select corresponding note in piano roll
      const matchedBox = lastRenderedNoteBoxes.find(b => b.startTick === hitStalk.startTick && b.note === hitStalk.note);
      if (matchedBox) {
        selectNote(matchedBox);
      }

      document.body.style.cursor = 'ns-resize';
      canvas.style.cursor = 'ns-resize';
      e.preventDefault();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingVelocity && velocityDragTarget) {
      // 1px upward = +1.1 velocity; 1px downward = -1.1 velocity
      const deltaY = velocityStartMouseY - e.clientY;
      const newVel = Math.max(1, Math.min(127, Math.round(velocityStartVal + deltaY * 1.1)));

      if (newVel !== currentVelocityDragVal) {
        currentVelocityDragVal = newVel;
        velocityPreviewOverride = {
          startTick: velocityDragTarget.startTick,
          note: velocityDragTarget.note,
          velocity: newVel,
        };

        if (currentCanvasRedraw) currentCanvasRedraw();

        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `📊 調整力度: <strong>${midiNoteToName(velocityDragTarget.note)}</strong> ｜ 新力度: <strong>${newVel}</strong> / 127 ｜ 放開滑鼠自動發聲試聽與儲存`;
          hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.25)';
        }

        const velInput = document.getElementById('insp-velocity-input') as HTMLInputElement | null;
        if (velInput) velInput.value = `${newVel}`;
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingVelocity && velocityDragTarget) {
      const target = velocityDragTarget;
      const finalVel = currentVelocityDragVal;
      const didChange = finalVel !== velocityStartVal;

      isDraggingVelocity = false;
      velocityDragTarget = null;
      velocityPreviewOverride = null;
      document.body.style.cursor = '';
      if (canvas) canvas.style.cursor = 'default';

      if (didChange) {
        hasJustDragged = true;
        try {
          if (currentParsed) {
            YamahaPadModifier.updateNoteEvent(
              currentParsed,
              currentCanvasPadNum,
              { note: target.note, startTick: target.startTick, oldDurationTick: target.durationTick },
              { velocity: finalVel }
            );
            if (selectedNoteBox) {
              selectedNoteBox.velocity = finalVel;
            }
            markModified(`已微調 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(target.note)} 力度為 ${finalVel}`);
            refreshCurrentPadDetail();
            auditionSelectedNote(target.note, target.durationTick, finalVel);
          }
        } catch (err: any) {
          console.error('Failed to update note velocity:', err);
        }
      } else {
        if (currentCanvasRedraw) currentCanvasRedraw();
      }

      setTimeout(() => {
        hasJustDragged = false;
      }, 100);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (isDraggingVelocity) return;
    if (hoveredVelocityStalk) {
      hoveredVelocityStalk = null;
      if (currentCanvasRedraw) currentCanvasRedraw();
      if (hoverInfoEl) {
        hoverInfoEl.textContent = '💡 點選任意音符可開啟屬性檢查器，拖曳音符可平移位置，右邊緣 ↔ 縮放音長，下方 📊 力度軌道可直接上下微調力度';
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
      }
    }
  });
}

function setupVelocityToggle() {
  if (isVelocityToggleBound) return;
  isVelocityToggleBound = true;

  const btnToggle = document.getElementById('btn-toggle-velocity-lane');
  const wrapper = document.getElementById('velocity-lane-wrapper');
  const noteCanvas = document.getElementById('pad-note-canvas');

  if (btnToggle && wrapper) {
    // 初始化同步狀態 (預設關閉)
    if (isVelocityLaneVisible) {
      wrapper.style.display = 'block';
      btnToggle.className = 'toggle-btn active-rp';
      btnToggle.textContent = '📊 力度軌道 ▾';
      if (noteCanvas) noteCanvas.style.borderRadius = '6px 6px 0 0';
    } else {
      wrapper.style.display = 'none';
      btnToggle.className = 'toggle-btn inactive';
      btnToggle.textContent = '📊 力度軌道 ▸';
      if (noteCanvas) noteCanvas.style.borderRadius = '6px';
    }

    btnToggle.addEventListener('click', () => {
      isVelocityLaneVisible = !isVelocityLaneVisible;
      if (isVelocityLaneVisible) {
        wrapper.style.display = 'block';
        btnToggle.className = 'toggle-btn active-rp';
        btnToggle.textContent = '📊 力度軌道 ▾';
        if (noteCanvas) noteCanvas.style.borderRadius = '6px 6px 0 0';
        if (currentCanvasRedraw) currentCanvasRedraw();
      } else {
        wrapper.style.display = 'none';
        btnToggle.className = 'toggle-btn inactive';
        btnToggle.textContent = '📊 力度軌道 ▸';
        if (noteCanvas) noteCanvas.style.borderRadius = '6px';
      }
    });
  }
}

function createNoteAtCanvasPos(mouseX: number, mouseY: number) {
  if (!currentParsed) return;
  const now = performance.now();
  if (now - lastNoteCreationTimestamp < 250) {
    return;
  }

  const canvas = document.getElementById('pad-note-canvas') as HTMLCanvasElement | null;
  const scaleW = 54;
  const rulerH = 26;

  if (mouseX < scaleW || mouseY < rulerH || mouseY > (canvas ? canvas.height : 460)) return;

  // 依 Y 座標計算音高
  const effectiveSemitoneH = currentSemitoneH > 0 ? currentSemitoneH : 15;
  const row = Math.floor((mouseY - rulerH) / effectiveSemitoneH);
  const noteNum = Math.max(0, Math.min(127, currentDisplayMaxNote - row));

  // 依 X 座標計算起始拍點 (吸附 1/16 音符網格)
  const effectivePlotW = currentPlotW > 0 ? currentPlotW : 1000;
  const effectiveWindowTotalTicks = currentWindowTotalTicks > 0 ? currentWindowTotalTicks : (currentTicksPerBeat * currentBeatsPerBar * 4);
  const relTick = ((mouseX - scaleW) / effectivePlotW) * effectiveWindowTotalTicks;
  const rawTick = currentWindowStartTick + relTick;
  const snapStep = Math.max(12, Math.round(currentTicksPerBeat / 4)); // 預設 1/16 音符 (24 ticks)
  const snappedStartTick = Math.max(0, Math.round(rawTick / snapStep) * snapStep);

  // 預先檢查當前軌道是否已存在同音高同拍點之音符，若存在則直接選取並試聽，避免重複堆疊
  const existingNotes = extractTrackNotes(currentParsed.tracks[currentCanvasPadNum]);
  const duplicate = existingNotes.find(n => n.note === noteNum && n.startTick === snappedStartTick);
  if (duplicate) {
    const existingBox = lastRenderedNoteBoxes.find(b => b.startTick === snappedStartTick && b.note === noteNum);
    if (existingBox) {
      selectNote(existingBox);
    }
    return;
  }

  // 預設長度：若當前選取的音符有音長，繼承該音長；否則預設為 1 拍 (currentTicksPerBeat)
  const durTick = selectedNoteBox ? selectedNoteBox.durationTick : currentTicksPerBeat;
  const vel = selectedNoteBox ? selectedNoteBox.velocity : 100;

  lastNoteCreationTimestamp = now;

  const success = YamahaPadModifier.addNoteEvent(currentParsed, currentCanvasPadNum, {
    note: noteNum,
    startTick: snappedStartTick,
    durationTick: durTick,
    velocity: vel,
  });

  if (success) {
    markModified(`已在 Pad ${currentCanvasPadNum} 新增音符 ${midiNoteToName(noteNum)} (${noteNum})`);
    refreshCurrentPadDetail();

    const newBox = lastRenderedNoteBoxes.find(b => b.startTick === snappedStartTick && b.note === noteNum);
    if (newBox) {
      selectNote(newBox);
    } else {
      auditionSelectedNote(noteNum, durTick, vel);
    }
  }
}

function setupNoteCreationControls() {
  if (isCreationControlsBound) return;
  isCreationControlsBound = true;

  const btnAddNote = document.getElementById('btn-add-note-action');
  const btnDrawMode = document.getElementById('btn-draw-mode');
  const canvas = document.getElementById('pad-note-canvas') as HTMLCanvasElement | null;

  if (btnAddNote) {
    btnAddNote.addEventListener('click', () => {
      if (!currentParsed) return;
      let targetTick = currentWindowStartTick;
      if (selectedNoteBox) {
        targetTick = selectedNoteBox.startTick + selectedNoteBox.durationTick;
      }
      const pitch = selectedNoteBox ? selectedNoteBox.note : 60; // 預設中央 C (C4)
      const durTick = selectedNoteBox ? selectedNoteBox.durationTick : currentTicksPerBeat;
      const vel = selectedNoteBox ? selectedNoteBox.velocity : 100;

      const success = YamahaPadModifier.addNoteEvent(currentParsed, currentCanvasPadNum, {
        note: pitch,
        startTick: targetTick,
        durationTick: durTick,
        velocity: vel,
      });

      if (success) {
        markModified(`已在 Pad ${currentCanvasPadNum} 新增音符 ${midiNoteToName(pitch)} (${pitch})`);
        refreshCurrentPadDetail();
        const newBox = lastRenderedNoteBoxes.find(b => b.startTick === targetTick && b.note === pitch);
        if (newBox) {
          selectNote(newBox);
        } else {
          auditionSelectedNote(pitch, durTick, vel);
        }
      }
    });
  }

  if (btnDrawMode) {
    btnDrawMode.addEventListener('click', () => {
      isDrawMode = !isDrawMode;
      if (isDrawMode) {
        if (isCanvasStepInputActive) {
          toggleCanvasStepInput(false);
        }
        btnDrawMode.className = 'toggle-btn active-rp';
        btnDrawMode.textContent = '✏️ 畫筆模式 (開)';
        if (canvas) canvas.style.cursor = 'crosshair';
        const hoverInfoEl = document.getElementById('canvas-hover-info');
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `✏️ <span style="color:#10b981;font-weight:700;">畫筆模式已開啟</span>：在畫布空白處「按一下（單擊）」即可直接建立新音符！`;
          hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
        }
      } else {
        btnDrawMode.className = 'toggle-btn inactive';
        btnDrawMode.textContent = '✏️ 畫筆模式';
        if (canvas) canvas.style.cursor = 'default';
        resetHoverInfo();
      }
    });
  }

  // 畫布直接手彈步進輸入控制
  const btnCanvasStepInput = document.getElementById('btn-toggle-canvas-step-input');
  const selectCanvasStepRes = document.getElementById('select-canvas-step-res') as HTMLSelectElement | null;

  if (btnCanvasStepInput) {
    btnCanvasStepInput.addEventListener('click', () => {
      toggleCanvasStepInput();
    });
  }

  if (selectCanvasStepRes) {
    selectCanvasStepRes.addEventListener('change', () => {
      const res = selectCanvasStepRes.value as StepResolution;
      canvasStepRecorder.setResolution(res);
      showStatus(`手彈步進每步時值已設定為: ${res}`);
    });
  }

  initCanvasStepRecorder();
}

function initCanvasStepRecorder() {
  canvasStepRecorder.configure({
    ppq: 480,
    timeSignature: { numerator: 4, denominator: 4 },
    resolution: '1/4',
    onStepChange: (entry, nextTick) => {
      if (!currentParsed) return;
      if (entry.type === 'notes' && entry.notes.length > 0) {
        for (const n of entry.notes) {
          YamahaPadModifier.addNoteEvent(currentParsed, currentCanvasPadNum, {
            note: n.note,
            startTick: n.startTick,
            durationTick: n.durationTick,
            velocity: n.velocity,
          });
        }
        markModified(`畫布手彈步進寫入 ${entry.chordName || '音符'} (${entry.notes.length} 顆) 至 Pad ${currentCanvasPadNum}`);
        refreshCurrentPadDetail();

        // 自動選取新增音符中的第一顆，以便檢查器即時顯示
        const newBox = lastRenderedNoteBoxes.find(b => b.startTick === entry.startTick && b.note === entry.notes[0].note);
        if (newBox) {
          selectNote(newBox);
        }

        showStatus(`🎹 步進寫入: ${entry.chordName || midiNoteToName(entry.notes[0].note)} (時值: ${entry.durationTick} ticks, 下一拍: Tick ${nextTick})`);
      } else if (entry.type === 'rest') {
        showStatus(`⏸️ 插入休止符 (時值: ${entry.durationTick} ticks, 下一拍: Tick ${nextTick})`);
      }

      const hoverInfoEl = document.getElementById('canvas-hover-info');
      if (hoverInfoEl && isCanvasStepInputActive) {
        hoverInfoEl.innerHTML = `🎹 <span style="color:#38bdf8;font-weight:700;">手彈步進模式已開啟</span>：彈奏琴鍵或電腦鍵盤直接印入和弦；按 <kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">Space</kbd> 插入休止符，<kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">Backspace</kbd> 撤銷前步，<kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">+</kbd> 延長時值 (Tie)。[游標: Tick ${nextTick}]`;
      }
    },
  });

  // 全域註冊 Canvas Step Input MIDI 監聽器
  midiManager.onNoteInput((type, pitch, velocity) => {
    const modal = document.getElementById('pad-record-modal');
    const isModalOpen = modal && modal.style.display !== 'none';
    if (isModalOpen) return; // 彈窗開啟時由彈窗專屬監聽器負責

    if (!isCanvasStepInputActive) return;

    if (type === 'noteon') {
      canvasStepRecorder.handleNoteOn(pitch, velocity);
      audioEngine.playAuditionNote(pitch, 0.35, { volume: Math.min(127, Math.max(30, velocity)) });
    } else {
      canvasStepRecorder.handleNoteOff(pitch);
    }
  });
}

function toggleCanvasStepInput(forceState?: boolean) {
  const btn = document.getElementById('btn-toggle-canvas-step-input');
  const selectRes = document.getElementById('select-canvas-step-res') as HTMLSelectElement | null;
  isCanvasStepInputActive = forceState !== undefined ? forceState : !isCanvasStepInputActive;

  if (isCanvasStepInputActive) {
    if (isDrawMode) {
      const btnDraw = document.getElementById('btn-draw-mode');
      if (btnDraw) btnDraw.click();
    }

    if (btn) {
      btn.className = 'toggle-btn active-rp';
      btn.textContent = '🎹 手彈步進: 開';
    }
    if (selectRes) selectRes.style.display = 'inline-block';

    midiManager.requestAccess().catch(() => {});

    let startTick = 0;
    if (selectedNoteBox) {
      startTick = selectedNoteBox.startTick + selectedNoteBox.durationTick;
    } else {
      startTick = currentWindowStartTick;
    }

    canvasStepRecorder.reset();
    canvasStepRecorder.seekToTick(startTick);
    const chosenRes = (selectRes?.value as StepResolution) || '1/4';
    canvasStepRecorder.configure({
      ppq: currentTicksPerBeat || 480,
      timeSignature: { numerator: currentBeatsPerBar || 4, denominator: 4 },
      resolution: chosenRes,
    });

    const hoverInfoEl = document.getElementById('canvas-hover-info');
    if (hoverInfoEl) {
      hoverInfoEl.innerHTML = `🎹 <span style="color:#38bdf8;font-weight:700;">手彈步進模式已開啟</span>：彈奏琴鍵或電腦鍵盤直接印入和弦；按 <kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">Space</kbd> 插入休止符，<kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">Backspace</kbd> 撤銷前步，<kbd style="background:#1e293b;padding:1px 5px;border-radius:3px;border:1px solid #475569;color:#e2e8f0;">+</kbd> 延長時值 (Tie)。[游標: Tick ${startTick}]`;
      hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.16)';
    }

    showStatus(`🎹 畫布手彈步進已開啟 (游標: Tick ${startTick})，彈奏琴鍵或電腦鍵盤直接在畫布印入音符！`);
  } else {
    if (btn) {
      btn.className = 'toggle-btn inactive';
      btn.textContent = '🎹 手彈步進: 關';
    }
    if (selectRes) selectRes.style.display = 'none';
    resetHoverInfo();
    showStatus('已關閉畫布手彈步進模式');
  }
}

function handleCanvasStepBack() {
  if (!currentParsed) return;
  const history = canvasStepRecorder.getHistory();
  if (history.length === 0) {
    showStatus('畫布步進歷史已空，無法再後退', true);
    return;
  }
  const lastEntry = history[history.length - 1];
  const ok = canvasStepRecorder.stepBack();
  if (ok && lastEntry.type === 'notes' && lastEntry.notes.length > 0) {
    for (const n of lastEntry.notes) {
      YamahaPadModifier.deleteNoteEvent(currentParsed, currentCanvasPadNum, {
        note: n.note,
        startTick: n.startTick,
        oldDurationTick: n.durationTick,
      });
    }
    markModified(`畫布步進撤銷：已刪除 Tick ${lastEntry.startTick} 的 ${lastEntry.chordName || '音符'}`);
    refreshCurrentPadDetail();
    showStatus(`已撤銷步進輸入 (${lastEntry.chordName || '音符'})，游標退回 Tick ${canvasStepRecorder.getCurrentTick()}`);
  } else if (ok) {
    showStatus(`已撤銷休止符，游標退回 Tick ${canvasStepRecorder.getCurrentTick()}`);
  }
}

function handleCanvasStepTie() {
  if (!currentParsed) return;
  const history = canvasStepRecorder.getHistory();
  const tiedEntry = history.slice().reverse().find(e => e.type === 'notes' && e.notes.length > 0);
  if (!tiedEntry) {
    showStatus('目前無前置音符可供延長 (Tie)', true);
    return;
  }
  const oldDur = tiedEntry.durationTick;
  const ok = canvasStepRecorder.tiePreviousNote();
  if (!ok) {
    showStatus('目前無前置音符可供延長 (Tie)', true);
    return;
  }
  const newDur = tiedEntry.durationTick;
  for (const n of tiedEntry.notes) {
    YamahaPadModifier.updateNoteEvent(
      currentParsed,
      currentCanvasPadNum,
      { note: n.note, startTick: n.startTick, oldDurationTick: oldDur },
      { durationTick: newDur }
    );
  }
  markModified(`畫布步進延長音 (Tie)：延長至 ${newDur} ticks`);
  refreshCurrentPadDetail();
  showStatus(`已延長音符時值至 ${newDur} ticks (下一拍 Tick: ${canvasStepRecorder.getCurrentTick()})`);
}

function updateMeasureControlsUI(totalBars: number) {
  const labelTotalBars = document.getElementById('label-pad-total-bars');
  const selectSrc = document.getElementById('select-copy-src-bar') as HTMLSelectElement | null;
  const selectDest = document.getElementById('select-copy-dest-bar') as HTMLSelectElement | null;

  if (labelTotalBars) {
    labelTotalBars.textContent = `${totalBars} 小節`;
  }

  if (selectSrc) {
    const curVal = selectSrc.value ? parseInt(selectSrc.value, 10) : 1;
    selectSrc.innerHTML = '';
    for (let b = 1; b <= totalBars; b++) {
      const opt = document.createElement('option');
      opt.value = `${b}`;
      opt.textContent = `第 ${b} 小節`;
      if (b === curVal || (curVal > totalBars && b === 1)) {
        opt.selected = true;
      }
      selectSrc.appendChild(opt);
    }
  }

  if (selectDest) {
    const curVal = selectDest.value ? parseInt(selectDest.value, 10) : (totalBars >= 2 ? 3 : 2);
    selectDest.innerHTML = '';
    const maxDest = Math.max(totalBars + 2, 8);
    for (let b = 1; b <= maxDest; b++) {
      const opt = document.createElement('option');
      opt.value = `${b}`;
      opt.textContent = `第 ${b} 小節${b > totalBars ? ' (自動延伸)' : ''}`;
      if (b === curVal) {
        opt.selected = true;
      }
      selectDest.appendChild(opt);
    }
  }

  const selectDelete = document.getElementById('select-delete-target-bar') as HTMLSelectElement | null;
  if (selectDelete) {
    const curVal = selectDelete.value ? parseInt(selectDelete.value, 10) : (selectedRulerBar ?? 1);
    selectDelete.innerHTML = '';
    for (let b = 1; b <= totalBars; b++) {
      const opt = document.createElement('option');
      opt.value = `${b}`;
      opt.textContent = `第 ${b} 小節`;
      if (b === curVal || (curVal > totalBars && b === 1)) {
        opt.selected = true;
      }
      selectDelete.appendChild(opt);
    }
  }
}

function setupMeasureControls() {
  if (isMeasureControlsBound) return;
  isMeasureControlsBound = true;

  const btnInc = document.getElementById('btn-pad-inc-bar');
  const btnDec = document.getElementById('btn-pad-dec-bar');
  const btnCopy = document.getElementById('btn-execute-bar-copy');
  const btnDup = document.getElementById('btn-duplicate-bar');
  const btnRipple = document.getElementById('btn-ripple-delete-bar');
  const btnClear = document.getElementById('btn-clear-bar-notes');
  const selectSrc = document.getElementById('select-copy-src-bar') as HTMLSelectElement | null;
  const selectDest = document.getElementById('select-copy-dest-bar') as HTMLSelectElement | null;
  const selectCopyMode = document.getElementById('select-copy-mode') as HTMLSelectElement | null;
  const selectDel = document.getElementById('select-delete-target-bar') as HTMLSelectElement | null;

  if (btnInc) {
    btnInc.addEventListener('click', () => {
      if (!currentParsed) return;
      const curLen = YamahaPadModifier.getPadBarLength(currentParsed, currentCanvasPadNum);
      const newLen = curLen + 1;
      YamahaPadModifier.setPadBarLength(currentParsed, currentCanvasPadNum, newLen);
      markModified(`已將 Pad ${currentCanvasPadNum} 長度擴展為 ${newLen} 小節`);
      refreshCurrentPadDetail();
      const hoverInfoEl = document.getElementById('canvas-hover-info');
      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `➕ <span style="color:#10b981;font-weight:700;">已擴展 Pad ${currentCanvasPadNum} 長度</span>：由 ${curLen} 小節 ➔ <strong>${newLen} 小節</strong>！`;
        hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
      }
    });
  }

  if (btnDec) {
    btnDec.addEventListener('click', () => {
      if (!currentParsed) return;
      const curLen = YamahaPadModifier.getPadBarLength(currentParsed, currentCanvasPadNum);
      if (curLen <= 1) return;

      const track = currentParsed.tracks[currentCanvasPadNum];
      const notes = extractTrackNotes(track);
      const ticksPerBar = (currentParsed.division || 96) * (currentParsed.timeSignature?.numerator || 4);
      const firstNoteTick = notes.length > 0 ? Math.min(...notes.map(n => n.startTick)) : 0;
      const gridStartTick = Math.floor(firstNoteTick / ticksPerBar) * ticksPerBar;
      const lastBarStartTick = gridStartTick + (curLen - 1) * ticksPerBar;
      const hasNotesInLastBar = notes.some(n => n.startTick >= lastBarStartTick);

      if (hasNotesInLastBar) {
        const ok = window.confirm(`Pad ${currentCanvasPadNum} 的第 ${curLen} 小節包含演奏音符，確定要縮減為 ${curLen - 1} 小節嗎？`);
        if (!ok) return;
      }

      const newLen = curLen - 1;
      YamahaPadModifier.setPadBarLength(currentParsed, currentCanvasPadNum, newLen);
      markModified(`已將 Pad ${currentCanvasPadNum} 長度縮減為 ${newLen} 小節`);
      refreshCurrentPadDetail();
      const hoverInfoEl = document.getElementById('canvas-hover-info');
      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `➖ <span style="color:#f59e0b;font-weight:700;">已縮減 Pad ${currentCanvasPadNum} 長度</span>：為 <strong>${newLen} 小節</strong>。`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.16)';
      }
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (!currentParsed || !selectSrc || !selectDest) return;
      const srcBar = parseInt(selectSrc.value, 10);
      const destBar = parseInt(selectDest.value, 10);
      const mode = (selectCopyMode?.value as 'replace' | 'insert') || 'replace';

      if (srcBar === destBar && mode !== 'insert') {
        alert('來源小節與目標小節相同，請在右側選擇不同的小節！');
        return;
      }

      const result = YamahaPadModifier.copyPadMeasure(currentParsed, currentCanvasPadNum, srcBar, destBar, mode);
      if (result.success) {
        deselectNote();
        const modeText = mode === 'insert' ? '插入順移' : '覆蓋替換';
        markModified(`已將 Pad ${currentCanvasPadNum} 第 ${srcBar} 小節以【${modeText}】至第 ${destBar} 小節 (共複製 ${result.copiedCount} 顆音符，總長度: ${result.newTotalBars} 小節)`);
        refreshCurrentPadDetail();
        const hoverInfoEl = document.getElementById('canvas-hover-info');
        if (hoverInfoEl) {
          const actionMsg = mode === 'insert'
            ? `已將第 ${srcBar} 小節【插入】至第 ${destBar} 小節，原目標及後續小節已自動向後順移 (+1 小節)`
            : `已將第 ${srcBar} 小節【覆蓋替換】至第 ${destBar} 小節`;
          hoverInfoEl.innerHTML = `🎉 <span style="color:#10b981;font-weight:700;">複製成功 (${modeText})</span>：${actionMsg} (共複製 ${result.copiedCount} 顆音符，總長度: ${result.newTotalBars} 小節)！`;
          hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
        }
      } else {
        alert(`第 ${srcBar} 小節沒有音符可供複製！`);
      }
    });
  }

  if (btnDup) {
    btnDup.addEventListener('click', () => {
      if (!currentParsed) return;
      const curLen = YamahaPadModifier.getPadBarLength(currentParsed, currentCanvasPadNum);
      let srcBar = selectSrc ? parseInt(selectSrc.value, 10) : curLen;
      if (selectedRulerBar) {
        srcBar = selectedRulerBar;
      } else if (selectedNoteBox) {
        const ticksPerBar = (currentParsed.division || 96) * (currentParsed.timeSignature?.numerator || 4);
        srcBar = Math.floor((selectedNoteBox.startTick - currentGridStartTick) / ticksPerBar) + 1;
      }

      const result = YamahaPadModifier.duplicatePadMeasure(currentParsed, currentCanvasPadNum, srcBar);
      if (result.success) {
        markModified(`已將 Pad ${currentCanvasPadNum} 第 ${srcBar} 小節倍增複製至第 ${result.newTargetBar} 小節`);
        refreshCurrentPadDetail();
        const hoverInfoEl = document.getElementById('canvas-hover-info');
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `🔁 <span style="color:#10b981;font-weight:700;">已一鍵倍增</span>：第 ${srcBar} 小節 ➔ 第 ${result.newTargetBar} 小節 (總長度: ${result.newTargetBar} 小節)！`;
          hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
        }
      } else {
        alert(`第 ${srcBar} 小節沒有音符可供倍增！`);
      }
    });
  }

  if (btnRipple) {
    btnRipple.addEventListener('click', () => {
      if (!currentParsed || !selectDel) return;
      const curLen = YamahaPadModifier.getPadBarLength(currentParsed, currentCanvasPadNum);
      const targetBar = parseInt(selectDel.value, 10);
      if (isNaN(targetBar) || targetBar < 1 || targetBar > curLen) return;

      if (curLen <= 1) {
        alert('Pad 最少需保留 1 個小節，無法再剪除結構！若欲清空內容請使用「清空音符」。');
        return;
      }

      const ok = window.confirm(
        `確定要剪除 Pad ${currentCanvasPadNum} 的【第 ${targetBar} 小節】嗎？\n\n` +
        `• 該小節內所有音符將自動清除 (無需手動預先清空)\n` +
        `• 後方小節音符將自動往前順移 1 個小節\n` +
        (curLen <= 4
          ? `• Pad 總長度將維持標準 4 小節 (末端保留空白小節，保持標準伴奏對齊)`
          : `• Pad 總長度將由 ${curLen} 縮減為 ${curLen - 1} 小節`)
      );
      if (!ok) return;

      const result = YamahaPadModifier.deletePadMeasure(currentParsed, currentCanvasPadNum, targetBar, 'ripple');
      if (result.success) {
        selectedRulerBar = null;
        deselectNote();
        markModified(`已剪除 Pad ${currentCanvasPadNum} 第 ${targetBar} 小節 (共移除 ${result.deletedCount} 顆音符，總長度: ${result.newTotalBars} 小節)`);
        refreshCurrentPadDetail();
        const hoverInfoEl = document.getElementById('canvas-hover-info');
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `✂️ <span style="color:#f87171;font-weight:700;">小節剪除成功</span>：已剪除第 ${targetBar} 小節 (共移除 ${result.deletedCount} 顆音符)，後續音符已自動順移遞補，總長度為 <strong>${result.newTotalBars} 小節</strong>！`;
          hoverInfoEl.style.backgroundColor = 'rgba(239, 68, 68, 0.16)';
        }
      }
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      if (!currentParsed || !selectDel) return;
      const curLen = YamahaPadModifier.getPadBarLength(currentParsed, currentCanvasPadNum);
      const targetBar = parseInt(selectDel.value, 10);
      if (isNaN(targetBar) || targetBar < 1 || targetBar > curLen) return;

      const ok = window.confirm(`確定要清空 Pad ${currentCanvasPadNum} 的【第 ${targetBar} 小節】所有音符嗎？\n\n• 該小節將變為完全靜音的空白小節\n• 後方小節音符位置與總長度 (${curLen} 小節) 將維持不變`);
      if (!ok) return;

      const result = YamahaPadModifier.deletePadMeasure(currentParsed, currentCanvasPadNum, targetBar, 'clear');
      if (result.success) {
        selectedRulerBar = null;
        deselectNote();
        markModified(`已清空 Pad ${currentCanvasPadNum} 第 ${targetBar} 小節音符 (共清空 ${result.deletedCount} 顆音符)`);
        refreshCurrentPadDetail();
        const hoverInfoEl = document.getElementById('canvas-hover-info');
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `🧹 <span style="color:#fbbf24;font-weight:700;">音符清空成功</span>：已清空第 ${targetBar} 小節所有音符 (共清空 ${result.deletedCount} 顆音符)，後方音符與總小節數 (${result.newTotalBars} 小節) 保持不變。`;
          hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.16)';
        }
      }
    });
  }
}

/**
 * 2.8-B 八度移調與畫布量化律動事件綁定
 */
let isOctaveQuantizeControlsBound = false;

function setupOctaveAndQuantizeControls() {
  if (isOctaveQuantizeControlsBound) return;
  isOctaveQuantizeControlsBound = true;

  const btnOctDown = document.getElementById('btn-roll-octave-down');
  const btnOctUp = document.getElementById('btn-roll-octave-up');
  const btnExecQuantize = document.getElementById('btn-execute-roll-quantize');
  const selectQuantizeGrid = document.getElementById('select-roll-quantize-grid') as HTMLSelectElement | null;

  const handleOctaveShift = (direction: 1 | -1) => {
    if (!currentParsed) return;
    const isSingle = !!selectedNoteBox;
    const res = isSingle
      ? YamahaPadModifier.shiftPadOctave(currentParsed, currentCanvasPadNum, direction, selectedNoteBox!.startTick, selectedNoteBox!.note)
      : YamahaPadModifier.shiftPadOctave(currentParsed, currentCanvasPadNum, direction);

    if (res.success) {
      const dirText = direction > 0 ? '升高 1 個八度 (+12 半音)' : '降低 1 個八度 (-12 半音)';
      if (isSingle && res.targetNoteInfo) {
        selectedNoteBox!.note = res.targetNoteInfo.newNote;
        const pitchEl = document.getElementById('insp-pitch-name');
        if (pitchEl) pitchEl.textContent = `${midiNoteToName(res.targetNoteInfo.newNote)} (${res.targetNoteInfo.newNote})`;
        markModified(`Pad ${currentCanvasPadNum} 音符已${dirText}至 ${midiNoteToName(res.targetNoteInfo.newNote)} (${res.targetNoteInfo.newNote})`);
        auditionSelectedNote(res.targetNoteInfo.newNote, selectedNoteBox!.durationTick, selectedNoteBox!.velocity);
        showStatus(`✨ 已將選取音符${dirText}至 ${midiNoteToName(res.targetNoteInfo.newNote)}！`);
      } else {
        markModified(`Pad ${currentCanvasPadNum} 整軌 ${res.shiftedCount} 顆音符已${dirText}`);
        showStatus(`✨ 已將 Pad ${currentCanvasPadNum} 整軌 ${res.shiftedCount} 顆音符${dirText}！`);
      }
      refreshCurrentPadDetail();
    } else {
      showStatus('音高已達 MIDI 邊界 (0~127) 或此 Pad 無音符', true);
    }
  };

  if (btnOctDown) {
    btnOctDown.addEventListener('click', () => handleOctaveShift(-1));
  }
  if (btnOctUp) {
    btnOctUp.addEventListener('click', () => handleOctaveShift(1));
  }

  if (btnExecQuantize) {
    btnExecQuantize.addEventListener('click', () => {
      if (!currentParsed) return;
      const grid = (selectQuantizeGrid?.value || '1/16') as QuantizeGrid;
      const isSingle = !!selectedNoteBox;

      const res = isSingle
        ? YamahaPadModifier.quantizePadTrack(currentParsed, currentCanvasPadNum, grid, selectedNoteBox!.startTick, selectedNoteBox!.note)
        : YamahaPadModifier.quantizePadTrack(currentParsed, currentCanvasPadNum, grid);

      if (res.success) {
        const targetDesc = isSingle ? '選取音符' : `整軌 ${res.quantizedCount} 顆音符`;
        markModified(`Pad ${currentCanvasPadNum} ${targetDesc}已套用 ${grid} 量化律動`);
        refreshCurrentPadDetail();
        showStatus(`✨ 成功將 Pad ${currentCanvasPadNum} ${targetDesc}吸附至 ${grid} 網格！`);
      } else {
        showStatus('此 Pad 目前無音符可套用量化', true);
      }
    });
  }
}

function updateTimelineNavigationUI(totalBars: number) {
  const container = document.getElementById('canvas-scroll-container');
  const btn4Bars = document.getElementById('btn-zoom-4bars') as HTMLButtonElement | null;
  const btnAll = document.getElementById('btn-zoom-all') as HTMLButtonElement | null;
  const slider = document.getElementById('timeline-slider') as HTMLInputElement | null;
  const rangeLabel = document.getElementById('timeline-range-label');
  const scrollControls = document.getElementById('scroll-bar-controls');

  const btnPrev = document.getElementById('btn-prev-bars') as HTMLButtonElement | null;
  const btnNext = document.getElementById('btn-next-bars') as HTMLButtonElement | null;

  if (!container) return;

  if (totalBars <= 4) {
    if (btn4Bars) btn4Bars.style.display = 'none';
    if (btnAll) btnAll.style.display = 'none';
    if (scrollControls) scrollControls.style.display = 'flex';
    if (btnPrev) btnPrev.style.display = 'none';
    if (slider) slider.style.display = 'none';
    if (btnNext) btnNext.style.display = 'none';
    if (rangeLabel) {
      rangeLabel.textContent = `第 1 ~ ${totalBars} 小節 / 共 ${totalBars} 小節 (標準 4 小節視野)`;
    }
    return;
  }

  // 小節數大於 4，顯示控制項
  if (btn4Bars) btn4Bars.style.display = 'inline-block';
  if (btnAll) btnAll.style.display = 'inline-block';
  if (scrollControls) scrollControls.style.display = 'flex';
  if (btnPrev) btnPrev.style.display = 'inline-block';
  if (btnNext) btnNext.style.display = 'inline-block';

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
    if (isResizingNote || isMovingNote) return;

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
      canvas.style.cursor = 'grab';
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
        hoverInfoEl.innerHTML = `🎯 音符: <strong>${midiNoteToName(bodyHit.note)}</strong> (${bodyHit.note}) ｜ 音長: <strong>${durStr}</strong> ｜ 點選開啟檢查器 (可按 Delete 刪除、↑/↓ 移調) ｜ ↔ 拖曳平移 ｜ 右端 ↔ 縮放`;
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.16)';
      } else {
        hoverInfoEl.textContent = '💡 雙擊空白處新增音符 ｜ 點選音符微調音高 (▲/▼ 或方向鍵 ↑/↓)、平移 (↔ 或 ◀/▶)、Delete 鍵刪除 ｜ 下方 📊 力度軌道可調力度';
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
      }
    }
  });

  // 音符拖曳或點選開始 (Mousedown to initiate resize, move, or select)
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // 僅限滑鼠左鍵
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const edgeHit = reversedBoxes.find(b => isMouseNearRightEdge(b, mouseX, mouseY));
    const bodyHit = reversedBoxes.find(b =>
      mouseX >= b.x && mouseX <= b.x + b.w &&
      mouseY >= b.y && mouseY <= b.y + b.h
    );

    if (edgeHit) {
      potentialResizeTarget = edgeHit;
      potentialMoveTarget = null;
      resizingStartMouseX = e.clientX;
      resizingStartDuration = edgeHit.durationTick;
      currentResizingDuration = edgeHit.durationTick;
      isResizingNote = false;
      selectedRulerBar = null;
      selectNote(edgeHit, e.ctrlKey || e.metaKey);
      e.preventDefault();
    } else if (bodyHit) {
      if (e.ctrlKey || e.metaKey) {
        selectNote(bodyHit, true);
        potentialMoveTarget = null;
        potentialResizeTarget = null;
        selectedRulerBar = null;
        e.preventDefault();
        return;
      }

      const isAlreadySelected = selectedNoteBoxes.some(b => b.startTick === bodyHit.startTick && b.note === bodyHit.note);
      if (!isAlreadySelected) {
        selectNote(bodyHit, false);
      }

      potentialMoveTarget = bodyHit;
      potentialResizeTarget = null;
      movingStartMouseX = e.clientX;
      movingStartMouseY = e.clientY;
      movingStartTick = bodyHit.startTick;
      currentMovingStartTick = bodyHit.startTick;
      isMovingNote = false;
      selectedRulerBar = null;
      e.preventDefault();
    } else {
      potentialResizeTarget = null;
      potentialMoveTarget = null;
      selectedRulerBar = null;

      // 啟動框選 (Marquee Box Selection) 追蹤
      marqueeStart = { x: mouseX, y: mouseY, clientX: e.clientX, clientY: e.clientY };
      marqueeCurrent = { x: mouseX, y: mouseY };
      isMarqueeSelecting = false;
    }
  });

  // 全域滑鼠拖曳監聽 (Window Mousemove for smooth dragging outside canvas)
  window.addEventListener('mousemove', (e) => {
    if (marqueeStart) {
      if (!isMarqueeSelecting) {
        if (Math.hypot(e.clientX - marqueeStart.clientX, e.clientY - marqueeStart.clientY) >= 5) {
          isMarqueeSelecting = true;
          document.body.style.cursor = 'crosshair';
          canvas.style.cursor = 'crosshair';
        }
      }
      if (isMarqueeSelecting) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const curMouseX = (e.clientX - rect.left) * scaleX;
        const curMouseY = (e.clientY - rect.top) * scaleY;
        marqueeCurrent = { x: curMouseX, y: curMouseY };
        if (currentCanvasRedraw) currentCanvasRedraw();
        return;
      }
    }

    if (potentialResizeTarget) {
      const deltaClientX = e.clientX - resizingStartMouseX;
      if (!isResizingNote) {
        if (Math.abs(deltaClientX) >= 6) {
          isResizingNote = true;
          document.body.style.cursor = 'ew-resize';
          canvas.style.cursor = 'ew-resize';
        } else {
          return;
        }
      }

      const rect = canvas.getBoundingClientRect();
      const canvasDeltaX = deltaClientX * (canvas.width / rect.width);
      const deltaTicks = (canvasDeltaX / currentPlotW) * currentWindowTotalTicks;

      // 網格對齊 (Grid Snap)：預設對齊 1/32 音符 (如 12 ticks 或 60 ticks)，按住 Shift 鍵可 1 Tick 自由微調
      const isFineTune = e.shiftKey;
      const snapStep = isFineTune ? 1 : Math.max(12, Math.round(currentTicksPerBeat / 8));
      const snappedDeltaTicks = Math.round(deltaTicks / snapStep) * snapStep;
      const newDur = Math.max(isFineTune ? 1 : snapStep, Math.min(resizingStartDuration + snappedDeltaTicks, currentWindowTotalTicks * 2));

      if (newDur !== currentResizingDuration) {
        currentResizingDuration = newDur;
        resizingPreviewDuration = {
          startTick: potentialResizeTarget.startTick,
          note: potentialResizeTarget.note,
          durationTick: newDur,
        };
        if (currentCanvasRedraw) currentCanvasRedraw();

        if (hoverInfoEl) {
          const durStr = formatNoteDuration(newDur, currentTicksPerBeat, currentBeatsPerBar);
          hoverInfoEl.innerHTML = `↔ 拖曳調整音長: <strong>${midiNoteToName(potentialResizeTarget.note)}</strong> ｜ 新音長: <strong>${durStr}</strong> (${newDur} ticks)${isFineTune ? ' <span style="color:#f59e0b;font-weight:600;">[精細微調]</span>' : ' <span style="opacity:0.75">(按住 Shift 可 1 Tick 微調)</span>'}`;
          hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
        }

        const durInput = document.getElementById('insp-duration-input') as HTMLInputElement | null;
        const durDescEl = document.getElementById('insp-duration-desc');
        if (durInput) durInput.value = `${newDur}`;
        if (durDescEl) durDescEl.textContent = `(${formatShortDuration(newDur, currentTicksPerBeat, currentBeatsPerBar)})`;
      }
    } else if (potentialMoveTarget) {
      const deltaClientX = e.clientX - movingStartMouseX;
      const deltaClientY = e.clientY - movingStartMouseY;
      if (!isMovingNote) {
        if (Math.hypot(deltaClientX, deltaClientY) >= 8) {
          isMovingNote = true;
          document.body.style.cursor = 'grabbing';
          canvas.style.cursor = 'grabbing';
        } else {
          return; // 未超過 8px 門檻，判定為純點擊，絕不動搖位置
        }
      }

      const rect = canvas.getBoundingClientRect();
      const canvasDeltaX = deltaClientX * (canvas.width / rect.width);
      const deltaTicks = (canvasDeltaX / currentPlotW) * currentWindowTotalTicks;

      // 網格對齊 (Grid Snap)：以原始 startTick 為基準累加 snappedDeltaTicks，預設對齊 1/16 音符
      const isFineTune = e.shiftKey;
      const snapStep = isFineTune ? 1 : Math.max(12, Math.round(currentTicksPerBeat / 4));
      const snappedDeltaTicks = Math.round(deltaTicks / snapStep) * snapStep;
      const newStart = Math.max(0, movingStartTick + snappedDeltaTicks);

      if (newStart !== currentMovingStartTick) {
        currentMovingStartTick = newStart;
        movingPreviewStartTick = {
          oldStartTick: potentialMoveTarget.startTick,
          note: potentialMoveTarget.note,
          newStartTick: newStart,
        };
        if (currentCanvasRedraw) currentCanvasRedraw();

        const pos = formatNotePosition(newStart - currentGridStartTick, currentTicksPerBeat, currentBeatsPerBar);
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `↔ 平移音符位置: <strong>${midiNoteToName(potentialMoveTarget.note)}</strong> ｜ 新位置: <strong>${pos.displayFull}</strong> (${pos.chinese})${isFineTune ? ' <span style="color:#f59e0b;font-weight:600;">[精細微調]</span>' : ' <span style="opacity:0.75">(按住 Shift 可 1 Tick 微調)</span>'}`;
          hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.25)';
        }

        const posEl = document.getElementById('insp-position-text');
        if (posEl) posEl.textContent = pos.chinese;
      }
    }
  });

  // 全域滑鼠釋放監聽 (Window Mouseup to commit duration or position modification)
  window.addEventListener('mouseup', (e: MouseEvent) => {
    if (marqueeStart) {
      if (isMarqueeSelecting && marqueeCurrent) {
        hasJustDragged = true;
        const rx1 = Math.min(marqueeStart.x, marqueeCurrent.x);
        const rx2 = Math.max(marqueeStart.x, marqueeCurrent.x);
        const ry1 = Math.min(marqueeStart.y, marqueeCurrent.y);
        const ry2 = Math.max(marqueeStart.y, marqueeCurrent.y);

        // 搜尋與選取框相交的所有音符
        const hitBoxes = lastRenderedNoteBoxes.filter((b) => {
          const bRight = b.x + b.w;
          const bBottom = b.y + b.h;
          return !(b.x > rx2 || bRight < rx1 || b.y > ry2 || bBottom < ry1);
        });

        if (e.ctrlKey || e.metaKey) {
          const merged = [...selectedNoteBoxes];
          for (const hit of hitBoxes) {
            if (!merged.some(b => b.startTick === hit.startTick && b.note === hit.note)) {
              merged.push(hit);
            }
          }
          selectMultipleNotes(merged);
        } else {
          selectMultipleNotes(hitBoxes);
        }
      } else {
        // 純點擊空白處 (未拖曳超過門檻)：若未按 Ctrl 則清空選取
        if (!e.ctrlKey && !e.metaKey) {
          deselectNote();
        }
      }

      isMarqueeSelecting = false;
      marqueeStart = null;
      marqueeCurrent = null;
      document.body.style.cursor = '';
      if (canvas) canvas.style.cursor = 'default';
      if (currentCanvasRedraw) currentCanvasRedraw();

      setTimeout(() => {
        hasJustDragged = false;
      }, 100);
      return;
    }

    if (potentialResizeTarget) {
      const target = potentialResizeTarget;
      const finalDuration = currentResizingDuration;
      const didChange = isResizingNote && (finalDuration !== resizingStartDuration);

      isResizingNote = false;
      potentialResizeTarget = null;
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
      } else {
        if (currentCanvasRedraw) currentCanvasRedraw();
      }

      setTimeout(() => {
        hasJustDragged = false;
      }, 100);
    } else if (potentialMoveTarget) {
      const target = potentialMoveTarget;
      const finalStart = currentMovingStartTick;
      const didChange = isMovingNote && (finalStart !== movingStartTick);

      isMovingNote = false;
      potentialMoveTarget = null;
      movingPreviewStartTick = null;
      document.body.style.cursor = '';
      if (canvas) canvas.style.cursor = 'default';

      if (didChange) {
        hasJustDragged = true;
        try {
          if (currentParsed) {
            if (selectedNoteBox) {
              selectedNoteBox.startTick = finalStart;
            }
            YamahaPadModifier.updateNoteEvent(
              currentParsed,
              currentCanvasPadNum,
              { note: target.note, startTick: movingStartTick, oldDurationTick: target.durationTick },
              { startTick: finalStart }
            );
            const pos = formatNotePosition(finalStart - currentGridStartTick, currentTicksPerBeat, currentBeatsPerBar);
            markModified(`已平移 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(target.note)} 位置至 ${pos.displayFull}`);
            refreshCurrentPadDetail();
            auditionSelectedNote(target.note, target.durationTick, target.velocity);
          }
        } catch (err: any) {
          console.error('Failed to move note position by dragging:', err);
          if (hoverInfoEl) {
            hoverInfoEl.innerHTML = `⚠️ <span style="color:#ef4444;">移動音符失敗: ${err.message}</span>`;
            hoverInfoEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
          }
        }
      } else {
        if (currentCanvasRedraw) currentCanvasRedraw();
      }

      setTimeout(() => {
        hasJustDragged = false;
      }, 100);
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (isResizingNote || isMovingNote || potentialResizeTarget || potentialMoveTarget) return;
    if (hoveredNoteBox) {
      hoveredNoteBox = null;
      if (currentCanvasRedraw) currentCanvasRedraw();
      if (hoverInfoEl) {
        hoverInfoEl.textContent = '💡 雙擊空白處新增音符 ｜ 點選音符微調音高 (▲/▼ 或方向鍵 ↑/↓)、平移 (↔ 或 ◀/▶)、Delete 鍵刪除 ｜ 下方 📊 力度軌道可調力度';
        hoverInfoEl.style.backgroundColor = 'rgba(56, 189, 248, 0.08)';
      }
    }
  });

  // 音符點選事件與空白處點擊新增 (Click & Double-Click Note Creation)
  canvas.addEventListener('click', (e) => {
    if (hasJustDragged) {
      hasJustDragged = false;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const scaleW = 54;
    const rulerH = 26;
    if (mouseX < scaleW || mouseY > canvas.height) return;

    // 點擊頂部小節時間軸尺規 (Timeline Measure Header)
    if (mouseY < rulerH) {
      const hitRuler = lastRenderedRulerBoxes.find(b => mouseX >= b.x && mouseX < b.x + b.w);
      if (!hitRuler) return;
      const clickedBar = hitRuler.barNum;
      selectedRulerBar = clickedBar;

      const srcSelect = document.getElementById('select-copy-src-bar') as HTMLSelectElement | null;
      if (srcSelect && srcSelect.querySelector(`option[value="${clickedBar}"]`)) {
        srcSelect.value = String(clickedBar);
      }
      const delSelect = document.getElementById('select-delete-target-bar') as HTMLSelectElement | null;
      if (delSelect && delSelect.querySelector(`option[value="${clickedBar}"]`)) {
        delSelect.value = String(clickedBar);
      }

      // 點選小節尺規專注於小節整體操作（複製/剪除/清空），取消單音選取並保持靜音
      deselectNote();

      if (currentCanvasRedraw) currentCanvasRedraw();

      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `📋 <span style="color:#fbbf24;font-weight:700;">已點選第 ${clickedBar} 小節</span>：<kbd>Ctrl+C</kbd> 複製、<kbd>Ctrl+V</kbd> 貼上、<kbd>Ctrl+Shift+V</kbd> 插入順移、<kbd>Ctrl+D</kbd> 倍增 ｜ <kbd>Shift+Del</kbd> 剪除順移、<kbd>Del</kbd> 清空音符`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      }
      return;
    }

    // 檢查是否點在既有音符上方 (若點在音符上方，由 mousedown 負責選取)
    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const hit = reversedBoxes.find(b =>
      mouseX >= b.x && mouseX <= b.x + b.w &&
      mouseY >= b.y && mouseY <= b.y + b.h
    );
    if (hit) return;

    // 點擊在空白處：若開啟畫筆模式 (isDrawMode)，單擊即可建立音符；若開啟手彈步進，移動步進游標；否則顯示雙擊新增提示
    if (isDrawMode) {
      createNoteAtCanvasPos(mouseX, mouseY);
    } else if (isCanvasStepInputActive) {
      const effectivePlotW = currentPlotW > 0 ? currentPlotW : 1000;
      const effectiveWindowTotalTicks = currentWindowTotalTicks > 0 ? currentWindowTotalTicks : (currentTicksPerBeat * currentBeatsPerBar * 4);
      const relTick = ((mouseX - 54) / effectivePlotW) * effectiveWindowTotalTicks;
      const rawTick = currentWindowStartTick + relTick;
      const snapStep = Math.max(24, Math.round(currentTicksPerBeat / 4));
      const snappedTick = Math.max(0, Math.round(rawTick / snapStep) * snapStep);
      canvasStepRecorder.seekToTick(snappedTick);

      const hoverInfoEl = document.getElementById('canvas-hover-info');
      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `🎹 <span style="color:#38bdf8;font-weight:700;">手彈步進游標已移動至 Tick ${snappedTick}</span>：彈奏琴鍵或電腦鍵盤直接在此拍印入音符！`;
      }
      showStatus(`🎯 手彈步進游標已移至 Tick ${snappedTick}`);
    } else {
      if (hoverInfoEl) {
        hoverInfoEl.innerHTML = `💡 <span style="color:#fbbf24;font-weight:700;">點擊了空白處</span>：連點兩下 (雙擊) 即可在此處建立音符，或開啟上方 <strong>[✏️ 畫筆模式]</strong> 單擊新增！`;
        hoverInfoEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      }
    }
  });

  // 原生雙擊事件：雙擊建立音符的唯一主管 (Native Double-Click)
  canvas.addEventListener('dblclick', (e) => {
    if (isDrawMode) return; // 畫筆模式下已由單擊建立

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    const scaleW = 54;
    const rulerH = 26;
    if (mouseX < scaleW || mouseY < rulerH || mouseY > canvas.height) return;

    // 檢查是否點在既有音符附近（給予容錯邊距避免誤觸發新增）
    const reversedBoxes = [...lastRenderedNoteBoxes].reverse();
    const hit = reversedBoxes.find(b =>
      mouseX >= b.x - 2 && mouseX <= b.x + b.w + 2 &&
      mouseY >= b.y - 1 && mouseY <= b.y + b.h + 1
    );
    if (hit) {
      selectNote(hit);
      return;
    }

    createNoteAtCanvasPos(mouseX, mouseY);
  });

  initNoteInspectorEvents();
}

function selectNote(box: RenderedNoteBox, isCtrl: boolean = false) {
  if (isCtrl) {
    const idx = selectedNoteBoxes.findIndex(b => b.startTick === box.startTick && b.note === box.note);
    if (idx >= 0) {
      selectedNoteBoxes.splice(idx, 1);
    } else {
      selectedNoteBoxes.push(box);
    }
  } else {
    selectedNoteBoxes = [box];
  }

  if (selectedNoteBoxes.length === 0) {
    deselectNote();
    return;
  }

  selectedNoteBox = selectedNoteBoxes[selectedNoteBoxes.length - 1];

  if (isCanvasStepInputActive && selectedNoteBox) {
    const nextTick = selectedNoteBox.startTick + selectedNoteBox.durationTick;
    canvasStepRecorder.seekToTick(nextTick);
    const hoverInfoEl = document.getElementById('canvas-hover-info');
    if (hoverInfoEl) {
      hoverInfoEl.innerHTML = `🎹 <span style="color:#38bdf8;font-weight:700;">手彈步進游標已接續於音符後方 (Tick ${nextTick})</span>：彈奏琴鍵或電腦鍵盤直接印入下一組音符！`;
    }
  }

  if (currentCanvasRedraw) currentCanvasRedraw();

  if (selectedNoteBoxes.length === 1) {
    updateInspectorFields(selectedNoteBoxes[0]);
    auditionSelectedNote(selectedNoteBoxes[0].note, selectedNoteBoxes[0].durationTick, selectedNoteBoxes[0].velocity);
  } else {
    updateBatchInspectorUI();
  }
}

function selectMultipleNotes(boxes: RenderedNoteBox[]) {
  selectedNoteBoxes = [...boxes];
  if (selectedNoteBoxes.length === 0) {
    deselectNote();
    return;
  }
  selectedNoteBox = selectedNoteBoxes[0];
  if (currentCanvasRedraw) currentCanvasRedraw();
  if (selectedNoteBoxes.length === 1) {
    updateInspectorFields(selectedNoteBoxes[0]);
  } else {
    updateBatchInspectorUI();
  }
}

function updateBatchInspectorUI() {
  const inspectorBar = document.getElementById('note-inspector-bar');
  const singleInspector = document.getElementById('single-note-inspector');
  const multiInspector = document.getElementById('multi-note-inspector');
  const batchTitle = document.getElementById('batch-note-title');
  const batchVelInput = document.getElementById('batch-vel-input') as HTMLInputElement | null;

  if (inspectorBar) inspectorBar.style.display = 'flex';
  if (singleInspector) singleInspector.style.display = 'none';
  if (multiInspector) multiInspector.style.display = 'flex';
  if (batchTitle) {
    batchTitle.textContent = `已選取 ${selectedNoteBoxes.length} 顆音符`;
  }

  // 同步批次力度數值輸入框：若選取音符力度全數相同則顯示數值，否則提示多種力度
  if (batchVelInput && selectedNoteBoxes.length > 0) {
    const firstVel = selectedNoteBoxes[0].velocity;
    const allSame = selectedNoteBoxes.every(b => b.velocity === firstVel);
    if (allSame) {
      batchVelInput.value = `${firstVel}`;
      batchVelInput.placeholder = '1~127';
    } else {
      batchVelInput.value = '';
      batchVelInput.placeholder = '多種力度';
    }
  }
}

function updateInspectorFields(box: RenderedNoteBox) {
  const inspectorBar = document.getElementById('note-inspector-bar');
  const singleInspector = document.getElementById('single-note-inspector');
  const multiInspector = document.getElementById('multi-note-inspector');
  const pitchEl = document.getElementById('insp-pitch-name');
  const posEl = document.getElementById('insp-position-text');
  const durInput = document.getElementById('insp-duration-input') as HTMLInputElement | null;
  const durDescEl = document.getElementById('insp-duration-desc');
  const velInput = document.getElementById('insp-velocity-input') as HTMLInputElement | null;

  if (inspectorBar) inspectorBar.style.display = 'flex';
  if (singleInspector) singleInspector.style.display = 'flex';
  if (multiInspector) multiInspector.style.display = 'none';

  if (pitchEl) pitchEl.textContent = `${midiNoteToName(box.note)} (${box.note})`;
  if (posEl) {
    if (currentGridStartTick > 0) {
      const absPos = formatAbsolutePosition(box.startTick, currentTicksPerBeat, currentBeatsPerBar);
      posEl.textContent = `${box.posChinese} [全曲: ${absPos.summary} / ${absPos.standard}]`;
    } else {
      posEl.textContent = box.posChinese;
    }
  }
  if (durInput) durInput.value = `${box.durationTick}`;
  if (durDescEl) durDescEl.textContent = `(${formatShortDuration(box.durationTick, currentTicksPerBeat, currentBeatsPerBar)})`;
  if (velInput) velInput.value = `${box.velocity}`;
}

function deselectNote() {
  selectedNoteBox = null;
  selectedNoteBoxes = [];
  if (currentCanvasRedraw) currentCanvasRedraw();

  const inspectorBar = document.getElementById('note-inspector-bar');
  const singleInspector = document.getElementById('single-note-inspector');
  const multiInspector = document.getElementById('multi-note-inspector');

  if (singleInspector) singleInspector.style.display = 'none';
  if (multiInspector) multiInspector.style.display = 'none';
  if (inspectorBar) inspectorBar.style.display = 'none';
}

function auditionSelectedNote(note: number, durTicks: number, velocity: number) {
  const durSec = Math.max(0.1, Math.min(2.0, ticksToSeconds(durTicks, 120, currentTicksPerBeat)));
  audioEngine.playAuditionPhrase([
    { note, startSec: 0, durationSec: durSec, velocity }
  ], currentCanvasPadInstrument);
}

function auditionSelectedNotes(boxes: RenderedNoteBox[]) {
  if (!boxes || boxes.length === 0) return;
  const sorted = [...boxes].sort((a, b) => a.startTick - b.startTick);
  const baseTick = sorted[0].startTick;
  const phrase = sorted.map(b => {
    const offsetTicks = Math.max(0, b.startTick - baseTick);
    const offsetSec = ticksToSeconds(offsetTicks, 120, currentTicksPerBeat);
    const durSec = Math.max(0.1, Math.min(2.5, ticksToSeconds(b.durationTick, 120, currentTicksPerBeat)));
    return {
      note: b.note,
      startSec: offsetSec,
      durationSec: durSec,
      velocity: b.velocity,
    };
  });
  audioEngine.playAuditionPhrase(phrase, currentCanvasPadInstrument);
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

  // 刪除音符按鈕與邏輯
  const btnDelete = document.getElementById('btn-insp-delete');
  const deleteSelectedNote = () => {
    if (!selectedNoteBox || !currentParsed) return;
    const target = {
      note: selectedNoteBox.note,
      startTick: selectedNoteBox.startTick,
      oldDurationTick: selectedNoteBox.durationTick,
    };
    const noteName = midiNoteToName(target.note);
    const success = YamahaPadModifier.deleteNoteEvent(currentParsed, currentCanvasPadNum, target);
    if (success) {
      deselectNote();
      markModified(`已刪除 Pad ${currentCanvasPadNum} 音符 ${noteName} (${target.note})`);
      refreshCurrentPadDetail();
    }
  };

  if (btnDelete) {
    btnDelete.addEventListener('click', deleteSelectedNote);
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

  // 音高微調快捷鍵 (Pitch Transpose Buttons: -8度 降八度, ▼ 降半音, ▲ 升半音, +8度 升八度)
  const btnPitchDownOct = document.getElementById('btn-pitch-down-oct');
  const btnPitchDownSemi = document.getElementById('btn-pitch-down-semi');
  const btnPitchUpSemi = document.getElementById('btn-pitch-up-semi');
  const btnPitchUpOct = document.getElementById('btn-pitch-up-oct');

  const shiftSelectedNotePitch = (semiDelta: number) => {
    if (!selectedNoteBox || !currentParsed) return;
    const oldNote = selectedNoteBox.note;
    const newNote = Math.max(0, Math.min(127, oldNote + semiDelta));
    if (newNote === oldNote) return;

    const success = YamahaPadModifier.updateNoteEvent(
      currentParsed,
      currentCanvasPadNum,
      { note: oldNote, startTick: selectedNoteBox.startTick, oldDurationTick: selectedNoteBox.durationTick },
      { note: newNote }
    );

    if (success) {
      selectedNoteBox.note = newNote;
      const pitchEl = document.getElementById('insp-pitch-name');
      if (pitchEl) pitchEl.textContent = `${midiNoteToName(newNote)} (${newNote})`;
      markModified(`已移調 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(oldNote)} 至 ${midiNoteToName(newNote)} (${newNote})`);
      refreshCurrentPadDetail();
      auditionSelectedNote(newNote, selectedNoteBox.durationTick, selectedNoteBox.velocity);
    }
  };

  if (btnPitchDownOct) {
    btnPitchDownOct.addEventListener('click', () => shiftSelectedNotePitch(-12));
  }
  if (btnPitchDownSemi) {
    btnPitchDownSemi.addEventListener('click', () => shiftSelectedNotePitch(-1));
  }
  if (btnPitchUpSemi) {
    btnPitchUpSemi.addEventListener('click', () => shiftSelectedNotePitch(1));
  }
  if (btnPitchUpOct) {
    btnPitchUpOct.addEventListener('click', () => shiftSelectedNotePitch(12));
  }

  // 位置微調快捷鍵 (Nudge Position Buttons: ⏪ 前移1小節, ◀ 前移1拍, ▶ 後移1拍, ⏩ 後移1小節)
  const btnNudgePrevBeat = document.getElementById('btn-nudge-prev-beat');
  const btnNudgeNextBeat = document.getElementById('btn-nudge-next-beat');
  const btnNudgePrevBar = document.getElementById('btn-nudge-prev-bar');
  const btnNudgeNextBar = document.getElementById('btn-nudge-next-bar');

  const shiftSelectedNotePosition = (tickDelta: number) => {
    if (!selectedNoteBox || !currentParsed) return;
    const oldStart = selectedNoteBox.startTick;
    const newStart = Math.max(0, oldStart + tickDelta);
    if (newStart === oldStart) return;

    const success = YamahaPadModifier.updateNoteEvent(
      currentParsed,
      currentCanvasPadNum,
      { note: selectedNoteBox.note, startTick: oldStart, oldDurationTick: selectedNoteBox.durationTick },
      { startTick: newStart }
    );

    if (success) {
      selectedNoteBox.startTick = newStart;
      const pos = formatNotePosition(newStart - currentGridStartTick, currentTicksPerBeat, currentBeatsPerBar);
      markModified(`已平移 Pad ${currentCanvasPadNum} 音符 ${midiNoteToName(selectedNoteBox.note)} 位置至 ${pos.displayFull}`);
      refreshCurrentPadDetail();
      auditionSelectedNote(selectedNoteBox.note, selectedNoteBox.durationTick, selectedNoteBox.velocity);
    }
  };

  if (btnNudgePrevBeat) {
    btnNudgePrevBeat.addEventListener('click', () => {
      shiftSelectedNotePosition(-currentTicksPerBeat);
    });
  }
  if (btnNudgeNextBeat) {
    btnNudgeNextBeat.addEventListener('click', () => {
      shiftSelectedNotePosition(currentTicksPerBeat);
    });
  }
  if (btnNudgePrevBar) {
    btnNudgePrevBar.addEventListener('click', () => {
      const ticksPerBar = currentTicksPerBeat * currentBeatsPerBar;
      shiftSelectedNotePosition(-ticksPerBar);
    });
  }
  if (btnNudgeNextBar) {
    btnNudgeNextBar.addEventListener('click', () => {
      const ticksPerBar = currentTicksPerBeat * currentBeatsPerBar;
      shiftSelectedNotePosition(ticksPerBar);
    });
  }

  // ==========================================
  // 多音符批次工具列 (Multi-Note Batch Bar) 事件綁定
  // ==========================================

  // 1. 批次力度增減 (-10 / +10)、自訂數值輸入與範本預設
  const applyBatchVelocity = (val: number, isRelative: boolean = false) => {
    if (!currentParsed || selectedNoteBoxes.length === 0) return;

    if (isRelative) {
      const updates = selectedNoteBoxes.map(b => {
        const newVel = Math.max(1, Math.min(127, b.velocity + val));
        b.velocity = newVel;
        return {
          target: { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick },
          updates: { velocity: newVel }
        };
      });
      YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
      markModified(`已批次將 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符力度 ${val > 0 ? '+' : ''}${val}`);
    } else {
      const targetVel = Math.max(1, Math.min(127, Math.round(val)));
      const updates = selectedNoteBoxes.map(b => {
        b.velocity = targetVel;
        return {
          target: { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick },
          updates: { velocity: targetVel }
        };
      });
      YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
      markModified(`已批次將 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符力度設為 ${targetVel}`);
    }

    refreshCurrentPadDetail();
    auditionSelectedNotes(selectedNoteBoxes);
  };

  const btnBatchVelMinus10 = document.getElementById('btn-batch-vel-minus10');
  if (btnBatchVelMinus10) {
    btnBatchVelMinus10.addEventListener('click', () => applyBatchVelocity(-10, true));
  }

  const btnBatchVelPlus10 = document.getElementById('btn-batch-vel-plus10');
  if (btnBatchVelPlus10) {
    btnBatchVelPlus10.addEventListener('click', () => applyBatchVelocity(10, true));
  }

  const batchVelInput = document.getElementById('batch-vel-input') as HTMLInputElement | null;
  const btnBatchVelApply = document.getElementById('btn-batch-vel-apply');

  const commitCustomBatchVelocity = () => {
    if (!batchVelInput) return;
    const rawVal = parseInt(batchVelInput.value, 10);
    if (isNaN(rawVal) || rawVal < 1 || rawVal > 127) {
      showStatus('⚠️ 請輸入 1 ~ 127 之間的有效力度數值 (Velocity)', true);
      return;
    }
    applyBatchVelocity(rawVal, false);
  };

  if (btnBatchVelApply) {
    btnBatchVelApply.addEventListener('click', commitCustomBatchVelocity);
  }

  if (batchVelInput) {
    batchVelInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitCustomBatchVelocity();
      }
    });
  }

  // 2. 統一固定力度下拉選單
  const selectBatchVelPreset = document.getElementById('batch-vel-preset-select') as HTMLSelectElement | null;
  if (selectBatchVelPreset) {
    selectBatchVelPreset.addEventListener('change', () => {
      const val = parseInt(selectBatchVelPreset.value, 10);
      if (isNaN(val) || !currentParsed || selectedNoteBoxes.length === 0) return;
      applyBatchVelocity(val, false);
      selectBatchVelPreset.value = '';
    });
  }

    // 3. 批次移調
  const shiftBatchNotesPitch = (semiDelta: number) => {
    if (!currentParsed || selectedNoteBoxes.length === 0) return;
    const wouldOverflow = selectedNoteBoxes.some(b => b.note + semiDelta < 0 || b.note + semiDelta > 127);
    if (wouldOverflow) {
      showStatus('移調將超出 MIDI 音高範圍 (0~127)，已自動取消操作', true);
      return;
    }
    const updates = selectedNoteBoxes.map(b => {
      const newNote = b.note + semiDelta;
      const target = { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick };
      b.note = newNote;
      return {
        target,
        updates: { note: newNote }
      };
    });
    YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
    markModified(`已批次將 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符移調 ${semiDelta > 0 ? '+' : ''}${semiDelta} 半音`);
    refreshCurrentPadDetail();
    auditionSelectedNotes(selectedNoteBoxes);
  };

  const btnBatchPitchDownOct = document.getElementById('btn-batch-pitch-down-oct');
  if (btnBatchPitchDownOct) btnBatchPitchDownOct.addEventListener('click', () => shiftBatchNotesPitch(-12));
  const btnBatchPitchDownSemi = document.getElementById('btn-batch-pitch-down-semi');
  if (btnBatchPitchDownSemi) btnBatchPitchDownSemi.addEventListener('click', () => shiftBatchNotesPitch(-1));
  const btnBatchPitchUpSemi = document.getElementById('btn-batch-pitch-up-semi');
  if (btnBatchPitchUpSemi) btnBatchPitchUpSemi.addEventListener('click', () => shiftBatchNotesPitch(1));
  const btnBatchPitchUpOct = document.getElementById('btn-batch-pitch-up-oct');
  if (btnBatchPitchUpOct) btnBatchPitchUpOct.addEventListener('click', () => shiftBatchNotesPitch(12));

  // 4. 批次音長縮放 (50%, 80%, 100%, 120%)
  const scaleBatchNotesDuration = (ratio: number, desc: string) => {
    if (!currentParsed || selectedNoteBoxes.length === 0) return;
    const updates = selectedNoteBoxes.map(b => {
      const newDur = Math.max(12, Math.round(b.durationTick * ratio));
      const target = { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick };
      b.durationTick = newDur;
      return {
        target,
        updates: { durationTick: newDur }
      };
    });
    YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
    markModified(`已批次將 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符音長調整為 ${desc}`);
    refreshCurrentPadDetail();
  };

  const btnBatchDur50 = document.getElementById('btn-batch-dur-50');
  if (btnBatchDur50) btnBatchDur50.addEventListener('click', () => scaleBatchNotesDuration(0.5, '50% 斷奏'));
  const btnBatchDur80 = document.getElementById('btn-batch-dur-80');
  if (btnBatchDur80) btnBatchDur80.addEventListener('click', () => scaleBatchNotesDuration(0.8, '80% 跳音'));
  const btnBatchDur100 = document.getElementById('btn-batch-dur-100');
  if (btnBatchDur100) btnBatchDur100.addEventListener('click', () => scaleBatchNotesDuration(1.0, '100% 滿格'));
  const btnBatchDur120 = document.getElementById('btn-batch-dur-120');
  if (btnBatchDur120) btnBatchDur120.addEventListener('click', () => scaleBatchNotesDuration(1.2, '120% 連音'));

  // 5. 批次位置平移
  const shiftBatchNotesPosition = (tickDelta: number) => {
    if (!currentParsed || selectedNoteBoxes.length === 0) return;
    const wouldUnderflow = selectedNoteBoxes.some(b => b.startTick + tickDelta < 0);
    if (wouldUnderflow) {
      showStatus('平移將超出開頭 (Tick 0)，已自動取消操作', true);
      return;
    }
    const updates = selectedNoteBoxes.map(b => {
      const newStart = b.startTick + tickDelta;
      const target = { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick };
      b.startTick = newStart;
      return {
        target,
        updates: { startTick: newStart }
      };
    });
    YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
    markModified(`已批次平移 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符位置`);
    refreshCurrentPadDetail();
  };

  const btnBatchNudgePrevBar = document.getElementById('btn-batch-nudge-prev-bar');
  if (btnBatchNudgePrevBar) btnBatchNudgePrevBar.addEventListener('click', () => shiftBatchNotesPosition(-(currentTicksPerBeat * currentBeatsPerBar)));
  const btnBatchNudgePrevBeat = document.getElementById('btn-batch-nudge-prev-beat');
  if (btnBatchNudgePrevBeat) btnBatchNudgePrevBeat.addEventListener('click', () => shiftBatchNotesPosition(-currentTicksPerBeat));
  const btnBatchNudgeNextBeat = document.getElementById('btn-batch-nudge-next-beat');
  if (btnBatchNudgeNextBeat) btnBatchNudgeNextBeat.addEventListener('click', () => shiftBatchNotesPosition(currentTicksPerBeat));
  const btnBatchNudgeNextBar = document.getElementById('btn-batch-nudge-next-bar');
  if (btnBatchNudgeNextBar) btnBatchNudgeNextBar.addEventListener('click', () => shiftBatchNotesPosition(currentTicksPerBeat * currentBeatsPerBar));

  // 6. 批次量化
  const btnBatchQuantize = document.getElementById('btn-batch-quantize');
  if (btnBatchQuantize) {
    btnBatchQuantize.addEventListener('click', () => {
      if (!currentParsed || selectedNoteBoxes.length === 0) return;
      const selectGridEl = document.getElementById('select-roll-quantize-grid') as HTMLSelectElement | null;
      const grid = (selectGridEl ? selectGridEl.value : '1/16') as QuantizeGrid;
      const updates = selectedNoteBoxes.map(b => {
        const newStart = PadRecorder.snapTickToGrid(b.startTick, grid, currentTicksPerBeat);
        const target = { note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick };
        b.startTick = newStart;
        return {
          target,
          updates: { startTick: newStart }
        };
      });
      YamahaPadModifier.batchUpdateNotes(currentParsed, currentCanvasPadNum, updates);
      markModified(`已批次將 Pad ${currentCanvasPadNum} 的 ${selectedNoteBoxes.length} 顆音符量化吸附至 ${grid}`);
      refreshCurrentPadDetail();
    });
  }

  // 7. 批次試聽
  const btnBatchPreview = document.getElementById('btn-batch-preview');
  if (btnBatchPreview) {
    btnBatchPreview.addEventListener('click', () => auditionSelectedNotes(selectedNoteBoxes));
  }

  // 8. 批次刪除
  const deleteBatchNotes = () => {
    if (!currentParsed || selectedNoteBoxes.length === 0) return;
    const count = selectedNoteBoxes.length;
    if (!confirm(`確定要刪除選取的 ${count} 顆音符嗎？`)) return;
    const targets = selectedNoteBoxes.map(b => ({ note: b.note, startTick: b.startTick, oldDurationTick: b.durationTick }));
    const deletedCount = YamahaPadModifier.batchDeleteNotes(currentParsed, currentCanvasPadNum, targets);
    markModified(`已批次刪除 Pad ${currentCanvasPadNum} 的 ${deletedCount} 顆音符`);
    deselectNote();
    refreshCurrentPadDetail();
  };

  const btnBatchDelete = document.getElementById('btn-batch-delete');
  if (btnBatchDelete) btnBatchDelete.addEventListener('click', deleteBatchNotes);

  const btnBatchClose = document.getElementById('btn-batch-close');
  if (btnBatchClose) btnBatchClose.addEventListener('click', () => deselectNote());

  // 鍵盤方向鍵與小節快捷鍵支援 (DAW 級操作手感)
  window.addEventListener('keydown', (e) => {
    if (!currentParsed) return;
    const activeEl = document.activeElement;
    const tag = (activeEl?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const hoverInfoEl = document.getElementById('canvas-hover-info');

    // 支援 Ctrl+A 全選當前畫布所有音符
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      if (lastRenderedNoteBoxes.length > 0) {
        e.preventDefault();
        selectMultipleNotes(lastRenderedNoteBoxes);
        return;
      }
    }

    // 支援 Ctrl+C / Ctrl+V / Ctrl+D 小節與音符操作
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c' || e.key === 'C') {
        const srcBar = selectedRulerBar || (selectedNoteBox ? Math.floor((selectedNoteBox.startTick - currentGridStartTick) / (currentTicksPerBeat * currentBeatsPerBar)) + 1 : 1);
        clipboardCopiedBar = srcBar;
        if (hoverInfoEl) {
          hoverInfoEl.innerHTML = `✅ <span style="color:#10b981;font-weight:700;">已複製第 ${srcBar} 小節</span>！請點擊目標小節（或從選單指定）按 <kbd>Ctrl+V</kbd> 貼上。`;
          hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
        }
        e.preventDefault();
        return;
      } else if (e.key === 'v' || e.key === 'V') {
        if (clipboardCopiedBar) {
          const destSelect = document.getElementById('select-copy-dest-bar') as HTMLSelectElement | null;
          const copyModeSelect = document.getElementById('select-copy-mode') as HTMLSelectElement | null;
          let targetBar = selectedRulerBar;
          if (!targetBar || targetBar === clipboardCopiedBar) {
            targetBar = destSelect ? parseInt(destSelect.value, 10) : (clipboardCopiedBar + 1);
          }
          const mode = e.shiftKey ? 'insert' : ((copyModeSelect?.value as 'replace' | 'insert') || 'replace');
          const res = YamahaPadModifier.copyPadMeasure(currentParsed, currentCanvasPadNum, clipboardCopiedBar, targetBar, mode);
          if (res.success) {
            deselectNote();
            const modeText = mode === 'insert' ? '插入順移' : '覆蓋替換';
            markModified(`已將 Pad ${currentCanvasPadNum} 第 ${clipboardCopiedBar} 小節以【${modeText}】至第 ${targetBar} 小節 (共複製 ${res.copiedCount} 顆音符)`);
            refreshCurrentPadDetail();
            if (hoverInfoEl) {
              const actionMsg = mode === 'insert'
                ? `已【插入順移】至第 ${targetBar} 小節，後續小節自動往後推移 (+1 小節)`
                : `已【覆蓋替換】至第 ${targetBar} 小節`;
              hoverInfoEl.innerHTML = `🎉 <span style="color:#10b981;font-weight:700;">已貼上 (${modeText})</span>：第 ${clipboardCopiedBar} 小節 ➔ ${actionMsg} (共 ${res.copiedCount} 顆音符，總長度: ${res.newTotalBars} 小節)！`;
              hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
            }
          }
          e.preventDefault();
          return;
        }
      } else if (e.key === 'd' || e.key === 'D') {
        let srcBar = selectedRulerBar;
        if (!srcBar && selectedNoteBox) {
          srcBar = Math.floor((selectedNoteBox.startTick - currentGridStartTick) / (currentTicksPerBeat * currentBeatsPerBar)) + 1;
        }
        const res = YamahaPadModifier.duplicatePadMeasure(currentParsed, currentCanvasPadNum, srcBar ?? undefined);
        if (res.success) {
          markModified(`已將 Pad ${currentCanvasPadNum} 第 ${srcBar || 1} 小節倍增至第 ${res.newTargetBar} 小節`);
          refreshCurrentPadDetail();
          if (hoverInfoEl) {
            hoverInfoEl.innerHTML = `🔁 <span style="color:#10b981;font-weight:700;">已一鍵倍增</span>：新第 ${res.newTargetBar} 小節 (總長度: ${res.newTargetBar} 小節)！`;
            hoverInfoEl.style.backgroundColor = 'rgba(16, 185, 129, 0.16)';
          }
        }
        e.preventDefault();
        return;
      }
    }

    // 快捷鍵：Shift + Delete 觸發小節剪除順移 (Ripple Delete)
    if (e.shiftKey && (e.key === 'Delete' || e.key === 'Backspace')) {
      const btnRipple = document.getElementById('btn-ripple-delete-bar');
      if (btnRipple) {
        e.preventDefault();
        btnRipple.click();
        return;
      }
    }

    // 快捷鍵：Delete / Backspace (支援單音與批次刪除)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNoteBoxes.length > 1) {
        e.preventDefault();
        deleteBatchNotes();
        return;
      } else if (selectedNoteBox) {
        e.preventDefault();
        deleteSelectedNote();
        return;
      } else if (selectedRulerBar !== null) {
        const btnClear = document.getElementById('btn-clear-bar-notes');
        if (btnClear) {
          e.preventDefault();
          btnClear.click();
          return;
        }
      }
    }

    if (!selectedNoteBox && selectedNoteBoxes.length === 0) {
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const btnOct = document.getElementById(e.key === 'ArrowUp' ? 'btn-roll-octave-up' : 'btn-roll-octave-down');
        if (btnOct) {
          e.preventDefault();
          btnOct.click();
        }
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.shiftKey ? 12 : 1;
      if (selectedNoteBoxes.length > 1) {
        shiftBatchNotesPitch(delta);
      } else if (selectedNoteBox) {
        shiftSelectedNotePitch(delta);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.shiftKey ? -12 : -1;
      if (selectedNoteBoxes.length > 1) {
        shiftBatchNotesPitch(delta);
      } else if (selectedNoteBox) {
        shiftSelectedNotePitch(delta);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const deltaTicks = e.shiftKey ? -currentTicksPerBeat * currentBeatsPerBar : -currentTicksPerBeat;
      if (selectedNoteBoxes.length > 1) {
        shiftBatchNotesPosition(deltaTicks);
      } else if (selectedNoteBox) {
        shiftSelectedNotePosition(deltaTicks);
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const deltaTicks = e.shiftKey ? currentTicksPerBeat * currentBeatsPerBar : currentTicksPerBeat;
      if (selectedNoteBoxes.length > 1) {
        shiftBatchNotesPosition(deltaTicks);
      } else if (selectedNoteBox) {
        shiftSelectedNotePosition(deltaTicks);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      deselectNote();
    }
  });
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
      let chorus: number | undefined;
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
            if (ev.controller === 93 && ev.value !== undefined) chorus = ev.value;
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
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${chorus ?? 0}" class="mixing-slider cho-range-${padNum}" title="合唱深度 (CC93, 0~127)" />
            <span class="cho-label-${padNum}" style="font-size: 0.8rem; width: 28px; text-align: right;">${chorus ?? 0}</span>
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
        midiManager.sendMixerControllers(padNum - 1, { volume: val });
        markModified(`Pad ${padNum} 音量調整為: ${val}`);
      });

      // 監聽聲相推桿事件
      const panRange = tr.querySelector(`.pan-range-${padNum}`) as HTMLInputElement;
      const panLabel = tr.querySelector(`.pan-label-${padNum}`) as HTMLElement;
      panRange.addEventListener('input', () => {
        const val = parseInt(panRange.value, 10);
        panLabel.textContent = formatPan(val);
        YamahaPadModifier.setPadMixing(parsed, padNum, { pan: val });
        midiManager.sendMixerControllers(padNum - 1, { pan: val });
        markModified(`Pad ${padNum} 聲相調整為: ${formatPan(val)}`);
      });

      // 監聽混響推桿事件
      const revRange = tr.querySelector(`.rev-range-${padNum}`) as HTMLInputElement;
      const revLabel = tr.querySelector(`.rev-label-${padNum}`) as HTMLElement;
      revRange.addEventListener('input', () => {
        const val = parseInt(revRange.value, 10);
        revLabel.textContent = `${val}`;
        YamahaPadModifier.setPadMixing(parsed, padNum, { reverb: val });
        midiManager.sendMixerControllers(padNum - 1, { reverb: val });
        markModified(`Pad ${padNum} 混響調整為: ${val}`);
      });

      // 監聽合唱推桿事件 (2.8-C)
      const choRange = tr.querySelector(`.cho-range-${padNum}`) as HTMLInputElement;
      const choLabel = tr.querySelector(`.cho-label-${padNum}`) as HTMLElement;
      choRange.addEventListener('input', () => {
        const val = parseInt(choRange.value, 10);
        choLabel.textContent = `${val}`;
        YamahaPadModifier.setPadMixing(parsed, padNum, { chorus: val });
        midiManager.sendMixerControllers(padNum - 1, { chorus: val });
        markModified(`Pad ${padNum} 合唱效果調整為: ${val}`);
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

        // 實體琴即時同步音色
        midiManager.sendVoiceChange(padNum - 1, { msb, lsb, pc: program });

        // 反向同步上方 Pad 卡片的樂器下拉選單
        updatePadCardInstrumentSelect(padNum, msb, lsb, program);

        // 若當前畫面正在檢視此 Pad，立即刷新詳細資訊面板
        if (currentActivePadNum === padNum) {
          const sec = parsed.sections[padIdx];
          const nameInput = document.querySelector(`.pad-card-${padNum} .pad-name-input`) as HTMLInputElement | null;
          const currentName = nameInput ? nameInput.value : `Pad ${padNum}`;
          showPadNotesDetail(parsed, sec || null, currentName, padNum);
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
    // STY 模式：8 伴奏聲部互動式混音台 (Rhythm 1/2, Bass, Chord 1/2, Pad, Phrase 1/2)
    // 檢查此 STY 是否主要使用 SFF1 通道 (0~7)
    const hasSff1Notes = parsed.parts.some(p => p.channel >= 0 && p.channel <= 7 && countPartTotalNotes(parsed, p.channel) > 0);
    const hasSff2Notes = parsed.parts.some(p => p.channel >= 8 && p.channel <= 15 && countPartTotalNotes(parsed, p.channel) > 0);

    // 若非純 SFF1 檔案，確保 8 大標準伴奏聲部 (Channel 8 ~ 15) 條目完整
    if (!hasSff1Notes || hasSff2Notes) {
      const partKeys: StylePartId[] = ['Rhythm1', 'Rhythm2', 'Bass', 'Chord1', 'Chord2', 'Pad', 'Phrase1', 'Phrase2'];
      for (const key of partKeys) {
        const def = DEFAULT_STYLE_PARTS[key];
        if (!parsed.parts.find((p) => p.channel === def.channel)) {
          parsed.parts.push({
            trackIndex: 0,
            channel: def.channel,
            partName: def.name,
            volume: def.volume,
            pan: def.pan,
            reverb: def.reverb,
            chorus: def.chorus,
            bankMsb: def.msb,
            bankLsb: def.lsb,
            programChange: def.pc,
          });
        }
      }
    }
    parsed.parts.sort((a, b) => a.channel - b.channel);

    // 取得在檔案中實際有音符的伴奏聲部
    const channelsWithNotes = new Set<number>();
    for (let c = 0; c <= 15; c++) {
      if (countPartTotalNotes(parsed, c) > 0) {
        channelsWithNotes.add(c);
      }
    }

    let partsToRender = parsed.parts;
    if (hasSff1Notes && channelsWithNotes.size > 0) {
      // 僅顯示在檔案中實際演奏 (有音符) 的聲部，過濾掉後面空的 8~15 通道
      partsToRender = parsed.parts.filter(p => channelsWithNotes.has(p.channel));
    }

    partsCount.textContent = hasSff1Notes && hasSff2Notes
      ? `${partsToRender.length} 個伴奏聲部 (完整偵測 ${channelsWithNotes.size} 軌: 跨 SFF1/SFF2 擴展通道)`
      : (hasSff1Notes
        ? `${partsToRender.length} 個伴奏聲部 (SFF1 伴奏通道 1~8)`
        : `${partsToRender.length} 個伴奏聲部 (Yamaha 原廠通道 9~16)`);

    for (const part of partsToRender) {
      const ch = part.channel;
      const meta = STY_PART_META[ch] || {
        id: 'Phrase2' as StylePartId,
        name: part.partName || `Part (Ch ${ch + 1})`,
        shortName: `Part ${ch + 1}`,
        icon: '🎵',
        color: '#94a3b8',
        bg: 'rgba(148, 163, 184, 0.15)',
        border: 'rgba(148, 163, 184, 0.35)',
      };

      const vol = part.volume ?? 100;
      const pan = part.pan ?? 64;
      const reverb = part.reverb ?? 40;
      const chorus = part.chorus ?? 0;
      const bankMsb = part.bankMsb ?? (ch === 8 || ch === 9 ? 127 : 0);
      const bankLsb = part.bankLsb ?? (ch === 8 || ch === 9 ? 0 : 112);
      const pc = part.programChange ?? 0;

      const isMuted = !!stylePartMuteState[ch];
      const isSolo = stylePartSoloChannel === ch;
      const isSilencedBySolo = stylePartSoloChannel !== null && !isSolo;

      const noteCount = countPartTotalNotes(parsed, ch);

      const tr = document.createElement('tr');
      tr.className = `sty-table-row sty-table-row-${ch} ${isMuted || isSilencedBySolo ? 'row-muted' : ''} ${isSolo ? 'row-solo' : ''}`;

      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="part-badge" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; background: ${meta.bg}; border: 1px solid ${meta.border}; color: ${meta.color}; font-weight: 600; font-size: 0.8rem;">
              <span>${meta.icon}</span>
              <span>${meta.name}</span>
            </span>
            <div class="part-ctrl-btn-group">
              <button type="button" class="btn-part-ctrl btn-mute-sty-${ch} ${isMuted ? 'active-mute' : ''}" data-channel="${ch}" title="靜音此伴奏聲部 (Mute)">M</button>
              <button type="button" class="btn-part-ctrl btn-solo-sty-${ch} ${isSolo ? 'active-solo' : ''}" data-channel="${ch}" title="獨奏此伴奏聲部 (Solo)">S</button>
            </div>
          </div>
        </td>
        <td class="part-notes-cell">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="color: #94a3b8; font-family: monospace; font-weight: 600;">Ch ${ch + 1}</span>
            <span style="font-size: 0.72rem; color: ${noteCount > 0 ? '#10b981' : '#64748b'};">
              ${noteCount > 0 ? `♪ ${noteCount} 音符` : '無音符'}
            </span>
          </div>
        </td>
        <td>
          <div style="display: flex; gap: 4px; align-items: center;">
            <input type="number" min="0" max="127" class="mixing-num-input bank-msb-sty-${ch}" value="${bankMsb}" title="Bank MSB (CC0)" />
            <span>-</span>
            <input type="number" min="0" max="127" class="mixing-num-input bank-lsb-sty-${ch}" value="${bankLsb}" title="Bank LSB (CC32)" />
          </div>
        </td>
        <td class="part-voice-cell">
          <div style="display: flex; gap: 4px; align-items: center;">
            <input type="number" min="0" max="127" class="mixing-num-input pc-sty-${ch}" value="${pc}" title="Program Change (音色代碼 0~127)" />
            <button type="button" class="btn-open-sty-voice-modal" data-channel="${ch}" title="開啟 Yamaha PSR-SX920 原廠音色庫搜尋視窗" style="padding: 2px 6px; font-size: 0.76rem; border-radius: 4px; border: 1px solid #475569; background: #1e293b; color: #38bdf8; cursor: pointer;">🔍 庫</button>
          </div>
        </td>
        <td class="part-vol-cell">
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${vol}" class="mixing-slider vol-range-sty-${ch}" title="音量 (0~127)" />
            <span class="vol-label-sty-${ch}" style="font-size: 0.8rem; width: 28px; text-align: right; color: #cbd5e1;">${vol}</span>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${pan}" class="mixing-slider pan-range-sty-${ch}" title="左右立體聲聲相 (L64~C~R63)" />
            <span class="pan-label-sty-${ch} pan-indicator">${formatPan(pan)}</span>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${reverb}" class="mixing-slider rev-range-sty-${ch}" title="混響深度 (CC91, 0~127)" />
            <span class="rev-label-sty-${ch}" style="font-size: 0.8rem; width: 28px; text-align: right; color: #cbd5e1;">${reverb}</span>
          </div>
        </td>
        <td>
          <div class="mixing-slider-container">
            <input type="range" min="0" max="127" value="${chorus}" class="mixing-slider cho-range-sty-${ch}" title="合唱深度 (CC93, 0~127)" />
            <span class="cho-label-sty-${ch}" style="font-size: 0.8rem; width: 28px; text-align: right; color: #cbd5e1;">${chorus}</span>
          </div>
        </td>
      `;

      // 監聽音量推桿事件
      const volRange = tr.querySelector(`.vol-range-sty-${ch}`) as HTMLInputElement;
      const volLabel = tr.querySelector(`.vol-label-sty-${ch}`) as HTMLElement;
      volRange.addEventListener('input', () => {
        const val = parseInt(volRange.value, 10);
        volLabel.textContent = `${val}`;
        YamahaStyleModifier.setPartMixing(parsed, ch, { volume: val });
        midiManager.sendMixerControllers(ch, { volume: val });
        markModified(`伴奏聲部 ${meta.name} 音量調整為: ${val}`);
      });

      // 監聽聲相推桿事件
      const panRange = tr.querySelector(`.pan-range-sty-${ch}`) as HTMLInputElement;
      const panLabel = tr.querySelector(`.pan-label-sty-${ch}`) as HTMLElement;
      panRange.addEventListener('input', () => {
        const val = parseInt(panRange.value, 10);
        panLabel.textContent = formatPan(val);
        YamahaStyleModifier.setPartMixing(parsed, ch, { pan: val });
        midiManager.sendMixerControllers(ch, { pan: val });
        markModified(`伴奏聲部 ${meta.name} 聲相調整為: ${formatPan(val)}`);
      });

      // 監聽混響推桿事件
      const revRange = tr.querySelector(`.rev-range-sty-${ch}`) as HTMLInputElement;
      const revLabel = tr.querySelector(`.rev-label-sty-${ch}`) as HTMLElement;
      revRange.addEventListener('input', () => {
        const val = parseInt(revRange.value, 10);
        revLabel.textContent = `${val}`;
        YamahaStyleModifier.setPartMixing(parsed, ch, { reverb: val });
        midiManager.sendMixerControllers(ch, { reverb: val });
        markModified(`伴奏聲部 ${meta.name} 混響調整為: ${val}`);
      });

      // 監聽合唱推桿事件
      const choRange = tr.querySelector(`.cho-range-sty-${ch}`) as HTMLInputElement;
      const choLabel = tr.querySelector(`.cho-label-sty-${ch}`) as HTMLElement;
      choRange.addEventListener('input', () => {
        const val = parseInt(choRange.value, 10);
        choLabel.textContent = `${val}`;
        YamahaStyleModifier.setPartMixing(parsed, ch, { chorus: val });
        midiManager.sendMixerControllers(ch, { chorus: val });
        markModified(`伴奏聲部 ${meta.name} 合唱效果調整為: ${val}`);
      });

      // 監聽音色變更事件
      const inputMsb = tr.querySelector(`.bank-msb-sty-${ch}`) as HTMLInputElement;
      const inputLsb = tr.querySelector(`.bank-lsb-sty-${ch}`) as HTMLInputElement;
      const inputPc = tr.querySelector(`.pc-sty-${ch}`) as HTMLInputElement;

      const onVoiceChange = () => {
        const msb = parseInt(inputMsb.value, 10) || 0;
        const lsb = parseInt(inputLsb.value, 10) || 0;
        const program = parseInt(inputPc.value, 10) || 0;
        YamahaStyleModifier.setPartMixing(parsed, ch, {
          bankMsb: msb,
          bankLsb: lsb,
          programChange: program,
        });
        midiManager.sendVoiceChange(ch, { msb, lsb, pc: program });
        markModified(`伴奏聲部 ${meta.name} 音色調整為: Bank ${msb}-${lsb}, PC ${program}`);
        restartCurrentStySectionAudition();
      };

      inputMsb.addEventListener('change', onVoiceChange);
      inputLsb.addEventListener('change', onVoiceChange);
      inputPc.addEventListener('change', onVoiceChange);

      // 開啟原廠音色庫搜尋視窗
      const btnVoiceModal = tr.querySelector(`.btn-open-sty-voice-modal[data-channel="${ch}"]`) as HTMLButtonElement | null;
      if (btnVoiceModal) {
        btnVoiceModal.addEventListener('click', (e) => {
          e.stopPropagation();
          openVoiceModal(ch, 'STY');
        });
      }

      // Mute (靜音) 切換按鈕
      const btnMute = tr.querySelector(`.btn-mute-sty-${ch}`) as HTMLButtonElement;
      btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        stylePartMuteState[ch] = !stylePartMuteState[ch];
        const muted = stylePartMuteState[ch];
        btnMute.classList.toggle('active-mute', muted);
        tr.classList.toggle('row-muted', muted || (stylePartSoloChannel !== null && stylePartSoloChannel !== ch));

        // 實體琴即時同步
        const currentVol = parseInt(volRange.value, 10) || 100;
        midiManager.sendMixerControllers(ch, { volume: muted ? 0 : currentVol });

        restartCurrentStySectionAudition();
      });

      // Solo (獨奏) 切換按鈕
      const btnSolo = tr.querySelector(`.btn-solo-sty-${ch}`) as HTMLButtonElement;
      btnSolo.addEventListener('click', (e) => {
        e.stopPropagation();
        if (stylePartSoloChannel === ch) {
          stylePartSoloChannel = null;
        } else {
          stylePartSoloChannel = ch;
        }

        updateAllStySoloVisuals();

        // 實體琴同步
        for (let c = 0; c <= 15; c++) {
          const inputEl = document.querySelector(`.vol-range-sty-${c}`) as HTMLInputElement | null;
          if (!inputEl) continue;
          const v = parseInt(inputEl.value, 10) || 100;
          if (stylePartSoloChannel !== null) {
            midiManager.sendMixerControllers(c, { volume: c === stylePartSoloChannel ? v : 0 });
          } else {
            const isM = !!stylePartMuteState[c];
            midiManager.sendMixerControllers(c, { volume: isM ? 0 : v });
          }
        }

        restartCurrentStySectionAudition();
      });

      partsTbody.appendChild(tr);
    }

    // 依據目前聚焦的伴奏段落，動態連動各聲部發聲狀態與音符
    updateStyPartsSectionLinkage(parsed, currentActiveStySection);
  }
}

function updateStyPartsSectionLinkage(parsed: YamahaFileParsed, sectionName: string | null) {
  if (!parsed || parsed.format !== 'STY') return;

  const panelPartsTitle = document.getElementById('panel-parts-title');
  const range = sectionName ? StyleRemixer.getSectionTickRange(parsed, sectionName) : null;

  if (panelPartsTitle) {
    if (sectionName) {
      panelPartsTitle.innerHTML = `🎛️ 伴奏聲部與音色配置 <span style="font-size: 0.82rem; font-weight: 600; color: #38bdf8; margin-left: 8px; padding: 2px 8px; background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3); border-radius: 4px;">🎯 聚焦段落: ${escapeHtml(sectionName)}</span>`;
    } else {
      panelPartsTitle.textContent = '🎛️ 伴奏聲部與音色配置 (Parts & Voices)';
    }
  }

  // 更新或插入表格上方的焦點提示橫幅
  let focusBanner = document.getElementById('sty-section-focus-banner');
  const tableContainer = document.querySelector('.parts-table-container');
  if (sectionName && range && tableContainer) {
    if (!focusBanner) {
      focusBanner = document.createElement('div');
      focusBanner.id = 'sty-section-focus-banner';
      focusBanner.className = 'sty-section-focus-banner';
      tableContainer.parentElement?.insertBefore(focusBanner, tableContainer);
    }
    focusBanner.style.display = 'flex';
    focusBanner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 1.1rem;">🎯</span>
        <div>
          <span>當前聚焦伴奏段落: <strong style="color: #38bdf8; font-size: 0.95rem;">${escapeHtml(sectionName)}</strong></span>
          <span style="color: #94a3b8; margin-left: 8px; font-size: 0.76rem;">(長度: ${range.measureCount} 小節 | Tick: ${range.startTick} ~ ${range.endTick})</span>
        </div>
      </div>
      <div style="font-size: 0.74rem; color: #a5b4fc; background: rgba(99,102,241,0.12); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(99,102,241,0.25);">
        ⚡ 各伴奏聲部音符與發聲狀態已自動連動至此段落
      </div>
    `;
  } else if (focusBanner) {
    focusBanner.style.display = 'none';
  }

  // 更新各聲部列 (tr.sty-table-row-{ch}) 的音符統計與段落專屬設定
  document.querySelectorAll<HTMLTableRowElement>('.sty-table-row').forEach(tr => {
    const classMatch = tr.className.match(/sty-table-row-(\d+)/);
    if (!classMatch) return;
    const ch = parseInt(classMatch[1], 10);

    const totalNotes = countPartTotalNotes(parsed, ch);
    const secNotes = range ? StyleRemixer.countNotesInChannel(parsed, range.startTick, range.endTick, ch) : totalNotes;

    const noteCell = tr.querySelector('.part-notes-cell') || tr.cells[1];
    if (noteCell) {
      if (sectionName && range) {
        const activeHtml = secNotes > 0
          ? `<span class="part-section-active-badge">🟢 本段: ♪ ${secNotes} 音符 (演奏中)</span>`
          : `<span class="part-section-silent-badge">⚪ 本段: 0 音符 (未演奏)</span>`;
        noteCell.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 3px;">
            <span style="color: #94a3b8; font-family: monospace; font-weight: 600;">Ch ${ch + 1}</span>
            ${activeHtml}
            <span class="part-total-notes-badge">全曲總計: ${totalNotes} 音符</span>
          </div>
        `;
      } else {
        noteCell.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="color: #94a3b8; font-family: monospace; font-weight: 600;">Ch ${ch + 1}</span>
            <span style="font-size: 0.72rem; color: ${totalNotes > 0 ? '#10b981' : '#64748b'};">
              ${totalNotes > 0 ? `♪ ${totalNotes} 音符` : '無音符'}
            </span>
          </div>
        `;
      }
    }

    if (sectionName && range) {
      tr.classList.toggle('part-active-in-section', secNotes > 0);
      tr.classList.toggle('part-silent-in-section', secNotes === 0);
    } else {
      tr.classList.remove('part-active-in-section', 'part-silent-in-section');
    }

    // 檢查是否有段落專屬音色或音量覆寫
    if (sectionName && range) {
      const override = StyleRemixer.getSectionChannelOverride(parsed, range.startTick, range.endTick, ch);
      const voiceCell = tr.querySelector('.part-voice-cell') || tr.cells[3];
      if (voiceCell) {
        let overrideBadge = voiceCell.querySelector('.badge-section-voice-override');
        if (override.pc !== undefined) {
          if (!overrideBadge) {
            overrideBadge = document.createElement('span');
            overrideBadge.className = 'badge-section-voice-override';
            voiceCell.appendChild(overrideBadge);
          }
          overrideBadge.textContent = `🎯 本段專屬 PC ${override.pc}`;
          overrideBadge.setAttribute('title', `此段落包含獨立 Program Change: ${override.pc}`);
        } else if (overrideBadge) {
          overrideBadge.remove();
        }
      }

      const volCell = tr.querySelector('.part-vol-cell') || tr.cells[4];
      if (volCell) {
        let volBadge = volCell.querySelector('.badge-section-vol-override');
        if (override.volume !== undefined) {
          if (!volBadge) {
            volBadge = document.createElement('span');
            volBadge.className = 'badge-section-vol-override';
            volCell.appendChild(volBadge);
          }
          volBadge.textContent = `🎯 本段音量 ${override.volume}`;
        } else if (volBadge) {
          volBadge.remove();
        }
      }
    } else {
      tr.querySelectorAll('.badge-section-voice-override, .badge-section-vol-override').forEach(el => el.remove());
    }
  });
}

// 註冊初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEvents);
} else {
  initEvents();
}
