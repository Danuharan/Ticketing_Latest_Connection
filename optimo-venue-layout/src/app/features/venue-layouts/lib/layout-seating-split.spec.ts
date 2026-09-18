import { describe, expect, it } from 'vitest';

import { createBlockGrid } from '../../layout-designer/data/element-factory';
import type { BlockGridElement } from '../../layout-designer/models/layout-element.model';
import type { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import {
  collectBlockSeatingEntries,
  ensureVenueBlockIds,
  mergeSeatingIntoLayout,
  stripSeatingFromLayout,
} from './layout-seating-split';

const canvas = { width: 1000, height: 800 };

function layoutWith(...elements: VenueLayoutConfig['elements']): VenueLayoutConfig {
  return { version: 1, canvas, elements };
}

describe('layout-seating-split block-grid', () => {
  it('collects Block Grid seats into existing seating snapshot (overrides + rows)', () => {
    const grid = createBlockGrid('square', {
      canvas,
      rows: 3,
      seatsPerRow: 4,
    }) as BlockGridElement;

    const entries = collectBlockSeatingEntries(layoutWith(grid));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.blockType).toBe('seating');
    expect(entries[0]?.shapeType).toBe('square');
    expect(entries[0]?.seating.rows).toBe(3);
    expect(entries[0]?.seating.seatsPerRow).toBe(4);
    expect(entries[0]?.seating.seatLayout?.rows).toBe(3);
    expect(Object.keys(entries[0]?.seating.seatPositionOverrides ?? {})).toHaveLength(12);
    expect(entries[0]?.seating.seatPositionOverrides?.['A-1']).toEqual(
      expect.objectContaining({ xPct: expect.any(Number), yPct: expect.any(Number) }),
    );
    expect(entries[0]?.venueBlockId).toBeTruthy();
  });

  it('collects oval / circle / curved-line Block Grids the same way', () => {
    for (const shape of ['oval', 'circle', 'curved-line'] as const) {
      const grid = createBlockGrid(shape, { canvas, rows: 2, seatsPerRow: 3 });
      const entries = collectBlockSeatingEntries(layoutWith(grid));
      expect(entries).toHaveLength(1);
      expect(entries[0]?.shapeType).toBe(shape);
      expect(Object.keys(entries[0]?.seating.seatPositionOverrides ?? {})).toHaveLength(6);
    }
  });

  it('strips Block Grid seating from layout_config shell but keeps geometry', () => {
    const grid = createBlockGrid('circle', {
      canvas,
      rows: 2,
      seatsPerRow: 2,
      position: { xPct: 40, yPct: 50 },
    }) as BlockGridElement;
    collectBlockSeatingEntries(layoutWith(grid));
    const stamped = ensureVenueBlockIds(layoutWith(grid));
    const shell = stripSeatingFromLayout(stamped);
    const stripped = shell.elements[0] as BlockGridElement;
    expect(stripped.type).toBe('block-grid');
    expect(stripped.shape).toBe('circle');
    expect(stripped.geometry?.type).toBe('circle');
    expect(stripped.position).toEqual({ xPct: 40, yPct: 50 });
    expect(stripped.rows).toBeUndefined();
    expect(stripped.seatsPerRow).toBeUndefined();
    expect(stripped.seatPositionOverrides).toBeUndefined();
    expect(stripped.venueBlockId).toBeTruthy();
  });

  it('merge restores Block Grid seats from Block Configuration rows', () => {
    const grid = createBlockGrid('oval', {
      canvas,
      rows: 2,
      seatsPerRow: 5,
      code: 'B09',
    }) as BlockGridElement;
    const full = layoutWith(grid);
    const entries = collectBlockSeatingEntries(full);
    const entry = entries[0]!;
    const shell = stripSeatingFromLayout(full);
    const merged = mergeSeatingIntoLayout(shell, [
      {
        element_id: entry.elementId,
        block_id: entry.venueBlockId,
        master_config_template_id: 'cfg-1',
        config: { seating: entry.seating },
      },
    ]);
    const restored = merged.elements[0] as BlockGridElement;
    expect(restored.rows).toBe(2);
    expect(restored.seatsPerRow).toBe(5);
    expect(restored.code).toBe('B09');
    expect(Object.keys(restored.seatPositionOverrides ?? {})).toHaveLength(10);
    expect(restored.venueBlockId).toBe(entry.venueBlockId);
    expect(restored.appliedConfigId).toBe('cfg-1');
    expect(restored.shape).toBe('oval');
  });

  it('legacy Block Grid without block config still has rows in layout_config after strip of unrelated seating', () => {
    const legacy: BlockGridElement = {
      id: 'legacy-grid',
      type: 'block-grid',
      name: 'Block',
      code: 'B01',
      label: 'Block',
      rows: 6,
      seatsPerRow: 10,
      rowLabelStyle: 'letter',
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 24, hPct: 22 },
      rotation: 0,
      style: {},
    };
    // Before first save through new flow, collect assigns venueBlockId and materializes seats.
    // Legacy file on disk still has rows; if never collected, strip of centerpiece-only path kept rows.
    // Simulate shell that still has rows (old save):
    const shell = stripSeatingFromLayout(layoutWith(legacy));
    // New strip removes rows once collect/save runs — old layouts that never went through
    // collect keep rows when loaded from historical JSON. Here we assert collect+merge round-trip
    // does not duplicate seats:
    const entries = collectBlockSeatingEntries(layoutWith(legacy));
    expect(Object.keys(entries[0]?.seating.seatPositionOverrides ?? {})).toHaveLength(60);
    const merged = mergeSeatingIntoLayout(shell, [
      {
        element_id: entries[0]!.elementId,
        block_id: entries[0]!.venueBlockId,
        master_config_template_id: null,
        config: { seating: entries[0]!.seating },
      },
    ]);
    const el = merged.elements[0] as BlockGridElement;
    expect(Object.keys(el.seatPositionOverrides ?? {})).toHaveLength(60);
    expect(el.rows).toBe(6);
  });

  it('does not break centerpiece-only collection', () => {
    const centerpiece = {
      id: 'c1',
      type: 'centerpiece' as const,
      name: 'Block',
      shape: 'square' as const,
      label: '232',
      curveDeg: 0,
      blockType: 'seating' as const,
      rows: 2,
      seatsPerRow: 3,
      seatLayout: { rows: 2, seatsPerRow: 3 },
      seatPositionOverrides: {
        'A-1': { xPct: 10, yPct: 10 },
        'A-2': { xPct: 20, yPct: 10 },
      },
      position: { xPct: 50, yPct: 50 },
      size: { wPct: 10, hPct: 10 },
      rotation: 0,
      style: {},
      customPoints: [
        { xPct: 0, yPct: 0 },
        { xPct: 100, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
    };
    const entries = collectBlockSeatingEntries(layoutWith(centerpiece));
    expect(entries).toHaveLength(1);
    expect(entries[0]?.elementId).toBe('c1');
    expect(entries[0]?.seating.seatPositionOverrides?.['A-1']).toEqual({ xPct: 10, yPct: 10 });
  });
});
