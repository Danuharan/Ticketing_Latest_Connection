/** Defensive normalization of the verification model response. */

// "split" is deliberately excluded — it produced false positives on adjacent
// tiers (e.g. 344 vs 244) and is no longer reported.
const ISSUE_TYPES = ['missing', 'merged', 'misnamed', 'extra'] as const;
export type VerificationIssueType = (typeof ISSUE_TYPES)[number];

export interface VerificationRegion {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface VerificationIssue {
  type: VerificationIssueType;
  realBlockLabel: string | null;
  detectedIndices: number[];
  approxRegion: VerificationRegion | null;
  note: string;
}

export interface VerificationResult {
  totalRealBlocks: number;
  issues: VerificationIssue[];
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

const MAX_ISSUES = 60;

function clampPct(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(100, Math.max(0, num));
}

function normalizeRegion(raw: unknown): VerificationRegion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.xPct !== 'number' || typeof r.yPct !== 'number') {
    return null;
  }
  return {
    xPct: clampPct(r.xPct),
    yPct: clampPct(r.yPct),
    wPct: clampPct(r.wPct),
    hPct: clampPct(r.hPct),
  };
}

function normalizeIssue(raw: unknown): VerificationIssue | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const type = typeof r.type === 'string' ? r.type.toLowerCase() : '';
  if (!(ISSUE_TYPES as readonly string[]).includes(type)) {
    return null;
  }
  const indices = Array.isArray(r.detectedIndices)
    ? r.detectedIndices
        .filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0)
        .slice(0, 20)
    : [];
  return {
    type: type as VerificationIssueType,
    realBlockLabel:
      typeof r.realBlockLabel === 'string' && r.realBlockLabel.trim()
        ? r.realBlockLabel.trim()
        : null,
    detectedIndices: indices,
    approxRegion: normalizeRegion(r.approxRegion),
    note: typeof r.note === 'string' ? r.note.trim().slice(0, 300) : '',
  };
}

export function normalizeVerification(raw: unknown): VerificationResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const totalRealBlocks =
    typeof r.totalRealBlocks === 'number' && Number.isFinite(r.totalRealBlocks)
      ? Math.max(0, Math.round(r.totalRealBlocks))
      : 0;
  const issues = (Array.isArray(r.issues) ? r.issues : [])
    .map(normalizeIssue)
    .filter((issue): issue is VerificationIssue => issue !== null)
    .slice(0, MAX_ISSUES);
  const confidence =
    r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
      ? r.confidence
      : 'low';
  return {
    totalRealBlocks,
    issues,
    confidence,
    summary: typeof r.summary === 'string' ? r.summary.trim().slice(0, 500) : '',
  };
}
