import { describe, expect, it } from 'vitest';

import { classifyBlockShape, simplifyPolygonCorners } from './classify-block-shape';
import type { ElementPosition } from '../models/layout-element.model';

function pts(...pairs: Array<[number, number]>): ElementPosition[] {
  return pairs.map(([xPct, yPct]) => ({ xPct, yPct }));
}

describe('classifyBlockShape', () => {
  it('classifies a clear triangle', () => {
    expect(classifyBlockShape(pts([0, 100], [50, 0], [100, 100]))).toBe('triangle');
  });

  it('classifies a square', () => {
    expect(classifyBlockShape(pts([0, 0], [100, 0], [100, 100], [0, 100]))).toBe('square');
  });

  it('classifies a rectangle', () => {
    expect(classifyBlockShape(pts([0, 0], [100, 0], [100, 40], [0, 40]))).toBe('rectangle');
  });

  it('classifies a near-circle polygon', () => {
    const circle: ElementPosition[] = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      circle.push({ xPct: 50 + 45 * Math.cos(a), yPct: 50 + 45 * Math.sin(a) });
    }
    expect(classifyBlockShape(circle)).toBe('circle');
  });

  it('classifies a wide oval polygon', () => {
    const oval: ElementPosition[] = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      oval.push({ xPct: 50 + 48 * Math.cos(a), yPct: 50 + 28 * Math.sin(a) });
    }
    expect(classifyBlockShape(oval)).toBe('oval');
  });

  it('keeps irregular pentagon as custom', () => {
    expect(
      classifyBlockShape(pts([0, 20], [40, 0], [100, 10], [80, 100], [10, 90])),
    ).toBe('custom');
  });

  it('simplifies colinear midpoints before classifying triangle', () => {
    const withColinear = pts([0, 100], [50, 100], [100, 100], [50, 0]);
    expect(simplifyPolygonCorners(withColinear).length).toBe(3);
    expect(classifyBlockShape(withColinear)).toBe('triangle');
  });
});
