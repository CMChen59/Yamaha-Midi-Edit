import { YamahaParser } from '../core/parser/yamaha-parser';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import type { YamahaFileParsed } from '../core/models/types';

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

function updatePartsTableRowName(padNum: number, name: string) {
  const el = document.querySelector(`.part-name-text-${padNum}`);
  if (el) el.textContent = `Pad ${padNum} (${name})`;
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
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
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
      const icon = parsed.padConfig?.icons[padIdx] || 'S809';

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
      item.className = `section-item pad-button-card pad-theme-${padNum}`;

      const iconOptions = [
        { code: 'S809', label: '🎸 吉他' },
        { code: 'S801', label: '🎹 鋼琴' },
        { code: 'S805', label: '🎻 弦樂' },
        { code: 'S815', label: '🥁 鼓組' },
        { code: 'S811', label: '🎸 貝斯' },
        { code: 'S820', label: '🎛️ 合成' },
        { code: 'S825', label: '🎷 銅管' },
        { code: 'S830', label: '🔔 音效' },
      ];

      const iconOptionsHtml = iconOptions
        .map(opt => `<option value="${opt.code}" ${opt.code === icon ? 'selected' : ''}>${opt.label}</option>`)
        .join('');

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
            <select class="icon-select" title="更換圖示">
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

      // 4. 圖示選擇事件
      const iconSelect = item.querySelector('.icon-select') as HTMLSelectElement;
      iconSelect.addEventListener('click', (e) => e.stopPropagation());
      iconSelect.addEventListener('change', () => {
        YamahaPadModifier.setPadIcon(parsed, padNum, iconSelect.value);
        markModified(`Pad ${padNum} 圖示代碼已更新為: ${iconSelect.value}`);
      });

      // 5. 卡片點擊選取事件 (展開詳細音符卷軸)
      item.addEventListener('click', () => {
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

  const startTick = sec.startTick;
  const endTick = sec.endTick ?? (startTick + parsed.division * 4 * (sec.measureCount || 4));

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

  badgeEl.textContent = `音符範圍 Tick: ${firstNoteTick} ~ ${lastNoteTick} (約 ${actualBars} 小節)`;
  summaryEl.textContent = `共 ${notes.length} 顆音符 | 音域: ${midiNoteToName(minNote)} (${minNote}) ~ ${midiNoteToName(maxNote)} (${maxNote}) | 平均力度: ${avgVel}`;

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
