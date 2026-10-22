/**
 * Yamaha PSR-SX920 專注創作台 (V2 核心版)
 * 主控入口程式碼 (Creator App)
 * 支援 Yamaha 原廠鼓組選擇與 USB 實體琴 Web MIDI 即時發聲監聽
 */

import { DrumStepGrid } from './drum-step-grid';
import { drumSynth } from './drum-synth';
import { YAMAHA_SX920_DRUM_KITS, type YamahaDrumKitPreset } from './drum-kits';
import { midiManager } from '../core/audio/midi-manager';
import { YamahaStyleSynthesizer } from '../core/writer/style-synthesizer';
import { YamahaPadSynthesizer } from '../core/writer/pad-synthesizer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import type { StyleNoteEvent } from '../core/models/style-types';

export type CreatorMode = 'STY' | 'PAD';

export interface CreatorState {
  mode: CreatorMode;
  bpm: number;
  totalBars: number;
  isPlaying: boolean;
  currentSection: string;
  selectedDrumKit: YamahaDrumKitPreset;
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
    isMidiConnected: false,
  };

  private drumGrid: DrumStepGrid | null = null;
  private playbackTimer: any = null;
  private currentPlayStep: number = 0;

  constructor() {
    this.initElements();
    this.initDrumKitSelector();
    this.initMidi();
    this.bindEvents();
    this.updateUI();
  }

  private initElements() {
    console.log('🎹 Yamaha PSR-SX920 Creator App V2 初始化啟動...');
    const container = document.getElementById('step-grid-container');
    if (container) {
      this.drumGrid = new DrumStepGrid(
        container,
        this.state.totalBars,
        () => this.onPatternModified(),
        (note, vel) => this.sendMidiNoteTrigger(note, vel)
      );
    }
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
        this.setStatus(`✓ 已切換為鼓組【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
      }
    });
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

      // 監聽熱插拔事件
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
      // 同步當前選定的鼓組音色至實體琴 Channel 10
      this.syncDrumKitToKeyboard();
      this.setStatus(`✓ 已連線 PSR-SX920 [${outputDevice.name}]，您在電腦上的排點將同步直接由琴端喇叭發聲！`);
    } else {
      this.state.isMidiConnected = false;
      btnMidi?.classList.remove('connected');
      if (labelMidi) {
        labelMidi.textContent = '🎹 琴端發聲: 未連線 (點擊重試)';
      }
      btnMidi?.setAttribute('title', '請以 USB 線連接 PSR-SX920 與電腦，並點擊此處嘗試連線');
    }
  }

  /**
   * 將目前選取的鼓組套件送往實體琴 Channel 10 (channel index 9)
   */
  private syncDrumKitToKeyboard() {
    if (this.state.isMidiConnected) {
      const kit = this.state.selectedDrumKit;
      // 發送 Bank MSB (CC 0), Bank LSB (CC 32) 與 Program Change 到 Channel 10
      midiManager.sendVoiceChange(9, {
        msb: kit.msb,
        lsb: kit.lsb,
        pc: kit.pc,
      });
    }
  }

  /**
   * 觸發鼓聲發聲 (同時輸出至電腦 Web Audio 與實體琴 MIDI)
   */
  private triggerDrumSound(note: number, velocity: number = 100, durMs: number = 80) {
    // 1. 電腦瀏覽器合成器發聲
    drumSynth.playNote(note, velocity);

    // 2. 實體琴 USB MIDI 發聲
    this.sendMidiNoteTrigger(note, velocity, durMs);
  }

  /**
   * 發送單音 MIDI 觸發至 PSR-SX920 Channel 10
   */
  private sendMidiNoteTrigger(note: number, velocity: number = 100, durMs: number = 80) {
    if (this.state.isMidiConnected) {
      midiManager.sendNoteOn(9, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(9, note);
      }, durMs);
    }
  }

  private onPatternModified() {
    const hasNotes = this.drumGrid?.hasNotes() ?? false;
    this.setStatus(hasNotes ? '節奏已更新，可點擊【播放】聆聽或點擊【一鍵鋪滿】擴展小節。' : '請點擊格子安排鼓點。');
  }

  private bindEvents() {
    // 模式切換按鈕
    const btnSty = document.getElementById('btn-mode-sty') as HTMLButtonElement | null;
    const btnPad = document.getElementById('btn-mode-pad') as HTMLButtonElement | null;

    btnSty?.addEventListener('click', () => this.setMode('STY'));
    btnPad?.addEventListener('click', () => this.setMode('PAD'));

    // MIDI 重新連線按鈕
    const btnMidi = document.getElementById('btn-midi-connect');
    btnMidi?.addEventListener('click', async () => {
      this.setStatus('正在掃描 USB MIDI 設備...');
      await midiManager.requestAccess();
      this.updateMidiUIState();
    });

    // BPM 輸入
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

    // 小節數選擇
    const selectBars = document.getElementById('select-bars') as HTMLSelectElement | null;
    selectBars?.addEventListener('change', () => {
      const val = parseInt(selectBars.value, 10);
      if (!isNaN(val)) {
        this.state.totalBars = val;
        this.drumGrid?.setTotalBars(val);
        this.updateCloneButtonText();
        this.updateSectionLabel();
        this.setStatus(`伴奏長度已調整為 ${this.state.totalBars} 小節`);
      }
    });

    // 播放 / 暫停
    const btnPlay = document.getElementById('btn-play-toggle') as HTMLButtonElement | null;
    btnPlay?.addEventListener('click', () => {
      this.togglePlay();
    });

    // 停止
    const btnStop = document.getElementById('btn-stop') as HTMLButtonElement | null;
    btnStop?.addEventListener('click', () => {
      this.stop();
    });

    // 一鍵鋪滿按鈕
    const btnClone = document.getElementById('btn-clone-bars') as HTMLButtonElement | null;
    btnClone?.addEventListener('click', () => {
      if (this.drumGrid) {
        this.drumGrid.cloneFirstBar();
        this.setStatus(`✨ 已將第 1 小節節奏原型一鍵鋪滿至全部 ${this.state.totalBars} 小節！可自由微調最後小節過門。`);
      }
    });

    // 匯出按鈕
    const btnExport = document.getElementById('btn-export-file') as HTMLButtonElement | null;
    btnExport?.addEventListener('click', () => {
      this.exportFile();
    });
  }

  public setMode(mode: CreatorMode) {
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

    this.updateSectionLabel();
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
    this.setStatus(`▶ 正在播放 ${this.state.currentSection} (${this.state.bpm} BPM)${midiMsg}...`);
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
      // 1. 高亮當前走帶位置
      this.drumGrid?.setPlayheadStep(this.currentPlayStep);

      // 2. 觸發當前步進發聲 (電腦與實體琴)
      const notesToPlay = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
      for (const note of notesToPlay) {
        this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
      }

      // 3. 步進遞增 (循環)
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
        const notesToPlay = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of notesToPlay) {
          this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
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

  private exportFile() {
    if (!this.drumGrid || !this.drumGrid.hasNotes()) {
      alert('請先在步進網格上點擊放置鼓點音符，再進行匯出！');
      return;
    }

    try {
      this.setStatus('⏳ 正在生成 Yamaha 二進位檔案...');
      const timeSig = this.drumGrid.getTimeSignatureObject();
      const chosenKit = this.state.selectedDrumKit;

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
        // --- 匯出 STY 伴奏風格 ---
        const division = 480;
        const ticksPerBeat = division;
        const ticksPerBar = Math.round(ticksPerBeat * timeSig.numerator * (4 / timeSig.denominator));
        const drumEvents = this.drumGrid.getMidiEvents(ticksPerBar);

        // 指派至 Channel 10 (channel index 9, Rhythm 2 主鼓組)
        const styleNotes: StyleNoteEvent[] = drumEvents.map(ev => ({
          partId: 'Rhythm2',
          channel: 9,
          note: ev.note,
          startTick: ev.startTick,
          durationTick: ev.durationTick,
          velocity: ev.velocity,
        }));

        const parsed = YamahaStyleSynthesizer.createBlankStyle({
          styleName: finalFilename.replace(/\.sty$/i, ''),
          bpm: this.state.bpm,
          timeSignature: timeSig,
          division,
          sections: [
            {
              name: 'Main A',
              bars: this.state.totalBars,
              notes: styleNotes,
            },
          ],
          parts: {
            Rhythm2: {
              msb: chosenKit.msb,
              lsb: chosenKit.lsb,
              pc: chosenKit.pc,
            },
          },
          injectCasm: true, // 自動注入相容 PSR-SX920 的合法 CASM
        });

        binaryBytes = YamahaStyleSynthesizer.serializeToStyleFile(parsed);
      } else {
        // --- 匯出 PAD 多功能打擊板 ---
        const division = 96;
        const ticksPerBar = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));
        const drumEvents = this.drumGrid.getMidiEvents(ticksPerBar);

        const padProject = YamahaPadSynthesizer.createBlankProject({
          projectName: finalFilename.replace(/\.pad$/i, ''),
          bpm: this.state.bpm,
          timeSignature: timeSig,
          division,
          bars: this.state.totalBars,
          pads: [
            {
              name: 'Pad 1',
              icon: 'S815', // Drum Kit 圖標
              repeat: false, // One-shot 單次播放
              chordMatch: false, // 鼓組音效不隨左手和弦轉調
              msb: chosenKit.msb,
              lsb: chosenKit.lsb,
              pc: chosenKit.pc,
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
      this.setStatus(`✓ 已成功匯出 [${finalFilename}] (${sizeKb} KB，套用鼓組: ${chosenKit.name})！已相容 PSR-SX920 SFF2 規範，請拷貝至 USB 插琴驗收。`);
      alert(`🎉 恭喜！檔案 [${finalFilename}] 匯出成功！\n\n- 格式: Yamaha ${this.state.mode === 'STY' ? 'SFF2 伴奏風格 (.STY)' : 'Multi Pad (.PAD)'}\n- 套用鼓組: ${chosenKit.name}\n- 檔案大小: ${sizeKb} KB\n- 驗收指引: 請將此檔案複製到隨身碟，插上 PSR-SX920 面板直接按 Start/Stop 試聽！`);
    } catch (err: any) {
      console.error('匯出失敗:', err);
      alert(`❌ 匯出失敗: ${err.message}`);
      this.setStatus(`匯出失敗: ${err.message}`);
    }
  }

  private updateCloneButtonText() {
    const btnClone = document.getElementById('btn-clone-bars');
    if (btnClone) {
      btnClone.textContent = `⚡ 一鍵鋪滿 ${this.state.totalBars} 小節`;
    }
  }

  private updateSectionLabel() {
    const label = document.getElementById('label-current-section');
    if (label) {
      label.textContent = `段落：${this.state.currentSection} (${this.state.totalBars}小節)`;
    }
  }

  public setStatus(msg: string) {
    const el = document.getElementById('status-text');
    if (el) {
      el.textContent = msg;
    }
  }

  private updateUI() {
    this.updateCloneButtonText();
    this.updateSectionLabel();
  }
}

// 頁面載入後自動啟動
window.addEventListener('DOMContentLoaded', () => {
  (window as any).creatorApp = new CreatorApp();
});
