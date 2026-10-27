/**
 * Yamaha STY 單軌專注編輯器 (Single Track Focused Editor)
 * 專為解決多軌同步渲染卡頓而設計的「單軌聚焦工作台」
 * 每次只載入並渲染 1 個 Channel 的音符、拍子、樂器與時間標尺，徹底消除效能負擔與掉拍問題。
 * 力度 (Velocity) 採用滑動拉桿 + 數值精確輸入框雙向連動，提供極速流暢的微調體驗。
 */

import type { PlaybackNoteEvent, PartVoiceInfo } from './sty-playback-engine';
import { styPlaybackEngine } from './sty-playback-engine';
import { YAMAHA_DRUM_VOICES } from '../creator/drum-step-grid';

export interface EditorRowInfo {
  note: number;
  label: string;
  subLabel?: string;
  isBlack?: boolean;
  color?: string;
  icon?: string;
}

export class SingleTrackEditor {
  private container: HTMLElement;
  private channel: number = 8;
  private events: PlaybackNoteEvent[] = [];
  private totalTicks: number = 7680;
  private totalBars: number = 4;
  private division: number = 480;
  private timeSignature = { numerator: 4, denominator: 4 };
  private voiceInfo: PartVoiceInfo | null = null;
  private partAccentColor: string = '#f59e0b';
  private partLabel: string = 'Rhythm 1';

  // 縮放與網格維度
  private pixelsPerBar: number = 260;
  private rowHeight: number = 24;
  private rows: EditorRowInfo[] = [];

  // 選中音符
  private selectedEventIndex: number | null = null;
  private defaultVelocity: number = 100;

  // DOM 參照
  private playheadEl: HTMLElement | null = null;
  private velSlider: HTMLInputElement | null = null;
  private velInput: HTMLInputElement | null = null;
  private velStatus: HTMLElement | null = null;
  private gridScrollEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 載入並切換至特定聲部資料
   */
  public loadTrack(
    channel: number,
    partLabel: string,
    accentColor: string,
    events: PlaybackNoteEvent[],
    totalTicks: number,
    totalBars: number,
    division: number,
    timeSignature: { numerator: number; denominator: number },
    voiceInfo: PartVoiceInfo | null
  ) {
    this.channel = channel;
    this.partLabel = partLabel;
    this.partAccentColor = accentColor;
    this.events = events;
    this.totalTicks = Math.max(1, totalTicks);
    this.totalBars = Math.max(1, totalBars);
    this.division = division || 480;
    this.timeSignature = timeSignature || { numerator: 4, denominator: 4 };
    this.voiceInfo = voiceInfo;
    this.selectedEventIndex = null;

    this.calculateRows();
    this.render();
  }

  /**
   * 計算該軌道需要顯示的縱向行 (Rows)
   */
  private calculateRows() {
    const isDrum = this.channel === 8 || this.channel === 9;

    if (isDrum) {
      // 鼓組軌道：彙整事件中的音高，並補齊常用的核心打擊樂器
      const eventNotes = new Set(this.events.map(e => e.noteNumber));
      const stapleNotes = [49, 51, 46, 42, 44, 50, 48, 47, 45, 41, 39, 40, 38, 37, 36, 35];
      stapleNotes.forEach(n => eventNotes.add(n));

      const sortedNotes = Array.from(eventNotes).sort((a, b) => b - a); // 由高音到低音
      this.rows = sortedNotes.map(n => {
        const found = YAMAHA_DRUM_VOICES.find(v => v.note === n);
        return {
          note: n,
          label: found ? found.name.split(' (')[0] : `Note ${n}`,
          subLabel: found ? found.noteName : `${n}`,
          icon: found ? found.icon : '🥁',
          color: found ? found.color : '#38bdf8',
        };
      });
    } else {
      // 樂器音軌（Bass, Chord, Pad, Phrase）
      let minMidi = 36;
      let maxMidi = 60;

      if (this.events.length > 0) {
        const notes = this.events.map(e => e.noteNumber);
        minMidi = Math.min(...notes);
        maxMidi = Math.max(...notes);
        minMidi = Math.max(0, minMidi - 2);
        maxMidi = Math.min(127, maxMidi + 2);
      } else {
        if (this.channel === 10) {
          // Bass 預設音域 C1 (36) ~ C3 (60)
          minMidi = 36;
          maxMidi = 60;
        } else {
          // 和弦 / 樂句預設音域 C3 (48) ~ C5 (72)
          minMidi = 48;
          maxMidi = 72;
        }
      }

      const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const blackIndices = [1, 3, 6, 8, 10];

      this.rows = [];
      for (let midi = maxMidi; midi >= minMidi; midi--) {
        const pitchClass = midi % 12;
        const octave = Math.floor(midi / 12) - 1;
        const name = `${noteNames[pitchClass]}${octave}`;
        const isBlack = blackIndices.includes(pitchClass);
        this.rows.push({
          note: midi,
          label: name,
          isBlack,
          subLabel: pitchClass === 0 ? 'Root' : undefined,
        });
      }
    }
  }

  /**
   * 繪製完整編輯器 UI
   */
  private render() {
    this.container.innerHTML = '';
    this.container.style.setProperty('--part-accent', this.partAccentColor);

    const totalWidthPx = this.totalBars * this.pixelsPerBar;
    const beatsPerBar = this.timeSignature.numerator || 4;

    // 1. 建立頂部工具列 (含樂器、拍號、力度拉桿與數字輸入框)
    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.innerHTML = `
      <div class="editor-toolbar-left">
        <span class="editor-track-badge" style="background: ${this.partAccentColor};">CH ${this.channel + 1} - ${this.partLabel}</span>
        <span class="editor-voice-tag">${this.voiceInfo?.voiceName || 'Default Voice'}</span>
        <span class="editor-meta-pill">拍號: ${this.timeSignature.numerator}/${this.timeSignature.denominator} | 總計: ${this.totalBars} 小節 | PPQ: ${this.division}</span>
        <span class="editor-meta-pill">音符總數: ${this.events.length}</span>
      </div>

      <div class="editor-toolbar-right">
        <!-- 🎛️ 力度 (Velocity) 調控模組：滑動拉桿 + 精確數字框 (無柱狀圖) -->
        <div class="editor-vel-box">
          <span class="editor-vel-label">力度 (Velocity):</span>
          <input type="range" id="ed-vel-slider" class="editor-vel-slider" min="1" max="127" value="${this.defaultVelocity}">
          <input type="number" id="ed-vel-input" class="editor-vel-input" min="1" max="127" value="${this.defaultVelocity}">
          <span id="ed-vel-status" class="editor-vel-status">預設寫入力度</span>
        </div>

        <div class="editor-zoom-btns">
          <button id="ed-btn-zoom-out" class="editor-mini-btn" title="縮小時間軸">🔍 -</button>
          <button id="ed-btn-zoom-in" class="editor-mini-btn" title="放大時間軸">🔍 +</button>
        </div>
      </div>
    `;

    this.container.appendChild(toolbar);

    // 2. 建立主編輯捲動工作區
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'editor-viewport-wrap';
    this.gridScrollEl = scrollWrap;

    // 左側固定琴鍵 / 打擊樂名稱欄
    const keyCol = document.createElement('div');
    keyCol.className = 'editor-key-column';

    // 左上角空白角落 (對齊時間標尺)
    const corner = document.createElement('div');
    corner.className = 'editor-corner-cell';
    corner.textContent = '音高 / 樂器';
    keyCol.appendChild(corner);

    // 渲染各行琴鍵 / 樂器名稱
    this.rows.forEach(r => {
      const rowLabel = document.createElement('div');
      rowLabel.className = `editor-key-row ${r.isBlack ? 'is-black-key' : 'is-white-key'}`;
      rowLabel.style.height = `${this.rowHeight}px`;

      if (r.icon) {
        rowLabel.innerHTML = `
          <span class="key-icon">${r.icon}</span>
          <span class="key-name" title="${r.label}">${r.label}</span>
          <span class="key-sub">${r.subLabel || ''}</span>
        `;
      } else {
        rowLabel.innerHTML = `
          <span class="key-name ${r.subLabel ? 'is-root' : ''}">${r.label}</span>
          ${r.subLabel ? '<span class="key-badge">根音</span>' : ''}
        `;
      }

      // 點擊琴鍵試聽
      rowLabel.addEventListener('click', () => {
        styPlaybackEngine.previewNote(this.channel, r.note, this.defaultVelocity);
      });

      keyCol.appendChild(rowLabel);
    });

    scrollWrap.appendChild(keyCol);

    // 右側時間標尺與音符畫布容器
    const canvasWrap = document.createElement('div');
    canvasWrap.className = 'editor-canvas-wrap';
    canvasWrap.style.width = `${totalWidthPx}px`;

    // 頂部時間標尺 (Time Ruler)
    const timeRuler = document.createElement('div');
    timeRuler.className = 'editor-time-ruler';
    timeRuler.style.width = `${totalWidthPx}px`;

    for (let bar = 1; bar <= this.totalBars; bar++) {
      const barCell = document.createElement('div');
      barCell.className = 'ruler-bar-cell';
      barCell.style.width = `${this.pixelsPerBar}px`;

      let beatsHtml = '';
      for (let b = 1; b <= beatsPerBar; b++) {
        beatsHtml += `<span class="ruler-beat-marker">${bar}.${b}</span>`;
      }

      barCell.innerHTML = `
        <div class="ruler-bar-title">第 ${bar} 小節</div>
        <div class="ruler-beats-row">${beatsHtml}</div>
      `;
      timeRuler.appendChild(barCell);
    }
    canvasWrap.appendChild(timeRuler);

    // 網格底層與音符層
    const gridContent = document.createElement('div');
    gridContent.className = 'editor-grid-content';
    gridContent.style.width = `${totalWidthPx}px`;
    gridContent.style.height = `${this.rows.length * this.rowHeight}px`;

    // 繪製背景水平行線
    this.rows.forEach((r, idx) => {
      const line = document.createElement('div');
      line.className = `grid-row-bg ${r.isBlack ? 'row-black' : 'row-white'}`;
      line.style.top = `${idx * this.rowHeight}px`;
      line.style.height = `${this.rowHeight}px`;
      line.style.width = `${totalWidthPx}px`;
      gridContent.appendChild(line);
    });

    // 繪製小節與拍子垂直格線
    for (let bar = 0; bar < this.totalBars; bar++) {
      const barLeft = bar * this.pixelsPerBar;
      const barLine = document.createElement('div');
      barLine.className = 'grid-v-line bar-line';
      barLine.style.left = `${barLeft}px`;
      barLine.style.height = `${this.rows.length * this.rowHeight}px`;
      gridContent.appendChild(barLine);

      for (let b = 1; b < beatsPerBar; b++) {
        const beatLeft = barLeft + (b * (this.pixelsPerBar / beatsPerBar));
        const beatLine = document.createElement('div');
        beatLine.className = 'grid-v-line beat-line';
        beatLine.style.left = `${beatLeft}px`;
        beatLine.style.height = `${this.rows.length * this.rowHeight}px`;
        gridContent.appendChild(beatLine);
      }
    }

    // 繪製音符事件 (Notes)
    this.events.forEach((ev, idx) => {
      const rowIndex = this.rows.findIndex(r => r.note === ev.noteNumber);
      if (rowIndex === -1) return;

      const leftPx = (ev.relTick / this.totalTicks) * totalWidthPx;
      const widthPx = Math.max(10, (ev.durationTicks / this.totalTicks) * totalWidthPx);
      const topPx = rowIndex * this.rowHeight + 2;
      const heightPx = this.rowHeight - 4;

      const noteEl = document.createElement('div');
      noteEl.className = 'editor-note-block';
      noteEl.id = `ed-note-${idx}`;
      noteEl.style.left = `${leftPx}px`;
      noteEl.style.width = `${widthPx}px`;
      noteEl.style.top = `${topPx}px`;
      noteEl.style.height = `${heightPx}px`;
      noteEl.style.backgroundColor = this.partAccentColor;

      // 力度透明度對比 (亮度/飽和度)
      const velRatio = Math.max(0.3, Math.min(1.0, ev.velocity / 127));
      noteEl.style.opacity = `${0.5 + 0.5 * velRatio}`;

      const row = this.rows[rowIndex];
      noteEl.innerHTML = `
        <span class="note-block-text">${row.label} (${ev.velocity})</span>
      `;

      // 點擊音符：選取、連動力度拉桿與數字輸入框、試聽發聲
      noteEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectNote(idx);
      });

      gridContent.appendChild(noteEl);
    });

    // 播放游標線 (GPU 加速 Translate3d)
    const playhead = document.createElement('div');
    playhead.className = 'editor-playhead';
    playhead.innerHTML = `<div class="playhead-cap"></div>`;
    playhead.style.height = `${this.rows.length * this.rowHeight + 36}px`;
    playhead.style.transform = `translate3d(0px, 0, 0)`;
    this.playheadEl = playhead;
    canvasWrap.appendChild(playhead);

    canvasWrap.appendChild(gridContent);
    scrollWrap.appendChild(canvasWrap);
    this.container.appendChild(scrollWrap);

    // 3. 綁定力度控制項與縮放事件
    this.bindControls();
  }

  /**
   * 綁定力度控制項（拉桿 ↔ 數字框雙向連動，無柱狀圖）
   */
  private bindControls() {
    this.velSlider = this.container.querySelector('#ed-vel-slider') as HTMLInputElement;
    this.velInput = this.container.querySelector('#ed-vel-input') as HTMLInputElement;
    this.velStatus = this.container.querySelector('#ed-vel-status');

    if (this.velSlider && this.velInput) {
      // 拉桿事件
      this.velSlider.addEventListener('input', () => {
        const val = parseInt(this.velSlider!.value, 10);
        this.velInput!.value = val.toString();
        this.applyVelocityChange(val);
      });

      // 數字框事件
      this.velInput.addEventListener('change', () => {
        let val = parseInt(this.velInput!.value, 10);
        if (isNaN(val)) val = 100;
        val = Math.max(1, Math.min(127, val));
        this.velInput!.value = val.toString();
        this.velSlider!.value = val.toString();
        this.applyVelocityChange(val);
      });
    }

    // 縮放按鈕
    const btnZoomIn = this.container.querySelector('#ed-btn-zoom-in');
    const btnZoomOut = this.container.querySelector('#ed-btn-zoom-out');

    btnZoomIn?.addEventListener('click', () => {
      this.pixelsPerBar = Math.min(600, this.pixelsPerBar + 60);
      this.render();
    });

    btnZoomOut?.addEventListener('click', () => {
      this.pixelsPerBar = Math.max(140, this.pixelsPerBar - 60);
      this.render();
    });

    // 點擊空白處解除選取
    this.container.querySelector('.editor-grid-content')?.addEventListener('click', () => {
      this.selectNote(null);
    });
  }

  /**
   * 套用力度的變更
   */
  private applyVelocityChange(newVel: number) {
    if (this.selectedEventIndex !== null && this.events[this.selectedEventIndex]) {
      const ev = this.events[this.selectedEventIndex];
      ev.velocity = newVel;

      // 更新 DOM 音符方塊
      const noteEl = this.container.querySelector(`#ed-note-${this.selectedEventIndex}`) as HTMLElement;
      if (noteEl) {
        const velRatio = Math.max(0.3, Math.min(1.0, newVel / 127));
        noteEl.style.opacity = `${0.5 + 0.5 * velRatio}`;
        const row = this.rows.find(r => r.note === ev.noteNumber);
        noteEl.innerHTML = `<span class="note-block-text">${row?.label || ''} (${newVel})</span>`;
      }

      if (this.velStatus) {
        const row = this.rows.find(r => r.note === ev.noteNumber);
        this.velStatus.textContent = `已修改音符: ${row?.label || ''} | 力度: ${newVel}`;
      }

      // 試聽一聲力度反饋
      styPlaybackEngine.previewNote(this.channel, ev.noteNumber, newVel, 200);
    } else {
      this.defaultVelocity = newVel;
      if (this.velStatus) {
        this.velStatus.textContent = `預設寫入力度: ${newVel}`;
      }
    }
  }

  /**
   * 選中特定音符
   */
  public selectNote(index: number | null) {
    this.selectedEventIndex = index;

    // 清除所有音符的選中樣式
    this.container.querySelectorAll('.editor-note-block').forEach(el => {
      el.classList.remove('is-selected');
    });

    if (index !== null && this.events[index]) {
      const ev = this.events[index];
      const noteEl = this.container.querySelector(`#ed-note-${index}`);
      noteEl?.classList.add('is-selected');

      // 同步設定力度拉桿與數字框數值
      if (this.velSlider && this.velInput) {
        this.velSlider.value = ev.velocity.toString();
        this.velInput.value = ev.velocity.toString();
      }

      const row = this.rows.find(r => r.note === ev.noteNumber);
      if (this.velStatus) {
        this.velStatus.textContent = `選取音符: ${row?.label || ''} (Tick: ${ev.relTick}) | 力度: ${ev.velocity}`;
      }

      // 點選音符試聽
      styPlaybackEngine.previewNote(this.channel, ev.noteNumber, ev.velocity, 220);
    } else {
      if (this.velStatus) {
        this.velStatus.textContent = `預設寫入力度: ${this.defaultVelocity}`;
      }
      if (this.velSlider && this.velInput) {
        this.velSlider.value = this.defaultVelocity.toString();
        this.velInput.value = this.defaultVelocity.toString();
      }
    }
  }

  /**
   * 即時平滑更新播放游標 (GPU 加速，零 Layout Reflow，永不卡頓)
   */
  public updatePlayhead(currentTick: number) {
    if (!this.playheadEl) return;
    const totalWidthPx = this.totalBars * this.pixelsPerBar;
    const progress = Math.max(0, Math.min(1.0, currentTick / this.totalTicks));
    const xPx = progress * totalWidthPx;

    this.playheadEl.style.transform = `translate3d(${xPx}px, 0, 0)`;

    // 播放時游標若超出可視區則自動平滑跟隨捲動
    if (this.gridScrollEl && currentTick > 0) {
      const scrollLeft = this.gridScrollEl.scrollLeft;
      const clientWidth = this.gridScrollEl.clientWidth;
      if (xPx > scrollLeft + clientWidth - 100) {
        this.gridScrollEl.scrollLeft = xPx - 150;
      } else if (xPx < scrollLeft) {
        this.gridScrollEl.scrollLeft = Math.max(0, xPx - 50);
      }
    }
  }
}
