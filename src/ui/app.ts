import { YamahaParser } from '../core/parser/yamaha-parser';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import type { YamahaFileParsed, YamahaSection } from '../core/models/types';

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
  { id: 'steel_guitar', label: '🎸 鋼弦吉他 (Steel Guitar)', icon: 'S809', msb: 0, lsb: 112, pc: 25 },
  { id: 'nylon_guitar', label: '🎸 尼龍吉他 (Nylon Guitar)', icon: 'S809', msb: 0, lsb: 112, pc: 24 },
  { id: 'clean_guitar', label: '🎸 電吉他 (Clean Guitar)', icon: 'S810', msb: 0, lsb: 112, pc: 27 },
  { id: 'bass', label: '🎸 指彈貝斯 (Finger Bass)', icon: 'S811', msb: 0, lsb: 112, pc: 33 },
  { id: 'synth_bass', label: '🎛️ 合成貝斯 (Synth Bass)', icon: 'S812', msb: 0, lsb: 112, pc: 38 },
  { id: 'wind_sax', label: '🎷 薩克斯風 (Breathy Sax)', icon: 'S825', msb: 0, lsb: 112, pc: 66 },
  { id: 'brass', label: '🎺 銅管組 (Brass Section)', icon: 'S826', msb: 0, lsb: 112, pc: 61 },
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
    customOpt.textContent = `⚙️ 自訂音色 (PC ${pc}, Bank ${msb}-${lsb})`;
    select.value = 'custom';
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
        const bars = Math.max(1, Math.ceil((maxT - minT) / (parsed.division * 4)));
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

      // 智慧比對目前最符合的預設樂器
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
        iconOptionsHtml += `<option value="custom" selected>⚙️ 自訂音色 (PC ${currentPc}, Bank ${currentMsb}-${currentLsb})</option>`;
      }

      item.innerHTML = `
        <div class="pad-header">
          <input type="text" class="pad-name-input" value="${customName}" title="點擊修改名稱" />
          <span class="pad-raw-tag">${sec ? sec.name : 'Track ' + padNum}</span>
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
          </div>
        </div>
      `;

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
          if (sec) showPadNotesDetail(parsed, sec, customName, 1);
          else showEmptyPadDetail(customName, 1);
        }, 50);
      }

      sectionsList.appendChild(item);
    }
  } else {
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

  // 搜尋對應 Track 提取音符
  // 在 Yamaha PAD 中，Track 1~4 分別代表 Pad 1~4 的專屬音軌
  const trackIdx = padNum; // Track 1~4
  const targetTrack = parsed.tracks[trackIdx];

  interface NoteSpan {
    note: number;
    velocity: number;
    startTick: number;
    durationTick: number;
  }

  const notes: NoteSpan[] = [];
  if (targetTrack) {
    let curTick = 0;
    const activeNotes = new Map<number, { tick: number; velocity: number }>();

    for (const ev of targetTrack.events) {
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
            durationTick: Math.max(curTick - start.tick, 60),
          });
          activeNotes.delete(ev.noteNumber);
        }
      }
    }
  }

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
  const ticksPerBar = parsed.division * 4;
  const actualBars = Math.max(1, Math.ceil((lastNoteTick - firstNoteTick) / ticksPerBar));

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

  const matchedInst = PRESET_INSTRUMENTS.find(i => i.pc === currentPc && (currentMsb === 0 || i.msb === currentMsb))
    || PRESET_INSTRUMENTS.find(i => i.pc === currentPc);
  const voiceName = matchedInst ? matchedInst.label : `自訂音色 (PC ${currentPc}, Bank ${currentMsb}-${currentLsb})`;

  badgeEl.textContent = `音符範圍 Tick: ${firstNoteTick} ~ ${lastNoteTick} (約 ${actualBars} 小節)`;
  summaryEl.innerHTML = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 600; margin-right: 8px;">演奏音色: ${voiceName}</span> <span>共 ${notes.length} 顆音符</span> | <span>音域: ${midiNoteToName(minNote)} (${minNote}) ~ ${midiNoteToName(maxNote)} (${maxNote})</span> | <span>平均力度: ${avgVel}</span>`;

  drawNoteRoll(canvas, notes, firstNoteTick, lastNoteTick, minNote, maxNote, padNum);
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

function drawNoteRoll(
  canvas: HTMLCanvasElement,
  notes: Array<{ note: number; velocity: number; startTick: number; durationTick: number }>,
  startTick: number,
  endTick: number,
  minNote: number,
  maxNote: number,
  padNum: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 背景網格
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, w, h);

  const totalTicks = Math.max(endTick - startTick, 480);
  const noteRange = Math.max(maxNote - minNote + 2, 8);

  // 繪製格線
  ctx.strokeStyle = '#222631';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const y = (h / 8) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 依據 Pad 主題選擇顏色
  const colors = [
    '#3b82f6', // Pad 1 藍
    '#10b981', // Pad 2 綠
    '#f59e0b', // Pad 3 琥珀
    '#ec4899', // Pad 4 粉紫
  ];
  const baseColor = colors[(padNum - 1) % colors.length];

  // 繪製音符方塊
  for (const n of notes) {
    const x = ((n.startTick - startTick) / totalTicks) * (w - 20) + 10;
    const noteW = Math.max((n.durationTick / totalTicks) * (w - 20), 4);
    const noteY = h - ((n.note - minNote + 1) / noteRange) * (h - 20) - 10;
    const noteH = Math.max((h - 20) / noteRange - 2, 4);

    const alpha = 0.4 + (n.velocity / 127) * 0.6;
    ctx.fillStyle = baseColor;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, noteY, noteW, noteH, 2) : ctx.rect(x, noteY, noteW, noteH);
    ctx.fill();

    // 邊框
    ctx.globalAlpha = 1.0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }
}

function renderParts(parsed: YamahaFileParsed) {
  if (!partsTbody || !partsCount) return;
  partsTbody.innerHTML = '';

  const isPad = parsed.format === 'PAD';

  if (isPad) {
    // PAD 模式：精確對齊 4 個 Pad 的聲部 (依據 Track 1 ~ 4)
    partsCount.textContent = '4 組打擊墊聲部配置';

    for (let padNum = 1; padNum <= 4; padNum++) {
      const padIdx = padNum - 1;
      const track = parsed.tracks[padNum]; // Track 1 ~ 4
      const customName = parsed.padConfig?.names[padIdx] || `Pad ${padNum}`;

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
      tr.innerHTML = `
        <td><span class="part-badge part-name-text-${padNum}" style="color: #60a5fa;">Pad ${padNum} (${customName})</span></td>
        <td>Track ${padNum} (Ch ${channel + 1})</td>
        <td>
          <div style="display: flex; gap: 4px; align-items: center;">
            <input type="number" min="0" max="127" class="mixing-num-input bank-msb-${padNum}" value="${bankMsb ?? 0}" title="Bank MSB (CC0)" />
            <span>-</span>
            <input type="number" min="0" max="127" class="mixing-num-input bank-lsb-${padNum}" value="${bankLsb ?? 0}" title="Bank LSB (CC32)" />
          </div>
        </td>
        <td>
          <input type="number" min="0" max="127" class="mixing-num-input pc-${padNum}" value="${pc ?? 0}" title="Program Change (音色代碼 0~127)" />
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
