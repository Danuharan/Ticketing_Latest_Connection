import { describe, expect, it } from 'vitest';

import { mapGeneratedLayoutToDescriptor } from './map-generated-dining-layout';
import type { GeneratedDiningLayoutDto } from '../models/dining-layout-generation.model';

describe('mapGeneratedLayoutToDescriptor', () => {
  it('maps generated geometry without reconstructing from a recipe id', () => {
    const layout: GeneratedDiningLayoutDto = {
      id: 'gen-central-aisle-9-0',
      name: 'Central Aisle',
      family: 'central-aisle',
      score: 91.6,
      capacity: 60,
      tableCount: 10,
      metrics: {
        capacityEfficiency: 80,
        spaceUtilisation: 70,
        guestFlow: 88,
        serviceEfficiency: 75,
        stageOrientation: 90,
        symmetry: 60,
        distributionQuality: 70,
      },
      tables: [
        {
          id: 't-1',
          label: '1',
          xPct: 22,
          yPct: 30,
          shape: 'round',
          seats: 6,
          widthM: 1.5,
          rotationDeg: 0,
          catalogueId: 'round-6',
        },
      ],
      fingerprint: 'central-aisle|n10|guest:5:1.2|round-6:2.00,2.00@0',
      previewSvg: '<svg></svg>',
      seed: 9,
    };

    const card = mapGeneratedLayoutToDescriptor(layout);
    expect(card.source).toBe('generated');
    expect(card.id).toBe('gen-central-aisle-9-0');
    expect(card.score).toBe(92);
    expect(card.generatedTables?.[0].widthM).toBe(1.5);
    expect(card.generatedTables?.[0].xPct).toBe(22);
  });

  it('preserves free stage and food-prep rotationDeg on descriptors', () => {
    const layout: GeneratedDiningLayoutDto = {
      id: 'gen-rot',
      name: 'Rotated Stage',
      family: 'regular-grid',
      score: 80,
      capacity: 24,
      tableCount: 4,
      metrics: {
        capacityEfficiency: 70,
        spaceUtilisation: 70,
        guestFlow: 70,
        serviceEfficiency: 70,
        stageOrientation: 70,
        symmetry: 70,
        distributionQuality: 70,
      },
      tables: [],
      fingerprint: 'rot',
      previewSvg: '<svg></svg>',
      seed: 1,
      stage: {
        xPct: 50,
        yPct: 10,
        widthM: 4,
        depthM: 1.2,
        sideEdgeId: 0,
        rotationDeg: 37,
      },
      foodPrep: {
        xPct: 50,
        yPct: 90,
        widthM: 2,
        depthM: 1,
        sideEdgeId: 2,
        rotationDeg: 12,
      },
    };

    const card = mapGeneratedLayoutToDescriptor(layout);
    expect(card.generatedStage?.rotationDeg).toBe(37);
    expect(card.generatedFoodPrepare?.rotationDeg).toBe(12);
  });
});
