/** Sum of polygon side lengths (metres). */
export function sumSideLengthsM(lengths: number[]): number {
  return lengths.reduce((total, length) => total + Math.max(0, length), 0);
}

/**
 * Scale factor when a reference block's configured perimeter changes.
 * Example: 3+7+3+7=20 → 14+6+14+6=40 gives factor 2, so 6+2+6+2 becomes 12+4+12+4.
 */
export function computeBlockMeasurementScaleFactor(
  baselineLengthsM: number[],
  configuredLengthsM: number[],
): number {
  const baselineTotal = sumSideLengthsM(baselineLengthsM);
  const configuredTotal = sumSideLengthsM(configuredLengthsM);
  if (baselineTotal <= 0 || configuredTotal <= 0) {
    return 1;
  }
  return configuredTotal / baselineTotal;
}

/** Scale factor when a single side length is edited (new ÷ baseline). */
export function computeSideScaleFactorFromSingleEdit(
  baselineLengthM: number,
  newLengthM: number,
): number {
  if (baselineLengthM <= 0 || newLengthM <= 0 || !Number.isFinite(newLengthM)) {
    return 1;
  }
  return newLengthM / baselineLengthM;
}

/** Scale every side length in a map by the same factor. */
export function scaleSideLengthMapByFactor(
  baselines: Record<number, number>,
  factor: number,
): Record<number, number> {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const scaled: Record<number, number> = {};
  for (const [key, length] of Object.entries(baselines)) {
    scaled[Number(key)] = scaleSideLengthsM([length], safeFactor)[0];
  }
  return scaled;
}

/** Apply a shared measurement scale factor to each default side length. */
export function scaleSideLengthsM(
  baselineLengthsM: number[],
  factor: number,
): number[] {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return baselineLengthsM.map(
    (length) => Math.round(Math.max(0.1, length * safeFactor) * 100) / 100,
  );
}

/** Per-side increase/decrease from reference baseline → configured lengths. */
export function computeSideLengthDeltasM(
  baselineLengthsM: number[],
  configuredLengthsM: number[],
): number[] {
  const count = Math.max(baselineLengthsM.length, configuredLengthsM.length);
  return Array.from({ length: count }, (_, index) => {
    const baseline = baselineLengthsM[index] ?? 0;
    const configured = configuredLengthsM[index] ?? baseline;
    return configured - baseline;
  });
}

/** Add reference side deltas to a block's baseline side lengths. */
export function applySideLengthDeltasM(
  baselineLengthsM: number[],
  deltasM: number[],
): number[] {
  const count = Math.max(baselineLengthsM.length, deltasM.length);
  return Array.from({ length: count }, (_, index) => {
    const baseline = baselineLengthsM[index] ?? 0;
    const delta = deltasM[index] ?? 0;
    return Math.round(Math.max(0.1, baseline + delta) * 100) / 100;
  });
}

/** Side lengths saved on a block, or its geometric default estimate. */
export function resolveBlockDisplaySideLengthsM(
  storedLengthsM: number[] | undefined,
  defaultLengthsM: number[],
): number[] {
  const stored = storedLengthsM ?? [];
  const positiveCount = stored.filter((len) => len > 0.05).length;
  if (positiveCount >= 3 && stored.length >= 3) {
    return stored;
  }
  return defaultLengthsM;
}

/** Auto Fill inspector: scaled lengths for non-reference blocks, reference config for reference. */
export function resolveAutoFillDisplaySideLengthsM(
  blockId: string,
  storedLengthsM: number[] | undefined,
  defaultLengthsM: number[],
  config: {
    applyBlockMeasurementScale?: boolean;
    referenceBlockId?: string | null;
    referenceBaselineSideLengthsM?: number[];
    referenceSideLengthsM?: number[];
    blockMeasurementBaselines?: Record<string, number[]>;
  },
): number[] {
  if (defaultLengthsM.length < 3) {
    return defaultLengthsM;
  }

  if (blockId === config.referenceBlockId) {
    if ((config.referenceSideLengthsM?.length ?? 0) >= 3) {
      return config.referenceSideLengthsM!;
    }
    return resolveBlockDisplaySideLengthsM(storedLengthsM, defaultLengthsM);
  }

  const stored = resolveBlockDisplaySideLengthsM(storedLengthsM, defaultLengthsM);
  const hasStored =
    (storedLengthsM?.filter((len) => len > 0.05).length ?? 0) >= 3 &&
    (storedLengthsM?.length ?? 0) >= 3;

  const referenceBaseline = config.referenceBaselineSideLengthsM ?? [];
  const referenceCurrent = config.referenceSideLengthsM ?? [];
  if (
    config.applyBlockMeasurementScale !== false &&
    config.referenceBlockId &&
    referenceBaseline.length >= 3 &&
    referenceCurrent.length >= 3
  ) {
    const baseline = config.blockMeasurementBaselines?.[blockId] ?? defaultLengthsM;
    const deltas = computeSideLengthDeltasM(referenceBaseline, referenceCurrent);
    const adjusted = applySideLengthDeltasM(baseline, deltas);
    const matchesBaseline =
      hasStored &&
      stored.length === baseline.length &&
      stored.every((length, index) => Math.abs(length - baseline[index]) < 0.001);
    const matchesAdjusted =
      hasStored &&
      stored.length === adjusted.length &&
      stored.every((length, index) => Math.abs(length - adjusted[index]) < 0.001);
    if (matchesAdjusted) {
      return stored;
    }
    if (!hasStored || matchesBaseline) {
      return adjusted;
    }
    // Stale synced lengths after reference edits — prefer the latest delta-adjusted values.
    return adjusted;
  }

  return stored;
}
