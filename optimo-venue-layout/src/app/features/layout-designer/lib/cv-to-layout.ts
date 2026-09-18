/**
 * Converts CV detection + OCR labels into editable canvas elements:
 *   - uploaded chart as reference background (handled separately)
 *   - pitch as centerpiece (rectangle, oval, or circle — optional)
 *   - each block as semi-transparent custom polygon with label
 *   - stand names as label elements
 */

import { defaultTierEdits, type AiTierEdit } from './ai-tier-groups';
import { classifyBlockShape } from './classify-block-shape';
import { renormalizeFromCanvasPoints } from './custom-shape';
import type { CvAnalysisResult, LabeledBlock } from './assign-ocr-labels';
import type {
  LayoutElement,
  CenterpieceElement,
  LabelElement,
  ShapeId,
} from '../models/layout-element.model';

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `cv-${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function tierLabelForRing(ringIndex: number, tierEdits: Record<number, AiTierEdit>): string {
  return tierEdits[ringIndex]?.name ?? defaultTierEdits([ringIndex])[ringIndex]?.name ?? `Tier ${ringIndex + 1}`;
}

function blockToCustomElement(
  block: LabeledBlock,
  tierEdits: Record<number, AiTierEdit> = {},
): CenterpieceElement | null {
  const normalized = renormalizeFromCanvasPoints(block.polygon);
  if (!normalized) {
    return null;
  }
  const label = block.labelFromOcr ? block.assignedLabel : '';
  return {
    id: uid('block'),
    type: 'centerpiece',
    name: label,
    shape: classifyBlockShape(normalized.customPoints),
    label,
    curveDeg: 0,
    customPoints: normalized.customPoints,
    position: normalized.position,
    size: normalized.size,
    rotation: 0,
    ringIndex: block.ringIndex,
    tierLabel: tierLabelForRing(block.ringIndex, tierEdits),
    style: blueprintBlockStyle(block.fillColor),
  };
}

/** Semi-transparent fill matching AI-detected blocks on the blueprint. */
export function blueprintBlockStyle(fillColor: string): {
  fillColor: string;
  strokeColor: string;
  labelColor: string;
} {
  return {
    fillColor: hexWithAlpha(fillColor, 0.42),
    strokeColor: fillColor,
    labelColor: '#0f172a',
  };
}

function hexWithAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) {
    return `rgba(255,255,255,${alpha})`;
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function pitchToElement(
  result: CvAnalysisResult,
  options: { nameOverride?: string; shape?: ShapeId } = {},
): CenterpieceElement | null {
  const pitch = result.pitch;
  if (!pitch || pitch.size.wPct < 1 || pitch.size.hPct < 1) {
    return null;
  }
  const label = (options.nameOverride ?? pitch.name).trim() || 'Pitch';
  const shape = options.shape ?? pitch.detectedShape ?? 'rectangle';
  return {
    id: uid('pitch'),
    type: 'centerpiece',
    name: label,
    shape,
    label: label.toUpperCase(),
    curveDeg: 0,
    position: pitch.position,
    size: pitch.size,
    rotation: 0,
    style: {
      fillColor: 'rgba(34,197,94,0.15)',
      strokeColor: '#16a34a',
      labelColor: '#dc2626',
    },
  };
}

function standToLabel(stand: { name: string; xPct: number; yPct: number }): LabelElement {
  return {
    id: uid('stand'),
    type: 'label',
    name: stand.name,
    text: stand.name,
    fontSize: 13,
    fontWeight: 'bold',
    textAlign: 'center',
    position: { xPct: stand.xPct, yPct: stand.yPct },
    size: { wPct: 18, hPct: 5 },
    rotation: 0,
    style: { labelColor: '#0f172a' },
  };
}

export interface CvLayoutBuild {
  elements: LayoutElement[];
  /** Per labeledBlocks index: created element id, or null when the polygon was rejected. */
  blockElementIds: (string | null)[];
}

/** Build layout elements from CV + OCR merge result (background set separately). */
export function cvToLayoutElements(
  result: CvAnalysisResult,
  options: {
    centerpieceName?: string;
    centerpieceShape?: ShapeId;
    tierEdits?: Record<number, AiTierEdit>;
  } = {},
): CvLayoutBuild {
  const tierEdits = options.tierEdits ?? {};
  const elements: LayoutElement[] = [];
  const blockElementIds: (string | null)[] = [];

  const pitchEl = pitchToElement(result, {
    nameOverride: options.centerpieceName,
    shape: options.centerpieceShape,
  });
  if (pitchEl) {
    elements.push(pitchEl);
  }

  for (const block of result.labeledBlocks) {
    const el = blockToCustomElement(block, tierEdits);
    if (el) {
      elements.push(el);
    }
    blockElementIds.push(el?.id ?? null);
  }

  for (const stand of result.stands) {
    elements.push(standToLabel(stand));
  }

  return { elements, blockElementIds };
}
