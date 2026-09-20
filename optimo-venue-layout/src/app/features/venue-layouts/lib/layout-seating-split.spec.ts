import { describe, expect, it } from 'vitest';

import type { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import type { CenterpieceElement } from '../../layout-designer/models/layout-element.model';
import {
  collectBlockSeatingEntries,
  mergeSeatingIntoLayout,
  stripSeatingFromLayout,
} from './layout-seating-split';

function seatingBlock(overrides: Partial<CenterpieceElement> = {}): CenterpieceElement {
  return {
    id: 'cv-block-1',
    type: 'centerpiece',
    name: '',
    label: '',
    shape: 'custom',
    blockType: 'seating',
    curveDeg: 0,
    customPoints: [
      { xPct: 0, yPct: 0 },
      { xPct: 100, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ],
    position: { xPct: 40, yPct: 30 },
    size: { wPct: 6, hPct: 10 },
    rotation: 0,
    style: { fillColor: '#fff', strokeColor: '#000', labelColor: '#000' },
    venueBlockId: 'block-uuid-1',
    appliedConfigId: 'config-uuid-1',
    appliedConfigName: 'CUSTOM',
    customSideNames: ['Side 1', 'Side 2', 'Side 3', 'Side 4'],
    gaConfiguredSides: [
      { label: 'Side 1', lengthM: 9.43, logicalId: 0 },
      { label: 'Side 2', lengthM: 17.24, logicalId: 1 },
      { label: 'Side 3', lengthM: 1.23, logicalId: 2 },
      { label: 'Side 4', lengthM: 10.48, logicalId: 3 },
    ],
    seatPositionOverrides: { A1: { xPct: 10, yPct: 10 } },
    seatLayout: { rows: 1, seatsPerRow: 1, rowSeatCounts: [1] },
    rows: 1,
    seatsPerRow: 1,
    autoFillStraightSeatPositions: { A1: { xPct: 10, yPct: 10 } },
    customSideLengthsM: [9.43, 17.24, 1.23, 10.48],
    seatStartSide: 'left',
    blockViewpointManuallySet: true,
    ...overrides,
  };
}

function layoutWith(el: CenterpieceElement): VenueLayoutConfig {
  return {
    version: 1,
    canvas: { width: 1000, height: 800 },
    elements: [el],
  };
}

describe('layout-seating-split boundary', () => {
  it('strips seating-edit fields from shell including seatStartSide / viewpoint flag', () => {
    const stripped = stripSeatingFromLayout(layoutWith(seatingBlock()));
    const el = stripped.elements[0] as CenterpieceElement;

    expect(el.gaConfiguredSides).toBeUndefined();
    expect(el.customSideNames).toBeUndefined();
    expect(el.appliedConfigId).toBeUndefined();
    expect(el.appliedConfigName).toBeUndefined();
    expect(el.seatStartSide).toBeUndefined();
    expect(el.blockViewpointManuallySet).toBeUndefined();
    expect(el.seatPositionOverrides).toBeUndefined();
    expect(el.autoFillStraightSeatPositions).toBeUndefined();
    // Geometry + venueBlockId stay on the shell.
    expect(el.venueBlockId).toBe('block-uuid-1');
    expect(el.position).toEqual({ xPct: 40, yPct: 30 });
    expect(el.customPoints?.length).toBe(4);
  });

  it('stamps seat totals on the shell so hover works before seating is fetched', () => {
    const stripped = stripSeatingFromLayout(layoutWith(seatingBlock()));
    const el = stripped.elements[0] as CenterpieceElement;

    expect(el.seatingSummary).toEqual({ rows: 1, columns: 1, totalSeats: 1 });
  });

  it('keeps the loaded summary for a block whose seating was never fetched', () => {
    // A shell straight out of layout_config: summary present, seating absent.
    const shellOnly = seatingBlock({
      seatLayout: undefined,
      rows: undefined,
      seatsPerRow: undefined,
      seatPositionOverrides: undefined,
      autoFillStraightSeatPositions: undefined,
      seatingSummary: { rows: 22, columns: 14, totalSeats: 127 },
    });

    const stripped = stripSeatingFromLayout(layoutWith(shellOnly));
    const el = stripped.elements[0] as CenterpieceElement;

    expect(el.seatingSummary).toEqual({ rows: 22, columns: 14, totalSeats: 127 });
  });

  it('drops the summary once a block has no seating left', () => {
    const emptied = seatingBlock({
      seatLayout: undefined,
      rows: undefined,
      seatsPerRow: undefined,
      seatPositionOverrides: undefined,
      autoFillStraightSeatPositions: undefined,
      seatingSummary: undefined,
    });

    const stripped = stripSeatingFromLayout(layoutWith(emptied));
    const el = stripped.elements[0] as CenterpieceElement;

    expect(el.seatingSummary).toBeUndefined();
  });

  it('collects seatStartSide and blockViewpointManuallySet into seating snapshot', () => {
    const entries = collectBlockSeatingEntries(layoutWith(seatingBlock()));
    expect(entries).toHaveLength(1);
    expect(entries[0].seating.seatStartSide).toBe('left');
    expect(entries[0].seating.blockViewpointManuallySet).toBe(true);
  });

  it('collects measurements into seating even when seats are not placed yet', () => {
    const entries = collectBlockSeatingEntries(
      layoutWith(
        seatingBlock({
          seatPositionOverrides: undefined,
          seatLayout: undefined,
          rows: undefined,
          seatsPerRow: undefined,
          autoFillStraightSeatPositions: undefined,
          customSideLengthsM: undefined,
        }),
      ),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].seating.gaConfiguredSides).toHaveLength(4);
    expect(entries[0].seating.customSideNames).toEqual(['Side 1', 'Side 2', 'Side 3', 'Side 4']);
    expect(entries[0].seating.appliedConfigName).toBe('CUSTOM');
  });

  it('merges seating back and prefers snapshot over shell for measurements', () => {
    const shell = stripSeatingFromLayout(layoutWith(seatingBlock()));
    // Simulate a legacy shell that still has gaConfiguredSides (pre-migration).
    const legacyShell = structuredClone(shell);
    const legacyEl = legacyShell.elements[0] as CenterpieceElement;
    legacyEl.gaConfiguredSides = [{ label: 'OLD', lengthM: 1, logicalId: 0 }];
    legacyEl.customSideNames = ['OLD'];
    legacyEl.appliedConfigName = 'OLD_NAME';

    const merged = mergeSeatingIntoLayout(legacyShell, [
      {
        element_id: 'cv-block-1',
        block_id: 'block-uuid-1',
        master_config_template_id: 'config-uuid-1',
        config: {
          seating: {
            gaConfiguredSides: [
              { label: 'Side 1', lengthM: 9.43, logicalId: 0 },
            ],
            customSideNames: ['Side 1'],
            appliedConfigName: 'CUSTOM',
            seatPositionOverrides: { A1: { xPct: 10, yPct: 10 } },
            rows: 1,
            seatsPerRow: 1,
          },
        },
      },
    ]);

    const el = merged.elements[0] as CenterpieceElement;
    expect(el.gaConfiguredSides?.[0]?.label).toBe('Side 1');
    expect(el.customSideNames).toEqual(['Side 1']);
    expect(el.appliedConfigName).toBe('CUSTOM');
    expect(el.appliedConfigId).toBe('config-uuid-1');
    expect(el.venueBlockId).toBe('block-uuid-1');
    expect(el.seatPositionOverrides?.['A1']).toEqual({ xPct: 10, yPct: 10 });
  });

  it('falls back to shell measurements when seating snapshot lacks them (legacy rows)', () => {
    const shell = stripSeatingFromLayout(layoutWith(seatingBlock()));
    const legacyShell = structuredClone(shell);
    const legacyEl = legacyShell.elements[0] as CenterpieceElement;
    legacyEl.gaConfiguredSides = [{ label: 'SHELL', lengthM: 5, logicalId: 0 }];
    legacyEl.customSideNames = ['SHELL'];
    legacyEl.appliedConfigName = 'SHELL_NAME';
    legacyEl.seatStartSide = 'right';
    legacyEl.blockViewpointManuallySet = true;

    const merged = mergeSeatingIntoLayout(legacyShell, [
      {
        element_id: 'cv-block-1',
        block_id: 'block-uuid-1',
        master_config_template_id: 'config-uuid-1',
        config: {
          seating: {
            seatPositionOverrides: { A1: { xPct: 1, yPct: 1 } },
            rows: 1,
            seatsPerRow: 1,
          },
        },
      },
    ]);

    const el = merged.elements[0] as CenterpieceElement;
    expect(el.gaConfiguredSides?.[0]?.label).toBe('SHELL');
    expect(el.customSideNames).toEqual(['SHELL']);
    expect(el.appliedConfigName).toBe('SHELL_NAME');
    expect(el.seatStartSide).toBe('right');
    expect(el.blockViewpointManuallySet).toBe(true);
  });
});
