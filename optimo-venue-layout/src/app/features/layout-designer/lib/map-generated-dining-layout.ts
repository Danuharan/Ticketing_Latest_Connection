import type { DiningTableSpec } from '../models/layout-element.model';
import {
  DINING_FAMILY_DISPLAY,
  type DiningLayoutFamily,
  type GeneratedDiningLayoutDto,
} from '../models/dining-layout-generation.model';
import type { DiningLayoutPattern, DiningLayoutTemplateDescriptor } from './dining-layout-templates';

function familyToPattern(family: DiningLayoutFamily): DiningLayoutPattern {
  if (family === 'staggered' || family === 'stage-facing' || family === 'clustered' || family === 'balanced-around-stage') {
    return 'staggered';
  }
  if (family === 'banquet-open-centre' || family === 'perimeter' || family === 'split-sides') {
    return 'banquet';
  }
  return 'grid';
}

export function mapGeneratedLayoutToDescriptor(
  layout: GeneratedDiningLayoutDto,
): DiningLayoutTemplateDescriptor {
  const display = DINING_FAMILY_DISPLAY[layout.family];
  return {
    id: layout.id,
    name: layout.name,
    icon: display?.icon ?? '▦',
    description: `${layout.tableCount} tables · ${layout.capacity} seats`,
    tableCount: layout.tableCount,
    totalSeats: layout.capacity,
    template: familyToPattern(layout.family),
    stageSide: null,
    foodPrepareSide: null,
    exitSide: null,
    serviceRouteVertical: layout.family.includes('aisle'),
    previewSvg: layout.previewSvg,
    source: 'generated',
    family: layout.family,
    score: Math.round(layout.score),
    metrics: layout.metrics,
    fingerprint: layout.fingerprint,
    seed: layout.seed,
    generatedTables: layout.tables.map(
      (t): DiningTableSpec => ({
        id: t.id,
        label: t.label,
        xPct: t.xPct,
        yPct: t.yPct,
        shape: t.shape,
        seats: t.seats,
        widthM: t.widthM,
        depthM: t.depthM,
        rotationDeg: t.rotationDeg,
      }),
    ),
    generatedStage: layout.stage
      ? {
          xPct: layout.stage.xPct,
          yPct: layout.stage.yPct,
          widthM: layout.stage.widthM,
          depthM: layout.stage.depthM,
          sideEdgeId: layout.stage.sideEdgeId,
          rotationDeg: layout.stage.rotationDeg,
        }
      : undefined,
    generatedFoodPrepare: layout.foodPrep
      ? {
          xPct: layout.foodPrep.xPct,
          yPct: layout.foodPrep.yPct,
          widthM: layout.foodPrep.widthM,
          depthM: layout.foodPrep.depthM,
          sideEdgeId: layout.foodPrep.sideEdgeId,
          rotationDeg: layout.foodPrep.rotationDeg,
        }
      : undefined,
  };
}
