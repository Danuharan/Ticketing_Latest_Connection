import type { CvAnalysisResult, LabeledBlock } from './assign-ocr-labels';

export interface AiTierGroup {
  ringIndex: number;
  name: string;
  tierCode: string;
  fillColor: string;
  strokeColor: string;
  blocks: LabeledBlock[];
  blockCount: number;
  blockPreview: string;
}

export interface AiTierEdit {
  name: string;
  tierCode: string;
}

const TIER_FILL = ['#dbeafe', '#f3e8ff', '#dcfce7', '#fef9c3', '#fce7f3', '#e0f2fe'];
const TIER_STROKE = ['#bfdbfe', '#e9d5ff', '#bbf7d0', '#fef08a', '#fbcfe8', '#7dd3fc'];

export const MAX_AI_TIERS = 6;
const DEFAULT_TIER_NAMES = ['Inner Tier', 'Thin Tier', 'B Tier', 'Outer Tier', 'Tier 5', 'Tier 6'];
const DEFAULT_TIER_CODES = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export function defaultTierEdits(ringIndices: number[]): Record<number, AiTierEdit> {
  const edits: Record<number, AiTierEdit> = {};
  const sorted = [...ringIndices].sort((a, b) => a - b);
  for (const ringIndex of sorted) {
    edits[ringIndex] = {
      name: DEFAULT_TIER_NAMES[ringIndex] ?? `Tier ${ringIndex + 1}`,
      tierCode: DEFAULT_TIER_CODES[ringIndex] ?? `T${ringIndex + 1}`,
    };
  }
  return edits;
}

function formatBlockPreview(blocks: LabeledBlock[], max = 8): string {
  if (blocks.length === 0) {
    return 'none yet';
  }
  const labels = blocks.map((b) => b.assignedLabel).filter((l) => l.length > 0);
  if (labels.length <= max) {
    return labels.join(', ');
  }
  return `${labels.slice(0, max).join(', ')} +${labels.length - max} more`;
}

export function buildTierGroups(
  result: CvAnalysisResult,
  edits: Record<number, AiTierEdit>,
  extraRingIndices: number[] = [],
): AiTierGroup[] {
  const byRing = new Map<number, LabeledBlock[]>();
  for (const block of result.labeledBlocks) {
    const list = byRing.get(block.ringIndex) ?? [];
    list.push(block);
    byRing.set(block.ringIndex, list);
  }
  for (const ringIndex of extraRingIndices) {
    if (!byRing.has(ringIndex)) {
      byRing.set(ringIndex, []);
    }
  }

  return [...byRing.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ringIndex, blocks], displayIndex) => {
      const edit = edits[ringIndex] ?? {
        name: DEFAULT_TIER_NAMES[displayIndex] ?? `Tier ${displayIndex + 1}`,
        tierCode: DEFAULT_TIER_CODES[displayIndex] ?? `T${displayIndex + 1}`,
      };
      return {
        ringIndex,
        name: edit.name,
        tierCode: edit.tierCode,
        fillColor: TIER_FILL[displayIndex % TIER_FILL.length],
        strokeColor: TIER_STROKE[displayIndex % TIER_STROKE.length],
        blocks,
        blockCount: blocks.length,
        blockPreview: formatBlockPreview(blocks),
      };
    });
}

export function buildDetectionParagraph(result: CvAnalysisResult): string {
  const rings = new Set(result.labeledBlocks.map((b) => b.ringIndex)).size;
  return `Detected ${result.labeledBlocks.length} polygon blocks across ${rings} layer(s) from image borders. Block labels come from OCR text inside each coloured section.`;
}

export function venueTitleFromResult(result: CvAnalysisResult): string {
  if (result.pitch) {
    return 'Stadium Layout';
  }
  return result.labeledBlocks.length >= 80 ? 'Multi Purpose' : 'Venue Layout';
}
