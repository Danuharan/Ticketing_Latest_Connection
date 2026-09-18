/**
 * Converts a `BlueprintAnalysisResult` (from the analyze-blueprint edge function)
 * into editable `LayoutElement[]` for the designer canvas:
 *   centerpiece -> CenterpieceElement
 *   each tier    -> LayerRingElement (with evenly-distributed SectorBlocks)
 *   each stand   -> LabelElement
 *
 * Everything stays in canvas-% space, so it drops straight onto the canvas and
 * remains fully editable by the user afterwards.
 */

import type {
  BlueprintAnalysisResult,
  BlueprintBlock,
  BlueprintTier,
} from '../models/blueprint-analysis.model';
import type {
  CenterpieceElement,
  LabelElement,
  LayerRingElement,
  LayoutElement,
  SectorBlock,
  ShapeId,
} from '../models/layout-element.model';

const RING_PALETTE: { fill: string; stroke: string; label: string }[] = [
  { fill: '#e0f2fe', stroke: '#7dd3fc', label: '#0c4a6e' },
  { fill: '#f3e8ff', stroke: '#d8b4fe', label: '#6b21a8' },
  { fill: '#dcfce7', stroke: '#86efac', label: '#166534' },
  { fill: '#fef9c3', stroke: '#fde047', label: '#854d0e' },
  { fill: '#ffe4e6', stroke: '#fda4af', label: '#9f1239' },
];

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `ai-${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function toShapeId(shape: string): ShapeId {
  const allowed: ShapeId[] = [
    'oval',
    'circle',
    'rectangle',
    'square',
    'curved',
    'triangle',
    'hexagon',
    'octagon',
    'd-end',
    'custom',
  ];
  return (allowed as string[]).includes(shape) ? (shape as ShapeId) : 'oval';
}

function buildSectorBlocks(tier: BlueprintTier): SectorBlock[] {
  const blocks = tier.blocks ?? [];
  const count = Math.max(blocks.length, 1);
  const step = 360 / count;

  return blocks.map((block: BlueprintBlock, i: number) => {
    const hasAngles =
      typeof block.startAngleDeg === 'number' &&
      typeof block.endAngleDeg === 'number';
    return {
      id: uid('sector'),
      code: block.name || `B${String(i + 1).padStart(2, '0')}`,
      startAngleDeg: hasAngles ? (block.startAngleDeg as number) : -90 + step * i,
      endAngleDeg: hasAngles ? (block.endAngleDeg as number) : -90 + step * (i + 1),
      rows: Math.max(0, Math.round(block.rows ?? tier.rowsPerBlock ?? 0)),
      seatsPerRow: Math.max(
        0,
        Math.round(block.seatsPerRow ?? tier.seatsPerRow ?? 0),
      ),
    };
  });
}

function buildCenterpiece(result: BlueprintAnalysisResult): CenterpieceElement {
  const cp = result.centerpiece;
  return {
    id: uid('center'),
    type: 'centerpiece',
    name: cp.name || 'Ground',
    shape: toShapeId(cp.shape),
    label: cp.name || 'Ground',
    curveDeg: 0,
    position: { xPct: cp.position.xPct, yPct: cp.position.yPct },
    size: { wPct: cp.size.wPct, hPct: cp.size.hPct },
    rotation: 0,
    style: { fillColor: '#dbeafe', strokeColor: '#93c5fd', labelColor: '#1e3a8a' },
  };
}

function buildRing(tier: BlueprintTier, paletteIndex: number): LayerRingElement {
  const palette = RING_PALETTE[paletteIndex % RING_PALETTE.length];
  return {
    id: uid('ring'),
    type: 'layer-ring',
    name: tier.name || `Tier ${tier.ringIndex + 1}`,
    label: tier.tierCode || tier.name || `Tier ${tier.ringIndex + 1}`,
    thicknessPct: tier.thicknessPct,
    rowLabelStyle: 'letter',
    blocks: buildSectorBlocks(tier),
    position: { xPct: tier.position.xPct, yPct: tier.position.yPct },
    size: { wPct: tier.size.wPct, hPct: tier.size.hPct },
    rotation: 0,
    style: {
      fillColor: palette.fill,
      strokeColor: palette.stroke,
      labelColor: palette.label,
    },
  };
}

function buildStandLabel(
  name: string,
  xPct: number,
  yPct: number,
  rotationDeg: number,
  fontSize: number,
): LabelElement {
  return {
    id: uid('label'),
    type: 'label',
    name: name || 'Stand',
    text: name || 'Stand',
    fontSize: Math.round(fontSize) || 14,
    fontWeight: 'bold',
    textAlign: 'center',
    position: { xPct, yPct },
    size: { wPct: 20, hPct: 6 },
    rotation: rotationDeg || 0,
    style: { labelColor: '#0f172a' },
  };
}

export function blueprintToLayoutElements(
  result: BlueprintAnalysisResult,
): LayoutElement[] {
  const elements: LayoutElement[] = [buildCenterpiece(result)];

  const sortedTiers = [...(result.tiers ?? [])].sort(
    (a, b) => a.ringIndex - b.ringIndex,
  );
  sortedTiers.forEach((tier, i) => {
    if ((tier.blocks ?? []).length > 0) {
      elements.push(buildRing(tier, i));
    }
  });

  for (const stand of result.stands ?? []) {
    elements.push(
      buildStandLabel(
        stand.name,
        stand.position.xPct,
        stand.position.yPct,
        stand.rotationDeg,
        stand.fontSize,
      ),
    );
  }

  return elements;
}

/** Quick stats for the review/summary panel. */
export function summarizeBlueprint(result: BlueprintAnalysisResult): {
  tierCount: number;
  blockCount: number;
  seatCount: number;
  standCount: number;
} {
  const tiers = result.tiers ?? [];
  let blockCount = 0;
  let seatCount = 0;
  for (const tier of tiers) {
    const blocks = tier.blocks ?? [];
    blockCount += blocks.length;
    for (const block of blocks) {
      seatCount +=
        Math.max(0, block.rows ?? 0) * Math.max(0, block.seatsPerRow ?? 0);
    }
  }
  return {
    tierCount: tiers.length,
    blockCount,
    seatCount,
    standCount: (result.stands ?? []).length,
  };
}
