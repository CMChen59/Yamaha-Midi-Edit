/**
 * Yamaha PSR-SX920 專注創作台 (V2 核心版)
 * 主控入口程式碼 (Creator App)
 * 支援多伴奏段落編輯 (Main A, Main B, Fill In 等)、段落一鍵複製、
 * C 大調和弦防呆導引、Yamaha 原廠鼓組/貝斯音色選擇、USB 實體琴 Web MIDI 即時發聲監聽
 */

import { DrumStepGrid } from './drum-step-grid';
import { drumSynth } from './drum-synth';
import { YAMAHA_SX920_DRUM_KITS, type YamahaDrumKitPreset } from './drum-kits';
import { PianoRollLite } from './piano-roll-lite';
import { bassSynth } from './bass-synth';
import { YAMAHA_SX920_BASS_VOICES, type YamahaBassPreset } from './bass-voices';
import { midiManager } from '../core/audio/midi-manager';
import { YamahaStyleSynthesizer } from '../core/writer/style-synthesizer';
import { YamahaPadSynthesizer } from '../core/writer/pad-synthesizer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import type { StyleNoteEvent, StyleSectionConfig } from '../core/models/style-types';

export type CreatorMode = 'STY' | 'PAD';

export interface SectionPreset {
  id: string;
  label: string;
  defaultBars: number;
}

export const STY_SECTION_PRESETS: SectionPreset[] = [
  { id: 'Main A', label: 'Main A (主要伴奏 1 - 主歌)', defaultBars: 4 },
  { id: 'Main B', label: 'Main B (主要伴奏 2 - 副歌)', defaultBars: 4 },
  { id: 'Main C', label: 'Main C (主要伴奏 3 - 強烈)', defaultBars: 4 },
  { id: 'Main D', label: 'Main D (主要伴奏 4 - 高潮)', defaultBars: 4 },
  { id: 'Fill In AA', label: 'Fill In AA (過門 A - 1小節)', defaultBars: 1 },
  { id: 'Fill In BB', label: 'Fill In BB (過門 B - 1小節)', defaultBars: 1 },
  { id: 'Fill In CC', label: 'Fill In CC (過門 C - 1小節)', defaultBars: 1 },
  { id: 'Fill In DD', label: 'Fill In DD (過門 D - 1小節)', defaultBars: 1 },
  { id: 'Intro A', label: 'Intro A (前奏 A - 2小節)', defaultBars: 2 },
  { id: 'Ending A', label: 'Ending A (尾奏 A - 2小節)', defaultBars: 2 },
];

export const PAD_SECTION_PRESETS: SectionPreset[] = [
  { id: 'Pad 1', label: 'Pad 1 (多功能打擊板 1)', defaultBars: 2 },
  { id: 'Pad 2', label: 'Pad 2 (多功能打擊板 2)', defaultBars: 2 },
  { id: 'Pad 3', label: 'Pad 3 (多功能打擊板 3)', defaultBars: 2 },
  { id: 'Pad 4', label: 'Pad 4 (多功能打擊板 4)', defaultBars: 2 },
];

export interface SectionStore {
  name: string;
  bars: number;
  drumPattern: Map<number, boolean[]>;
  bassPattern: Map<number, number>;
}

export interface CreatorState {
  mode: CreatorMode;
  bpm: number;
  totalBars: number;
  isPlaying: boolean;
  currentSection: string;
  selectedDrumKit: YamahaDrumKitPreset;
  selectedBassVoice: YamahaBassPreset;
  isMidiConnected: boolean;
}

export class CreatorApp {
  private state: CreatorState = {
    mode: 'STY',
    bpm: 120,
    totalBars: 4,
    isPlaying: false,
    currentSection: 'Main A',
    selectedDrumKit: YAMAHA_SX920_DRUM_KITS[0], // 預設 Standard Kit 1
    selectedBassVoice: YAMAHA_SX920_BASS_VOICES[0], // 預設 Finger Bass
    isMidiConnected: false,
  };

  private drumGrid: DrumStepGrid | null = null;
  private bassRoll: PianoRollLite | null = null;
  private playbackTimer: any = null;
  private currentPlayStep: number = 0;

  // 多段落狀態記憶庫 (Section Name -> SectionStore)
  private sections: Map<string, SectionStore> = new Map();

  constructor() {
    this.initElements();
    this.initDrumKitSelector();
    this.initBassVoiceSelector();
    this.initSectionSelector();
    this.initMidi();
    this.bindEvents();
    this.updateUI();
  }

  private initElements() {
    console.log('🎹 Yamaha PSR-SX920 Creator App V2 初始化啟動...');
    const drumContainer = document.getElementById('step-grid-container');
    if (drumContainer) {
      this.drumGrid = new DrumStepGrid(
        drumContainer,
        this.state.totalBars,
        () => this.onPatternModified(),
        (note, vel) => this.sendMidiDrumTrigger(note, vel),
        (res) => this.onGlobalResolutionChange(res),
        (sig) => this.onGlobalTimeSignatureChange(sig)
      );
    }

    const bassContainer = document.getElementById('bass-roll-container');
    if (bassContainer) {
      this.bassRoll = new PianoRollLite(
        bassContainer,
        this.state.totalBars,
        () => this.onPatternModified(),
        (note, vel) => this.sendMidiBassTrigger(note, vel)
      );
    }

    // 初始化預設 Main A
    this.sections.set('Main A', {
      name: 'Main A',
      bars: 4,
      drumPattern: new Map(),
      bassPattern: new Map(),
    });
  }

  /**
   * 初始化鼓組下拉選單
   */
  private initDrumKitSelector() {
    const selectKit = document.getElementById('select-drum-kit') as HTMLSelectElement | null;
    if (!selectKit) return;

    selectKit.innerHTML = '';
    for (const kit of YAMAHA_SX920_DRUM_KITS) {
      const opt = document.createElement('option');
      opt.value = kit.id;
      opt.textContent = `${kit.icon} ${kit.name} (PC ${kit.panelPc} / Bank ${kit.msb}-${kit.lsb})`;
      if (kit.id === this.state.selectedDrumKit.id) {
        opt.selected = true;
      }
      selectKit.appendChild(opt);
    }

    selectKit.addEventListener('change', () => {
      const selectedId = selectKit.value;
      const found = YAMAHA_SX920_DRUM_KITS.find(k => k.id === selectedId);
      if (found) {
        this.state.selectedDrumKit = found;
        this.syncDrumKitToKeyboard();
        this.setStatus(`✓ 已切換鼓組【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
      }
    });
  }

  /**
   * 初始化貝斯音色下拉選單
   */
  private initBassVoiceSelector() {
    const selectBass = document.getElementById('select-bass-voice') as HTMLSelectElement | null;
    if (!selectBass) return;

    selectBass.innerHTML = '';
    for (const bass of YAMAHA_SX920_BASS_VOICES) {
      const opt = document.createElement('option');
      opt.value = bass.id;
      opt.textContent = `${bass.icon} ${bass.name} (PC ${bass.panelPc} / Bank ${bass.msb}-${bass.lsb})`;
      if (bass.id === this.state.selectedBassVoice.id) {
        opt.selected = true;
      }
      selectBass.appendChild(opt);
    }

    selectBass.addEventListener('change', () => {
      const selectedId = selectBass.value;
      const found = YAMAHA_SX920_BASS_VOICES.find(b => b.id === selectedId);
      if (found) {
        this.state.selectedBassVoice = found;
        this.syncBassVoiceToKeyboard();
        this.setStatus(`✓ 已切換貝斯【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
      }
    });
  }

  /**
   * 初始化段落切換下拉選單與複製對話盒
   */
  private initSectionSelector() {
    this.refreshSectionOptions();

    const selectSection = document.getElementById('select-current-section') as HTMLSelectElement | null;
    selectSection?.addEventListener('change', () => {
      this.switchSection(selectSection.value);
    });

    // 複製段落按鈕
    const btnCopy = document.getElementById('btn-copy-section') as HTMLButtonElement | null;
    btnCopy?.addEventListener('click', () => {
      this.openCopyModal();
    });

    // 關閉複製彈窗
    const btnCloseCopy = document.getElementById('btn-close-copy-modal');
    btnCloseCopy?.addEventListener('click', () => {
      this.closeCopyModal();
    });
  }

  /**
   * 更新段落選項清單 (STY 段落 vs PAD 段落)
   */
  private refreshSectionOptions() {
    const selectSection = document.getElementById('select-current-section') as HTMLSelectElement | null;
    if (!selectSection) return;

    selectSection.innerHTML = '';
    const presets = this.state.mode === 'STY' ? STY_SECTION_PRESETS : PAD_SECTION_PRESETS;

    for (const item of presets) {
      const opt = document.createElement('option');
      opt.value = item.id;
      const hasNotes = this.checkSectionHasNotes(item.id);
      opt.textContent = `${item.label}${hasNotes ? ' ★' : ''}`;
      if (item.id === this.state.currentSection) {
        opt.selected = true;
      }
      selectSection.appendChild(opt);
    }
  }

  /**
   * 檢查某個段落是否已有編寫音符
   */
  private checkSectionHasNotes(secName: string): boolean {
    if (secName === this.state.currentSection) {
      return (this.drumGrid?.hasNotes() ?? false) || (this.bassRoll?.hasNotes() ?? false);
    }
    const store = this.sections.get(secName);
    if (!store) return false;
    let hasDrums = false;
    store.drumPattern.forEach(arr => {
      if (arr.some(b => b)) hasDrums = true;
    });
    return hasDrums || store.bassPattern.size > 0;
  }

  /**
   * 將當前畫面的鼓與貝斯 Pattern 存入 Store
   */
  private saveCurrentSectionToStore() {
    if (!this.drumGrid || !this.bassRoll) return;

    this.sections.set(this.state.currentSection, {
      name: this.state.currentSection,
      bars: this.state.totalBars,
      drumPattern: this.drumGrid.getPatternData(),
      bassPattern: this.bassRoll.getPatternData(),
    });
  }

  /**
   * 切換編輯段落 (例如由 Main A 切換至 Main B)
   */
  public switchSection(newSectionName: string) {
    if (this.state.currentSection === newSectionName) return;

    if (this.state.isPlaying) {
      this.stop();
    }

    // 1. 先暫存當前段落
    this.saveCurrentSectionToStore();

    // 2. 切換段落標識
    this.state.currentSection = newSectionName;

    // 3. 獲取或建立目標段落
    let store = this.sections.get(newSectionName);
    if (!store) {
      const presets = this.state.mode === 'STY' ? STY_SECTION_PRESETS : PAD_SECTION_PRESETS;
      const foundPreset = presets.find(p => p.id === newSectionName);
      const defaultBars = foundPreset ? foundPreset.defaultBars : 4;

      store = {
        name: newSectionName,
        bars: defaultBars,
        drumPattern: new Map(),
        bassPattern: new Map(),
      };
      this.sections.set(newSectionName, store);
    }

    // 4. 同步更新小節數與網格
    this.state.totalBars = store.bars;
    const selectBars = document.getElementById('select-bars') as HTMLSelectElement | null;
    if (selectBars) selectBars.value = store.bars.toString();

    this.drumGrid?.setTotalBars(store.bars);
    this.bassRoll?.setTotalBars(store.bars);

    this.drumGrid?.setPatternData(store.drumPattern);
    this.bassRoll?.setPatternData(store.bassPattern);

    this.updateUI();
    this.setStatus(`✓ 已切換至【${newSectionName}】段落 (${store.bars} 小節)`);
  }

  /**
   * 開啟「複製此段到...」彈窗
   */
  private openCopyModal() {
    const modal = document.getElementById('modal-copy-section');
    const sourceLabel = document.getElementById('modal-source-sec-name');
    const list = document.getElementById('modal-target-sections-list');
    if (!modal || !list) return;

    if (sourceLabel) sourceLabel.textContent = this.state.currentSection;
    list.innerHTML = '';

    const presets = this.state.mode === 'STY' ? STY_SECTION_PRESETS : PAD_SECTION_PRESETS;
    const targets = presets.filter(p => p.id !== this.state.currentSection);

    for (const t of targets) {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.style.padding = '8px 12px';
      btn.style.fontSize = '0.85rem';
      btn.style.textAlign = 'left';
      btn.style.display = 'flex';
      btn.style.justifyContent = 'space-between';
      btn.style.alignItems = 'center';

      const hasNotes = this.checkSectionHasNotes(t.id);
      btn.innerHTML = `
        <span>📄 ${t.id}</span>
        <span style="font-size: 0.72rem; color: ${hasNotes ? '#f59e0b' : '#64748b'};">${hasNotes ? '(有音符)' : '(空白)'}</span>
      `;

      btn.addEventListener('click', () => {
        this.copyCurrentSectionTo(t.id);
        this.closeCopyModal();
      });

      list.appendChild(btn);
    }

    modal.style.display = 'flex';
  }

  private closeCopyModal() {
    const modal = document.getElementById('modal-copy-section');
    if (modal) modal.style.display = 'none';
  }

  /**
   * 複製當前段落的鼓組與貝斯至目標段落
   */
  public copyCurrentSectionTo(targetSectionName: string) {
    if (this.state.currentSection === targetSectionName) return;

    this.saveCurrentSectionToStore();
    const currentStore = this.sections.get(this.state.currentSection);
    if (!currentStore) return;

    // 複製鼓組
    const drumCopy = new Map<number, boolean[]>();
    currentStore.drumPattern.forEach((arr, note) => drumCopy.set(note, [...arr]));

    // 複製貝斯
    const bassCopy = new Map(currentStore.bassPattern);

    // 針對 Fill In 自動將小節調整為 1 小節以符合原廠規範
    let targetBars = currentStore.bars;
    if (targetSectionName.startsWith('Fill')) {
      targetBars = 1;
    }

    this.sections.set(targetSectionName, {
      name: targetSectionName,
      bars: targetBars,
      drumPattern: drumCopy,
      bassPattern: bassCopy,
    });

    this.refreshSectionOptions();
    this.updateSectionSummary();

    if (confirm(`✨ 成功將【${this.state.currentSection}】複製到【${targetSectionName}】！\n\n是否立即切換到【${targetSectionName}】進行微調？`)) {
      const selectSection = document.getElementById('select-current-section') as HTMLSelectElement | null;
      if (selectSection) selectSection.value = targetSectionName;
      this.switchSection(targetSectionName);
    } else {
      this.setStatus(`✓ 已將【${this.state.currentSection}】複製到【${targetSectionName}】`);
    }
  }

  /**
   * 當使用者切換網格解析度 (1/16 vs 1/8) 時，全曲（鼓組與貝斯）同步更新
   */
  private onGlobalResolutionChange(res: import('./drum-step-grid').GridResolution) {
    this.bassRoll?.setResolution(res);
    if (this.state.isPlaying) {
      this.restartPlaybackTimer();
    }
    this.saveCurrentSectionToStore();
    this.setStatus(`✓ 全曲（鼓組與貝斯）網格解析度已同步切換為【${res === '1/16' ? '1/16 (16分音符，細緻)' : '1/8 (8分音符，簡潔)'}】`);
  }

  /**
   * 當使用者切換拍號 (4/4, 3/4, 6/8) 時，全曲（鼓組與貝斯）同步更新
   */
  private onGlobalTimeSignatureChange(sig: import('./drum-step-grid').TimeSignatureType) {
    this.bassRoll?.setTimeSignature(sig);
    if (this.state.isPlaying) {
      this.restartPlaybackTimer();
    }
    this.saveCurrentSectionToStore();
    this.setStatus(`✓ 全曲（鼓組與貝斯）拍號已同步切換為【${sig} 拍】`);
  }

  /**
   * 初始化 Web MIDI 與 PSR-SX920 埠口連線偵測
   */
  private async initMidi() {
    const labelMidi = document.getElementById('label-midi-status');

    if (!midiManager.isSupported()) {
      if (labelMidi) labelMidi.textContent = '琴端發聲: 瀏覽器不支援 MIDI';
      return;
    }

    try {
      await midiManager.requestAccess();
      this.updateMidiUIState();

      (navigator as any).requestMIDIAccess().then((access: any) => {
        access.onstatechange = () => {
          this.updateMidiUIState();
        };
      });
    } catch (err) {
      console.warn('Web MIDI 初始化受限:', err);
      if (labelMidi) labelMidi.textContent = '琴端發聲: 點擊授權連線';
    }
  }

  private updateMidiUIState() {
    const btnMidi = document.getElementById('btn-midi-connect');
    const labelMidi = document.getElementById('label-midi-status');
    const outputDevice = midiManager.getSelectedOutput();
    const hasOut = outputDevice !== null;

    if (hasOut && outputDevice) {
      this.state.isMidiConnected = true;
      btnMidi?.classList.add('connected');
      if (labelMidi) {
        labelMidi.textContent = `🎹 琴端即時發聲: ${outputDevice.name} 🟢`;
      }
      btnMidi?.setAttribute('title', `已連線實體琴 [${outputDevice.name}]，點擊格子或播放即可直接從琴上喇叭發聲！`);
      this.syncDrumKitToKeyboard();
      this.syncBassVoiceToKeyboard();
      this.setStatus(`✓ 已連線 PSR-SX920 [${outputDevice.name}]，鼓點與貝斯將同步直接由琴端喇叭發聲！`);
    } else {
      this.state.isMidiConnected = false;
      btnMidi?.classList.remove('connected');
      if (labelMidi) {
        labelMidi.textContent = '🎹 琴端發聲: 未連線 (點擊重試)';
      }
      btnMidi?.setAttribute('title', '請以 USB 線連接 PSR-SX920 與電腦，並點擊此處嘗試連線');
    }
  }

  private syncDrumKitToKeyboard() {
    if (this.state.isMidiConnected) {
      const kit = this.state.selectedDrumKit;
      midiManager.sendVoiceChange(9, {
        msb: kit.msb,
        lsb: kit.lsb,
        pc: kit.pc,
      });
    }
  }

  private syncBassVoiceToKeyboard() {
    if (this.state.isMidiConnected) {
      const bass = this.state.selectedBassVoice;
      midiManager.sendVoiceChange(10, {
        msb: bass.msb,
        lsb: bass.lsb,
        pc: bass.pc,
      });
    }
  }

  private triggerDrumSound(note: number, velocity: number = 100, durMs: number = 80) {
    drumSynth.playNote(note, velocity);
    this.sendMidiDrumTrigger(note, velocity, durMs);
  }

  private triggerBassSound(note: number, velocity: number = 100, durMs: number = 240) {
    bassSynth.playNote(note, velocity, durMs);
    this.sendMidiBassTrigger(note, velocity, durMs);
  }

  private sendMidiDrumTrigger(note: number, velocity: number = 100, durMs: number = 80) {
    if (this.state.isMidiConnected) {
      midiManager.sendNoteOn(9, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(9, note);
      }, durMs);
    }
  }

  private sendMidiBassTrigger(note: number, velocity: number = 100, durMs: number = 240) {
    if (this.state.isMidiConnected) {
      midiManager.sendNoteOn(10, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(10, note);
      }, durMs);
    }
  }

  private onPatternModified() {
    this.saveCurrentSectionToStore();
    this.refreshSectionOptions();
    this.updateSectionSummary();

    const hasDrum = this.drumGrid?.hasNotes() ?? false;
    const hasBass = this.bassRoll?.hasNotes() ?? false;
    if (hasDrum || hasBass) {
      this.setStatus(`【${this.state.currentSection}】已更新 (鼓點: ${hasDrum ? '已安排' : '無'}, 貝斯: ${hasBass ? '已安排' : '無'})，可點擊【播放】試聽！`);
    } else {
      this.setStatus(`【${this.state.currentSection}】空白。請在上方安排鼓點，或在下方安排貝斯。`);
    }
  }

  private bindEvents() {
    const btnSty = document.getElementById('btn-mode-sty') as HTMLButtonElement | null;
    const btnPad = document.getElementById('btn-mode-pad') as HTMLButtonElement | null;

    btnSty?.addEventListener('click', () => this.setMode('STY'));
    btnPad?.addEventListener('click', () => this.setMode('PAD'));

    const btnMidi = document.getElementById('btn-midi-connect');
    btnMidi?.addEventListener('click', async () => {
      this.setStatus('正在掃描 USB MIDI 設備...');
      await midiManager.requestAccess();
      this.updateMidiUIState();
    });

    const inputBpm = document.getElementById('input-bpm') as HTMLInputElement | null;
    inputBpm?.addEventListener('change', () => {
      const val = parseInt(inputBpm.value, 10);
      if (!isNaN(val) && val >= 40 && val <= 260) {
        this.state.bpm = val;
        this.setStatus(`速度設定為 ${this.state.bpm} BPM`);
        if (this.state.isPlaying) {
          this.restartPlaybackTimer();
        }
      }
    });

    const selectBars = document.getElementById('select-bars') as HTMLSelectElement | null;
    selectBars?.addEventListener('change', () => {
      const val = parseInt(selectBars.value, 10);
      if (!isNaN(val)) {
        this.state.totalBars = val;
        this.drumGrid?.setTotalBars(val);
        this.bassRoll?.setTotalBars(val);
        this.saveCurrentSectionToStore();
        this.setStatus(`【${this.state.currentSection}】伴奏長度已調整為 ${this.state.totalBars} 小節`);
      }
    });

    const btnPlay = document.getElementById('btn-play-toggle') as HTMLButtonElement | null;
    btnPlay?.addEventListener('click', () => {
      this.togglePlay();
    });

    const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
    btnStop?.addEventListener('click', () => {
      this.stop();
    });

    const btnExport = document.getElementById('btn-export-file') as HTMLButtonElement | null;
    btnExport?.addEventListener('click', () => {
      this.exportFile();
    });
  }

  public setMode(mode: CreatorMode) {
    if (this.state.isPlaying) this.stop();
    this.saveCurrentSectionToStore();

    this.state.mode = mode;

    const btnSty = document.getElementById('btn-mode-sty');
    const btnPad = document.getElementById('btn-mode-pad');
    const btnExport = document.getElementById('btn-export-file');

    if (mode === 'STY') {
      btnSty?.classList.add('active');
      btnPad?.classList.remove('active');
      if (btnExport) btnExport.textContent = '🚀 匯出為 .STY';
      this.state.currentSection = 'Main A';
    } else {
      btnPad?.classList.add('active');
      btnSty?.classList.remove('active');
      if (btnExport) btnExport.textContent = '🚀 匯出為 .PAD';
      this.state.currentSection = 'Pad 1';
    }

    this.refreshSectionOptions();
    this.switchSection(this.state.currentSection);
    this.setStatus(`已切換為【${mode === 'STY' ? 'STY 伴奏風格製作' : 'PAD 多功能打擊板插音製作'}】模式`);
  }

  private togglePlay() {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  private play() {
    this.state.isPlaying = true;
    const btnPlay = document.getElementById('btn-play-toggle');
    if (btnPlay) {
      btnPlay.innerHTML = '<span>⏸</span> 暫停';
      btnPlay.style.background = '#f59e0b';
    }
    const midiMsg = this.state.isMidiConnected ? ' (琴端同步發聲中)' : '';
    this.setStatus(`▶ 正在播放【${this.state.currentSection}】(${this.state.bpm} BPM)${midiMsg}...`);
    this.startPlaybackTimer();
  }

  private pause() {
    this.state.isPlaying = false;
    this.stopPlaybackTimer();
    const btnPlay = document.getElementById('btn-play-toggle');
    if (btnPlay) {
      btnPlay.innerHTML = '<span>▶</span> 播放';
      btnPlay.style.background = 'var(--accent-green)';
    }
    this.setStatus('已暫停。再次點擊【播放】從暫停點繼續。');
  }

  private stop() {
    this.state.isPlaying = false;
    this.stopPlaybackTimer();
    this.currentPlayStep = 0;
    this.drumGrid?.setPlayheadStep(null);
    this.bassRoll?.setPlayheadStep(null);

    const btnPlay = document.getElementById('btn-play-toggle');
    if (btnPlay) {
      btnPlay.innerHTML = '<span>▶</span> 播放';
      btnPlay.style.background = 'var(--accent-green)';
    }
    this.setStatus('⏹ 已停止。回到第 1 小節起點。');
  }

  private getStepIntervalMs(): number {
    const stepsPerBeat = this.drumGrid?.getStepsPerBeat() || 4;
    return (60 / this.state.bpm / stepsPerBeat) * 1000;
  }

  private startPlaybackTimer() {
    this.stopPlaybackTimer();
    const stepIntervalMs = this.getStepIntervalMs();

    const tick = () => {
      if (!this.state.isPlaying) return;

      const stepsPerBar = this.drumGrid?.getStepsPerBar() || 16;
      const totalSteps = this.state.totalBars * stepsPerBar;

      this.drumGrid?.setPlayheadStep(this.currentPlayStep);
      this.bassRoll?.setPlayheadStep(this.currentPlayStep);

      const drumNotes = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
      for (const note of drumNotes) {
        this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
      }

      const bassNotes = this.bassRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
      for (const note of bassNotes) {
        this.triggerBassSound(note, 100, Math.max(80, Math.round(stepIntervalMs * 1.5)));
      }

      this.currentPlayStep = (this.currentPlayStep + 1) % totalSteps;
    };

    tick();
    this.playbackTimer = setInterval(tick, stepIntervalMs);
  }

  private restartPlaybackTimer() {
    if (this.state.isPlaying) {
      this.stopPlaybackTimer();
      const stepIntervalMs = this.getStepIntervalMs();
      this.playbackTimer = setInterval(() => {
        if (!this.state.isPlaying) return;
        const stepsPerBar = this.drumGrid?.getStepsPerBar() || 16;
        const totalSteps = this.state.totalBars * stepsPerBar;

        this.drumGrid?.setPlayheadStep(this.currentPlayStep);
        this.bassRoll?.setPlayheadStep(this.currentPlayStep);

        const drumNotes = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of drumNotes) {
          this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
        }

        const bassNotes = this.bassRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of bassNotes) {
          this.triggerBassSound(note, 100, Math.max(80, Math.round(stepIntervalMs * 1.5)));
        }

        this.currentPlayStep = (this.currentPlayStep + 1) % totalSteps;
      }, stepIntervalMs);
    }
  }

  private stopPlaybackTimer() {
    if (this.playbackTimer) {
      clearInterval(this.playbackTimer);
      this.playbackTimer = null;
    }
  }

  /**
   * 匯出 STY / PAD 檔案
   */
  private exportFile() {
    this.saveCurrentSectionToStore();

    // 統計當前哪些段落包含音符
    const editedSections: SectionStore[] = [];
    this.sections.forEach(s => {
      let hasDrum = false;
      s.drumPattern.forEach(arr => {
        if (arr.some(b => b)) hasDrum = true;
      });
      const hasBass = s.bassPattern.size > 0;
      if (hasDrum || hasBass) {
        editedSections.push(s);
      }
    });

    if (editedSections.length === 0) {
      alert('所有段落目前皆為空白！請先在網格上安排鼓點或貝斯，再進行匯出。');
      return;
    }

    try {
      this.setStatus('⏳ 正在生成 Yamaha 二進位檔案...');
      const timeSig = this.drumGrid?.getTimeSignatureObject() ?? { numerator: 4, denominator: 4 };
      const chosenKit = this.state.selectedDrumKit;
      const chosenBass = this.state.selectedBassVoice;

      let binaryBytes: Uint8Array;
      const defaultFilename = this.state.mode === 'STY' ? `SX920_${chosenKit.id}.sty` : `SX920_${chosenKit.id}.pad`;
      const promptName = prompt('請輸入要匯出的檔案名稱：', defaultFilename);
      if (!promptName) {
        this.setStatus('已取消匯出。');
        return;
      }

      const ext = this.state.mode === 'STY' ? '.sty' : '.pad';
      const finalFilename = promptName.toLowerCase().endsWith(ext) ? promptName : `${promptName}${ext}`;

      if (this.state.mode === 'STY') {
        const division = 480;
        const ticksPerBeat = division;
        const ticksPerBar = Math.round(ticksPerBeat * timeSig.numerator * (4 / timeSig.denominator));
        const stepsPerBar = this.drumGrid?.getStepsPerBar() || 16;
        const ticksPerStep = Math.round(ticksPerBar / stepsPerBar);

        // 如果使用者只有編輯 Main A，詢問是否自動同步到 Main B/C/D 與 Fill In
        let sectionsToCompile: SectionStore[] = [...editedSections];
        if (editedSections.length === 1 && editedSections[0].name === 'Main A') {
          const autoMirror = confirm(
            '【多段落伴奏推薦】\n目前您只編寫了【Main A】。\n\n是否將 Main A 自動鏡像複製至 Main B、Main C、Main D 與 Fill In AA？\n（這樣在 PSR-SX920 面板上切換任何 Main 鍵或過門鍵都有聲音，絕不靜音！）\n\n點選【確定】：自動複製到所有段落 (推薦)\n點選【取消】：僅匯出 Main A 單一段落'
          );

          if (autoMirror) {
            const mainA = editedSections[0];
            const mirrorNames = ['Main B', 'Main C', 'Main D', 'Fill In AA'];
            for (const mName of mirrorNames) {
              sectionsToCompile.push({
                name: mName,
                bars: mName.startsWith('Fill') ? 1 : mainA.bars,
                drumPattern: mainA.drumPattern,
                bassPattern: mainA.bassPattern,
              });
            }
          }
        }

        // 將每個段落的 Pattern 編譯為 StyleSectionConfig
        const styleSections: StyleSectionConfig[] = sectionsToCompile.map(secStore => {
          const notes: StyleNoteEvent[] = [];

          // 1. 鼓組 (Ch 10 / idx 9)
          secStore.drumPattern.forEach((steps, note) => {
            for (let s = 0; s < secStore.bars * stepsPerBar; s++) {
              if (steps[s]) {
                notes.push({
                  partId: 'Rhythm2',
                  channel: 9,
                  note,
                  startTick: s * ticksPerStep,
                  durationTick: Math.max(24, Math.round(ticksPerStep * 0.8)),
                  velocity: 100,
                });
              }
            }
          });

          // 2. 貝斯 (Ch 11 / idx 10)
          secStore.bassPattern.forEach((note, s) => {
            if (s < secStore.bars * stepsPerBar) {
              notes.push({
                partId: 'Bass',
                channel: 10,
                note,
                startTick: s * ticksPerStep,
                durationTick: Math.max(24, Math.round(ticksPerStep * 1.5)),
                velocity: 100,
              });
            }
          });

          return {
            name: secStore.name,
            bars: secStore.bars,
            notes: notes.sort((a, b) => a.startTick - b.startTick),
          };
        });

        const parsed = YamahaStyleSynthesizer.createBlankStyle({
          styleName: finalFilename.replace(/\.sty$/i, ''),
          bpm: this.state.bpm,
          timeSignature: timeSig,
          division,
          sections: styleSections,
          parts: {
            Rhythm2: {
              msb: chosenKit.msb,
              lsb: chosenKit.lsb,
              pc: chosenKit.pc,
            },
            Bass: {
              msb: chosenBass.msb,
              lsb: chosenBass.lsb,
              pc: chosenBass.pc,
            },
          },
          injectCasm: true, // 自動建立合法 SFF2 CASM 轉調映射
        });

        binaryBytes = YamahaStyleSynthesizer.serializeToStyleFile(parsed);
      } else {
        // --- 匯出 PAD 多功能打擊板 ---
        const division = 96;
        const ticksPerBar = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));
        const drumEvents = this.drumGrid?.getMidiEvents(ticksPerBar) || [];
        const bassEvents = this.bassRoll?.getMidiEvents(ticksPerBar) || [];

        const padProject = YamahaPadSynthesizer.createBlankProject({
          projectName: finalFilename.replace(/\.pad$/i, ''),
          bpm: this.state.bpm,
          timeSignature: timeSig,
          division,
          bars: this.state.totalBars,
          pads: [
            {
              name: 'Pad 1 (Drums)',
              icon: 'S815',
              repeat: false,
              chordMatch: false,
              msb: chosenKit.msb,
              lsb: chosenKit.lsb,
              pc: chosenKit.pc,
            },
            {
              name: 'Pad 2 (Bass)',
              icon: 'S813',
              repeat: false,
              chordMatch: true,
              msb: chosenBass.msb,
              lsb: chosenBass.lsb,
              pc: chosenBass.pc,
            },
          ],
        });

        for (const ev of drumEvents) {
          YamahaPadModifier.addNoteEvent(padProject, 1, {
            note: ev.note,
            startTick: ev.startTick,
            durationTick: ev.durationTick,
            velocity: ev.velocity,
          });
        }

        for (const ev of bassEvents) {
          YamahaPadModifier.addNoteEvent(padProject, 2, {
            note: ev.note,
            startTick: ev.startTick,
            durationTick: ev.durationTick,
            velocity: ev.velocity,
          });
        }

        const validation = YamahaWriter.validateAndWrite(padProject);
        binaryBytes = validation.bytes;
      }

      // 觸發瀏覽器下載
      const blob = new Blob([binaryBytes as unknown as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const sizeKb = (binaryBytes.length / 1024).toFixed(1);
      const secCount = this.state.mode === 'STY' ? editedSections.length : 1;
      this.setStatus(`✓ 已成功匯出 [${finalFilename}] (${sizeKb} KB，包含 ${secCount} 個段落)！請拷貝至隨身碟插琴驗收。`);
      alert(`🎉 恭喜！檔案 [${finalFilename}] 匯出成功！\n\n- 格式: Yamaha ${this.state.mode === 'STY' ? 'SFF2 伴奏風格 (.STY)' : 'Multi Pad (.PAD)'}\n- 伴奏段落: 已寫入 ${secCount} 個段落\n- 套用鼓組: ${chosenKit.name}\n- 套用貝斯: ${chosenBass.name}\n- 檔案大小: ${sizeKb} KB\n- 驗收指引: 請將此檔案複製到隨身碟，插上 PSR-SX920 面板直接按 Start/Stop 試聽！`);
    } catch (err: any) {
      console.error('匯出失敗:', err);
      alert(`❌ 匯出失敗: ${err.message}`);
      this.setStatus(`匯出失敗: ${err.message}`);
    }
  }

  private updateSectionSummary() {
    const summaryEl = document.getElementById('label-sections-summary');
    if (!summaryEl) return;

    const names: string[] = [];
    const presets = this.state.mode === 'STY' ? STY_SECTION_PRESETS : PAD_SECTION_PRESETS;
    for (const p of presets) {
      if (this.checkSectionHasNotes(p.id)) {
        names.push(p.id);
      }
    }

    if (names.length === 0) {
      summaryEl.textContent = '💡 包含音符段落：無';
    } else {
      summaryEl.textContent = `💡 已包含音符段落：${names.join(', ')}`;
    }
  }

  public setStatus(msg: string) {
    const el = document.getElementById('status-text');
    if (el) {
      el.textContent = msg;
    }
  }

  private updateUI() {
    this.refreshSectionOptions();
    this.updateSectionSummary();
  }
}

// 頁面載入後自動啟動
window.addEventListener('DOMContentLoaded', () => {
  (window as any).creatorApp = new CreatorApp();
});
