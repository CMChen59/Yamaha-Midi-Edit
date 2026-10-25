/**
 * Yamaha PSR-SX920 專注創作台 (V2 核心版)
 * 主控入口程式碼 (Creator App)
 * 支援多伴奏段落編輯 (Main A, Main B, Fill In 等)、段落一鍵複製、
 * C 大調和弦防呆導引、Yamaha 原廠鼓組/貝斯/和弦音色選擇、USB 實體琴 Web MIDI 即時發聲監聽
 */

import { DrumStepGrid } from './drum-step-grid';
import { drumSynth } from './drum-synth';
import { YAMAHA_SX920_DRUM_KITS, type YamahaDrumKitPreset } from './drum-kits';
import { PianoRollLite } from './piano-roll-lite';
import { bassSynth } from './bass-synth';
import { YAMAHA_SX920_BASS_VOICES, type YamahaBassPreset } from './bass-voices';
import { ChordRollLite, AVAILABLE_CHORD_TRACK_CONFIGS } from './chord-roll-lite';
import { chordSynth } from './chord-synth';
import { YAMAHA_SX920_CHORD_VOICES, type YamahaChordPreset } from './chord-voices';
import { setComputerAudioMuted } from './audio-routing';
import { searchYamahaVoices, type YamahaVoice, type VoiceCategory } from '../core/data/yamaha-voices';
import { midiManager } from '../core/audio/midi-manager';
import { YamahaTemplateStyleSynthesizer, type TemplateSectionInput } from '../core/writer/template-style-synthesizer';
import { YamahaPadSynthesizer } from '../core/writer/pad-synthesizer';
import { YamahaPadModifier } from '../core/writer/pad-modifier';
import { YamahaWriter } from '../core/writer/yamaha-writer';
import { MixerPanel, type MixerChannelInfo } from './mixer-panel';

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
  chordPattern: Map<number, Set<number>>;
  dynamicPatterns?: Record<string, Map<number, Set<number>>>;
}

export interface DynamicChordTrack {
  partId: 'Chord2' | 'Pad' | 'Phrase1' | 'Phrase2';
  container: HTMLElement;
  roll: ChordRollLite;
  selectedVoice: YamahaChordPreset;
}

export interface CreatorState {
  mode: CreatorMode;
  bpm: number;
  totalBars: number;
  isPlaying: boolean;
  activePlayTrack: string | null;
  currentSection: string;
  selectedDrumKit: YamahaDrumKitPreset;
  selectedBassVoice: YamahaBassPreset;
  selectedChordVoice: YamahaChordPreset;
  isMidiConnected: boolean;
  midiRoutingMode: 'standard' | 'direct_ch1';
  computerAudioMuted: boolean;
}

export class CreatorApp {
  private state: CreatorState = {
    mode: 'STY',
    bpm: 120,
    totalBars: 4,
    isPlaying: false,
    activePlayTrack: null,
    currentSection: 'Main A',
    selectedDrumKit: YAMAHA_SX920_DRUM_KITS[0], // 預設 Standard Kit 1
    selectedBassVoice: YAMAHA_SX920_BASS_VOICES[0], // 預設 Finger Bass
    selectedChordVoice: YAMAHA_SX920_CHORD_VOICES[0], // 預設 Concert Grand
    isMidiConnected: false,
    midiRoutingMode: 'standard',
    computerAudioMuted: false,
  };

  private drumGrid: DrumStepGrid | null = null;
  private bassRoll: PianoRollLite | null = null;
  private chordRoll: ChordRollLite | null = null;
  private dynamicTracks: Map<string, DynamicChordTrack> = new Map();
  private mixerPanel: MixerPanel | null = null;
  private mutedChannels: Set<string> = new Set();
  private soloChannels: Set<string> = new Set();
  private playbackTimer: any = null;
  private currentPlayStep: number = 0;

  // 多段落狀態記憶庫 (Section Name -> SectionStore)
  private sections: Map<string, SectionStore> = new Map();

  constructor() {
    this.initElements();
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
        (sig) => this.onGlobalTimeSignatureChange(sig),
        (kitId) => this.onDrumKitChange(kitId),
        this.state.selectedDrumKit.id,
        () => this.toggleSoloPlay('drum')
      );
    }

    const bassContainer = document.getElementById('bass-roll-container');
    if (bassContainer) {
      this.bassRoll = new PianoRollLite(
        bassContainer,
        this.state.totalBars,
        () => this.onPatternModified(),
        (note, vel) => this.sendMidiBassTrigger(note, vel),
        (voiceId) => this.onBassVoiceChange(voiceId),
        this.state.selectedBassVoice.id,
        () => this.toggleSoloPlay('bass'),
        () => this.openVoiceSearchModal('bass')
      );
    }

    const chordContainer = document.getElementById('chord-roll-container');
    if (chordContainer) {
      this.chordRoll = new ChordRollLite(
        chordContainer,
        this.state.totalBars,
        () => this.onPatternModified(),
        (note, vel) => this.sendMidiChordTrigger(note, vel),
        (voiceId) => this.onChordVoiceChange(voiceId),
        this.state.selectedChordVoice.id,
        () => this.toggleSoloPlay('chord'),
        () => this.openVoiceSearchModal('chord')
      );
    }

    // 初始化預設 Main A
    this.sections.set('Main A', {
      name: 'Main A',
      bars: 4,
      drumPattern: new Map(),
      bassPattern: new Map(),
      chordPattern: new Map(),
      dynamicPatterns: {},
    });

    // 初始化合成器聲音模型
    chordSynth.setVoice(this.state.selectedChordVoice);
    bassSynth.setVoice(this.state.selectedBassVoice);

    this.updateAddChannelButtonsUI();

    // 初始化視覺化伴奏混音台
    const mixerContainer = document.getElementById('mixer-panel-container');
    if (mixerContainer) {
      this.mixerPanel = new MixerPanel(mixerContainer, {
        onVolumeChange: (id, vol) => this.onMixerVolumeChange(id, vol),
        onPanChange: (id, pan) => this.onMixerPanChange(id, pan),
        onReverbChange: (id, rev) => this.onMixerReverbChange(id, rev),
        onChorusChange: (id, cho) => this.onMixerChorusChange(id, cho),
        onMuteToggle: (id, muted) => this.onMixerMuteToggle(id, muted),
        onSoloToggle: (id, solo) => this.onMixerSoloToggle(id, solo),
        onResetDefaults: () => this.resetMixerToGoldenDefaults(),
        onPanic: () => this.panicMixer(),
        onVisibilityChange: (vis) => this.updateMixerButtonState(vis),
      });
      this.refreshMixerChannels();
    }
  }

  /**
   * 滾動至新增伴奏音軌面板並給予閃爍高亮反饋
   */
  public scrollToAddChannelPanel() {
    const panel = document.getElementById('panel-add-channel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.remove('panel-pulse-highlight');
      void panel.offsetWidth; // 強制重繪
      panel.classList.add('panel-pulse-highlight');
      this.setStatus('💡 請在下方點選要新增的伴奏聲部 (Chord 2, Pad, Phrase 1, Phrase 2)');
    }
  }

  /**
   * 動態新增伴奏音軌 (Chord 2, Pad, Phrase 1, Phrase 2)
   */
  public addDynamicTrack(partId: 'Chord2' | 'Pad' | 'Phrase1' | 'Phrase2') {
    if (this.dynamicTracks.has(partId)) return;

    const dynamicContainer = document.getElementById('dynamic-tracks-container');
    if (!dynamicContainer) return;

    const config = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
    if (!config) return;

    const trackContainer = document.createElement('section');
    trackContainer.id = `track-${partId.toLowerCase()}-container`;
    trackContainer.className = 'sequencer-panel piano-roll-panel';
    dynamicContainer.appendChild(trackContainer);

    const initVoice = YAMAHA_SX920_CHORD_VOICES.find(v => v.id === config.defaultVoiceId) || YAMAHA_SX920_CHORD_VOICES[0];

    const roll = new ChordRollLite(
      trackContainer,
      this.state.totalBars,
      () => this.onPatternModified(),
      (note, vel) => this.sendMidiDynamicTrackTrigger(partId, note, vel),
      (voiceId) => this.onDynamicTrackVoiceChange(partId, voiceId),
      initVoice.id,
      () => this.toggleSoloPlay(partId),
      () => this.openVoiceSearchModal(partId),
      {
        ...config,
        onRemoveTrack: () => this.removeDynamicTrack(partId),
      }
    );

    // 同步當前拍號與網格解析度
    const currentRes = this.drumGrid?.getResolution() || '1/16';
    const currentSig = this.drumGrid?.getTimeSignatureType() || '4/4';
    roll.setResolution(currentRes);
    roll.setTimeSignature(currentSig);

    // 若當前段落記憶庫中有此軌 Pattern，予以還原
    const currentStore = this.sections.get(this.state.currentSection);
    if (currentStore?.dynamicPatterns && currentStore.dynamicPatterns[partId]) {
      roll.setPatternData(currentStore.dynamicPatterns[partId]);
    }

    // 設定原廠黃金配比預設音量、聲相與效果器
    const dynSynth = roll.getSynth();
    if (partId === 'Chord2') {
      dynSynth.setVolume(85);
      dynSynth.setPan(76); // R12
      dynSynth.setReverb(50);
      dynSynth.setChorus(40);
    } else if (partId === 'Pad') {
      dynSynth.setVolume(80);
      dynSynth.setPan(64); // C
      dynSynth.setReverb(75);
      dynSynth.setChorus(50);
    } else if (partId === 'Phrase1') {
      dynSynth.setVolume(85);
      dynSynth.setPan(44); // L20
      dynSynth.setReverb(60);
      dynSynth.setChorus(20);
    } else if (partId === 'Phrase2') {
      dynSynth.setVolume(80);
      dynSynth.setPan(84); // R20
      dynSynth.setReverb(60);
      dynSynth.setChorus(30);
    }

    const dynTrack: DynamicChordTrack = {
      partId,
      container: trackContainer,
      roll,
      selectedVoice: initVoice,
    };
    this.dynamicTracks.set(partId, dynTrack);

    // 若已連線實體琴，同步發送音色切換與混音設定
    if (this.state.isMidiConnected) {
      midiManager.sendVoiceChange(config.channel, {
        msb: initVoice.msb,
        lsb: initVoice.lsb,
        pc: initVoice.pc,
      });
      midiManager.sendMixerControllers(config.channel, {
        volume: dynSynth.getVolume(),
        pan: dynSynth.getPan(),
        reverb: dynSynth.getReverb(),
        chorus: dynSynth.getChorus(),
      });
    }

    this.refreshMixerChannels();
    this.updateAddChannelButtonsUI();
    this.updateSectionSummary();
    this.refreshSectionOptions();

    trackContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.setStatus(`✓ 已啟用【${config.title}】(Channel ${config.panelCh})！預設音色為【${initVoice.name}】。`);
  }

  /**
   * 移除動態伴奏音軌
   */
  public removeDynamicTrack(partId: string) {
    const track = this.dynamicTracks.get(partId);
    if (!track) return;
    const config = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
    const trackTitle = config ? config.title : partId;

    if (track.roll.hasNotes()) {
      const ok = confirm(`確定要移除【${trackTitle}】音軌嗎？\n該軌道目前編寫的音符將會被清除。`);
      if (!ok) return;
    }

    if (this.state.isPlaying && this.state.activePlayTrack === partId) {
      this.pause();
    }

    track.container.remove();
    this.dynamicTracks.delete(partId);
    this.mutedChannels.delete(partId);
    this.soloChannels.delete(partId);
    this.applyMixerAudioStates();
    this.refreshMixerChannels();

    // 同步清空各段落中此音軌的 Pattern
    this.sections.forEach(s => {
      if (s.dynamicPatterns && s.dynamicPatterns[partId]) {
        delete s.dynamicPatterns[partId];
      }
    });

    this.updateAddChannelButtonsUI();
    this.updateSectionSummary();
    this.refreshSectionOptions();
    this.setStatus(`✓ 已移除【${trackTitle}】伴奏音軌。`);
  }

  /**
   * 更新新增聲部按鈕的顯示狀態
   */
  private updateAddChannelButtonsUI() {
    const parts = ['Chord2', 'Pad', 'Phrase1', 'Phrase2'];
    let addedCount = 0;
    for (const p of parts) {
      const btn = document.getElementById(`btn-add-ch-${p.toLowerCase()}`);
      const isAdded = this.dynamicTracks.has(p);
      if (btn) {
        if (isAdded) {
          btn.style.display = 'none';
          addedCount++;
        } else {
          btn.style.display = 'inline-flex';
        }
      }
    }

    const panelNotice = document.getElementById('add-channel-notice');
    if (panelNotice) {
      if (addedCount === parts.length) {
        panelNotice.textContent = '🌟 已啟用 PSR-SX920 全部 8 個伴奏通道 (Ch 9 ~ Ch 16)！';
        panelNotice.style.color = '#38bdf8';
      } else {
        panelNotice.textContent = `PSR-SX920 完整具備 8 個伴奏通道。目前已啟用 ${3 + addedCount}/8 個聲部，點擊按鈕可隨時增減！`;
        panelNotice.style.color = '#94a3b8';
      }
    }
  }

  /**
   * 動態軌道音色切換處理
   */
  private onDynamicTrackVoiceChange(partId: string, voiceId: string) {
    const track = this.dynamicTracks.get(partId);
    if (!track) return;
    const found = YAMAHA_SX920_CHORD_VOICES.find(c => c.id === voiceId);
    if (found) {
      track.selectedVoice = found;
      track.roll.getSynth().setVoice(found);
      this.mixerPanel?.updateVoiceName(partId, found.name);
      const config = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
      if (this.state.isMidiConnected && config) {
        midiManager.sendVoiceChange(config.channel, {
          msb: found.msb,
          lsb: found.lsb,
          pc: found.pc,
        });
      }
      this.setStatus(`✓ 已切換【${config?.title || partId}】音色為【${found.name}】(琴端: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
    }
  }

  /**
   * 發送動態伴奏音軌的 Web MIDI 音符觸發
   */
  private sendMidiDynamicTrackTrigger(partId: string, note: number, velocity: number = 100, durMs: number = 350) {
    if (this.isChannelEffectiveMuted(partId)) return;
    if (this.state.isMidiConnected) {
      const config = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
      if (config) {
        const ch = this.state.midiRoutingMode === 'direct_ch1' ? 0 : config.channel;
        midiManager.sendNoteOn(ch, note, velocity);
        setTimeout(() => {
          midiManager.sendNoteOff(ch, note);
        }, durMs);
      }
    }
  }

  /**
   * 鼓組切換處理
   */
  private onDrumKitChange(kitId: string) {
    const found = YAMAHA_SX920_DRUM_KITS.find(k => k.id === kitId);
    if (found) {
      this.state.selectedDrumKit = found;
      this.syncDrumKitToKeyboard();
      this.mixerPanel?.updateVoiceName('drum', found.name);
      this.setStatus(`✓ 已切換鼓組【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
    }
  }

  /**
   * 貝斯音色切換處理
   */
  private onBassVoiceChange(voiceId: string) {
    const found = YAMAHA_SX920_BASS_VOICES.find(b => b.id === voiceId);
    if (found) {
      this.state.selectedBassVoice = found;
      bassSynth.setVoice(found);
      this.syncBassVoiceToKeyboard();
      this.mixerPanel?.updateVoiceName('bass', found.name);
      this.setStatus(`✓ 已切換貝斯【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
    }
  }

  /**
   * 和弦音色切換處理
   */
  private onChordVoiceChange(voiceId: string) {
    const found = YAMAHA_SX920_CHORD_VOICES.find(c => c.id === voiceId);
    if (found) {
      this.state.selectedChordVoice = found;
      chordSynth.setVoice(found);
      this.syncChordVoiceToKeyboard();
      this.mixerPanel?.updateVoiceName('chord', found.name);
      this.setStatus(`✓ 已切換和弦【${found.name}】(琴端代碼: PC ${found.panelPc}, Bank ${found.msb}-${found.lsb})`);
    }
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
      let hasDynamic = false;
      for (const track of this.dynamicTracks.values()) {
        if (track.roll.hasNotes()) {
          hasDynamic = true;
          break;
        }
      }
      return (
        (this.drumGrid?.hasNotes() ?? false) ||
        (this.bassRoll?.hasNotes() ?? false) ||
        (this.chordRoll?.hasNotes() ?? false) ||
        hasDynamic
      );
    }
    const store = this.sections.get(secName);
    if (!store) return false;
    let hasDrums = false;
    store.drumPattern.forEach(arr => {
      if (arr.some(b => b)) hasDrums = true;
    });
    const hasBass = store.bassPattern.size > 0;
    let hasChord = false;
    if (store.chordPattern) {
      for (const set of store.chordPattern.values()) {
        if (set && set.size > 0) {
          hasChord = true;
          break;
        }
      }
    }
    let hasDynamic = false;
    if (store.dynamicPatterns) {
      for (const pat of Object.values(store.dynamicPatterns)) {
        for (const set of pat.values()) {
          if (set && set.size > 0) {
            hasDynamic = true;
            break;
          }
        }
        if (hasDynamic) break;
      }
    }
    return hasDrums || hasBass || hasChord || hasDynamic;
  }

  /**
   * 將當前畫面的鼓、貝斯與和弦 Pattern 存入 Store
   */
  private saveCurrentSectionToStore() {
    if (!this.drumGrid || !this.bassRoll || !this.chordRoll) return;

    const dynamicPatterns: Record<string, Map<number, Set<number>>> = {};
    this.dynamicTracks.forEach((track, partId) => {
      dynamicPatterns[partId] = track.roll.getPatternData();
    });

    this.sections.set(this.state.currentSection, {
      name: this.state.currentSection,
      bars: this.state.totalBars,
      drumPattern: this.drumGrid.getPatternData(),
      bassPattern: this.bassRoll.getPatternData(),
      chordPattern: this.chordRoll.getPatternData(),
      dynamicPatterns,
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
        chordPattern: new Map(),
        dynamicPatterns: {},
      };
      this.sections.set(newSectionName, store);
    }

    // 4. 同步更新小節數與網格
    this.state.totalBars = store.bars;
    const selectBars = document.getElementById('select-bars') as HTMLSelectElement | null;
    if (selectBars) selectBars.value = store.bars.toString();

    this.drumGrid?.setTotalBars(store.bars);
    this.bassRoll?.setTotalBars(store.bars);
    this.chordRoll?.setTotalBars(store.bars);

    this.drumGrid?.setPatternData(store.drumPattern);
    this.bassRoll?.setPatternData(store.bassPattern);
    this.chordRoll?.setPatternData(store.chordPattern || new Map());

    // 同步更新所有已啟用的動態伴奏音軌
    this.dynamicTracks.forEach((track, partId) => {
      track.roll.setTotalBars(store.bars);
      const pat = store.dynamicPatterns?.[partId] || new Map();
      track.roll.setPatternData(pat);
    });

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

  private currentVoiceSearchTarget: string = 'chord';

  public openVoiceSearchModal(target: string) {
    this.currentVoiceSearchTarget = target;
    const modal = document.getElementById('modal-voice-search');
    const input = document.getElementById('input-voice-search-keyword') as HTMLInputElement | null;
    const catSelect = document.getElementById('select-voice-search-category') as HTMLSelectElement | null;
    const title = modal?.querySelector('h3') as HTMLElement | null;

    if (!modal) return;

    if (title) {
      if (target === 'chord') {
        title.innerHTML = '<span>🔍</span> 伴奏和弦 (Chord 1 / Ch 12) - Yamaha SX920 原廠 2,300+ 音色資料庫檢索';
      } else if (target === 'bass') {
        title.innerHTML = '<span>🔍</span> 伴奏貝斯 (Bass / Ch 11) - Yamaha SX920 原廠 2,300+ 音色資料庫檢索';
      } else {
        const dynCfg = AVAILABLE_CHORD_TRACK_CONFIGS[target];
        title.innerHTML = `<span>🔍</span> ${dynCfg?.title || target} (Ch ${dynCfg?.panelCh || ''}) - Yamaha SX920 原廠 2,300+ 音色資料庫檢索`;
      }
    }

    if (input) {
      input.value = '';
    }

    if (catSelect) {
      if (target === 'bass') catSelect.value = 'Bass';
      else if (target === 'Pad') catSelect.value = 'Pad';
      else if (target === 'Phrase1' || target === 'Phrase2') catSelect.value = 'Brass';
      else catSelect.value = 'ALL';
    }

    modal.style.display = 'flex';
    input?.focus();
    this.renderVoiceSearchResults();
  }

  public closeVoiceSearchModal() {
    const modal = document.getElementById('modal-voice-search');
    if (modal) modal.style.display = 'none';
  }

  private renderVoiceSearchResults() {
    const input = document.getElementById('input-voice-search-keyword') as HTMLInputElement | null;
    const catSelect = document.getElementById('select-voice-search-category') as HTMLSelectElement | null;
    const list = document.getElementById('voice-search-results-list');
    if (!list) return;

    const keyword = input?.value.trim() || '';
    const category = (catSelect?.value || 'ALL') as VoiceCategory | 'ALL';

    const results = searchYamahaVoices(keyword, category, 'ALL');
    list.innerHTML = '';

    if (results.length === 0) {
      list.innerHTML = `
        <div style="padding: 32px 16px; text-align: center; color: #94a3b8; font-size: 0.9rem;">
          🔍 找不到符合「${keyword}」的音色，請嘗試更簡短的關鍵字（如 CFX, Strum, Clean, Sax, Bass）或切換分類。
        </div>
      `;
      return;
    }

    // 限制顯示前 80 筆提升渲染流暢度
    const displayLimit = 80;
    const toRender = results.slice(0, displayLimit);

    const headerInfo = document.createElement('div');
    headerInfo.style.cssText = 'padding: 4px 6px; font-size: 0.78rem; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 4px;';
    headerInfo.innerHTML = `
      <span>共找到 <strong style="color: #38bdf8;">${results.length}</strong> 個原廠音色</span>
      ${results.length > displayLimit ? `<span style="color: #f59e0b;">(僅顯示前 ${displayLimit} 筆，請輸入關鍵字縮小範圍)</span>` : ''}
    `;
    list.appendChild(headerInfo);

    toRender.forEach(v => {
      const item = document.createElement('div');
      item.className = 'voice-picker-item';
      item.style.cursor = 'pointer';

      let typeBadge = '';
      if (v.type && v.type !== 'Standard' && v.type !== 'Legacy') {
        typeBadge = `<span style="font-size: 0.68rem; padding: 1px 5px; border-radius: 3px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 700;">${v.type}</span>`;
      }

      const icon = this.getVoiceCategoryIcon(v.category);
      let isSelected = false;
      if (this.currentVoiceSearchTarget === 'chord') {
        isSelected = (this.state.selectedChordVoice.msb === v.msb && this.state.selectedChordVoice.lsb === v.lsb && this.state.selectedChordVoice.pc === v.pc);
      } else if (this.currentVoiceSearchTarget === 'bass') {
        isSelected = (this.state.selectedBassVoice.msb === v.msb && this.state.selectedBassVoice.lsb === v.lsb && this.state.selectedBassVoice.pc === v.pc);
      } else {
        const dynTrack = this.dynamicTracks.get(this.currentVoiceSearchTarget);
        if (dynTrack) {
          isSelected = (dynTrack.selectedVoice.msb === v.msb && dynTrack.selectedVoice.lsb === v.lsb && dynTrack.selectedVoice.pc === v.pc);
        }
      }

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <span style="font-size: 1.3rem;">${icon}</span>
          <div style="min-width: 0; display: flex; flex-direction: column; gap: 2px;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-weight: 600; color: ${isSelected ? '#38bdf8' : '#f1f5f9'}; font-size: 0.88rem;">${v.name}</span>
              ${typeBadge}
              ${v.chineseName ? `<span style="font-size: 0.76rem; color: #94a3b8;">${v.chineseName}</span>` : ''}
            </div>
            <div style="font-size: 0.73rem; color: #64748b; display: flex; gap: 10px;">
              <span>琴端 PC: <strong style="color: #cbd5e1;">${v.pc + 1}</strong></span>
              <span>Bank: <strong style="color: #cbd5e1;">${v.msb}-${v.lsb}</strong></span>
              <span>類別: ${v.category}</span>
            </div>
          </div>
        </div>
        <button class="btn-picker-add" style="margin-left: 8px; font-size: 0.8rem; padding: 4px 10px; white-space: nowrap;">
          ${isSelected ? '已選用 ✓' : '套用'}
        </button>
      `;

      item.addEventListener('click', () => {
        this.applyVoiceSearchResult(v);
      });

      list.appendChild(item);
    });
  }

  private getVoiceCategoryIcon(cat: string): string {
    switch (cat) {
      case 'Piano': return '🎹';
      case 'E.Piano': return '⚡';
      case 'Guitar': return '🎸';
      case 'Bass': return '🎸';
      case 'Strings': return '🎻';
      case 'Brass': return '🎺';
      case 'Saxophone': return '🎷';
      case 'Organ': return '🎼';
      case 'Accordion': return '🪗';
      case 'Pad': return '🌌';
      case 'Choir': return '👥';
      case 'Synth': return '🎛️';
      case 'Woodwind': return '🪈';
      default: return '🎵';
    }
  }

  private applyVoiceSearchResult(voice: YamahaVoice) {
    if (this.currentVoiceSearchTarget === 'chord') {
      const id = `voice-${voice.msb}-${voice.lsb}-${voice.pc}`;
      let preset = YAMAHA_SX920_CHORD_VOICES.find(c => c.msb === voice.msb && c.lsb === voice.lsb && c.pc === voice.pc);
      if (!preset) {
        preset = {
          id,
          name: voice.chineseName ? `${voice.name} (${voice.chineseName})` : voice.name,
          panelPc: voice.pc + 1,
          pc: voice.pc,
          msb: voice.msb,
          lsb: voice.lsb,
          icon: this.getVoiceCategoryIcon(voice.category),
          category: (['Piano', 'E.Piano', 'Guitar', 'Strings', 'Brass', 'Saxophone', 'Organ', 'Accordion', 'Pad', 'Choir', 'Synth'].includes(voice.category) ? voice.category : 'Synth') as any,
          categoryLabel: `🔍 自選 / ${voice.category}`,
          description: voice.chineseName || voice.name,
        };
        YAMAHA_SX920_CHORD_VOICES.push(preset);
      }
      this.state.selectedChordVoice = preset;
      chordSynth.setVoice(preset);
      this.chordRoll?.setVoice(preset);
      this.syncChordVoiceToKeyboard();
      this.mixerPanel?.updateVoiceName('chord', preset.name);
      this.setStatus(`✓ 已自音色庫套用和弦音色【${preset.name}】(琴端: PC ${preset.panelPc}, Bank ${preset.msb}-${preset.lsb})`);
    } else if (this.currentVoiceSearchTarget === 'bass') {
      const id = `voice-${voice.msb}-${voice.lsb}-${voice.pc}`;
      let preset = YAMAHA_SX920_BASS_VOICES.find(b => b.msb === voice.msb && b.lsb === voice.lsb && b.pc === voice.pc);
      if (!preset) {
        const cat = (voice.category === 'Synth' ? 'Synth' : (voice.name.toLowerCase().includes('acoustic') || voice.name.toLowerCase().includes('upright')) ? 'Acoustic' : 'Electric') as any;
        preset = {
          id,
          name: voice.chineseName ? `${voice.name} (${voice.chineseName})` : voice.name,
          panelPc: voice.pc + 1,
          pc: voice.pc,
          msb: voice.msb,
          lsb: voice.lsb,
          icon: '🎸',
          category: cat,
          description: voice.chineseName || voice.name,
        };
        YAMAHA_SX920_BASS_VOICES.push(preset);
      }
      this.state.selectedBassVoice = preset;
      bassSynth.setVoice(preset);
      this.bassRoll?.setVoice(preset);
      this.syncBassVoiceToKeyboard();
      this.mixerPanel?.updateVoiceName('bass', preset.name);
      this.setStatus(`✓ 已自音色庫套用貝斯音色【${preset.name}】(琴端: PC ${preset.panelPc}, Bank ${preset.msb}-${preset.lsb})`);
    } else {
      const id = `voice-${voice.msb}-${voice.lsb}-${voice.pc}`;
      let preset = YAMAHA_SX920_CHORD_VOICES.find(c => c.msb === voice.msb && c.lsb === voice.lsb && c.pc === voice.pc);
      if (!preset) {
        preset = {
          id,
          name: voice.chineseName ? `${voice.name} (${voice.chineseName})` : voice.name,
          panelPc: voice.pc + 1,
          pc: voice.pc,
          msb: voice.msb,
          lsb: voice.lsb,
          icon: this.getVoiceCategoryIcon(voice.category),
          category: (['Piano', 'E.Piano', 'Guitar', 'Strings', 'Brass', 'Saxophone', 'Organ', 'Accordion', 'Pad', 'Choir', 'Synth'].includes(voice.category) ? voice.category : 'Synth') as any,
          categoryLabel: `🔍 自選 / ${voice.category}`,
          description: voice.chineseName || voice.name,
        };
        YAMAHA_SX920_CHORD_VOICES.push(preset);
      }
      const dynTrack = this.dynamicTracks.get(this.currentVoiceSearchTarget);
      if (dynTrack) {
        dynTrack.selectedVoice = preset;
        dynTrack.roll.getSynth().setVoice(preset);
        dynTrack.roll.setVoice(preset);
        this.mixerPanel?.updateVoiceName(this.currentVoiceSearchTarget, preset.name);
        const config = AVAILABLE_CHORD_TRACK_CONFIGS[this.currentVoiceSearchTarget];
        if (this.state.isMidiConnected && config) {
          midiManager.sendVoiceChange(config.channel, {
            msb: preset.msb,
            lsb: preset.lsb,
            pc: preset.pc,
          });
        }
        this.setStatus(`✓ 已自音色庫套用【${config?.title || this.currentVoiceSearchTarget}】音色【${preset.name}】(琴端: PC ${preset.panelPc}, Bank ${preset.msb}-${preset.lsb})`);
      }
    }

    this.closeVoiceSearchModal();
  }

  /**
   * 複製當前段落的鼓組、貝斯與和弦至目標段落
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

    // 複製和弦
    const chordCopy = new Map<number, Set<number>>();
    if (currentStore.chordPattern) {
      currentStore.chordPattern.forEach((set, k) => chordCopy.set(k, new Set(set)));
    }

    // 複製動態音軌
    const dynamicCopies: Record<string, Map<number, Set<number>>> = {};
    if (currentStore.dynamicPatterns) {
      for (const [partId, pat] of Object.entries(currentStore.dynamicPatterns)) {
        const copyMap = new Map<number, Set<number>>();
        pat.forEach((notes, step) => copyMap.set(step, new Set(notes)));
        dynamicCopies[partId] = copyMap;
      }
    }

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
      chordPattern: chordCopy,
      dynamicPatterns: dynamicCopies,
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
   * 當使用者切換網格解析度 (1/16 vs 1/8) 時，全曲（鼓組、貝斯、和弦與所有聲部）同步更新
   */
  private onGlobalResolutionChange(res: import('./drum-step-grid').GridResolution) {
    this.bassRoll?.setResolution(res);
    this.chordRoll?.setResolution(res);
    this.dynamicTracks.forEach(t => t.roll.setResolution(res));
    if (this.state.isPlaying) {
      this.restartPlaybackTimer();
    }
    this.saveCurrentSectionToStore();
    this.setStatus(`✓ 全曲（鼓組、貝斯、和弦與所有聲部）網格解析度已同步切換為【${res === '1/16' ? '1/16 (16分音符，細緻)' : '1/8 (8分音符，簡潔)'}】`);
  }

  /**
   * 當使用者切換拍號 (4/4, 3/4, 6/8) 時，全曲（鼓組、貝斯、和弦與所有聲部）同步更新
   */
  private onGlobalTimeSignatureChange(sig: import('./drum-step-grid').TimeSignatureType) {
    this.bassRoll?.setTimeSignature(sig);
    this.chordRoll?.setTimeSignature(sig);
    this.dynamicTracks.forEach(t => t.roll.setTimeSignature(sig));
    if (this.state.isPlaying) {
      this.restartPlaybackTimer();
    }
    this.saveCurrentSectionToStore();
    this.setStatus(`✓ 全曲（鼓組、貝斯、和弦與所有聲部）拍號已同步切換為【${sig} 拍】`);
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
      btnMidi?.setAttribute('title', `已連線實體琴 [${outputDevice.name}]，點擊可開啟發聲設定與通道診斷`);
      // 當實體琴連線時，預設自動將電腦 Web Audio 發聲靜音，純由琴端喇叭發聲，避免重音延遲
      if (!this.state.computerAudioMuted) {
        this.setComputerAudioMute(true);
      }
      midiManager.wakeUpAllChannels();
      this.syncDrumKitToKeyboard();
      this.syncBassVoiceToKeyboard();
      this.syncChordVoiceToKeyboard();
      this.dynamicTracks.forEach((t, partId) => {
        const config = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
        if (config) {
          midiManager.sendVoiceChange(config.channel, {
            msb: t.selectedVoice.msb,
            lsb: t.selectedVoice.lsb,
            pc: t.selectedVoice.pc,
          });
        }
      });
      this.syncMixerControllersToKeyboard();
      this.setStatus(`✓ 已連線 PSR-SX920 [${outputDevice.name}]，鼓點、貝斯、和弦與所有聲部將同步直接由琴端喇叭發聲！`);
    } else {
      this.state.isMidiConnected = false;
      btnMidi?.classList.remove('connected');
      if (labelMidi) {
        labelMidi.textContent = '🎹 琴端發聲: 未連線 (點擊重試)';
      }
      btnMidi?.setAttribute('title', '請以 USB 線連接 PSR-SX920 與電腦，並點擊此處嘗試連線');
      // 實體琴未連線時，自動恢復電腦端發聲
      if (this.state.computerAudioMuted) {
        this.setComputerAudioMute(false);
      }
    }
  }

  private setComputerAudioMute(muted: boolean) {
    this.state.computerAudioMuted = muted;
    setComputerAudioMuted(muted);
    this.updateComputerAudioUI();
  }

  private toggleComputerAudioMute() {
    this.setComputerAudioMute(!this.state.computerAudioMuted);
    if (this.state.computerAudioMuted) {
      this.setStatus('🔇 電腦端發聲已靜音（聲音純由 PSR-SX920 琴端喇叭輸出，零回音）');
    } else {
      this.setStatus('🔊 電腦端發聲已開啟（電腦喇叭與 PSR-SX920 琴端同時發聲）');
    }
  }

  private updateComputerAudioUI() {
    const btn = document.getElementById('btn-toggle-computer-audio');
    const label = document.getElementById('label-computer-audio');
    const modalBtn = document.getElementById('btn-modal-toggle-pc-audio');
    const modalDesc = document.getElementById('modal-pc-audio-desc');

    if (this.state.computerAudioMuted) {
      if (btn) {
        btn.classList.add('muted-active');
        btn.setAttribute('title', '電腦 Web Audio 目前已靜音（由 PSR-SX920 琴端發聲）。點擊可切換為雙重發聲。');
      }
      if (label) {
        label.textContent = '電腦: 🔇 已靜音 (琴端發聲)';
      }
      if (modalBtn) {
        modalBtn.textContent = '🔇 電腦目前已靜音 (由琴端發聲)';
        modalBtn.style.color = '#38bdf8';
        modalBtn.style.borderColor = '#38bdf8';
      }
      if (modalDesc) {
        modalDesc.textContent = '✓ 電腦 Web Audio 已自動靜音，所有音效均由 PSR-SX920 琴端高傳真喇叭輸出，完美避免雙重發聲延遲！';
      }
    } else {
      if (btn) {
        btn.classList.remove('muted-active');
        btn.setAttribute('title', '電腦 Web Audio 目前發聲中。點擊可切換靜音（純由 PSR-SX920 發聲）。');
      }
      if (label) {
        label.textContent = '電腦: 🔊 發聲中';
      }
      if (modalBtn) {
        modalBtn.textContent = '🔊 電腦目前發聲中 (雙重發聲)';
        modalBtn.style.color = '#34d399';
        modalBtn.style.borderColor = '#34d399';
      }
      if (modalDesc) {
        modalDesc.textContent = '電腦喇叭與實體琴同時發聲中（若聽到回音或重音，請點擊右側按鈕靜音電腦）。';
      }
    }
  }

  private openMidiSettingsModal() {
    const modal = document.getElementById('modal-midi-settings');
    if (!modal) return;
    this.populateMidiOutputSelect();

    const radios = document.querySelectorAll<HTMLInputElement>('input[name="radio-midi-routing"]');
    radios.forEach(r => {
      r.checked = (r.value === this.state.midiRoutingMode);
    });

    modal.style.display = 'flex';
  }

  private closeMidiSettingsModal() {
    const modal = document.getElementById('modal-midi-settings');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  private populateMidiOutputSelect() {
    const select = document.getElementById('select-midi-output-device') as HTMLSelectElement | null;
    if (!select) return;

    const outputs = midiManager.getAvailableOutputs();
    const current = midiManager.getSelectedOutput();
    select.innerHTML = '';

    if (outputs.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '未偵測到 MIDI 輸出埠口 (請確認 USB 線已連接琴端)';
      select.appendChild(opt);
      select.disabled = true;
    } else {
      select.disabled = false;
      outputs.forEach(port => {
        const opt = document.createElement('option');
        opt.value = port.id;
        opt.textContent = port.name ? `${port.name} (${port.id})` : `MIDI 設備 (${port.id})`;
        if (current && current.id === port.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
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

  private syncChordVoiceToKeyboard() {
    if (this.state.isMidiConnected) {
      const chord = this.state.selectedChordVoice;
      midiManager.sendVoiceChange(11, {
        msb: chord.msb,
        lsb: chord.lsb,
        pc: chord.pc,
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

  private triggerChordSound(note: number, velocity: number = 100, durMs: number = 350) {
    chordSynth.playNote(note, velocity, durMs);
    this.sendMidiChordTrigger(note, velocity, durMs);
  }

  private sendMidiDrumTrigger(note: number, velocity: number = 100, durMs: number = 80) {
    if (this.isChannelEffectiveMuted('drum')) return;
    if (this.state.isMidiConnected) {
      const ch = this.state.midiRoutingMode === 'direct_ch1' ? 0 : 9;
      midiManager.sendNoteOn(ch, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(ch, note);
      }, durMs);
    }
  }

  private sendMidiBassTrigger(note: number, velocity: number = 100, durMs: number = 240) {
    if (this.isChannelEffectiveMuted('bass')) return;
    if (this.state.isMidiConnected) {
      const ch = this.state.midiRoutingMode === 'direct_ch1' ? 0 : 10;
      midiManager.sendNoteOn(ch, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(ch, note);
      }, durMs);
    }
  }

  private sendMidiChordTrigger(note: number, velocity: number = 100, durMs: number = 350) {
    if (this.isChannelEffectiveMuted('chord')) return;
    if (this.state.isMidiConnected) {
      const ch = this.state.midiRoutingMode === 'direct_ch1' ? 0 : 11;
      midiManager.sendNoteOn(ch, note, velocity);
      setTimeout(() => {
        midiManager.sendNoteOff(ch, note);
      }, durMs);
    }
  }

  private onPatternModified() {
    this.saveCurrentSectionToStore();
    this.refreshSectionOptions();
    this.updateSectionSummary();

    const hasDrum = this.drumGrid?.hasNotes() ?? false;
    const hasBass = this.bassRoll?.hasNotes() ?? false;
    const hasChord = this.chordRoll?.hasNotes() ?? false;
    let hasDynamic = false;
    for (const track of this.dynamicTracks.values()) {
      if (track.roll.hasNotes()) {
        hasDynamic = true;
        break;
      }
    }

    if (hasDrum || hasBass || hasChord || hasDynamic) {
      const activePartNames: string[] = [];
      if (hasDrum) activePartNames.push('鼓組');
      if (hasBass) activePartNames.push('貝斯');
      if (hasChord) activePartNames.push('和弦 1');
      this.dynamicTracks.forEach((t, partId) => {
        if (t.roll.hasNotes()) {
          const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
          activePartNames.push(cfg?.title || partId);
        }
      });
      this.setStatus(`【${this.state.currentSection}】已更新 (包含音符聲部: ${activePartNames.join(', ')})，可點擊【全部播放】試聽！`);
    } else {
      this.setStatus(`【${this.state.currentSection}】空白。請在上方安排鼓點，或在下方安排貝斯與和弦。`);
    }
  }

  private bindEvents() {
    const btnSty = document.getElementById('btn-mode-sty') as HTMLButtonElement | null;
    const btnPad = document.getElementById('btn-mode-pad') as HTMLButtonElement | null;

    btnSty?.addEventListener('click', () => this.setMode('STY'));
    btnPad?.addEventListener('click', () => this.setMode('PAD'));

    const btnMidi = document.getElementById('btn-midi-connect');
    btnMidi?.addEventListener('click', async () => {
      if (!midiManager.isSupported()) {
        alert('您的瀏覽器不支援 Web MIDI API，建議使用 Google Chrome 或 Microsoft Edge。');
        return;
      }
      try {
        await midiManager.requestAccess();
        this.updateMidiUIState();
      } catch (err) {
        console.warn('MIDI 存取授權失敗:', err);
      }
      this.openMidiSettingsModal();
    });

    // MIDI 設定與診斷彈窗控制
    document.getElementById('btn-close-midi-modal')?.addEventListener('click', () => {
      this.closeMidiSettingsModal();
    });
    document.getElementById('btn-close-midi-modal-bottom')?.addEventListener('click', () => {
      this.closeMidiSettingsModal();
    });
    document.getElementById('modal-midi-settings')?.addEventListener('click', (e) => {
      if (e.target === document.getElementById('modal-midi-settings')) {
        this.closeMidiSettingsModal();
      }
    });

    const selectMidiDevice = document.getElementById('select-midi-output-device') as HTMLSelectElement | null;
    selectMidiDevice?.addEventListener('change', () => {
      const val = selectMidiDevice.value;
      if (val) {
        midiManager.selectOutput(val);
        this.updateMidiUIState();
      }
    });

    document.getElementById('btn-reconnect-midi')?.addEventListener('click', async () => {
      this.setStatus('正在重新掃描 USB MIDI 設備...');
      await midiManager.requestAccess();
      this.populateMidiOutputSelect();
      this.updateMidiUIState();
      this.setStatus('✓ 已重新整理 MIDI 設備清單！');
    });

    document.getElementById('btn-test-ch1-piano')?.addEventListener('click', () => {
      midiManager.playTestChime(0);
      this.setStatus('🔔 已向 PSR-SX920 發送 Ch 1 大鋼琴測試琶音 (CC7=115, CC11=127)');
    });
    document.getElementById('btn-test-ch10-drums')?.addEventListener('click', () => {
      midiManager.playTestDrums(9);
      this.setStatus('🥁 已向 PSR-SX920 發送 Ch 10 標準鼓組節奏測試音 (CC7=115, CC11=127)');
    });
    document.getElementById('btn-test-ch11-bass')?.addEventListener('click', () => {
      midiManager.playTestBass(10);
      this.setStatus('🎸 已向 PSR-SX920 發送 Ch 11 貝斯低音測試音 (CC7=115, CC11=127)');
    });
    document.getElementById('btn-test-ch12-chord')?.addEventListener('click', () => {
      midiManager.playTestChord(11);
      this.setStatus('🎹 已向 PSR-SX920 發送 Ch 12 和弦試聽測試音 (CC7=115, CC11=127)');
    });

    const routingRadios = document.querySelectorAll<HTMLInputElement>('input[name="radio-midi-routing"]');
    routingRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          this.state.midiRoutingMode = radio.value as 'standard' | 'direct_ch1';
          if (this.state.midiRoutingMode === 'direct_ch1') {
            this.setStatus('✓ 已啟用【直通主聲部模式 (Direct to Ch 1)】：所有聲部強制映射至 Channel 1，琴端無需調整設定即可發聲！');
          } else {
            this.setStatus('✓ 已啟用【標準伴奏 8 通道模式】：鼓(Ch10)、貝斯(Ch11)、和弦(Ch12...)獨立多軌發聲。');
          }
        }
      });
    });

    // 電腦端 Web Audio 靜音/發聲切換按鈕 (頂部欄與彈窗)
    document.getElementById('btn-toggle-computer-audio')?.addEventListener('click', () => {
      this.toggleComputerAudioMute();
    });
    document.getElementById('btn-modal-toggle-pc-audio')?.addEventListener('click', () => {
      this.toggleComputerAudioMute();
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
        this.chordRoll?.setTotalBars(val);
        this.dynamicTracks.forEach(t => t.roll.setTotalBars(val));
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

    // 快捷跳轉至新增聲部操作區
    document.getElementById('btn-quick-add-track-nav')?.addEventListener('click', () => {
      this.scrollToAddChannelPanel();
    });

    // 視覺化混音台開關按鈕
    const btnToggleMixer = document.getElementById('btn-toggle-mixer');
    btnToggleMixer?.addEventListener('click', () => {
      if (this.mixerPanel) {
        const isVis = this.mixerPanel.toggle();
        if (isVis) {
          document.getElementById('mixer-panel-container')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          this.setStatus('🎛️ 混音台已開啟：可直接推動直立推桿調整各聲部音量與立體聲聲相');
        } else {
          this.setStatus('混音台已收合。');
        }
      }
    });

    // 動態新增伴奏聲部按鈕 (Chord 2, Pad, Phrase 1, Phrase 2)
    document.getElementById('btn-add-ch-chord2')?.addEventListener('click', () => {
      this.addDynamicTrack('Chord2');
    });
    document.getElementById('btn-add-ch-pad')?.addEventListener('click', () => {
      this.addDynamicTrack('Pad');
    });
    document.getElementById('btn-add-ch-phrase1')?.addEventListener('click', () => {
      this.addDynamicTrack('Phrase1');
    });
    document.getElementById('btn-add-ch-phrase2')?.addEventListener('click', () => {
      this.addDynamicTrack('Phrase2');
    });

    // 原廠音色資料庫搜尋彈窗事件
    const btnCloseVoiceSearch = document.getElementById('btn-close-voice-search');
    btnCloseVoiceSearch?.addEventListener('click', () => {
      this.closeVoiceSearchModal();
    });

    const modalVoiceSearch = document.getElementById('modal-voice-search');
    modalVoiceSearch?.addEventListener('click', (e) => {
      if (e.target === modalVoiceSearch) {
        this.closeVoiceSearchModal();
      }
    });

    const inputVoiceKeyword = document.getElementById('input-voice-search-keyword');
    inputVoiceKeyword?.addEventListener('input', () => {
      this.renderVoiceSearchResults();
    });

    const selectVoiceCategory = document.getElementById('select-voice-search-category');
    selectVoiceCategory?.addEventListener('change', () => {
      this.renderVoiceSearchResults();
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

  public toggleSoloPlay(track: string) {
    if (this.state.isPlaying && this.state.activePlayTrack === track) {
      this.pause();
    } else {
      this.play(track);
    }
  }

  private togglePlay() {
    if (this.state.isPlaying && this.state.activePlayTrack === 'all') {
      this.pause();
    } else {
      this.play('all');
    }
  }

  private play(track: string = 'all') {
    this.state.isPlaying = true;
    this.state.activePlayTrack = track;
    this.updatePlayButtonsUI();

    const midiMsg = this.state.isMidiConnected ? ' (琴端同步發聲中)' : '';
    let trackName = '全曲聲部';
    if (track === 'drum') trackName = '鼓組 (Solo)';
    else if (track === 'bass') trackName = '貝斯 (Solo)';
    else if (track === 'chord') trackName = '和弦 1 (Solo)';
    else if (this.dynamicTracks.has(track)) {
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[track];
      trackName = `${cfg?.title || track} (Solo)`;
    }

    this.setStatus(`▶ 正在播放【${this.state.currentSection}】${trackName} (${this.state.bpm} BPM)${midiMsg}...`);
    this.startPlaybackTimer();
  }

  private pause() {
    this.state.isPlaying = false;
    this.stopPlaybackTimer();
    this.updatePlayButtonsUI();
    this.setStatus('已暫停。再次點擊【播放】從暫停點繼續。');
  }

  private stop() {
    this.state.isPlaying = false;
    this.state.activePlayTrack = null;
    this.stopPlaybackTimer();
    this.currentPlayStep = 0;
    this.drumGrid?.setPlayheadStep(null);
    this.bassRoll?.setPlayheadStep(null);
    this.chordRoll?.setPlayheadStep(null);
    this.dynamicTracks.forEach(t => t.roll.setPlayheadStep(null));
    this.updatePlayButtonsUI();
    this.setStatus('⏹ 已停止。回到第 1 小節起點。');
  }

  private updatePlayButtonsUI() {
    const isPlaying = this.state.isPlaying;
    const track = this.state.activePlayTrack;

    // 頂部全部播放按鈕
    const btnPlay = document.getElementById('btn-play-toggle');
    if (btnPlay) {
      if (isPlaying && track === 'all') {
        btnPlay.innerHTML = '<span>⏸</span> 暫停全部';
        btnPlay.style.background = '#f59e0b';
      } else {
        btnPlay.innerHTML = '<span>▶</span> 全部播放';
        btnPlay.style.background = 'var(--accent-green)';
      }
    }

    // 軌道獨立播放按鈕狀態
    this.drumGrid?.setSoloPlayState(isPlaying && track === 'drum');
    this.bassRoll?.setSoloPlayState(isPlaying && track === 'bass');
    this.chordRoll?.setSoloPlayState(isPlaying && track === 'chord');
    this.dynamicTracks.forEach((t, partId) => {
      t.roll.setSoloPlayState(isPlaying && track === partId);
    });
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

      const playTrack = this.state.activePlayTrack;
      const playDrum = playTrack === 'all' || playTrack === 'drum';
      const playBass = playTrack === 'all' || playTrack === 'bass';
      const playChord = playTrack === 'all' || playTrack === 'chord';

      this.drumGrid?.setPlayheadStep(playDrum ? this.currentPlayStep : null);
      this.bassRoll?.setPlayheadStep(playBass ? this.currentPlayStep : null);
      this.chordRoll?.setPlayheadStep(playChord ? this.currentPlayStep : null);

      this.dynamicTracks.forEach((t, partId) => {
        const playThis = playTrack === 'all' || playTrack === partId;
        t.roll.setPlayheadStep(playThis ? this.currentPlayStep : null);
        if (playThis) {
          const notes = t.roll.getActiveNotesAtStep(this.currentPlayStep);
          for (const note of notes) {
            t.roll.getSynth().playNote(note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
            this.sendMidiDynamicTrackTrigger(partId, note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
          }
        }
      });

      if (playDrum) {
        const drumNotes = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of drumNotes) {
          this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
        }
      }

      if (playBass) {
        const bassNotes = this.bassRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of bassNotes) {
          this.triggerBassSound(note, 100, Math.max(80, Math.round(stepIntervalMs * 1.5)));
        }
      }

      if (playChord) {
        const chordNotes = this.chordRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
        for (const note of chordNotes) {
          this.triggerChordSound(note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
        }
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

        const playTrack = this.state.activePlayTrack;
        const playDrum = playTrack === 'all' || playTrack === 'drum';
        const playBass = playTrack === 'all' || playTrack === 'bass';
        const playChord = playTrack === 'all' || playTrack === 'chord';

        this.drumGrid?.setPlayheadStep(playDrum ? this.currentPlayStep : null);
        this.bassRoll?.setPlayheadStep(playBass ? this.currentPlayStep : null);
        this.chordRoll?.setPlayheadStep(playChord ? this.currentPlayStep : null);

        this.dynamicTracks.forEach((t, partId) => {
          const playThis = playTrack === 'all' || playTrack === partId;
          t.roll.setPlayheadStep(playThis ? this.currentPlayStep : null);
          if (playThis) {
            const notes = t.roll.getActiveNotesAtStep(this.currentPlayStep);
            for (const note of notes) {
              t.roll.getSynth().playNote(note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
              this.sendMidiDynamicTrackTrigger(partId, note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
            }
          }
        });

        if (playDrum) {
          const drumNotes = this.drumGrid?.getActiveNotesAtStep(this.currentPlayStep) || [];
          for (const note of drumNotes) {
            this.triggerDrumSound(note, 100, Math.max(30, Math.round(stepIntervalMs * 0.8)));
          }
        }

        if (playBass) {
          const bassNotes = this.bassRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
          for (const note of bassNotes) {
            this.triggerBassSound(note, 100, Math.max(80, Math.round(stepIntervalMs * 1.5)));
          }
        }

        if (playChord) {
          const chordNotes = this.chordRoll?.getActiveNotesAtStep(this.currentPlayStep) || [];
          for (const note of chordNotes) {
            this.triggerChordSound(note, 100, Math.max(120, Math.round(stepIntervalMs * 1.5)));
          }
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
      let hasChord = false;
      if (s.chordPattern) {
        for (const set of s.chordPattern.values()) {
          if (set && set.size > 0) {
            hasChord = true;
            break;
          }
        }
      }
      if (hasDrum || hasBass || hasChord) {
        editedSections.push(s);
      }
    });

    if (editedSections.length === 0) {
      alert('所有段落目前皆為空白！請先在網格上安排鼓點、貝斯或和弦，再進行匯出。');
      return;
    }

    try {
      this.setStatus('⏳ 正在生成 Yamaha 二進位檔案...');
      const timeSig = this.drumGrid?.getTimeSignatureObject() ?? { numerator: 4, denominator: 4 };
      const chosenKit = this.state.selectedDrumKit;
      const chosenBass = this.state.selectedBassVoice;
      const chosenChord = this.state.selectedChordVoice;

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
        // 動態伴奏音軌之音色配置
        const dynamicVoices: Record<string, { msb: number; lsb: number; pc: number }> = {};
        this.dynamicTracks.forEach((t, partId) => {
          dynamicVoices[partId] = {
            msb: t.selectedVoice.msb,
            lsb: t.selectedVoice.lsb,
            pc: t.selectedVoice.pc,
          };
        });

        // 整理所有段落之樂音與 Pattern 輸入
        const currentStepsPerBar = this.drumGrid?.getStepsPerBar() || 16;
        const sectionsInput: TemplateSectionInput[] = [];
        this.sections.forEach((store, name) => {
          sectionsInput.push({
            name,
            bars: store.bars,
            stepsPerBar: currentStepsPerBar,
            drumPattern: store.drumPattern,
            bassPattern: store.bassPattern,
            chordPattern: store.chordPattern,
            dynamicPatterns: store.dynamicPatterns,
          });
        });

        // 收集各動態伴奏聲部之當前混音音量、聲相與效果器
        const dynamicMixer: Record<string, { volume: number; pan: number; reverb: number; chorus: number }> = {};
        this.dynamicTracks.forEach((t, partId) => {
          const s = t.roll.getSynth();
          dynamicMixer[partId] = {
            volume: s.getVolume(),
            pan: s.getPan(),
            reverb: s.getReverb(),
            chorus: s.getChorus(),
          };
        });

        // 採用經過實體 Yamaha PSR-SX920 驗證通過的黃金範本進行合成，確保原廠格式 100% 完整相容
        binaryBytes = YamahaTemplateStyleSynthesizer.synthesizeFromTemplate({
          styleName: finalFilename.replace(/\.sty$/i, ''),
          bpm: this.state.bpm,
          timeSignature: timeSig,
          stepsPerBar: currentStepsPerBar,
          drumKit: {
            msb: chosenKit.msb,
            lsb: chosenKit.lsb,
            pc: chosenKit.pc,
          },
          bassVoice: {
            msb: chosenBass.msb,
            lsb: chosenBass.lsb,
            pc: chosenBass.pc,
          },
          chordVoice: {
            msb: chosenChord.msb,
            lsb: chosenChord.lsb,
            pc: chosenChord.pc,
          },
          dynamicVoices,
          sections: sectionsInput,
          mixer: {
            drum: { volume: drumSynth.getVolume(), pan: drumSynth.getPan(), reverb: drumSynth.getReverb(), chorus: drumSynth.getChorus() },
            bass: { volume: bassSynth.getVolume(), pan: bassSynth.getPan(), reverb: bassSynth.getReverb(), chorus: bassSynth.getChorus() },
            chord: { volume: chordSynth.getVolume(), pan: chordSynth.getPan(), reverb: chordSynth.getReverb(), chorus: chordSynth.getChorus() },
            dynamicTracks: dynamicMixer,
          },
        });
      } else {
        // --- 匯出 PAD 多功能打擊板 ---
        const division = 96;
        const ticksPerBar = Math.round(division * timeSig.numerator * (4 / timeSig.denominator));
        const drumEvents = this.drumGrid?.getMidiEvents(ticksPerBar) || [];
        const bassEvents = this.bassRoll?.getMidiEvents(ticksPerBar) || [];
        const chordEvents = this.chordRoll?.getMidiEvents(ticksPerBar) || [];

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
            {
              name: 'Pad 3 (Chord)',
              icon: 'S809',
              repeat: false,
              chordMatch: true,
              msb: chosenChord.msb,
              lsb: chosenChord.lsb,
              pc: chosenChord.pc,
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

        for (const ev of chordEvents) {
          YamahaPadModifier.addNoteEvent(padProject, 3, {
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
      const partCount = 3 + this.dynamicTracks.size;
      const partNames = ['鼓組', '貝斯', '和弦 1', ...Array.from(this.dynamicTracks.values()).map(t => AVAILABLE_CHORD_TRACK_CONFIGS[t.partId]?.title || t.partId)];
      this.setStatus(`✓ 已成功匯出 [${finalFilename}] (${sizeKb} KB，包含 ${secCount} 個段落、${partCount} 個伴奏聲部)！請拷貝至隨身碟插琴驗收。`);
      alert(`🎉 恭喜！檔案 [${finalFilename}] 匯出成功！\n\n- 格式: Yamaha ${this.state.mode === 'STY' ? 'SFF2 伴奏風格 (.STY)' : 'Multi Pad (.PAD)'}\n- 伴奏段落: 已寫入 ${secCount} 個段落\n- 伴奏聲部: 啟用 ${partCount} 軌 (${partNames.join(', ')})\n- 套用鼓組: ${chosenKit.name}\n- 套用貝斯: ${chosenBass.name}\n- 套用和弦: ${chosenChord.name}\n- 檔案大小: ${sizeKb} KB\n- 驗收指引: 請將此檔案複製到隨身碟，插上 PSR-SX920 面板直接按 Start/Stop 試聽！`);
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

  /**
   * 建立當前伴奏混音台通道條資訊清單
   */
  private buildMixerChannelList(): MixerChannelInfo[] {
    const list: MixerChannelInfo[] = [
      {
        id: 'drum',
        name: 'Rhythm 2',
        subName: '鼓組',
        chNumber: 10,
        midiChannel: 9,
        icon: '🥁',
        color: '#38bdf8',
        voiceName: this.state.selectedDrumKit.name,
        volume: drumSynth.getVolume(),
        pan: drumSynth.getPan(),
        reverb: drumSynth.getReverb(),
        chorus: drumSynth.getChorus(),
        muted: this.mutedChannels.has('drum'),
        solo: this.soloChannels.has('drum'),
      },
      {
        id: 'bass',
        name: 'Bass',
        subName: '貝斯',
        chNumber: 11,
        midiChannel: 10,
        icon: '🎸',
        color: '#10b981',
        voiceName: this.state.selectedBassVoice.name,
        volume: bassSynth.getVolume(),
        pan: bassSynth.getPan(),
        reverb: bassSynth.getReverb(),
        chorus: bassSynth.getChorus(),
        muted: this.mutedChannels.has('bass'),
        solo: this.soloChannels.has('bass'),
      },
      {
        id: 'chord',
        name: 'Chord 1',
        subName: '和弦 1',
        chNumber: 12,
        midiChannel: 11,
        icon: '🎹',
        color: '#a855f7',
        voiceName: this.state.selectedChordVoice.name,
        volume: chordSynth.getVolume(),
        pan: chordSynth.getPan(),
        reverb: chordSynth.getReverb(),
        chorus: chordSynth.getChorus(),
        muted: this.mutedChannels.has('chord'),
        solo: this.soloChannels.has('chord'),
      },
    ];

    // 動態伴奏音軌 (Chord 2, Pad, Phrase 1, Phrase 2)
    const partOrder: Array<'Chord2' | 'Pad' | 'Phrase1' | 'Phrase2'> = ['Chord2', 'Pad', 'Phrase1', 'Phrase2'];
    partOrder.forEach(partId => {
      const dynTrack = this.dynamicTracks.get(partId);
      if (dynTrack) {
        const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
        const color = partId === 'Chord2' ? '#f97316' : (partId === 'Pad' ? '#06b6d4' : (partId === 'Phrase1' ? '#eab308' : '#ec4899'));
        const synth = dynTrack.roll.getSynth();
        list.push({
          id: partId,
          name: cfg ? cfg.trackId.toUpperCase() : partId,
          subName: cfg ? cfg.title.replace(/\(.*\)/, '').trim() : partId,
          chNumber: cfg ? cfg.panelCh : 13,
          midiChannel: cfg ? cfg.channel : 12,
          icon: cfg ? cfg.icon : '🎵',
          color,
          voiceName: dynTrack.selectedVoice.name,
          volume: synth.getVolume(),
          pan: synth.getPan(),
          reverb: synth.getReverb(),
          chorus: synth.getChorus(),
          muted: this.mutedChannels.has(partId),
          solo: this.soloChannels.has(partId),
        });
      }
    });

    return list;
  }

  /**
   * 刷新混音台所有通道條顯示
   */
  public refreshMixerChannels() {
    if (this.mixerPanel) {
      this.mixerPanel.setChannels(this.buildMixerChannelList());
    }
  }

  /**
   * 判斷某聲部在當前 Solo/Mute 狀態下是否實質靜音
   */
  public isChannelEffectiveMuted(id: string): boolean {
    if (this.soloChannels.size > 0) {
      if (!this.soloChannels.has(id)) return true;
      return this.mutedChannels.has(id);
    }
    return this.mutedChannels.has(id);
  }

  /**
   * 套用混音台音訊與 MIDI 發聲狀態至各合成器與琴端
   */
  private applyMixerAudioStates() {
    const drumMuted = this.isChannelEffectiveMuted('drum');
    drumSynth.setChannelMuted(drumMuted);
    if (this.state.isMidiConnected) {
      midiManager.sendMixerControllers(9, { volume: drumMuted ? 0 : drumSynth.getVolume() });
    }

    const bassMuted = this.isChannelEffectiveMuted('bass');
    bassSynth.setChannelMuted(bassMuted);
    if (this.state.isMidiConnected) {
      midiManager.sendMixerControllers(10, { volume: bassMuted ? 0 : bassSynth.getVolume() });
    }

    const chordMuted = this.isChannelEffectiveMuted('chord');
    chordSynth.setChannelMuted(chordMuted);
    if (this.state.isMidiConnected) {
      midiManager.sendMixerControllers(11, { volume: chordMuted ? 0 : chordSynth.getVolume() });
    }

    this.dynamicTracks.forEach((t, partId) => {
      const dynMuted = this.isChannelEffectiveMuted(partId);
      t.roll.getSynth().setChannelMuted(dynMuted);
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
      if (this.state.isMidiConnected && cfg) {
        midiManager.sendMixerControllers(cfg.channel, { volume: dynMuted ? 0 : t.roll.getSynth().getVolume() });
      }
    });
  }

  /**
   * 同步所有聲部當前混音推桿 (CC 7)、聲相 (CC 10)、殘響 (CC 91) 與合唱 (CC 93) 至實體琴
   */
  public syncMixerControllersToKeyboard() {
    if (!this.state.isMidiConnected) return;
    const drumVol = this.isChannelEffectiveMuted('drum') ? 0 : drumSynth.getVolume();
    midiManager.sendMixerControllers(9, {
      volume: drumVol,
      pan: drumSynth.getPan(),
      reverb: drumSynth.getReverb(),
      chorus: drumSynth.getChorus(),
    });

    const bassVol = this.isChannelEffectiveMuted('bass') ? 0 : bassSynth.getVolume();
    midiManager.sendMixerControllers(10, {
      volume: bassVol,
      pan: bassSynth.getPan(),
      reverb: bassSynth.getReverb(),
      chorus: bassSynth.getChorus(),
    });

    const chordVol = this.isChannelEffectiveMuted('chord') ? 0 : chordSynth.getVolume();
    midiManager.sendMixerControllers(11, {
      volume: chordVol,
      pan: chordSynth.getPan(),
      reverb: chordSynth.getReverb(),
      chorus: chordSynth.getChorus(),
    });

    this.dynamicTracks.forEach((t, partId) => {
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[partId];
      if (cfg) {
        const s = t.roll.getSynth();
        const dynVol = this.isChannelEffectiveMuted(partId) ? 0 : s.getVolume();
        midiManager.sendMixerControllers(cfg.channel, {
          volume: dynVol,
          pan: s.getPan(),
          reverb: s.getReverb(),
          chorus: s.getChorus(),
        });
      }
    });
  }

  private onMixerVolumeChange(id: string, vol: number) {
    if (id === 'drum') {
      drumSynth.setVolume(vol);
      if (this.state.isMidiConnected && !this.isChannelEffectiveMuted('drum')) {
        midiManager.sendMixerControllers(9, { volume: vol });
      }
    } else if (id === 'bass') {
      bassSynth.setVolume(vol);
      if (this.state.isMidiConnected && !this.isChannelEffectiveMuted('bass')) {
        midiManager.sendMixerControllers(10, { volume: vol });
      }
    } else if (id === 'chord') {
      chordSynth.setVolume(vol);
      if (this.state.isMidiConnected && !this.isChannelEffectiveMuted('chord')) {
        midiManager.sendMixerControllers(11, { volume: vol });
      }
    } else if (this.dynamicTracks.has(id)) {
      const t = this.dynamicTracks.get(id)!;
      t.roll.getSynth().setVolume(vol);
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[id];
      if (this.state.isMidiConnected && cfg && !this.isChannelEffectiveMuted(id)) {
        midiManager.sendMixerControllers(cfg.channel, { volume: vol });
      }
    }
  }

  private onMixerPanChange(id: string, pan: number) {
    if (id === 'drum') {
      drumSynth.setPan(pan);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(9, { pan });
      }
    } else if (id === 'bass') {
      bassSynth.setPan(pan);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(10, { pan });
      }
    } else if (id === 'chord') {
      chordSynth.setPan(pan);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(11, { pan });
      }
    } else if (this.dynamicTracks.has(id)) {
      const t = this.dynamicTracks.get(id)!;
      t.roll.getSynth().setPan(pan);
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[id];
      if (this.state.isMidiConnected && cfg) {
        midiManager.sendMixerControllers(cfg.channel, { pan });
      }
    }
  }

  private onMixerReverbChange(id: string, reverb: number) {
    if (id === 'drum') {
      drumSynth.setReverb(reverb);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(9, { reverb });
      }
    } else if (id === 'bass') {
      bassSynth.setReverb(reverb);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(10, { reverb });
      }
    } else if (id === 'chord') {
      chordSynth.setReverb(reverb);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(11, { reverb });
      }
    } else if (this.dynamicTracks.has(id)) {
      const t = this.dynamicTracks.get(id)!;
      t.roll.getSynth().setReverb(reverb);
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[id];
      if (this.state.isMidiConnected && cfg) {
        midiManager.sendMixerControllers(cfg.channel, { reverb });
      }
    }
  }

  private onMixerChorusChange(id: string, chorus: number) {
    if (id === 'drum') {
      drumSynth.setChorus(chorus);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(9, { chorus });
      }
    } else if (id === 'bass') {
      bassSynth.setChorus(chorus);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(10, { chorus });
      }
    } else if (id === 'chord') {
      chordSynth.setChorus(chorus);
      if (this.state.isMidiConnected) {
        midiManager.sendMixerControllers(11, { chorus });
      }
    } else if (this.dynamicTracks.has(id)) {
      const t = this.dynamicTracks.get(id)!;
      t.roll.getSynth().setChorus(chorus);
      const cfg = AVAILABLE_CHORD_TRACK_CONFIGS[id];
      if (this.state.isMidiConnected && cfg) {
        midiManager.sendMixerControllers(cfg.channel, { chorus });
      }
    }
  }

  private onMixerMuteToggle(id: string, muted: boolean) {
    if (muted) {
      this.mutedChannels.add(id);
    } else {
      this.mutedChannels.delete(id);
    }
    this.applyMixerAudioStates();
  }

  private onMixerSoloToggle(id: string, solo: boolean) {
    if (solo) {
      this.soloChannels.add(id);
    } else {
      this.soloChannels.delete(id);
    }
    this.applyMixerAudioStates();
  }

  public resetMixerToGoldenDefaults() {
    drumSynth.setVolume(100);
    drumSynth.setPan(64);
    drumSynth.setReverb(40);
    drumSynth.setChorus(0);

    bassSynth.setVolume(95);
    bassSynth.setPan(64);
    bassSynth.setReverb(20);
    bassSynth.setChorus(0);

    chordSynth.setVolume(90);
    chordSynth.setPan(52); // L12
    chordSynth.setReverb(65);
    chordSynth.setChorus(20);

    if (this.dynamicTracks.has('Chord2')) {
      const t = this.dynamicTracks.get('Chord2')!;
      t.roll.getSynth().setVolume(85);
      t.roll.getSynth().setPan(76); // R12
      t.roll.getSynth().setReverb(50);
      t.roll.getSynth().setChorus(40);
    }
    if (this.dynamicTracks.has('Pad')) {
      const t = this.dynamicTracks.get('Pad')!;
      t.roll.getSynth().setVolume(80);
      t.roll.getSynth().setPan(64); // C
      t.roll.getSynth().setReverb(75);
      t.roll.getSynth().setChorus(50);
    }
    if (this.dynamicTracks.has('Phrase1')) {
      const t = this.dynamicTracks.get('Phrase1')!;
      t.roll.getSynth().setVolume(85);
      t.roll.getSynth().setPan(44); // L20
      t.roll.getSynth().setReverb(60);
      t.roll.getSynth().setChorus(20);
    }
    if (this.dynamicTracks.has('Phrase2')) {
      const t = this.dynamicTracks.get('Phrase2')!;
      t.roll.getSynth().setVolume(80);
      t.roll.getSynth().setPan(84); // R20
      t.roll.getSynth().setReverb(60);
      t.roll.getSynth().setChorus(30);
    }

    this.mutedChannels.clear();
    this.soloChannels.clear();
    this.applyMixerAudioStates();

    if (this.state.isMidiConnected) {
      this.syncMixerControllersToKeyboard();
    }

    this.refreshMixerChannels();
    this.setStatus('✨ 已將所有伴奏聲部重設為 Yamaha PSR-SX920 原廠推薦黃金配比 (含音量、聲相、Reverb 與 Chorus 效果器)！');
  }

  public panicMixer() {
    if (this.state.isPlaying) {
      this.stop();
    }
    if (this.state.isMidiConnected) {
      midiManager.panicAllChannels();
    }
    this.setStatus('🔇 已發送全聲部防掛音中斷 (Panic) 與即時靜音指令！');
  }

  private updateMixerButtonState(visible: boolean) {
    const btn = document.getElementById('btn-toggle-mixer');
    if (btn) {
      if (visible) {
        btn.classList.add('active');
        btn.style.background = '#f59e0b';
        btn.style.color = '#0f172a';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'rgba(245, 158, 11, 0.15)';
        btn.style.color = '#f59e0b';
      }
    }
  }

  private updateUI() {
    this.refreshSectionOptions();
    this.updateSectionSummary();
    this.updateComputerAudioUI();
  }
}

// 頁面載入後自動啟動
window.addEventListener('DOMContentLoaded', () => {
  (window as any).creatorApp = new CreatorApp();
});
