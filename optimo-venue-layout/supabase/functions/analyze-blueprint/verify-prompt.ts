/** Prompt for the block-detection verification (QA audit) pass. */

export interface VerifyBlockSummary {
  index: number;
  label: string;
  cxPct: number;
  cyPct: number;
  wPct: number;
  hPct: number;
}

export function buildVerificationPrompt(blocks: VerifyBlockSummary[]): string {
  const table = JSON.stringify(
    blocks.map((b) => ({
      i: b.index,
      label: b.label,
      cx: b.cxPct,
      cy: b.cyPct,
      w: b.wPct,
      h: b.hPct,
    })),
  );

  // Missing blocks are found deterministically on the client (Azure OCR + block
  // coverage check) and the client DROPS any "missing" the model returns, so
  // this pass deliberately skips the exhaustive "read every number" enumeration.
  // That enumeration is the single biggest source of latency/timeouts and adds
  // no value here — focus the model only on the geometry/label problems a vision
  // model is actually needed for.
  return `You are a QA auditor for an automated seating-block detector.

IMAGE 1 is the original stadium/venue seating chart.
IMAGE 2 is the same chart with every DETECTED block outlined in magenta and tagged with a numbered white badge.

Detected blocks (badge number, OCR label, centre and size as % of the image):
${table}

A "real block" is one individually printed, coloured seating section in IMAGE 1. Do NOT count the pitch/field/stage, legends, gates, compass or direction text, stand titles, walkways, or decorative shapes.

Do NOT report "missing" blocks — those are detected separately by another system. Only report the outline/label problems below. Do not enumerate every number; go straight to the outlines that look wrong.

TASKS:
1. Estimate the total number of real blocks in IMAGE 1 (a count only — you do not need to list them).
2. Compare the magenta outlines in IMAGE 2 against the real blocks and report only these problem types:
- "merged": one outline spanning 2 or more real blocks.
- "misnamed": an outline whose label in the table differs from the label printed inside that block in IMAGE 1 (an empty label while the block clearly has a printed one also counts).
- "extra": an outline covering something that is not a seating block.

Do NOT report "split" — adjacent blocks (e.g. an upper-tier 344 and a lower-tier 244) are separate real blocks, not one block split in two.

Return ONLY valid JSON, exactly this shape:
{
  "totalRealBlocks": 34,
  "issues": [
    {
      "type": "misnamed",
      "realBlockLabel": "A12",
      "detectedIndices": [7],
      "approxRegion": { "xPct": 22.5, "yPct": 14.0, "wPct": 6.0, "hPct": 5.0 },
      "note": "Outline labelled A13 but the block prints A12."
    }
  ],
  "confidence": "high",
  "summary": "1-2 sentence overall assessment."
}

Rules:
- Report ONLY merged, misnamed and extra issues — never "missing" and never "split".
- "approxRegion" is the bounding box of the REAL block in % of IMAGE 1 (values 0-100, top-left origin).
- "detectedIndices" must be badge numbers from IMAGE 2.
- "realBlockLabel" is the label printed in IMAGE 1, or null when it has none.
- Ignore case and whitespace differences when comparing labels.
- Report at most 25 issues (the most severe first).
- "confidence" is "low", "medium" or "high".
- If IMAGE 1 is not a seating chart, return totalRealBlocks 0, an empty issues array, and confidence "low".
- Do not include any text outside the JSON object.`;
}
