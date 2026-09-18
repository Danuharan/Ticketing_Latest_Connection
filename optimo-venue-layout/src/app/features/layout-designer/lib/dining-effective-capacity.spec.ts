import { describe, expect, it } from 'vitest';

import {
  canIncreaseDiningTableCount,
  clampDiningTableCount,
  diningCapacityFootKind,
  diningTableCountAdjustedMessage,
  resolveEffectiveMaximumTableCount,
  selectedCountFeasibilityMessage,
} from './dining-effective-capacity';

describe('dining effective maximum table count', () => {
  it('uses a certified proven maximum as the hard cap', () => {
    expect(
      resolveEffectiveMaximumTableCount({
        status: 'ready',
        maximumProven: true,
        provenMaximum: 8,
        geometricUpperBound: 12,
      }),
    ).toBe(8);
  });

  it('does not treat a heuristic feasible count as the stepper maximum', () => {
    expect(
      resolveEffectiveMaximumTableCount({
        status: 'ready',
        maximumProven: false,
        provenMaximum: null,
        geometricUpperBound: 12,
      }),
    ).toBe(12);
    expect(canIncreaseDiningTableCount(6, 12, 'ready')).toBe(true);
    expect(canIncreaseDiningTableCount(12, 12, 'ready')).toBe(false);
  });

  it('does not use geometric/basic capacity while operational max is unknown or checking', () => {
    expect(
      resolveEffectiveMaximumTableCount({
        status: 'unknown',
        maximumProven: false,
        provenMaximum: null,
        geometricUpperBound: 15,
      }),
    ).toBeNull();
    expect(
      resolveEffectiveMaximumTableCount({
        status: 'checking',
        maximumProven: false,
        provenMaximum: 15,
        geometricUpperBound: 15,
      }),
    ).toBeNull();
    expect(canIncreaseDiningTableCount(12, null, 'checking')).toBe(false);
    expect(canIncreaseDiningTableCount(12, 15, 'checking')).toBe(true);
    expect(canIncreaseDiningTableCount(15, 15, 'checking')).toBe(false);
  });

  it('stops the stepper at the proven maximum only', () => {
    expect(canIncreaseDiningTableCount(8, 8, 'ready')).toBe(false);
    expect(canIncreaseDiningTableCount(7, 8, 'ready')).toBe(true);
    expect(clampDiningTableCount(20, 8)).toBe(8);
    expect(clampDiningTableCount(9, 8)).toBe(8);
    expect(clampDiningTableCount(3, 8)).toBe(3);
  });

  it('describes a downward clamp', () => {
    expect(diningTableCountAdjustedMessage(6, true)).toBe(
      'Table count adjusted to the current operational maximum of 6.',
    );
    expect(diningTableCountAdjustedMessage(12, false)).toBe(
      'Table count adjusted to the current geometric upper bound of 12.',
    );
  });

  it('does not label a heuristic feasible count as a maximum', () => {
    expect(
      diningCapacityFootKind({
        status: 'ready',
        maximumProven: false,
        provenMaximum: null,
        validatedFeasible: 6,
      }),
    ).toBe('validated');
    expect(
      diningCapacityFootKind({
        status: 'ready',
        maximumProven: true,
        provenMaximum: 8,
        validatedFeasible: 8,
      }),
    ).toBe('proven');
    expect(selectedCountFeasibilityMessage(8, 'not-found-yet', null)).toBe(
      'No valid 8-table arrangement was found within the current search.',
    );
  });
});
