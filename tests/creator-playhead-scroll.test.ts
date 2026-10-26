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
    };
  }

  public scrollTo = vi.fn((opts: { left: number; behavior?: string }) => {
    this.scrollLeft = opts.left;
  });

  public getBoundingClientRect() {
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

describe('DAW Page-by-Page Auto-Scroll and Boundary Handling', () => {
  it('manages 4-bar page transitions on DrumStepGrid without jittering', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8); // 8 bars total

    expect(grid.getCurrentPageIndex()).toBe(0);

    // Bars 1~4 (steps 0 to 63): should remain on Page 0
    grid.setPlayheadStep(0, true);
    expect(grid.getCurrentPageIndex()).toBe(0);

    container.scrollTo.mockClear();
    grid.setPlayheadStep(16, true); // Bar 2
    grid.setPlayheadStep(32, true); // Bar 3
    grid.setPlayheadStep(48, true); // Bar 4
    grid.setPlayheadStep(63, true); // End of Bar 4

    // Crucial: no scrolling triggered during Bars 1~4
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(grid.getCurrentPageIndex()).toBe(0);

    // Step 64 (Start of Bar 5): turns to Page 1
    grid.setPlayheadStep(64, true);
    expect(grid.getCurrentPageIndex()).toBe(1);
    expect(container.scrollTo).toHaveBeenCalled();

    // Bars 5~8 (steps 65 to 127): should remain on Page 1 without re-scrolling
    container.scrollTo.mockClear();
    grid.setPlayheadStep(80, true); // Bar 6
    grid.setPlayheadStep(96, true); // Bar 7
    grid.setPlayheadStep(127, true); // End of Bar 8
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(grid.getCurrentPageIndex()).toBe(1);

    // Loop back to Step 0: turns back to Page 0
    grid.setPlayheadStep(0, true);
    expect(grid.getCurrentPageIndex()).toBe(0);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0 });

    // resetScroll explicitly resets to 0
    grid.resetScroll();
    expect(grid.getCurrentPageIndex()).toBe(0);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it('manages 4-bar page transitions on PianoRollLite', () => {
    const container = new MockElement('div') as any;
    const roll = new PianoRollLite(container, 8);

    expect(roll.getCurrentPageIndex()).toBe(0);

    // Steps within Bars 1~4
    roll.setPlayheadStep(0, true);
    container.scrollTo.mockClear();
    roll.setPlayheadStep(32, true);
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(roll.getCurrentPageIndex()).toBe(0);

    // Step 64 crosses into Bar 5 -> page 1
    roll.setPlayheadStep(64, true);
    expect(roll.getCurrentPageIndex()).toBe(1);
    expect(container.scrollTo).toHaveBeenCalled();

    // Reset
    roll.resetScroll();
    expect(roll.getCurrentPageIndex()).toBe(0);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it('manages 4-bar page transitions on ChordRollLite', () => {
    const container = new MockElement('div') as any;
    const roll = new ChordRollLite(container, 8);

    expect(roll.getCurrentPageIndex()).toBe(0);

    // Steps within Bars 1~4
    roll.setPlayheadStep(0, true);
    container.scrollTo.mockClear();
    roll.setPlayheadStep(48, true);
    expect(container.scrollTo).not.toHaveBeenCalled();
    expect(roll.getCurrentPageIndex()).toBe(0);

    // Step 64 crosses into Bar 5 -> page 1
    roll.setPlayheadStep(64, true);
    expect(roll.getCurrentPageIndex()).toBe(1);
    expect(container.scrollTo).toHaveBeenCalled();

    // Reset
    roll.resetScroll();
    expect(roll.getCurrentPageIndex()).toBe(0);
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0 });
  });

  it('does not scroll when autoScroll is disabled', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8);

    container.scrollTo.mockClear();
    grid.setPlayheadStep(64, false); // autoScroll = false
    expect(grid.getCurrentPageIndex()).toBe(0);
    expect(container.scrollTo).not.toHaveBeenCalled();
  });
});
