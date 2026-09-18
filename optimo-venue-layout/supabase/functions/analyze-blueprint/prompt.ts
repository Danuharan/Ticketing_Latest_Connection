import type { OcrToken } from './azure-ocr.ts';

/** Caps the OCR hint list so the prompt stays compact for large charts. */
const MAX_OCR_TOKENS = 400;

export function buildAnalysisPrompt(
  ocrTokens: OcrToken[],
  includeSeats: boolean,
): string {
  const seatRules = includeSeats
    ? `- Include "rows" and "seatsPerRow" per block when the chart shows them; otherwise estimate from visible seat dots.
- "rowsPerBlock" / "seatsPerRow" at tier level are averages when blocks differ slightly.`
    : `- Do NOT estimate seat counts. Set "rows" and "seatsPerRow" to 0 on every block and tier.
- Focus only on geometry, block names, tier structure, and stand labels.`;

  const ocrBlock = formatOcrHint(ocrTokens);

  return `You are a professional venue layout analyst. Analyse this stadium / arena / venue seating chart image and recreate its 2D structure.

${ocrBlock}

Return ONLY valid JSON (no markdown, no commentary) in EXACTLY this shape:
{
  "venueType": "football_stadium",
  "centerpiece": {
    "name": "Pitch",
    "shape": "rectangle",
    "position": { "xPct": 50, "yPct": 50 },
    "size": { "wPct": 28, "hPct": 18 }
  },
  "stands": [
    { "name": "NORTH BANK", "position": { "xPct": 50, "yPct": 6 }, "rotationDeg": 0, "fontSize": 12 }
  ],
  "tiers": [
    {
      "name": "Inner Tier",
      "tierCode": "IN",
      "ringIndex": 0,
      "position": { "xPct": 50, "yPct": 50 },
      "size": { "wPct": 58, "hPct": 52 },
      "thicknessPct": 7,
      "rowsPerBlock": 0,
      "seatsPerRow": 0,
      "blocks": [
        { "name": "1", "startAngleDeg": -90, "endAngleDeg": -78.75, "rows": 0, "seatsPerRow": 0 }
      ]
    }
  ],
  "confidence": "high",
  "notes": "2-4 sentences on naming patterns per tier and stand layout."
}

Geometry rules (CRITICAL):
- All positions/sizes are canvas percentages (0-100). Centre of the image is (50, 50).
- Angles: 0° = east (right), 90° = south (bottom), -90° = north (top). Measure each block's wedge around the centerpiece.
- "centerpiece.shape" must be one of: oval, circle, rectangle, square, hexagon, octagon, d-end.
- List EVERY visible seating block in each tier with its label EXACTLY as printed (prefer the OCR text above when it matches a block).
- "ringIndex": 0 = innermost ring around the centerpiece, increasing outward. Detect ALL rings — never merge separate rings.
- "size.wPct"/"size.hPct" = the outer ellipse of that ring layer; "thicknessPct" = radial band thickness (usually 5-14).
- "stands" = large stand/section labels placed outside the seating (compass sides). Use OCR text for their names where possible.
${seatRules}
- If the image is not a venue/seating chart, return venueType "unknown", empty tiers, and confidence "low".`;
}

function formatOcrHint(tokens: OcrToken[]): string {
  if (tokens.length === 0) {
    return 'No OCR text was extracted; rely on the image alone for labels.';
  }
  const capped = tokens.slice(0, MAX_OCR_TOKENS);
  const list = capped
    .map((t) => `"${t.text}"@(${t.xPct},${t.yPct})`)
    .join(', ');
  return `These text labels were detected by OCR with their (xPct,yPct) centre positions (0-100). Use them as the source of truth for block names and stand names — match each label to the nearest block/stand and do NOT invent names that are not in this list when a real one exists:
[${list}]`;
}
