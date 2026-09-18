import type { GenerateDiningLayoutsRequestDto } from '../models/dining-layout-generation.model';

/**
 * Canonical capacity identity. Excludes tableCount, seed, and excludeFingerprints.
 * Any geometry / catalogue / rule change resets capacity knowledge.
 */
export function diningCapacitySignature(req: GenerateDiningLayoutsRequestDto): string {
  return JSON.stringify({
    block: {
      id: req.block.id,
      polygon: req.block.polygon,
      widthM: req.block.widthM,
      depthM: req.block.depthM,
    },
    tableCatalogue: req.tableCatalogue,
    rules: req.rules,
    features: req.features,
    accessPoints: req.accessPoints,
    stageFacingAngleDeg: req.stageFacingAngleDeg ?? 0,
  });
}

/** Wizard-side physical identity. Must never include background/image/visual fields. */
export function diningWizardPhysicalCapacityKey(fields: {
  blockId: string;
  widthM: number;
  depthM: number;
  polygon: { x: number; y: number }[];
  shape: string;
  tableWidthM: number;
  tableDepthM: number;
  gapM: number;
  chairWidthM: number;
  chairLengthM: number;
  seats: number;
  stage: { w: number; d: number; x: number; y: number; r?: number } | null;
  food: { w: number; d: number; x: number; y: number; r?: number } | null;
  entrance: { x: number; y: number; w: number } | null;
  exit: { x: number; y: number; w: number } | null;
  stageClearanceM?: number;
  foodPrepClearanceM?: number;
  accessClearanceM?: number;
  serviceRouteClearanceM?: number;
  wallClearanceM?: number;
}): string {
  return JSON.stringify({
    blockId: fields.blockId,
    widthM: fields.widthM,
    depthM: fields.depthM,
    polygon: fields.polygon,
    shape: fields.shape,
    tableWidthM: fields.tableWidthM,
    tableDepthM: fields.tableDepthM,
    gapM: fields.gapM,
    chairWidthM: fields.chairWidthM,
    chairLengthM: fields.chairLengthM,
    seats: fields.seats,
    stage: fields.stage,
    food: fields.food,
    entrance: fields.entrance,
    exit: fields.exit,
    stageClearanceM: fields.stageClearanceM ?? null,
    foodPrepClearanceM: fields.foodPrepClearanceM ?? null,
    accessClearanceM: fields.accessClearanceM ?? null,
    serviceRouteClearanceM: fields.serviceRouteClearanceM ?? null,
    wallClearanceM: fields.wallClearanceM ?? null,
  });
}

export function generatorVersionMismatchMessage(
  expected: string,
  received: string | null | undefined,
): string | null {
  if (received === expected) {
    return null;
  }
  return `Dining generator version mismatch. Expected ${expected}, received ${received ?? 'unknown'}.`;
}

export interface DiningCapacityKnowledge {
  validatedFeasibleCount: number;
  provenMaximumCount: number | null;
  maximumProven: boolean;
  basicGeometricUpperBound: number;
  witnessTableCount: number;
  generatorVersion: string | null;
}

export function mergeCapacityKnowledge(
  previous: DiningCapacityKnowledge | null,
  incoming: DiningCapacityKnowledge,
  sameConfiguration: boolean,
): DiningCapacityKnowledge {
  if (!sameConfiguration || previous == null) {
    return { ...incoming };
  }
  const validatedFeasibleCount = Math.max(previous.validatedFeasibleCount, incoming.validatedFeasibleCount);
  const geometric = Math.max(previous.basicGeometricUpperBound, incoming.basicGeometricUpperBound);
  let provenMaximumCount: number | null = null;
  let maximumProven = false;
  if (incoming.maximumProven && incoming.provenMaximumCount != null && incoming.provenMaximumCount >= validatedFeasibleCount) {
    provenMaximumCount = incoming.provenMaximumCount;
    maximumProven = true;
  } else if (
    previous.maximumProven &&
    previous.provenMaximumCount != null &&
    previous.provenMaximumCount >= validatedFeasibleCount
  ) {
    provenMaximumCount = previous.provenMaximumCount;
    maximumProven = true;
  }
  return {
    validatedFeasibleCount,
    provenMaximumCount,
    maximumProven,
    basicGeometricUpperBound: geometric,
    witnessTableCount: Math.max(previous.witnessTableCount, incoming.witnessTableCount),
    generatorVersion: incoming.generatorVersion ?? previous.generatorVersion,
  };
}
