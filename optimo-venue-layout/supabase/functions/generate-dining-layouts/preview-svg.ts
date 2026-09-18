import type { AisleBand, GenerateDiningLayoutsRequest, GeneratedTable, PlacedTable, RectFeatureInput } from './types.ts';

/** Draw a feature rect in metre-space, honouring rotationDeg about its centre. */
function featureRectSvg(
  sx: (xM: number) => number,
  sy: (yM: number) => number,
  scale: number,
  feat: RectFeatureInput,
  padM: number,
  attrs: string,
): string {
  const cx = sx(feat.xM);
  const cy = sy(feat.yM);
  const w = (feat.widthM + padM * 2) * scale;
  const h = (feat.depthM + padM * 2) * scale;
  const rot = feat.rotationDeg ?? 0;
  return `<g transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${rot.toFixed(1)})"><rect x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" ${attrs}/></g>`;
}

export function buildPreviewSvg(
  req: GenerateDiningLayoutsRequest,
  tables: GeneratedTable[],
  aisles: AisleBand[],
): string {
  const VB_W = 160;
  const VB_H = 120;
  const pad = 6;
  const w = Math.max(0.1, req.block.widthM);
  const d = Math.max(0.1, req.block.depthM);
  const scale = Math.min((VB_W - pad * 2) / w, (VB_H - pad * 2) / d);
  const ox = pad + ((VB_W - pad * 2) - w * scale) / 2;
  const oy = pad + ((VB_H - pad * 2) - d * scale) / 2;
  const sx = (xM: number) => ox + xM * scale;
  const sy = (yM: number) => oy + yM * scale;

  const parts: string[] = [
    `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`,
    `<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#f1f5f9"/>`,
  ];

  const poly = req.block.polygon
    .map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');
  if (req.block.polygon.length >= 3) {
    parts.push(
      `<polygon points="${poly}" fill="#dbeafe" stroke="#2563eb" stroke-width="1.4" stroke-linejoin="round"/>`,
    );
  }

  const stage = req.features.stage;
  if (stage) {
    parts.push(
      featureRectSvg(sx, sy, scale, stage, 0, 'rx="0.8" fill="#cbd5e1" stroke="#64748b" stroke-width="0.6"'),
    );
  }
  const food = req.features.foodPrep;
  if (food) {
    parts.push(
      featureRectSvg(sx, sy, scale, food, 0, 'rx="0.8" fill="#d7e4df" stroke="#5f7d74" stroke-width="0.6"'),
    );
  }

  for (const aisle of aisles) {
    parts.push(
      `<rect x="${(sx(aisle.xM) - (aisle.widthM * scale) / 2).toFixed(1)}" y="${(sy(aisle.yM) - (aisle.depthM * scale) / 2).toFixed(1)}" width="${(aisle.widthM * scale).toFixed(1)}" height="${(aisle.depthM * scale).toFixed(1)}" fill="#fef9c3" opacity="0.55"/>`,
    );
  }

  for (const table of tables) {
    const x = sx((table.xPct / 100) * w);
    const y = sy((table.yPct / 100) * d);
    const tw = Math.max(2.2, table.widthM * scale);
    if (table.shape === 'rectangular') {
      const th = Math.max(2, (table.depthM ?? table.widthM) * scale);
      const rot = table.rotationDeg ?? 0;
      parts.push(
        `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(1)})"><rect x="${(-tw / 2).toFixed(1)}" y="${(-th / 2).toFixed(1)}" width="${tw.toFixed(1)}" height="${th.toFixed(1)}" rx="0.6" fill="#fff" stroke="#64748b" stroke-width="0.55"/></g>`,
      );
    } else {
      parts.push(
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(tw / 2).toFixed(1)}" fill="#fff" stroke="#64748b" stroke-width="0.55"/>`,
      );
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

export function buildCandidateDebugSvg(
  req: GenerateDiningLayoutsRequest,
  candidates: PlacedTable[],
  selected?: PlacedTable[],
): string {
  const VB_W = 160;
  const VB_H = 120;
  const pad = 6;
  const w = Math.max(0.1, req.block.widthM);
  const d = Math.max(0.1, req.block.depthM);
  const scale = Math.min((VB_W - pad * 2) / w, (VB_H - pad * 2) / d);
  const ox = pad + ((VB_W - pad * 2) - w * scale) / 2;
  const oy = pad + ((VB_H - pad * 2) - d * scale) / 2;
  const sx = (xM: number) => ox + xM * scale;
  const sy = (yM: number) => oy + yM * scale;
  const parts: string[] = [
    `<svg viewBox="0 0 ${VB_W} ${VB_H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`,
    `<rect x="0" y="0" width="${VB_W}" height="${VB_H}" fill="#0f172a"/>`,
  ];
  const poly = req.block.polygon
    .map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(' ');
  if (req.block.polygon.length >= 3) {
    parts.push(`<polygon points="${poly}" fill="#1e293b" stroke="#38bdf8" stroke-width="1.2"/>`);
  }
  const stage = req.features.stage;
  if (stage) {
    const padM = req.rules.stageClearanceM;
    parts.push(
      featureRectSvg(
        sx,
        sy,
        scale,
        stage,
        padM,
        'fill="none" stroke="#f87171" stroke-width="0.7" stroke-dasharray="2 1.2"',
      ),
    );
    parts.push(
      featureRectSvg(sx, sy, scale, stage, padM, 'fill="#7f1d1d" opacity="0.35"'),
    );
    parts.push(
      featureRectSvg(sx, sy, scale, stage, 0, 'fill="#94a3b8"'),
    );
  }
  const food = req.features.foodPrep;
  if (food) {
    const padM = req.rules.foodPrepClearanceM;
    parts.push(
      featureRectSvg(sx, sy, scale, food, padM, 'fill="#14532d" opacity="0.28"'),
    );
    parts.push(
      featureRectSvg(sx, sy, scale, food, 0, 'fill="#86efac" opacity="0.7"'),
    );
  }
  const access = [
    ...req.accessPoints.entrances.map((p) => ({ ...p, clearance: req.rules.entranceClearanceM, color: '#fbbf24' })),
    ...req.accessPoints.exits.map((p) => ({ ...p, clearance: req.rules.exitClearanceM, color: '#fb923c' })),
  ];
  for (const point of access) {
    const cw = (point.widthM + point.clearance * 2) * scale;
    const cd = (point.depthM + point.clearance * 2) * scale;
    const rot = point.rotationDeg ?? 0;
    parts.push(
      `<g transform="translate(${sx(point.xM).toFixed(1)},${sy(point.yM).toFixed(1)}) rotate(${rot.toFixed(1)})"><rect x="${(-cw / 2).toFixed(1)}" y="${(-cd / 2).toFixed(1)}" width="${cw.toFixed(1)}" height="${cd.toFixed(1)}" fill="${point.color}" opacity="0.22"/></g>`,
    );
  }
  const sampleStride = Math.max(1, Math.floor(candidates.length / 18));
  candidates.forEach((c, i) => {
    if (i % sampleStride !== 0 && i !== 0) {
      return;
    }
    const x = sx(c.xM);
    const y = sy(c.yM);
    const spacingR = Math.max(c.spacingHalfWidthM, c.spacingHalfDepthM) * scale;
    const physicalR = Math.max(c.physicalHalfWidthM, c.physicalHalfDepthM) * scale;
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${spacingR.toFixed(2)}" fill="none" stroke="#38bdf8" stroke-width="0.45" stroke-dasharray="1.6 1.1" opacity="0.7"/>`,
    );
    parts.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${physicalR.toFixed(2)}" fill="none" stroke="#f8fafc" stroke-width="0.5" opacity="0.9"/>`,
    );
  });
  for (const c of candidates) {
    parts.push(`<circle cx="${sx(c.xM).toFixed(1)}" cy="${sy(c.yM).toFixed(1)}" r="1.15" fill="#4ade80"/>`);
  }
  for (const table of selected ?? []) {
    parts.push(
      `<circle cx="${sx(table.xM).toFixed(1)}" cy="${sy(table.yM).toFixed(1)}" r="2.1" fill="#facc15" stroke="#fde68a" stroke-width="0.6"/>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}
