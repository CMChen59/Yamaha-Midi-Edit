import { describe, it, expect, vi } from 'vitest';

class MockElement {
  public tagName: string;
  public className: string = '';
  public innerHTML: string = '';
  public style: Record<string, any> = {};
  public dataset: Record<string, string> = {};
  public children: MockElement[] = [];
  public scrollLeft: number = 0;
  public clientWidth: number = 1000;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  public appendChild(child: MockElement) {
    this.children.push(child);
  }

  public remove() {}

  public addEventListener = vi.fn();

  public setAttribute(name: string, value: string) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = value;
    }
  }

  public querySelectorAll(sel: string): MockElement[] {
    const parts = sel.split(',').map(s => s.trim());
    if (parts.length > 1) {
      const set = new Set<MockElement>();
      for (const p of parts) {
        for (const el of this.querySelectorAll(p)) {
          set.add(el);
        }
      }
      return Array.from(set);
    }

    const results: MockElement[] = [];
    const traverse = (node: MockElement) => {
      let match = true;
      if (sel.includes('active-playhead') && !node.classList.contains('active-playhead')) match = false;
      if (sel.includes('.step-cell') && !node.className.includes('step-cell')) match = false;
      if (sel.includes('.step-header-cell') && !node.className.includes('step-header-cell')) match = false;
      if (sel.includes('.chord-header-cell') && !node.className.includes('chord-header-cell')) match = false;
      if (sel.includes('.row-header-label') && !node.className.includes('row-header-label')) match = false;
      if (sel.includes('.piano-key-label') && !node.className.includes('piano-key-label')) match = false;

      const stepMatch = sel.match(/\[data-step="?(\d+)"?\]/);
      if (stepMatch && node.dataset.step !== stepMatch[1]) match = false;

      const chordStepMatch = sel.match(/\[data-chord-step="?(\d+)"?\]/);
      if (chordStepMatch && node.dataset.chordStep !== chordStepMatch[1]) match = false;

      if (match && (
        node.className.includes(sel.replace(/^[.#]/, '').replace(/\[.*\]/, '')) ||
        sel.startsWith('[data-') ||
        sel.includes('.active-playhead') ||
        sel.includes('.row-header-label') ||
        sel.includes('.step-header-cell') ||
        sel.includes('.chord-header-cell')
      )) {
        results.push(node);
      }

      for (const c of node.children) {
        traverse(c);
      }
    };
    traverse(this);
    return results;
  }

  public querySelector(sel: string): MockElement | null {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  public get classList() {
    return {
      add: (cls: string) => {
        if (!this.className.includes(cls)) this.className += ' ' + cls;
      },
      remove: (cls: string) => {
        this.className = this.className.replace(cls, '').trim();
      },
      contains: (cls: string) => this.className.includes(cls),
      toggle: (cls: string, force?: boolean) => {
        const has = this.className.includes(cls);
        const shouldHave = force !== undefined ? force : !has;
        if (shouldHave && !has) this.className += ' ' + cls;
        else if (!shouldHave && has) this.className = this.className.replace(cls, '').trim();
        return shouldHave;
      },
    };
  }

  public scrollTo = vi.fn((opts: { left: number; behavior?: string }) => {
    this.scrollLeft = opts.left;
  });

  public getBoundingClientRect() {
    if (this.dataset.step !== undefined || this.dataset.chordStep !== undefined) {
      const step = parseInt(this.dataset.step || this.dataset.chordStep || '0', 10);
      const left = 330 + step * 26 - this.scrollLeft;
      return {
        left,
        right: left + 26,
        width: 26,
        top: 0,
        bottom: 22,
        height: 22,
      };
    }
    if (this.className.includes('row-header-label') || this.className.includes('piano-key-label')) {
      return {
        left: 100,
        right: 330,
        width: 230,
        top: 0,
        bottom: 22,
        height: 22,
      };
    }
    return {
      left: 100,
      right: 1100,
      width: 1000,
      top: 0,
      bottom: 500,
      height: 500,
    };
  }
}

// Global document mock
(globalThis as any).document = {
  createElement: (tag: string) => new MockElement(tag),
};

import { DrumStepGrid } from '../src/creator/drum-step-grid';
import { PianoRollLite } from '../src/creator/piano-roll-lite';
import { ChordRollLite } from '../src/creator/chord-roll-lite';

describe('Instant Page-Turn Auto-Scroll and Boundary Handling', () => {
  it('manages instant page flipping on DrumStepGrid without jittering', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8); // 8 bars total
    grid.setFitMode(false); // 切換為非 Fit 模式 (可捲動之放大編輯模式)

    // Start at Step 0: scrollLeft should be 0
    grid.setPlayheadStep(0, true);
    expect(container.scrollLeft).toBe(0);

    container.scrollTo.mockClear();
    // Steps within visible screen bounds (steps 1 to 20): should NOT scroll
    grid.setPlayheadStep(8, true);
    grid.setPlayheadStep(16, true);
    expect(container.scrollTo).not.toHaveBeenCalled();

    // Step 29: hits the right edge (right > 1100 - 35 = 1065)
    // Should trigger instant page flip!
    grid.setPlayheadStep(29, true);
    expect(container.scrollLeft).toBeGreaterThan(0);

    // Loop back to Step 0: instantly resets to 0
    grid.setPlayheadStep(0, true);
    expect(container.scrollLeft).toBe(0);

    // resetScroll explicitly resets to 0
    grid.resetScroll();
    expect(container.scrollLeft).toBe(0);
  });

  it('manages instant page flipping on PianoRollLite', () => {
    const container = new MockElement('div') as any;
    const roll = new PianoRollLite(container, 8);
    roll.setFitMode(false);

    roll.setPlayheadStep(0, true);
    expect(container.scrollLeft).toBe(0);

    container.scrollTo.mockClear();
    roll.setPlayheadStep(12, true);
    expect(container.scrollTo).not.toHaveBeenCalled();

    // Step 29 hits right edge -> page flip
    roll.setPlayheadStep(29, true);
    expect(container.scrollLeft).toBeGreaterThan(0);

    // Reset
    roll.resetScroll();
    expect(container.scrollLeft).toBe(0);
  });

  it('manages instant page flipping on ChordRollLite', () => {
    const container = new MockElement('div') as any;
    const roll = new ChordRollLite(container, 8);
    roll.setFitMode(false);

    roll.setPlayheadStep(0, true);
    expect(container.scrollLeft).toBe(0);

    container.scrollTo.mockClear();
    roll.setPlayheadStep(12, true);
    expect(container.scrollTo).not.toHaveBeenCalled();

    // Step 29 hits right edge -> page flip
    roll.setPlayheadStep(29, true);
    expect(container.scrollLeft).toBeGreaterThan(0);

    // Reset
    roll.resetScroll();
    expect(container.scrollLeft).toBe(0);
  });

  it('does not scroll when in Fit Mode (Overview Zoom Mode)', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8);
    grid.setFitMode(true); // 預設即為 Fit Mode

    container.scrollTo.mockClear();
    grid.setPlayheadStep(29, true);
    // 在 Fit Mode 下完全不觸發橫向滾動
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(container.scrollLeft).toBe(0);
  });

  it('does not scroll when autoScroll is disabled', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8);
    grid.setFitMode(false);

    container.scrollTo.mockClear();
    grid.setPlayheadStep(29, false); // autoScroll = false
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(container.scrollLeft).toBe(0);
  });
});
