/**
 * Yamaha PSR-SX920 專注創作台 (V2)
 * 16 格打擊樂步進網格元件 (Drum Step Grid)
 * 支援彈性更換樂器、自由新增樂器行、拍號 (4/4, 3/4, 6/8) 與網格精度 (1/16, 1/8) 切換。
 */

import { drumSynth } from './drum-synth';

export interface DrumVoiceOption {
  note: number;
  name: string;
  subName: string;
  noteName: string;
  icon: string;
  color: string;
}

export const YAMAHA_DRUM_VOICES: DrumVoiceOption[] = [
  { note: 36, name: '大鼓 (Kick)', subName: 'Bass Drum', noteName: 'C1', icon: '🔊', color: '#38bdf8' },
  { note: 38, name: '小鼓 (Snare)', subName: 'Snare Drum', noteName: 'D1', icon: '🥁', color: '#f59e0b' },
  { note: 37, name: '敲框音 (Side Stick)', subName: 'Rimshot', noteName: 'C#1', icon: '🥢', color: '#eab308' },
  { note: 39, name: '拍手 (Clap)', subName: 'Hand Clap', noteName: 'D#1', icon: '👏', color: '#ec4899' },
  { note: 42, name: '閉鈸 (Closed Hat)', subName: 'Closed Hi-Hat', noteName: 'F#1', icon: '💿', color: '#10b981' },
  { note: 46, name: '開鈸 (Open Hat)', subName: 'Open Hi-Hat', noteName: 'A#1', icon: '📀', color: '#06b6d4' },
  { note: 49, name: '碎音鈸 (Crash)', subName: 'Crash Cymbal', noteName: 'C#2', icon: '🔔', color: '#f43f5e' },
  { note: 51, name: '叮叮鈸 (Ride)', subName: 'Ride Cymbal', noteName: 'D#2', icon: '🛎️', color: '#8b5cf6' },
  { note: 50, name: '高音中鼓 (High Tom)', subName: 'High Tom', noteName: 'D2', icon: '🪘', color: '#fb7185' },
  { note: 47, name: '中音中鼓 (Mid Tom)', subName: 'Mid Tom', noteName: 'B1', icon: '🪘', color: '#d946ef' },
  { note: 45, name: '低音中鼓 (Low Tom)', subName: 'Low Tom', noteName: 'A1', icon: '🪘', color: '#a855f7' },
  { note: 54, name: '鈴鼓 (Tambourine)', subName: 'Tambourine', noteName: 'F#2', icon: '🪇', color: '#e11d48' },
  { note: 56, name: '牛鈴 (Cowbell)', subName: 'Cowbell', noteName: 'G#2', icon: '🔔', color: '#fb923c' },
];

export type GridResolution = '1/16' | '1/8';
export type TimeSignatureType = '4/4' | '3/4' | '6/8';

export class DrumStepGrid {
  private totalBars: number = 4;
  private timeSignature: TimeSignatureType = '4/4';
  private resolution: GridResolution = '1/16';
  private container: HTMLElement;

  // 當前畫面上啟用的打擊樂行 (預設 Crash, Hi-Hat, Snare, Kick)
  private activeVoices: DrumVoiceOption[] = [
    YAMAHA_DRUM_VOICES[6], // Crash (49)
    YAMAHA_DRUM_VOICES[4], // Closed Hat (42)
    YAMAHA_DRUM_VOICES[1], // Snare (38)
    YAMAHA_DRUM_VOICES[0], // Kick (36)
  ];

  // 步進狀態記錄：note -> boolean[] (長度 = totalBars * stepsPerBar)
  private pattern: Map<number, boolean[]> = new Map();
  private onPatternChange?: () => void;
  private onTriggerNote?: (note: number, velocity: number) => void;

  constructor(
    container: HTMLElement,
    totalBars: number = 4,
    onPatternChange?: () => void,
    onTriggerNote?: (note: number, velocity: number) => void
  ) {
    this.container = container;
    this.totalBars = totalBars;
    this.onPatternChange = onPatternChange;
    this.onTriggerNote = onTriggerNote;

    this.initPattern();
    this.render();
  }

  public playSound(note: number, velocity: number = 100) {
    drumSynth.playNote(note, velocity);
    this.onTriggerNote?.(note, velocity);
  }

  /**
   * 計算每小節的步進格數
   * - 4/4 拍: 1/16 模式為 16 格 (4 拍 * 4 格)；1/8 模式為 8 格 (4 拍 * 2 格)
   * - 3/4 拍: 1/16 模式為 12 格 (3 拍 * 4 格)；1/8 模式為 6 格 (3 拍 * 2 格)
   * - 6/8 拍: 固定 6 格 (6 個 8 分音符)
   */
  public getStepsPerBar(): number {
    if (this.timeSignature === '6/8') {
      return 6;
    }
    const beats = this.timeSignature === '3/4' ? 3 : 4;
    return this.resolution === '1/16' ? beats * 4 : beats * 2;
  }

  public getStepsPerBeat(): number {
    if (this.timeSignature === '6/8') return 3; // 2 大拍，每拍 3 個 8 分音符
    return this.resolution === '1/16' ? 4 : 2;
  }

  public getBeatsPerBar(): number {
    if (this.timeSignature === '6/8') return 2;
    return this.timeSignature === '3/4' ? 3 : 4;
  }

  public getTimeSignatureObject(): { numerator: number; denominator: number } {
    if (this.timeSignature === '3/4') return { numerator: 3, denominator: 4 };
    if (this.timeSignature === '6/8') return { numerator: 6, denominator: 8 };
    return { numerator: 4, denominator: 4 };
  }

  private initPattern() {
    const totalSteps = this.totalBars * this.getStepsPerBar();
    for (const inst of this.activeVoices) {
      if (!this.pattern.has(inst.note)) {
        this.pattern.set(inst.note, new Array(totalSteps).fill(false));
      } else {
        const current = this.pattern.get(inst.note)!;
        if (current.length < totalSteps) {
          this.pattern.set(inst.note, [...current, ...new Array(totalSteps - current.length).fill(false)]);
        } else if (current.length > totalSteps) {
          this.pattern.set(inst.note, current.slice(0, totalSteps));
        }
      }
    }
  }

  public setTotalBars(bars: number) {
    if (this.totalBars === bars) return;
    this.totalBars = bars;
    this.initPattern();
    this.render();
  }

  public setResolution(res: GridResolution) {
    if (this.resolution === res) return;
    this.resolution = res;
    this.initPattern();
    this.render();
  }

  public setTimeSignature(sig: TimeSignatureType) {
    if (this.timeSignature === sig) return;
    this.timeSignature = sig;
    this.initPattern();
    this.render();
  }

  /**
   * 更換指定行的打擊樂器
   */
  public changeRowVoice(rowIndex: number, newNote: number) {
    const newVoice = YAMAHA_DRUM_VOICES.find(v => v.note === newNote);
    if (!newVoice || rowIndex < 0 || rowIndex >= this.activeVoices.length) return;

    const oldNote = this.activeVoices[rowIndex].note;
    this.activeVoices[rowIndex] = newVoice;

    // 搬移已點的音符到新 note 上
    if (oldNote !== newNote) {
      const oldSteps = this.pattern.get(oldNote);
      if (oldSteps) {
        this.pattern.set(newNote, oldSteps);
        this.pattern.delete(oldNote);
      }
    }

    this.render();
    this.onPatternChange?.();
  }

  /**
   * 新增一行打擊樂器
   */
  public addVoiceRow(note: number) {
    const voice = YAMAHA_DRUM_VOICES.find(v => v.note === note);
    if (!voice || this.activeVoices.some(v => v.note === note)) return;

    this.activeVoices.push(voice);
    const totalSteps = this.totalBars * this.getStepsPerBar();
    this.pattern.set(note, new Array(totalSteps).fill(false));

    this.render();
    this.onPatternChange?.();
  }

  /**
   * 移除指定行打擊樂器
   */
  public removeVoiceRow(rowIndex: number) {
    if (this.activeVoices.length <= 1) {
      alert('請至少保留一行打擊樂器！');
      return;
    }
    const removed = this.activeVoices.splice(rowIndex, 1)[0];
    this.pattern.delete(removed.note);
    this.render();
    this.onPatternChange?.();
  }

  /**
   * 核心功能：將第 1 小節一鍵鋪滿至後續所有小節
   */
  public cloneFirstBar(): void {
    const stepsPerBar = this.getStepsPerBar();
    for (const inst of this.activeVoices) {
      const steps = this.pattern.get(inst.note)!;
      const bar1 = steps.slice(0, stepsPerBar);
      for (let bar = 1; bar < this.totalBars; bar++) {
        for (let s = 0; s < stepsPerBar; s++) {
          steps[bar * stepsPerBar + s] = bar1[s];
        }
      }
    }
    this.render();
    this.onPatternChange?.();
  }

  /**
   * 清除全部格子
   */
  public clear(): void {
    const totalSteps = this.totalBars * this.getStepsPerBar();
    for (const inst of this.activeVoices) {
      this.pattern.set(inst.note, new Array(totalSteps).fill(false));
    }
    this.render();
    this.onPatternChange?.();
  }

  /**
   * 取得用於匯出 STY 的音符清單
   */
  public getMidiEvents(ticksPerBar: number = 1920): Array<{ note: number; startTick: number; durationTick: number; velocity: number }> {
    const events: Array<{ note: number; startTick: number; durationTick: number; velocity: number }> = [];
    const stepsPerBar = this.getStepsPerBar();
    const ticksPerStep = Math.round(ticksPerBar / stepsPerBar);

    for (const inst of this.activeVoices) {
      const steps = this.pattern.get(inst.note) || [];
      for (let s = 0; s < steps.length; s++) {
        if (steps[s]) {
          events.push({
            note: inst.note,
            startTick: s * ticksPerStep,
            durationTick: Math.max(1, Math.round(ticksPerStep * 0.8)),
            velocity: 100,
          });
        }
      }
    }

    events.sort((a, b) => a.startTick - b.startTick);
    return events;
  }

  public hasNotes(): boolean {
    for (const steps of this.pattern.values()) {
      if (steps.some(Boolean)) return true;
    }
    return false;
  }

  public getActiveNotesAtStep(stepIndex: number): number[] {
    const active: number[] = [];
    for (const inst of this.activeVoices) {
      const steps = this.pattern.get(inst.note);
      if (steps && steps[stepIndex]) {
        active.push(inst.note);
      }
    }
    return active;
  }

  public setPlayheadStep(stepIndex: number | null): void {
    const prev = this.container.querySelectorAll('.step-cell.active-playhead, .step-header-cell.active-playhead');
    prev.forEach(el => el.classList.remove('active-playhead'));

    if (stepIndex !== null && stepIndex >= 0) {
      const current = this.container.querySelectorAll(`[data-step="${stepIndex}"]`);
      current.forEach(el => el.classList.add('active-playhead'));
    }
  }

  /**
   * 渲染完整步進網格
   */
  public render(): void {
    this.container.innerHTML = '';

    const stepsPerBar = this.getStepsPerBar();
    const beatsPerBar = this.getBeatsPerBar();
    const stepsPerBeat = this.getStepsPerBeat();

    // 建立外層滾動容器
    const scrollWrapper = document.createElement('div');
    scrollWrapper.className = 'grid-scroll-wrapper';

    // 1. 建立頂部控制輔助列 (Toolbar / Add voice / Resolution switch)
    const toolbar = document.createElement('div');
    toolbar.className = 'grid-toolbar';
    toolbar.innerHTML = `
      <div class="grid-toolbar-left">
        <label style="font-size: 0.82rem; color: #94a3b8; font-weight: 600;">拍號:</label>
        <select id="grid-time-sig-select" class="grid-select">
          <option value="4/4" ${this.timeSignature === '4/4' ? 'selected' : ''}>4/4 拍 (標準)</option>
          <option value="3/4" ${this.timeSignature === '3/4' ? 'selected' : ''}>3/4 拍 (華爾滋)</option>
          <option value="6/8" ${this.timeSignature === '6/8' ? 'selected' : ''}>6/8 拍 (三連慢搖)</option>
        </select>

        <label style="font-size: 0.82rem; color: #94a3b8; font-weight: 600; margin-left: 12px;">網格解析度:</label>
        <select id="grid-res-select" class="grid-select">
          <option value="1/16" ${this.resolution === '1/16' ? 'selected' : ''}>1/16 (16分音符，細緻)</option>
          <option value="1/8" ${this.resolution === '1/8' ? 'selected' : ''}>1/8 (8分音符，簡潔)</option>
        </select>
      </div>

      <div class="grid-toolbar-right">
        <button id="btn-add-drum-row" class="btn-grid-tool">
          <span>➕</span> 加入打擊樂器
        </button>
        <button id="btn-clear-grid" class="btn-grid-tool btn-grid-clear">
          <span>🗑️</span> 清空網格
        </button>
      </div>
    `;
    this.container.appendChild(toolbar);

    // 綁定工具列事件
    const selectSig = toolbar.querySelector('#grid-time-sig-select') as HTMLSelectElement | null;
    selectSig?.addEventListener('change', () => this.setTimeSignature(selectSig.value as TimeSignatureType));

    const selectRes = toolbar.querySelector('#grid-res-select') as HTMLSelectElement | null;
    selectRes?.addEventListener('change', () => this.setResolution(selectRes.value as GridResolution));

    const btnAdd = toolbar.querySelector('#btn-add-drum-row') as HTMLButtonElement | null;
    btnAdd?.addEventListener('click', () => this.openAddVoiceModal());

    const btnClear = toolbar.querySelector('#btn-clear-grid') as HTMLButtonElement | null;
    btnClear?.addEventListener('click', () => {
      if (confirm('確定要清空所有已點選的鼓點嗎？')) {
        this.clear();
      }
    });

    // 2. 建立拍子指示列 (Header Row)
    const headerRow = document.createElement('div');
    headerRow.className = 'grid-row grid-header-row';

    const headerLabelCell = document.createElement('div');
    headerLabelCell.className = 'row-header-label';
    headerLabelCell.innerHTML = `<span style="font-size: 0.82rem; color: #38bdf8; font-weight: 700;">🥁 打擊樂器 / 拍子</span>`;
    headerRow.appendChild(headerLabelCell);

    const headerStepsContainer = document.createElement('div');
    headerStepsContainer.className = 'steps-container';

    for (let bar = 0; bar < this.totalBars; bar++) {
      const barGroup = document.createElement('div');
      barGroup.className = 'bar-group';

      for (let beat = 0; beat < beatsPerBar; beat++) {
        const beatGroup = document.createElement('div');
        beatGroup.className = 'beat-group';

        for (let sub = 0; sub < stepsPerBeat; sub++) {
          const stepIdx = bar * stepsPerBar + beat * stepsPerBeat + sub;
          const stepHeader = document.createElement('div');
          stepHeader.className = `step-header-cell ${sub === 0 ? 'beat-start' : ''}`;
          stepHeader.dataset.step = `${stepIdx}`;

          if (sub === 0) {
            stepHeader.innerHTML = `<span class="beat-num">${beat + 1}</span>`;
          } else {
            stepHeader.innerHTML = `<span class="sub-dot">·</span>`;
          }
          beatGroup.appendChild(stepHeader);
        }
        barGroup.appendChild(beatGroup);
      }
      headerStepsContainer.appendChild(barGroup);
    }
    headerRow.appendChild(headerStepsContainer);
    scrollWrapper.appendChild(headerRow);

    // 3. 建立各打擊樂行
    this.activeVoices.forEach((inst, rowIndex) => {
      const row = document.createElement('div');
      row.className = 'grid-row drum-row';
      row.dataset.note = `${inst.note}`;

      // 樂器標籤欄 (左側)
      const labelCol = document.createElement('div');
      labelCol.className = 'row-header-label';

      // 樂器選擇下拉選單
      let voiceOptionsHtml = '';
      for (const v of YAMAHA_DRUM_VOICES) {
        voiceOptionsHtml += `<option value="${v.note}" ${v.note === inst.note ? 'selected' : ''}>${v.icon} ${v.name} (${v.noteName})</option>`;
      }

      labelCol.innerHTML = `
        <div class="inst-info-wrap">
          <div class="inst-name-row">
            <span class="inst-icon">${inst.icon}</span>
            <select class="inst-voice-select" data-row-index="${rowIndex}" title="更換樂器">
              ${voiceOptionsHtml}
            </select>
          </div>
          <div class="inst-sub">
            <div class="inst-sub-left">
              <span class="inst-preview-tag" data-note="${inst.note}" title="點擊試聽發聲">🔊 試聽</span>
              <button class="btn-remove-row" data-row-index="${rowIndex}" title="從工作台移除此打擊樂器">🗑️ 刪除</button>
            </div>
            <span class="inst-note-badge-small" style="color: ${inst.color}; font-weight: 700; font-family: monospace;">${inst.noteName} (MIDI ${inst.note})</span>
          </div>
        </div>
      `;

      // 監聽更換樂器
      const voiceSelect = labelCol.querySelector('.inst-voice-select') as HTMLSelectElement | null;
      voiceSelect?.addEventListener('change', (e) => {
        e.stopPropagation();
        const newNote = parseInt(voiceSelect.value, 10);
        this.changeRowVoice(rowIndex, newNote);
      });

      // 監聽移除行
      const btnRemove = labelCol.querySelector('.btn-remove-row') as HTMLButtonElement | null;
      btnRemove?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeVoiceRow(rowIndex);
      });

      // 監聽試聽按鈕
      const btnPreview = labelCol.querySelector('.inst-preview-tag') as HTMLElement | null;
      btnPreview?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.playSound(inst.note);
      });

      row.appendChild(labelCol);

      // 格子區域
      const stepsContainer = document.createElement('div');
      stepsContainer.className = 'steps-container';

      const stepsData = this.pattern.get(inst.note) || new Array(this.totalBars * stepsPerBar).fill(false);

      for (let bar = 0; bar < this.totalBars; bar++) {
        const barGroup = document.createElement('div');
        barGroup.className = 'bar-group';
        barGroup.dataset.bar = `${bar + 1}`;

        for (let beat = 0; beat < beatsPerBar; beat++) {
          const beatGroup = document.createElement('div');
          beatGroup.className = `beat-group ${beat % 2 === 0 ? 'beat-even' : 'beat-odd'}`;

          for (let sub = 0; sub < stepsPerBeat; sub++) {
            const stepIdx = bar * stepsPerBar + beat * stepsPerBeat + sub;
            const isFilled = stepsData[stepIdx];

            const cell = document.createElement('div');
            cell.className = `step-cell ${isFilled ? 'step-active' : ''} ${sub === 0 ? 'beat-start' : ''}`;
            cell.dataset.step = `${stepIdx}`;
            cell.dataset.note = `${inst.note}`;

            if (isFilled) {
              cell.style.backgroundColor = inst.color;
              cell.style.boxShadow = `0 0 10px ${inst.color}88`;
            }

            // 點擊事件：切換狀態 + 發聲
            cell.addEventListener('click', () => {
              const nextState = !stepsData[stepIdx];
              stepsData[stepIdx] = nextState;

              if (nextState) {
                cell.classList.add('step-active');
                cell.style.backgroundColor = inst.color;
                cell.style.boxShadow = `0 0 10px ${inst.color}88`;
                this.playSound(inst.note);
              } else {
                cell.classList.remove('step-active');
                cell.style.backgroundColor = '';
                cell.style.boxShadow = '';
              }

              this.onPatternChange?.();
            });

            beatGroup.appendChild(cell);
          }
          barGroup.appendChild(beatGroup);
        }
        stepsContainer.appendChild(barGroup);
      }

      row.appendChild(stepsContainer);
      scrollWrapper.appendChild(row);
    });

    this.container.appendChild(scrollWrapper);
  }

  private openAddVoiceModal() {
    const unadded = YAMAHA_DRUM_VOICES.filter(v => !this.activeVoices.some(av => av.note === v.note));
    if (unadded.length === 0) {
      alert('所有 Yamaha 標準打擊樂器皆已加入至網格中！');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'custom-drum-modal-overlay';
    modal.innerHTML = `
      <div class="custom-drum-modal">
        <h3 style="margin-bottom: 12px; color: #fff;">➕ 加入打擊樂器</h3>
        <p style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 16px;">選擇要加入排點網格的 Yamaha PSR-SX920 打擊樂器：</p>
        <div class="voice-picker-list">
          ${unadded.map(v => `
            <div class="voice-picker-item" data-note="${v.note}">
              <span style="font-size: 1.3rem;">${v.icon}</span>
              <div>
                <div style="font-weight: 700; color: #fff;">${v.name}</div>
                <div style="font-size: 0.75rem; color: #94a3b8;">${v.subName} (${v.noteName} / MIDI ${v.note})</div>
              </div>
              <button class="btn-picker-add" data-note="${v.note}">加入工作台</button>
            </div>
          `).join('')}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
          <button id="btn-close-modal" style="padding: 6px 16px; background: #475569; color: #fff; border: none; border-radius: 6px; cursor: pointer;">關閉</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-close-modal')?.addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelectorAll('.btn-picker-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const note = parseInt((e.target as HTMLElement).dataset.note || '0', 10);
        if (note > 0) {
          this.addVoiceRow(note);
          document.body.removeChild(modal);
        }
      });
    });
  }
}
