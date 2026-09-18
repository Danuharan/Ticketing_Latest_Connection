/**
 * Bounded maximum independent set on the table-candidate conflict graph.
 * Safe reductions preserve independence number. Timeout never claims a proof.
 */

export interface MaximumSetResult {
  best: number[];
  proven: boolean;
  searchStates: number;
}

function closedNeighborhood(index: number, conflicts: Set<number>[], alive: boolean[]): Set<number> {
  const next = new Set<number>([index]);
  for (const other of conflicts[index] ?? []) {
    if (alive[other]) {
      next.add(other);
    }
  }
  return next;
}

function isSubset(a: Set<number>, b: Set<number>): boolean {
  if (a.size > b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/** Vertices kept after twin-collapse and closed-neighbourhood domination. */
export function reduceConflictVertices(conflicts: Set<number>[], deadline?: number): number[] {
  const n = conflicts.length;
  const alive = Array.from({ length: n }, () => true);
  let changed = true;
  while (changed) {
    if (deadline != null && Date.now() > deadline) {
      break;
    }
    changed = false;
    for (let i = 0; i < n; i += 1) {
      if (deadline != null && Date.now() > deadline) {
        changed = false;
        break;
      }
      if (!alive[i]) {
        continue;
      }
      const ni = closedNeighborhood(i, conflicts, alive);
      for (let j = 0; j < n; j += 1) {
        if (!alive[j] || i === j) {
          continue;
        }
        const nj = closedNeighborhood(j, conflicts, alive);
        if (isSubset(ni, nj) && (ni.size < nj.size || i < j)) {
          alive[j] = false;
          changed = true;
        }
      }
    }
  }
  const kept: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (alive[i]) {
      kept.push(i);
    }
  }
  return kept;
}

function remapConflicts(conflicts: Set<number>[], kept: number[]): Set<number>[] {
  const indexOf = new Map<number, number>();
  kept.forEach((original, dense) => indexOf.set(original, dense));
  return kept.map((original) => {
    const next = new Set<number>();
    for (const other of conflicts[original] ?? []) {
      const dense = indexOf.get(other);
      if (dense != null) {
        next.add(dense);
      }
    }
    return next;
  });
}

function connectedComponents(conflicts: Set<number>[]): number[][] {
  const n = conflicts.length;
  const seen = new Uint8Array(n);
  const parts: number[][] = [];
  for (let start = 0; start < n; start += 1) {
    if (seen[start]) {
      continue;
    }
    const stack = [start];
    const part: number[] = [];
    seen[start] = 1;
    while (stack.length > 0) {
      const v = stack.pop()!;
      part.push(v);
      for (const other of conflicts[v] ?? []) {
        if (!seen[other]) {
          seen[other] = 1;
          stack.push(other);
        }
      }
    }
    parts.push(part);
  }
  return parts;
}

function matchingUpperBound(remaining: number[], conflicts: Set<number>[]): number {
  const used = new Set<number>();
  let matching = 0;
  for (const i of remaining) {
    if (used.has(i)) {
      continue;
    }
    for (const j of conflicts[i] ?? []) {
      if (!used.has(j) && remaining.includes(j)) {
        used.add(i);
        used.add(j);
        matching += 1;
        break;
      }
    }
  }
  return remaining.length - matching;
}

function pickBranchVertex(remaining: number[], conflicts: Set<number>[]): number {
  let best = remaining[0]!;
  let bestDeg = -1;
  const live = new Set(remaining);
  for (const i of remaining) {
    let deg = 0;
    for (const j of conflicts[i] ?? []) {
      if (live.has(j)) {
        deg += 1;
      }
    }
    if (deg > bestDeg) {
      bestDeg = deg;
      best = i;
    }
  }
  return best;
}

function branchComponent(
  conflicts: Set<number>[],
  remaining: number[],
  chosen: number[],
  best: { value: number[]; proven: boolean; timedOut: boolean; searchStates: number },
  deadline: number,
): void {
  best.searchStates += 1;
  if (Date.now() > deadline) {
    best.timedOut = true;
    best.proven = false;
    return;
  }
  if (chosen.length > best.value.length) {
    best.value = [...chosen];
  }
  if (remaining.length === 0) {
    return;
  }
  const upper = chosen.length + matchingUpperBound(remaining, conflicts);
  if (upper <= best.value.length) {
    return;
  }
  const v = pickBranchVertex(remaining, conflicts);
  const neighbors = conflicts[v] ?? new Set<number>();
  const takeRemaining = remaining.filter((i) => i !== v && !neighbors.has(i));
  branchComponent(conflicts, takeRemaining, [...chosen, v], best, deadline);
  if (best.timedOut) {
    return;
  }
  const skipRemaining = remaining.filter((i) => i !== v);
  branchComponent(conflicts, skipRemaining, chosen, best, deadline);
}

/**
 * Maximum independent set. `seed` is an original-index feasible set used as the lower bound.
 * `proven` is true only if the search exhausted the reduced graph before the deadline.
 */
export function maximumIndependentSet(
  conflicts: Set<number>[],
  seed: number[],
  deadline: number,
): MaximumSetResult {
  const n = conflicts.length;
  if (n === 0) {
    return { best: [], proven: true, searchStates: 0 };
  }
  const kept = reduceConflictVertices(conflicts, deadline);
  const reductionTimedOut = Date.now() > deadline;
  const denseConflicts = remapConflicts(conflicts, kept);
  const originalOf = kept;
  const seedDense = seed
    .map((original) => kept.indexOf(original))
    .filter((dense) => dense >= 0);
  const components = connectedComponents(denseConflicts);
  const combined: number[] = [];
  let proven = !reductionTimedOut;
  let searchStates = 0;
  const maxBranchVertices = 96;
  for (const part of components) {
    if (Date.now() > deadline) {
      proven = false;
      break;
    }
    const partSet = new Set(part);
    if (part.length > maxBranchVertices) {
      proven = false;
      for (const dense of seedDense) {
        if (partSet.has(dense)) {
          combined.push(originalOf[dense]!);
        }
      }
      continue;
    }
    const partConflicts = part.map((v) => {
      const next = new Set<number>();
      for (const other of denseConflicts[v] ?? []) {
        if (partSet.has(other)) {
          next.add(other);
        }
      }
      return next;
    });
    const denseIndex = new Map<number, number>();
    part.forEach((v, i) => denseIndex.set(v, i));
    const localConflicts = partConflicts.map((set) => {
      const remapped = new Set<number>();
      for (const other of set) {
        const idx = denseIndex.get(other);
        if (idx != null) {
          remapped.add(idx);
        }
      }
      return remapped;
    });
    const localSeed = seedDense.filter((v) => partSet.has(v)).map((v) => denseIndex.get(v)!);
    const best = {
      value: [...localSeed],
      proven: true,
      timedOut: false,
      searchStates: 0,
    };
    const remaining = part.map((_, i) => i);
    branchComponent(localConflicts, remaining, [], best, deadline);
    searchStates += best.searchStates;
    if (best.timedOut) {
      proven = false;
    }
    for (const local of best.value) {
      combined.push(originalOf[part[local]!]!);
    }
  }
  if (seed.length > combined.length) {
    return { best: [...seed], proven: false, searchStates };
  }
  return { best: combined, proven, searchStates };
}
