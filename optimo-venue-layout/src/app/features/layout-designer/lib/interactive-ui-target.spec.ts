/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { isInteractiveUiTarget } from './interactive-ui-target';

describe('isInteractiveUiTarget', () => {
  it('detects native form controls', () => {
    const input = document.createElement('input');
    expect(isInteractiveUiTarget(input)).toBe(true);
    expect(isInteractiveUiTarget(document.createElement('textarea'))).toBe(true);
    expect(isInteractiveUiTarget(document.createElement('select'))).toBe(true);
    expect(isInteractiveUiTarget(document.createElement('button'))).toBe(true);
  });

  it('detects nested controls via closest()', () => {
    const label = document.createElement('label');
    const span = document.createElement('span');
    label.appendChild(span);
    expect(isInteractiveUiTarget(span)).toBe(true);
  });

  it('ignores ordinary canvas/svg nodes', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    svg.appendChild(rect);
    expect(isInteractiveUiTarget(rect)).toBe(false);
  });
});
