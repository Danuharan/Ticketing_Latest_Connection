import { describe, expect, it } from 'vitest';

import type { GenerateDiningLayoutsRequestDto } from '../models/dining-layout-generation.model';
import { DEFAULT_DINING_LAYOUT_RULES } from '../models/dining-layout-generation.model';
import {
  diningCapacitySignature,
  diningWizardPhysicalCapacityKey,
  generatorVersionMismatchMessage,
  mergeCapacityKnowledge,
} from './dining-capacity-signature';

function request(overrides: Partial<GenerateDiningLayoutsRequestDto> = {}): GenerateDiningLayoutsRequestDto {
  return {
    block: {
      id: 'b',
      polygon: [
        { x: 0, y: 0 },
        { x: 5.6, y: 0 },
        { x: 5.6, y: 7.73 },
        { x: 0, y: 7.73 },
      ],
      widthM: 5.6,
      depthM: 7.73,
    },
    accessPoints: { entrances: [], exits: [] },
    features: {},
    tableCatalogue: [
      {
        id: 'round',
        name: 'Round',
        shape: 'round',
        widthM: 0.6,
        depthM: 0.6,
        capacity: 3,
        chairWidthM: 0.4,
        chairDepthM: 0.5,
        allowed: true,
      },
    ],
    target: { tableCount: 8 },
    rules: { ...DEFAULT_DINING_LAYOUT_RULES },
    generation: { suggestionCount: 6, seed: 1, excludeFingerprints: ['a'] },
    ...overrides,
  };
}

describe('diningCapacitySignature', () => {
  it('ignores tableCount, seed, and excludeFingerprints', () => {
    const a = diningCapacitySignature(request({ target: { tableCount: 3 }, generation: { suggestionCount: 6, seed: 1 } }));
    const b = diningCapacitySignature(
      request({
        target: { tableCount: 9 },
        generation: { suggestionCount: 4, seed: 99, excludeFingerprints: ['z'] },
      }),
    );
    expect(a).toBe(b);
  });

  it('changes when polygon, Stage, access, or rules change', () => {
    const base = diningCapacitySignature(request());
    expect(
      diningCapacitySignature(
        request({
          block: {
            id: 'b',
            polygon: [
              { x: 0, y: 0 },
              { x: 6, y: 0 },
              { x: 6, y: 7.73 },
              { x: 0, y: 7.73 },
            ],
            widthM: 6,
            depthM: 7.73,
          },
        }),
      ),
    ).not.toBe(base);
    expect(
      diningCapacitySignature(request({ features: { stage: { xM: 2.8, yM: 3.865, widthM: 3.3, depthM: 0.9 } } })),
    ).not.toBe(base);
    expect(
      diningCapacitySignature(
        request({
          accessPoints: {
            entrances: [{ kind: 'entrance', xM: 2.8, yM: 0.25, widthM: 1.5, depthM: 0.5 }],
            exits: [],
          },
        }),
      ),
    ).not.toBe(base);
    expect(
      diningCapacitySignature(request({ rules: { ...DEFAULT_DINING_LAYOUT_RULES, wallClearanceM: 0.2 } })),
    ).not.toBe(base);
  });

  it('ignores visual-only extras on the block object', () => {
    const base = diningCapacitySignature(request());
    const withVisual = diningCapacitySignature(
      request({
        block: {
          id: 'b',
          polygon: [
            { x: 0, y: 0 },
            { x: 5.6, y: 0 },
            { x: 5.6, y: 7.73 },
            { x: 0, y: 7.73 },
          ],
          widthM: 5.6,
          depthM: 7.73,
          diningLayoutReferenceImage: { dataUrl: 'data:image/jpeg;base64,AAA', name: 'hall.jpg' },
          clipSignature: 'custom:0,0|100,0',
        } as GenerateDiningLayoutsRequestDto['block'] & {
          diningLayoutReferenceImage: { dataUrl: string; name: string };
          clipSignature: string;
        },
      }),
    );
    expect(withVisual).toBe(base);
  });
});

describe('diningWizardPhysicalCapacityKey', () => {
  const physical = {
    blockId: 'block-16',
    widthM: 6.13,
    depthM: 9.19,
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
    shape: 'round',
    tableWidthM: 1.05,
    tableDepthM: 1.05,
    gapM: 0.6,
    chairWidthM: 0.4,
    chairLengthM: 0.5,
    seats: 4,
    stage: null,
    food: null,
    entrance: { x: 50, y: 3, w: 1.5 },
    exit: { x: 50, y: 3, w: 1.5 },
  };

  it('is unchanged by background image / crop / visibility fields', () => {
    const a = diningWizardPhysicalCapacityKey(physical);
    const b = diningWizardPhysicalCapacityKey({
      ...physical,
      ...({
        diningLayoutReferenceImage: { dataUrl: 'data:image/jpeg;base64,AAA', name: 'hall.jpg' },
        clipSignature: 'rect',
        visible: false,
      } as object),
    });
    expect(b).toBe(a);
  });

  it('changes when table diameter changes', () => {
    expect(diningWizardPhysicalCapacityKey({ ...physical, tableWidthM: 1.25 })).not.toBe(
      diningWizardPhysicalCapacityKey(physical),
    );
  });
});

describe('generatorVersionMismatchMessage', () => {
  it('rejects a stale remote version', () => {
    expect(generatorVersionMismatchMessage('2026-08-18-capacity-certification-v1', '2026-08-18-footprint-semantics-v1')).toBe(
      'Dining generator version mismatch. Expected 2026-08-18-capacity-certification-v1, received 2026-08-18-footprint-semantics-v1.',
    );
    expect(generatorVersionMismatchMessage('2026-08-18-capacity-certification-v1', '2026-08-18-capacity-certification-v1')).toBeNull();
  });
});

describe('mergeCapacityKnowledge', () => {
  it('never downgrades a validated witness on the same configuration', () => {
    const merged = mergeCapacityKnowledge(
      {
        validatedFeasibleCount: 6,
        provenMaximumCount: null,
        maximumProven: false,
        basicGeometricUpperBound: 12,
        witnessTableCount: 6,
        generatorVersion: 'v1',
      },
      {
        validatedFeasibleCount: 3,
        provenMaximumCount: null,
        maximumProven: false,
        basicGeometricUpperBound: 12,
        witnessTableCount: 3,
        generatorVersion: 'v1',
      },
      true,
    );
    expect(merged.validatedFeasibleCount).toBe(6);
    expect(merged.maximumProven).toBe(false);
  });
});
