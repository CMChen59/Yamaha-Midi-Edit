/**
 * Yamaha PSR-SX920 專注創作台 (V2)
 * 輕量貝斯鋼琴捲軸元件 (Piano Roll Lite - Bass)
 * 專為 PSR-SX920 伴奏風格 SFF2 CASM 轉調規則量身打造
 * 包含 C 大調和弦安全導引防呆機制 (C 根音、G 五度音、E 三度音高亮徽章)
 */

import { bassSynth } from './bass-synth';
import type { GridResolution, TimeSignatureType } from './drum-step-grid';

export interface BassPitchInfo {
  note: number;      // MIDI 音高 (例如 36 = C1)
  name: string;      // 音名 (例如 C1)
  isBlack: boolean;  // 是否為黑鍵
  role?: 'root' | 'fifth' | 'third' | 'scale'; // Yamaha 和弦導引角色
  roleLabel?: string;
}

export class PianoRollLite {
  private container: HTMLElement;
  private totalBars: number = 4;
  private timeSignature: TimeSignatureType = '4/4';
  private resolution: GridResolution = '1/16';

  // 貝斯音域：C1 (36) 至 C3 (60) 共 25 個半音，由高至低排列
  private pitches: BassPitchInfo[] = [];

  // 音符狀態：stepIndex -> number (MIDI note) | null (單音模式)
  private pattern: Map<number, number> = new Map();

  private playheadStep: number | null = null;
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

    this.initPitches();
    this.render();
  }

  /**
   * 初始化 2 個八度的貝斯音高清單 (C3 ~ C1)
   */
  private initPitches() {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const blackIndices = [1, 3, 6, 8, 10]; // C#, D#, F#, G#, A#

    this.pitches = [];
    // 從 C3 (60) 遞減至 C1 (36)
    for (let midi = 60; midi >= 36; midi--) {
      const pitchClass = midi % 12;
      const octave = Math.floor(midi / 12) - 1; // MIDI 12 = C0, MIDI 36 = C1
      const noteName = `${noteNames[pitchClass]}${octave}`;
      const isBlack = blackIndices.includes(pitchClass);

      let role: BassPitchInfo['role'] = undefined;
      let roleLabel: string | undefined = undefined;

      if (pitchClass === 0) {
        // C: 根音 Root
        role = 'root';
        roleLabel = '★ 根音 (Root)';
      } else if (pitchClass === 7) {
        // G: 五度音 Fifth
        role = 'fifth';
        roleLabel = '★ 5度 (Fifth)';
      } else if (pitchClass === 4) {
        // E: 三度音 Third
        role = 'third';
        roleLabel = '★ 3度 (Third)';
      } else if (!isBlack) {
        role = 'scale';
      }

      this.pitches.push({
        note: midi,
        name: noteName,
        isBlack,
        role,
        roleLabel,
      });
    }
  }

  public getStepsPerBar(): number {
    if (this.timeSignature === '6/8') return 6;
    const beats = this.timeSignature === '3/4' ? 3 : 4;
    return this.resolution === '1/16' ? beats * 4 : beats * 2;
  }

  public getStepsPerBeat(): number {
    if (this.timeSignature === '6/8') return 3;
    return this.resolution === '1/16' ? 4 : 2;
  }

  public getBeatsPerBar(): number {
    if (this.timeSignature === '6/8') return 2;
    return this.timeSignature === '3/4' ? 3 : 4;
  }

  public getTotalSteps(): number {
    return this.totalBars * this.getStepsPerBar();
  }

  public playNoteSound(note: number, velocity: number = 100) {
    bassSynth.playNote(note, velocity);
    this.onTriggerNote?.(note, velocity);
  }

  public hasNotes(): boolean {
    return this.pattern.size > 0;
  }

  public setTotalBars(bars: number) {
    this.totalBars = bars;
    this.render();
  }

  public setResolution(res: GridResolution) {
    this.resolution = res;
    this.pattern.clear();
    this.render();
    this.onPatternChange?.();
  }

  public setTimeSignature(ts: TimeSignatureType) {
    this.timeSignature = ts;
    this.pattern.clear();
    this.render();
    this.onPatternChange?.();
  }

  public clear() {
    this.pattern.clear();
    this.render();
    this.onPatternChange?.();
  }

  /**
   * 一鍵將第 1 小節的貝斯律動複製鋪滿全部小節
   */
  public cloneFirstBar() {
    const stepsPerBar = this.getStepsPerBar();
    const bar1Pattern: Array<{ step: number; note: number }> = [];

    for (let s = 0; s < stepsPerBar; s++) {
      const note = this.pattern.get(s);
      if (note !== undefined) {
        bar1Pattern.push({ step: s, note });
      }
    }

    if (bar1Pattern.length === 0) return;

    for (let bar = 1; bar < this.totalBars; bar++) {
      const offset = bar * stepsPerBar;
      for (const item of bar1Pattern) {
        this.pattern.set(offset + item.step, item.note);
      }
    }

    this.render();
    this.onPatternChange?.();
  }

  /**
   * 智慧填入「經典流行 Bass 律動」範本 (對齊 C 大調根音與五度音)
   */
  public insertClassicPattern() {
    const stepsPerBar = this.getStepsPerBar();
    const stepsPerBeat = this.getStepsPerBeat();
    this.pattern.clear();

    // 在 4/4 拍 1/16 模式下：
    // 第 1 拍正拍: C1 (36)
    // 第 2 拍後半: G1 (43)
    // 第 3 拍正拍與切分: C1 (36)
    // 第 4 拍後半: G1 (43)
    for (let bar = 0; bar < this.totalBars; bar++) {
      const offset = bar * stepsPerBar;
      if (this.resolution === '1/16' && stepsPerBar === 16) {
        this.pattern.set(offset + 0, 36);  // Beat 1.1: C1
        this.pattern.set(offset + 6, 43);  // Beat 2.3: G1
        this.pattern.set(offset + 8, 36);  // Beat 3.1: C1
        this.pattern.set(offset + 11, 36); // Beat 3.4: C1 (切分尾音)
        this.pattern.set(offset + 14, 43); // Beat 4.3: G1
      } else {
        // 8 分音符模式
        this.pattern.set(offset + 0, 36);
        this.pattern.set(offset + 2 * stepsPerBeat, 43);
      }
    }

    this.render();
    this.onPatternChange?.();
  }

  public getActiveNotesAtStep(step: number): number[] {
    const note = this.pattern.get(step);
    return note !== undefined ? [note] : [];
  }

  public setPlayheadStep(step: number | null) {
    if (this.playheadStep === step) return;
    this.playheadStep = step;

    // 更新畫面上目前走帶高亮格
    const allPlayheadCells = this.container.querySelectorAll('.bass-cell.playing, .bass-header-cell.playing');
    allPlayheadCells.forEach(el => el.classList.remove('playing'));

    if (step !== null) {
      const activeCells = this.container.querySelectorAll(`[data-step="${step}"]`);
      activeCells.forEach(el => el.classList.add('playing'));
    }
  }

  /**
   * 導出 StyleNoteEvent 清單 (基於 ticksPerBar 計算)
   */
  public getMidiEvents(ticksPerBar: number): Array<{
    note: number;
    startTick: number;
    durationTick: number;
    velocity: number;
  }> {
    const stepsPerBar = this.getStepsPerBar();
    const ticksPerStep = Math.round(ticksPerBar / stepsPerBar);
    const durationTick = Math.max(24, Math.round(ticksPerStep * 0.9));
    const events: Array<{
      note: number;
      startTick: number;
      durationTick: number;
      velocity: number;
    }> = [];

    this.pattern.forEach((note, step) => {
      const startTick = step * ticksPerStep;
      events.push({
        note,
        startTick,
        durationTick,
        velocity: 100,
      });
    });

    return events.sort((a, b) => a.startTick - b.startTick);
  }

  /**
   * 繪製完整貝斯鋼琴捲軸介面
   */
  public render() {
    this.container.innerHTML = '';

    const stepsPerBar = this.getStepsPerBar();
    const stepsPerBeat = this.getStepsPerBeat();
    const beatsPerBar = this.getBeatsPerBar();
    const totalSteps = this.getTotalSteps();

    // 1. 捲軸頂部輔助工具列
    const toolbar = document.createElement('div');
    toolbar.className = 'grid-toolbar';
    toolbar.innerHTML = `
      <div class="grid-toolbar-left">
        <span style="font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
          🎸 貝斯低音音軌 (Bass Track - Channel 11)
        </span>
        <span class="c-chord-guardrail-badge" title="PSR-SX920 原廠 SFF2 CASM 轉調規則以 C 大調為基準。標有金色、青色、綠色之音符在彈奏左手和弦時保證 100% 正確轉調！">
          🛡️ C 大調安全防呆啟用
        </span>
      </div>
      <div class="grid-toolbar-right">
        <button id="btn-bass-template" class="btn-grid-tool" title="一鍵自動填入流行樂 C-G 貝斯標準律動">
          ✨ 填入經典流行律動
        </button>
        <button id="btn-bass-clone" class="btn-grid-tool" title="將第 1 小節貝斯音符一鍵鋪滿至全部小節">
          ⚡ 一鍵鋪滿 ${this.totalBars} 小節
        </button>
        <button id="btn-bass-clear" class="btn-grid-tool btn-grid-clear" title="清除所有貝斯音符">
          🗑️ 清空貝斯
        </button>
      </div>
    `;
    this.container.appendChild(toolbar);

    // 綁定工具按鈕事件
    toolbar.querySelector('#btn-bass-template')?.addEventListener('click', () => this.insertClassicPattern());
    toolbar.querySelector('#btn-bass-clone')?.addEventListener('click', () => this.cloneFirstBar());
    toolbar.querySelector('#btn-bass-clear')?.addEventListener('click', () => this.clear());

    // 2. 鋼琴捲軸滾動外容器
    const scrollWrap = document.createElement('div');
    scrollWrap.className = 'grid-scroll-wrapper piano-roll-scroll-wrapper';

    // 3. 頂部小節與拍子標記列
    const headerRow = document.createElement('div');
    headerRow.className = 'grid-row grid-header-row';

    const headerCorner = document.createElement('div');
    headerCorner.className = 'row-header-label';
    headerCorner.style.width = '180px';
    headerCorner.style.minWidth = '180px';
    headerCorner.innerHTML = `
      <span style="font-size: 0.78rem; font-weight: 700; color: #94a3b8; display: flex; align-items: center; gap: 4px;">
        🎹 琴鍵音高 / 拍子
      </span>
    `;
    headerRow.appendChild(headerCorner);

    const stepHeadersWrap = document.createElement('div');
    stepHeadersWrap.className = 'step-cells-wrap';

    for (let bar = 0; bar < this.totalBars; bar++) {
      for (let beat = 0; beat < beatsPerBar; beat++) {
        for (let sub = 0; sub < stepsPerBeat; sub++) {
          const globalStep = (bar * beatsPerBar + beat) * stepsPerBeat + sub;
          const isBarStart = beat === 0 && sub === 0;
          const isBeatStart = sub === 0;

          const cell = document.createElement('div');
          cell.className = `step-header-cell bass-header-cell ${isBarStart ? 'bar-start' : ''} ${isBeatStart ? 'beat-start' : ''}`;
          cell.setAttribute('data-step', globalStep.toString());

          if (isBarStart && this.totalBars > 1) {
            cell.innerHTML = `<span class="bar-num" style="color: #38bdf8; font-weight: 800;">M${bar + 1}</span>`;
          } else if (isBeatStart) {
            cell.innerHTML = `<span class="beat-num">${beat + 1}</span>`;
          } else {
            cell.innerHTML = `<span class="sub-dot">·</span>`;
          }

          stepHeadersWrap.appendChild(cell);
        }
      }
    }
    headerRow.appendChild(stepHeadersWrap);
    scrollWrap.appendChild(headerRow);

    // 4. 捲軸內容區 (可限制高度並捲動，預設直接精準顯示 C1 ~ C3)
    const rollBody = document.createElement('div');
    rollBody.className = 'piano-roll-body';

    for (const pitch of this.pitches) {
      const pitchRow = document.createElement('div');
      let rowRoleClass = '';
      if (pitch.role === 'root') rowRoleClass = 'pitch-row-root';
      else if (pitch.role === 'fifth') rowRoleClass = 'pitch-row-fifth';
      else if (pitch.role === 'third') rowRoleClass = 'pitch-row-third';
      else if (pitch.isBlack) rowRoleClass = 'pitch-row-black';

      pitchRow.className = `grid-row piano-pitch-row ${rowRoleClass}`;

      // 左側鋼琴琴鍵
      const keyLabel = document.createElement('div');
      keyLabel.className = `row-header-label piano-key-label ${pitch.isBlack ? 'piano-black-key' : 'piano-white-key'}`;
      keyLabel.style.width = '180px';
      keyLabel.style.minWidth = '180px';
      keyLabel.setAttribute('title', `點擊試聽 ${pitch.name} (MIDI ${pitch.note})`);

      let badgeHtml = '';
      if (pitch.roleLabel) {
        let badgeColor = '#94a3b8';
        if (pitch.role === 'root') badgeColor = '#fbbf24'; // Gold
        else if (pitch.role === 'fifth') badgeColor = '#38bdf8'; // Cyan
        else if (pitch.role === 'third') badgeColor = '#34d399'; // Green

        badgeHtml = `<span class="pitch-badge" style="background: ${badgeColor}22; color: ${badgeColor}; border: 1px solid ${badgeColor}66;">${pitch.roleLabel}</span>`;
      }

      keyLabel.innerHTML = `
        <div class="piano-key-content">
          <span class="pitch-name ${pitch.role === 'root' ? 'root-text' : ''}">${pitch.name}</span>
          ${badgeHtml}
        </div>
      `;

      // 點擊琴鍵直接發聲試聽
      keyLabel.addEventListener('click', () => {
        this.playNoteSound(pitch.note, 100);
      });

      pitchRow.appendChild(keyLabel);

      // 右側步進格子清單
      const cellsWrap = document.createElement('div');
      cellsWrap.className = 'step-cells-wrap';

      for (let s = 0; s < totalSteps; s++) {
        const subInBeat = s % stepsPerBeat;
        const isBarStart = (s % stepsPerBar) === 0;
        const isBeatStart = subInBeat === 0;

        const cell = document.createElement('div');
        const isActive = this.pattern.get(s) === pitch.note;

        let activeColorClass = '';
        if (isActive) {
          if (pitch.role === 'root') activeColorClass = 'active-root';
          else if (pitch.role === 'fifth') activeColorClass = 'active-fifth';
          else if (pitch.role === 'third') activeColorClass = 'active-third';
          else activeColorClass = 'active-scale';
        }

        cell.className = `step-cell bass-cell ${isBarStart ? 'bar-start' : ''} ${isBeatStart ? 'beat-start' : ''} ${pitch.isBlack ? 'black-key-row' : ''} ${isActive ? 'active ' + activeColorClass : ''}`;
        cell.setAttribute('data-step', s.toString());
        cell.setAttribute('data-note', pitch.note.toString());

        // 點擊格子切換該步音符 (單音模式：同一步只能有一個貝斯音符)
        cell.addEventListener('click', () => {
          if (this.pattern.get(s) === pitch.note) {
            // 已啟用則關閉
            this.pattern.delete(s);
          } else {
            // 啟用新音符並自動替換同一步的其他舊音
            this.pattern.set(s, pitch.note);
            this.playNoteSound(pitch.note, 100);
          }
          this.render();
          this.onPatternChange?.();
        });

        cellsWrap.appendChild(cell);
      }

      pitchRow.appendChild(cellsWrap);
      rollBody.appendChild(pitchRow);
    }

    scrollWrap.appendChild(rollBody);
    this.container.appendChild(scrollWrap);
  }
}
