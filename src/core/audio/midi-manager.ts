/**
 * Yamaha PSR-SX920 Web MIDI Manager
 * 負責瀏覽器 Web MIDI API 存取、實體琴埠口偵測、熱插拔監聽、音色與控制器指令傳送及發聲路由控制
 */

export type AudioRoutingMode = 'audio' | 'midi' | 'both';

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: 'connected' | 'disconnected';
  isRecommended: boolean;
}

export interface VoiceBankConfig {
  msb: number; // CC 0
  lsb: number; // CC 32
  pc: number;  // Program Change (0~127)
}

export interface WebMidiPort {
  id: string;
  name?: string;
  manufacturer?: string;
  type: string;
  state: string;
  connection: string;
  send: (data: number[] | Uint8Array, timestamp?: number) => void;
  open?: () => Promise<WebMidiPort>;
  close?: () => Promise<WebMidiPort>;
}

export interface WebMidiAccess {
  inputs: Map<string, WebMidiPort>;
  outputs: Map<string, WebMidiPort>;
  onstatechange: ((event: any) => void) | null;
}

export class MidiManager {
  private midiAccess: WebMidiAccess | null = null;
  private selectedOutput: WebMidiPort | null = null;
  private routingMode: AudioRoutingMode = 'audio';
  private stateChangeListeners: Array<(devices: MidiDeviceInfo[]) => void> = [];
  private isRequesting = false;
  private activeNotes: Set<string> = new Set(); // 格式: `${channel}:${note}`

  /**
   * 檢查瀏覽器是否支援 Web MIDI API
   */
  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof (navigator as any).requestMIDIAccess === 'function';
  }

  /**
   * 請求 Web MIDI API 存取權限並掃描可用輸出裝置
   */
  public async requestAccess(): Promise<{ success: boolean; error?: string; devices: MidiDeviceInfo[] }> {
    if (!this.isSupported()) {
      return { success: false, error: '當前瀏覽器環境不支援 Web MIDI API (建議使用 Google Chrome 或 Microsoft Edge)', devices: [] };
    }

    if (this.isRequesting) {
      return { success: false, error: '正在請求 MIDI 存取權限中...', devices: this.getAvailableOutputs() };
    }

    this.isRequesting = true;
    try {
      this.midiAccess = await (navigator as any).requestMIDIAccess({ sysex: false });

      // 綁定熱插拔事件監聽器 (Hot-plugging detection)
      if (this.midiAccess) {
        this.midiAccess.onstatechange = (event: any) => {
          this.handleStateChange(event);
        };
      }

      const devices = this.getAvailableOutputs();

      // 如果尚未選定設備，自動推薦選取 Yamaha / Digital Workstation 設備
      if (!this.selectedOutput) {
        const recommended = devices.find(d => d.isRecommended && d.state === 'connected');
        if (recommended) {
          this.selectOutput(recommended.id);
        } else if (devices.length > 0) {
          this.selectOutput(devices[0].id);
        }
      }

      return { success: true, devices };
    } catch (err: any) {
      return { success: false, error: err?.message || '使用者拒絕了 MIDI 設備存取授權', devices: [] };
    } finally {
      this.isRequesting = false;
    }
  }

  /**
   * 取得所有已連線之 MIDI 輸出裝置清單
   */
  public getAvailableOutputs(): MidiDeviceInfo[] {
    if (!this.midiAccess) return [];

    const result: MidiDeviceInfo[] = [];
    for (const port of this.midiAccess.outputs.values()) {
      const name = port.name || 'MIDI Output';
      const mfr = port.manufacturer || '';
      const isRecommended = /digital workstation|yamaha|sx920|psr|workstation/i.test(name) || /yamaha/i.test(mfr);

      result.push({
        id: port.id,
        name,
        manufacturer: mfr,
        state: (port.state as 'connected' | 'disconnected') || 'connected',
        isRecommended,
      });
    }

    // 優先推薦的置頂
    return result.sort((a, b) => (b.isRecommended ? 1 : 0) - (a.isRecommended ? 1 : 0));
  }

  /**
   * 依據 ID 或名稱選取當前使用的 MIDI 輸出裝置
   */
  public selectOutput(idOrName: string | null): boolean {
    if (!idOrName) {
      this.selectedOutput = null;
      return true;
    }

    if (!this.midiAccess) return false;

    for (const port of this.midiAccess.outputs.values()) {
      if (port.id === idOrName || port.name === idOrName) {
        this.selectedOutput = port;
        return true;
      }
    }

    this.selectedOutput = null;
    return false;
  }

  /**
   * 取得當前選取的 MIDI 輸出裝置資訊
   */
  public getSelectedOutput(): MidiDeviceInfo | null {
    if (!this.selectedOutput) return null;
    const name = this.selectedOutput.name || 'MIDI Output';
    const mfr = this.selectedOutput.manufacturer || '';
    return {
      id: this.selectedOutput.id,
      name,
      manufacturer: mfr,
      state: (this.selectedOutput.state as 'connected' | 'disconnected') || 'connected',
      isRecommended: /digital workstation|yamaha|sx920|psr/i.test(name) || /yamaha/i.test(mfr),
    };
  }

  /**
   * 設定發聲路由模式 ('audio' | 'midi' | 'both')
   */
  public setRoutingMode(mode: AudioRoutingMode) {
    this.routingMode = mode;
  }

  public getRoutingMode(): AudioRoutingMode {
    return this.routingMode;
  }

  public isAudioActive(): boolean {
    return this.routingMode === 'audio' || this.routingMode === 'both';
  }

  public isMidiActive(): boolean {
    return (this.routingMode === 'midi' || this.routingMode === 'both') && this.selectedOutput !== null;
  }

  /**
   * 傳送原生 MIDI 位元組陣列
   */
  public send(bytes: number[] | Uint8Array, timestamp?: number): boolean {
    if (!this.selectedOutput) return false;
    try {
      if (timestamp !== undefined) {
        this.selectedOutput.send(bytes, timestamp);
      } else {
        this.selectedOutput.send(bytes);
      }
      return true;
    } catch (err) {
      console.warn('[MidiManager] Failed to send MIDI message:', err);
      return false;
    }
  }

  /**
   * 傳送 Yamaha 原廠音色切換指令 (Bank Select MSB + LSB + Program Change)
   */
  public sendVoiceChange(channel: number, config: VoiceBankConfig): boolean {
    if (!this.selectedOutput) return false;
    const ch = Math.max(0, Math.min(15, channel));
    const msb = Math.max(0, Math.min(127, Math.round(config.msb)));
    const lsb = Math.max(0, Math.min(127, Math.round(config.lsb)));
    const pc = Math.max(0, Math.min(127, Math.round(config.pc)));

    this.send([0xB0 | ch, 0, msb]);   // CC 0: Bank Select MSB
    this.send([0xB0 | ch, 32, lsb]);  // CC 32: Bank Select LSB
    this.send([0xC0 | ch, pc]);       // Program Change
    return true;
  }

  /**
   * 傳送混音控制器參數 (Volume, Pan, Reverb)
   */
  public sendMixerControllers(
    channel: number,
    params: { volume?: number; pan?: number; reverb?: number }
  ): boolean {
    if (!this.selectedOutput) return false;
    const ch = Math.max(0, Math.min(15, channel));

    if (params.volume !== undefined) {
      const vol = Math.max(0, Math.min(127, Math.round(params.volume)));
      this.send([0xB0 | ch, 7, vol]); // CC 7: Channel Volume
    }
    if (params.pan !== undefined) {
      const pan = Math.max(0, Math.min(127, Math.round(params.pan)));
      this.send([0xB0 | ch, 10, pan]); // CC 10: Pan
    }
    if (params.reverb !== undefined) {
      const rev = Math.max(0, Math.min(127, Math.round(params.reverb)));
      this.send([0xB0 | ch, 91, rev]); // CC 91: Reverb Send Level
    }
    return true;
  }

  /**
   * 傳送 Note-On 事件
   */
  public sendNoteOn(channel: number, note: number, velocity: number = 100, timestamp?: number): boolean {
    const ch = Math.max(0, Math.min(15, channel));
    const n = Math.max(0, Math.min(127, Math.round(note)));
    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    this.activeNotes.add(`${ch}:${n}`);
    return this.send([0x90 | ch, n, v], timestamp);
  }

  /**
   * 傳送 Note-Off 事件
   */
  public sendNoteOff(channel: number, note: number, timestamp?: number): boolean {
    const ch = Math.max(0, Math.min(15, channel));
    const n = Math.max(0, Math.min(127, Math.round(note)));
    this.activeNotes.delete(`${ch}:${n}`);
    return this.send([0x80 | ch, n, 0], timestamp);
  }

  /**
   * 防掛音安全緊急中斷：對全部 16 個通道廣播 All Sound Off, All Notes Off 與 Damper Off
   */
  public panicAllChannels(): boolean {
    if (!this.selectedOutput) return false;

    // 1. 先對所有主動追蹤中正在發聲的音符逐一發送實體 Note-Off，確保硬體琴音符立刻熄滅
    for (const key of this.activeNotes) {
      const [ch, n] = key.split(':').map(Number);
      this.send([0x80 | ch, n, 0]);
    }
    this.activeNotes.clear();

    // 2. 對全部 16 個通道廣播 All Sound Off (CC120), All Notes Off (CC123), Damper Off (CC64)
    for (let ch = 0; ch < 16; ch++) {
      this.send([0xB0 | ch, 120, 0]); // CC 120: All Sound Off (立即切斷發聲)
      this.send([0xB0 | ch, 123, 0]); // CC 123: All Notes Off
      this.send([0xB0 | ch, 64, 0]);  // CC 64: Damper / Sustain Pedal Off
    }
    return true;
  }

  /**
   * 琴端連線測試音效：彈奏 C4 -> E4 -> G4 -> C5 琶音與和弦，確認 PSR-SX920 發聲正常
   */
  public playTestChime(channel: number = 0): void {
    if (!this.selectedOutput) return;
    const ch = Math.max(0, Math.min(15, channel));

    // 先切換至 Concert Grand (MSB 0, LSB 112, PC 0)
    this.sendVoiceChange(ch, { msb: 0, lsb: 112, pc: 0 });
    this.sendMixerControllers(ch, { volume: 105, pan: 64 });

    const notes = [60, 64, 67, 72]; // C4, E4, G4, C5
    notes.forEach((pitch, i) => {
      setTimeout(() => {
        this.sendNoteOn(ch, pitch, 100);
        setTimeout(() => {
          this.sendNoteOff(ch, pitch);
        }, 300);
      }, i * 140);
    });
  }

  /**
   * 註冊設備插拔狀態變更回呼函式
   */
  public onDeviceChange(callback: (devices: MidiDeviceInfo[]) => void): () => void {
    this.stateChangeListeners.push(callback);
    return () => {
      this.stateChangeListeners = this.stateChangeListeners.filter(cb => cb !== callback);
    };
  }

  private handleStateChange(event: any) {
    const devices = this.getAvailableOutputs();

    // 如果目前選取的設備斷線了
    if (this.selectedOutput && event?.port?.id === this.selectedOutput.id) {
      if (event.port.state === 'disconnected') {
        this.selectedOutput = null;
      }
    }

    // 若斷線後又有推薦設備，自動重新連線
    if (!this.selectedOutput) {
      const rec = devices.find(d => d.isRecommended && d.state === 'connected');
      if (rec) this.selectOutput(rec.id);
    }

    // 觸發所有註冊的監聽器
    for (const listener of this.stateChangeListeners) {
      try {
        listener(devices);
      } catch (err) {
        console.error('[MidiManager] Error in state change listener:', err);
      }
    }
  }
}

export const midiManager = new MidiManager();
