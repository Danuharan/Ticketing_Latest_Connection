export type OperationalCapacityStatus = 'unknown' | 'checking' | 'ready' | 'error';

/** Hard stepper ceiling. Proven max when certified; otherwise geometric bound. Never a heuristic "found N". */
export function resolveEffectiveMaximumTableCount(opts: {
  status: OperationalCapacityStatus;
  maximumProven: boolean;
  provenMaximum: number | null;
  geometricUpperBound: number | null;
}): number | null {
  if (opts.status !== 'ready') {
    return null;
  }
  if (opts.maximumProven && opts.provenMaximum != null && Number.isFinite(opts.provenMaximum)) {
    return Math.max(0, Math.round(opts.provenMaximum));
  }
  if (opts.geometricUpperBound != null && Number.isFinite(opts.geometricUpperBound)) {
    return Math.max(0, Math.round(opts.geometricUpperBound));
  }
  return null;
}

export function canIncreaseDiningTableCount(
  count: number,
  effectiveMaximum: number | null,
  _status?: OperationalCapacityStatus,
): boolean {
  return effectiveMaximum != null && effectiveMaximum > 0 && count < effectiveMaximum;
}

export function clampDiningTableCount(count: number, effectiveMaximum: number | null): number {
  const value = Number.isFinite(count) ? Math.round(count) : 1;
  if (effectiveMaximum == null) {
    return Math.max(1, value);
  }
  const maxVal = Math.max(0, Math.round(effectiveMaximum));
  if (maxVal <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(maxVal, value));
}

export function diningTableCountAdjustedMessage(max: number, proven = false): string {
  return proven
    ? `Table count adjusted to the current operational maximum of ${max}.`
    : `Table count adjusted to the current geometric upper bound of ${max}.`;
}

export type DiningCapacityFootKind = 'checking' | 'proven' | 'validated' | 'error';

/** Heuristic witnesses are labelled "at least N", never "maximum". */
export function diningCapacityFootKind(opts: {
  status: OperationalCapacityStatus;
  maximumProven: boolean;
  provenMaximum: number | null;
  validatedFeasible: number | null;
}): DiningCapacityFootKind {
  if (opts.status === 'error') {
    return 'error';
  }
  if (opts.status === 'ready' && opts.maximumProven && opts.provenMaximum != null) {
    return 'proven';
  }
  if (opts.status === 'ready' && opts.validatedFeasible != null) {
    return 'validated';
  }
  return 'checking';
}

export function selectedCountFeasibilityMessage(
  count: number,
  result: 'found' | 'not-found-yet' | 'impossible' | null,
  provenMaximum: number | null,
): string | null {
  if (result === 'not-found-yet') {
    return `No valid ${count}-table arrangement was found within the current search.`;
  }
  if (result === 'impossible' && provenMaximum != null) {
    return `${count} tables cannot fit. Proven operational maximum: ${provenMaximum}.`;
  }
  return null;
}
