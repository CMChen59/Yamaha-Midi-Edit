import { YamahaParser } from '../core/parser/yamaha-parser';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { YamahaPadSynthesizer } from '../core/writer/pad-synthesizer';
import {
  MidiImporter,
  type MidiSourceAnalysis,
  type PadAssignmentOption,
} from '../core/writer/midi-importer';
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
let targetModalPadNum: number = 1;
let currentModalCategory: VoiceCategory | 'ALL' = 'ALL';
let currentModalSuitabilityFilter: VoiceSuitabilityFilter = 'ALL';
let currentModalSearchQuery: string = '';
let currentModalRenderLimit: number = 60;

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

function openVoiceModal(padNum: number) {
  const modal = document.getElementById('voice-search-modal');
  const badge = document.getElementById('modal-target-pad-badge');
  const searchInput = document.getElementById('voice-search-input') as HTMLInputElement | null;
  if (!modal) return;

  targetModalPadNum = padNum;
  currentModalRenderLimit = 60;
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

  // 模擬琴端切換音色選單
  const simVoiceSelect = document.getElementById('rec-sim-voice-select') as HTMLSelectElement | null;
  if (simVoiceSelect) {
    simVoiceSelect.addEventListener('change', () => {
      const val = simVoiceSelect.value;
      if (!val) return;
      const v = YAMAHA_SX920_VOICES.find(item => item.name === val || item.name.toLowerCase().includes(val.toLowerCase())) || searchYamahaVoices(val)[0];
      if (v) {
        midiManager.simulateVoiceChange({ msb: v.msb, lsb: v.lsb, pc: v.pc });
        showStatus(`已模擬琴端切換音色: ${v.name} (${v.chineseName}) [Bank ${v.msb}-${v.lsb}, PC ${v.pc}]`);
      }
      simVoiceSelect.value = '';
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
  if (!label) return;
  const inDev = midiManager.getSelectedInput();
  if (inDev) {
    label.textContent = `🟢 ${inDev.name}`;
    label.style.color = '#34d399';
  } else {
    label.textContent = '⚪ 未連線 (已啟用電腦鍵盤模擬)';
    label.style.color = '#94a3b8';
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

  // 5. 顯示彈窗
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

  // 背景點擊關閉
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeMidiImportModal();
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

  // Phase 2.4: 新建空白 Multi Pad 專案按鈕與彈窗監聽
  const btnNewPad = document.getElementById('btn-new-pad');
  if (btnNewPad) {
    btnNewPad.addEventListener('click', openNewPadModal);
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

  // Phase 2.3: MIDI 匯入與範例按鈕
  if (btnImportMidi) {
    btnImportMidi.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.mid,.midi,.MID,.MIDI';
      input.onchange = () => {
        if (input.files && input.files[0]) {
          handleFile(input.files[0]);
        }
      };
      input.click();
    });
  }

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

  const btnTransportStop = document.getElementById('btn-transport-stop');
  if (btnTransportStop) {
    btnTransportStop.addEventListener('click', () => {
      audioEngine.stop();
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

  // Phase 2.7: 初始化琴端即時錄音視窗 (Live Pad Recorder)
  initPadRecordModal();

  // Phase 2.2-F: 初始化 Web MIDI 實體琴直連控制
  setupWebMidiControls();
}

/**
 * Phase 2.2-F: 初始化 Web MIDI 實體琴直連控制與狀態燈號
 */
function setupWebMidiControls() {
  const statusLed = document.getElementById('midi-status-led');
  const statusText = document.getElementById('midi-status-text');
  const selectOutput = document.getElementById('select-midi-output') as HTMLSelectElement | null;
  const btnConnect = document.getElementById('btn-midi-connect');
  const btnHeaderTestChime = document.getElementById('btn-header-test-chime');
  const selectRouting = document.getElementById('select-audio-routing') as HTMLSelectElement | null;
  const btnTestChime = document.getElementById('btn-midi-test-chime');

  const updateMidiUI = (devices: MidiDeviceInfo[]) => {
    const selected = midiManager.getSelectedOutput();
    if (!statusLed || !statusText || !selectOutput || !btnConnect) return;

    if (devices.length === 0 || !selected) {
      statusLed.style.background = '#94a3b8';
      statusLed.style.boxShadow = 'none';
      statusText.textContent = '實體琴: 未連線';
      selectOutput.style.display = 'none';
      btnConnect.style.display = 'inline-block';
      btnConnect.textContent = '連接實體琴';
      if (btnHeaderTestChime) btnHeaderTestChime.style.display = 'none';
    } else {
      statusLed.style.background = '#22c55e';
      statusLed.style.boxShadow = '0 0 8px #22c55e';
      statusText.textContent = '實體琴:';
      selectOutput.style.display = 'inline-block';
      btnConnect.textContent = '🔄 重新整理';
      if (btnHeaderTestChime) btnHeaderTestChime.style.display = 'inline-block';

      // 填充下拉清單
      selectOutput.innerHTML = '';
      for (const d of devices) {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.isRecommended ? '🎹 ' : ''}${d.name}`;
        if (d.id === selected.id) opt.selected = true;
        selectOutput.appendChild(opt);
      }
    }
  };

  if (btnConnect) {
    btnConnect.addEventListener('click', async () => {
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
        if (statusLed) statusLed.style.background = '#ef4444';
        showStatus(`⚠️ MIDI 連線失敗: ${res.error}`, true);
      }
    });
  }

  if (selectOutput) {
    selectOutput.addEventListener('change', () => {
      midiManager.selectOutput(selectOutput.value);
      const sel = midiManager.getSelectedOutput();
      if (sel) {
        showStatus(`🎹 已切換 MIDI 輸出埠: ${sel.name}`, false);
        midiManager.playTestChime();
      }
    });
  }

  if (selectRouting) {
    selectRouting.addEventListener('change', async () => {
      const mode = selectRouting.value as 'audio' | 'midi' | 'both';
      midiManager.setRoutingMode(mode);

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
    });
  }

  const triggerTestChime = () => {
    if (!midiManager.getSelectedOutput()) {
      showStatus('請先點選上方 [連接實體琴] 建立 USB 連線', true);
      if (btnConnect) btnConnect.click();
      return;
    }
    midiManager.playTestChime();
    showStatus('🔔 正在向 PSR-SX920 傳送測試音階 (C4-E4-G4-C5)...', false);
  };

  if (btnHeaderTestChime) {
    btnHeaderTestChime.addEventListener('click', triggerTestChime);
  }

  if (btnTestChime) {
    btnTestChime.addEventListener('click', triggerTestChime);
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

    // Phase 2.3: 偵測到 .mid / .midi 檔案時開啟切片分配精靈
    if (ext === 'MID' || ext === 'MIDI') {
      openMidiImportModal(bytes, file.name);
      return;
    }

    const format: 'STY' | 'PAD' = ext === 'PAD' ? 'PAD' : 'STY';
    renderParsed(bytes, file.name, format);
  } catch (err: any) {
    showStatus(`讀取檔案錯誤: ${err.message}`, true);
    alert(`讀取檔案錯誤: ${err.message}`);
  }
}

// Phase 2.3: 載入伺服器端示範 MIDI 檔案
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
    openMidiImportModal(bytes, filename);
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
  updateMeasureControlsUI(actualBars);

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

      const isSelected = selectedNoteBox && selectedNoteBox.startTick === n.startTick && selectedNoteBox.note === n.note;
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

      const isSelected = selectedNoteBox && selectedNoteBox.startTick === n.startTick && selectedNoteBox.note === n.note;
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
      selectNote(edgeHit);
      e.preventDefault();
    } else if (bodyHit) {
      potentialMoveTarget = bodyHit;
      potentialResizeTarget = null;
      movingStartMouseX = e.clientX;
      movingStartMouseY = e.clientY;
      movingStartTick = bodyHit.startTick;
      currentMovingStartTick = bodyHit.startTick;
      isMovingNote = false;
      selectedRulerBar = null;
      selectNote(bodyHit);
      e.preventDefault();
    } else {
      potentialResizeTarget = null;
      potentialMoveTarget = null;
      deselectNote();
      selectedRulerBar = null;
    }
  });

  // 全域滑鼠拖曳監聽 (Window Mousemove for smooth dragging outside canvas)
  window.addEventListener('mousemove', (e) => {
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
  window.addEventListener('mouseup', () => {
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

function selectNote(box: RenderedNoteBox) {
  selectedNoteBox = box;
  if (isCanvasStepInputActive) {
    const nextTick = box.startTick + box.durationTick;
    canvasStepRecorder.seekToTick(nextTick);
    const hoverInfoEl = document.getElementById('canvas-hover-info');
    if (hoverInfoEl) {
      hoverInfoEl.innerHTML = `🎹 <span style="color:#38bdf8;font-weight:700;">手彈步進游標已接續於音符後方 (Tick ${nextTick})</span>：彈奏琴鍵或電腦鍵盤直接印入下一組音符！`;
    }
  }
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

  // 鍵盤方向鍵與小節快捷鍵支援 (DAW 級操作手感)
  window.addEventListener('keydown', (e) => {
    if (!currentParsed) return;
    const activeEl = document.activeElement;
    const tag = (activeEl?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const hoverInfoEl = document.getElementById('canvas-hover-info');

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

    // 快捷鍵：Delete / Backspace
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedNoteBox) {
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

    if (!selectedNoteBox) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.shiftKey ? 12 : 1;
      shiftSelectedNotePitch(delta);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = e.shiftKey ? -12 : -1;
      shiftSelectedNotePitch(delta);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const deltaTicks = e.shiftKey ? -currentTicksPerBeat * currentBeatsPerBar : -currentTicksPerBeat;
      shiftSelectedNotePosition(deltaTicks);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const deltaTicks = e.shiftKey ? currentTicksPerBeat * currentBeatsPerBar : currentTicksPerBeat;
      shiftSelectedNotePosition(deltaTicks);
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
