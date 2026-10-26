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
    const results: MockElement[] = [];
    const traverse = (node: MockElement) => {
      if (sel.includes('active-playhead') && node.classList.contains('active-playhead')) {
        results.push(node);
      }
      if (sel.includes('[data-step=') && node.dataset.step) {
        results.push(node);
      }
      if (sel.includes('[data-chord-step=') && node.dataset.chordStep) {
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

describe('Playhead Auto-Scroll and Boundary Handling', () => {
  it('calls setPlayheadStep and resetScroll on DrumStepGrid without crashing', () => {
    const container = new MockElement('div') as any;
    const grid = new DrumStepGrid(container, 8);

    grid.setPlayheadStep(0, true);
    expect(container.scrollTo).toHaveBeenCalled();

    grid.setPlayheadStep(16, true);
    grid.setPlayheadStep(64, true);
    grid.setPlayheadStep(120, true);
    grid.setPlayheadStep(null);

    grid.resetScroll();
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('calls setPlayheadStep and resetScroll on PianoRollLite without crashing', () => {
    const container = new MockElement('div') as any;
    const roll = new PianoRollLite(container, 8);

    roll.setPlayheadStep(0, true);
    expect(container.scrollTo).toHaveBeenCalled();

    roll.setPlayheadStep(32, true);
    roll.setPlayheadStep(64, true);
    roll.setPlayheadStep(null);
    roll.resetScroll();
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });

  it('calls setPlayheadStep and resetScroll on ChordRollLite without crashing', () => {
    const container = new MockElement('div') as any;
    const roll = new ChordRollLite(container, 8);

    roll.setPlayheadStep(0, true);
    expect(container.scrollTo).toHaveBeenCalled();

    roll.setPlayheadStep(48, true);
    roll.setPlayheadStep(80, true);
    roll.setPlayheadStep(null);
    roll.resetScroll();
    expect(container.scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' });
  });
});
