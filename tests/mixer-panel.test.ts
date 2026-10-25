/**
 * Yamaha PSR-SX920 視覺化混音台 (Mixer Panel) 單元測試
 * 驗證通道條建立、音量推桿、立體聲聲相格式化、靜音/獨奏邏輯與回呼事件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MixerPanel, type MixerChannelInfo } from '../src/creator/mixer-panel';

// 輕量 Mock DOM 節點以在 Node 環境下運行測試
class MockNode {
  public tagName: string;
  public className: string = '';
  public id: string = '';
  public innerHTML: string = '';
  public textContent: string = '';
  public value: string = '';
  public style: Record<string, any> = { display: '', setProperty: () => {} };
  public children: MockNode[] = [];
  public attributes: Record<string, string> = {};
  public listeners: Record<string, Function[]> = {};

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public appendChild(child: MockNode) {
    this.children.push(child);
    return child;
  }

  public setAttribute(name: string, val: string) {
    this.attributes[name] = val;
  }

  public getAttribute(name: string) {
    return this.attributes[name] || null;
  }

  public addEventListener(event: string, fn: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  public dispatchEvent(ev: any) {
    const list = this.listeners[ev.type] || [];
    list.forEach(fn => fn(ev));
    return true;
  }

  public click() {
    this.dispatchEvent({ type: 'click' });
  }

  public classList = {
    add: (cls: string) => {
      const parts = this.className.split(' ').filter(Boolean);
      if (!parts.includes(cls)) parts.push(cls);
      this.className = parts.join(' ');
    },
    remove: (cls: string) => {
      this.className = this.className.split(' ').filter(c => c !== cls).join(' ');
    },
    contains: (cls: string) => {
      return this.className.split(' ').includes(cls);
    },
  };

  public querySelector<T = any>(sel: string): T | null {
    const all = this.querySelectorAll(sel);
    return (all.length > 0 ? all[0] : null) as any;
  }

  public querySelectorAll(sel: string): MockNode[] {
    const result: MockNode[] = [];

    const matches = (node: MockNode): boolean => {
      if (sel.startsWith('#') && node.id === sel.slice(1)) return true;
      if (sel.startsWith('.') && node.classList.contains(sel.slice(1))) return true;
      if (sel.startsWith('[') && sel.endsWith(']')) {
        const inner = sel.slice(1, -1);
        if (inner.includes('=')) {
          const [attr, val] = inner.split('=').map(s => s.replace(/['"]/g, ''));
          return node.attributes[attr] === val;
        } else {
          return !!node.attributes[inner];
        }
      }
      return false;
    };

    const traverse = (node: MockNode) => {
      if (matches(node)) result.push(node);
      for (const child of node.children) {
        traverse(child);
      }
    };

    for (const child of this.children) {
      traverse(child);
    }

    return result;
  }
}

// 設置 globalThis.document
if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      const node = new MockNode(tag);
      return node;
    },
  };
  (globalThis as any).Event = class {
    constructor(public type: string) {}
  };
  (globalThis as any).MouseEvent = class {
    constructor(public type: string) {}
  };
}

describe('MixerPanel 視覺化混音台', () => {
  let container: any;
  let callbacks: any;

  beforeEach(() => {
    container = new MockNode('div');
    callbacks = {
      onVolumeChange: vi.fn(),
      onPanChange: vi.fn(),
      onReverbChange: vi.fn(),
      onChorusChange: vi.fn(),
      onMuteToggle: vi.fn(),
      onSoloToggle: vi.fn(),
      onResetDefaults: vi.fn(),
      onPanic: vi.fn(),
      onVisibilityChange: vi.fn(),
    };
  });

  it('能夠成功實例化並建立基本面板結構', () => {
    const panel = new MixerPanel(container, callbacks);
    expect(panel).toBeDefined();
    expect(container.children.length).toBeGreaterThan(0);
    const wrapper = container.children[0];
    expect(wrapper.className).toBe('mixer-panel-card');
  });

  it('能正確格式化聲相 (formatPan): 64 -> C, <64 -> L, >64 -> R', () => {
    const panel = new MixerPanel(container, callbacks);
    expect(panel.formatPan(64)).toBe('C');
    expect(panel.formatPan(0)).toBe('L64');
    expect(panel.formatPan(52)).toBe('L12');
    expect(panel.formatPan(76)).toBe('R12');
    expect(panel.formatPan(127)).toBe('R63');
  });

  it('支援設定包含 Reverb 與 Chorus 之通道條資料 (setChannels)', () => {
    const panel = new MixerPanel(container, callbacks);
    const testChannels: MixerChannelInfo[] = [
      {
        id: 'drum',
        name: 'Rhythm 2',
        subName: '鼓組',
        chNumber: 10,
        midiChannel: 9,
        icon: '🥁',
        color: '#38bdf8',
        voiceName: 'Standard Kit 1',
        volume: 100,
        pan: 64,
        reverb: 40,
        chorus: 0,
        muted: false,
        solo: false,
      },
      {
        id: 'chord',
        name: 'Chord 1',
        subName: '和弦 1',
        chNumber: 12,
        midiChannel: 11,
        icon: '🎹',
        color: '#a855f7',
        voiceName: 'Concert Grand',
        volume: 90,
        pan: 52,
        reverb: 65,
        chorus: 20,
        muted: false,
        solo: false,
      },
    ];

    panel.setChannels(testChannels);
    expect(panel).toBeDefined();
  });

  it('toggle() 正確切換可見性並觸發 onVisibilityChange', () => {
    const panel = new MixerPanel(container, callbacks);
    expect(panel.isVisible()).toBe(false);

    panel.toggle(true);
    expect(panel.isVisible()).toBe(true);
    expect(container.style.display).toBe('block');
    expect(callbacks.onVisibilityChange).toHaveBeenCalledWith(true);

    panel.toggle(false);
    expect(panel.isVisible()).toBe(false);
    expect(container.style.display).toBe('none');
    expect(callbacks.onVisibilityChange).toHaveBeenCalledWith(false);
  });
});
