import {
  annularEllipsePath,
  curvedRectanglePath,
  dEndPath,
  localPointsToSvg,
  polygonPath,
  radialSectorPath,
  rectFromPositionSize,
  PixelRect,
} from '../../layout-designer/lib/geometry';
import {
  buildGridSeatMap,
  buildSeatSectionSeatMap,
  SeatNode,
} from '../../layout-designer/lib/seat-layout';
import { buildCustomShapeSeatMap } from '../../layout-designer/lib/custom-shape-seats';
import { buildSectorSeatMapForBlock } from '../../layout-designer/lib/sector-seat-layout';
import {
  CenterpieceElement,
  isCustomShapeSeatingEnabled,
  LayoutElement,
} from '../../layout-designer/models/layout-element.model';
import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';

export interface PreviewLabel {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  weight: number;
  color: string;
}

export interface PreviewSector {
  path: string;
  seats: SeatNode[];
  code: string;
  displayLabel: string;
  fill: string;
  labelX: number;
  labelY: number;
}

export interface PreviewRectBlock {
  x: number;
  y: number;
  width: number;
  height: number;
  seats: SeatNode[];
  code: string;
  labelX: number;
  labelY: number;
}

export interface PreviewElement {
  id: string;
  transform: string;
  fill: string;
  stroke: string;
  labelColor: string;
  type: LayoutElement['type'];
  rect: PixelRect;
  shapeMode?: 'ellipse' | 'rect' | 'path' | 'polygon';
  pathD?: string;
  rectRx?: number;
  centerLabel?: PreviewLabel;
  ringPath?: string;
  sectors?: PreviewSector[];
  groundX?: number;
  groundY?: number;
  groundW?: number;
  groundH?: number;
  rectBlocks?: PreviewRectBlock[];
  seats?: SeatNode[];
  textLabel?: PreviewLabel;
}

const SEAT_FILL = '#ffffff';
const SEAT_STROKE = '#64748b';

export interface LayoutPreviewOptions {
  /** When false, skips per-seat geometry (fast thumbnails). Default: true. */
  includeSeats?: boolean;
}

export function buildLayoutPreviewElements(
  config: VenueLayoutConfig,
  options: LayoutPreviewOptions = {},
): PreviewElement[] {
  const includeSeats = options.includeSeats !== false;
  return config.elements.map((el) => buildElement(el, config, includeSeats));
}

export { SEAT_FILL, SEAT_STROKE };

function buildElement(el: LayoutElement, config: VenueLayoutConfig, includeSeats: boolean): PreviewElement {
  const rect = rectFromPositionSize(el.position, el.size, config.canvas);
  const base: PreviewElement = {
    id: el.id,
    transform: el.rotation ? `rotate(${el.rotation} ${rect.cx} ${rect.cy})` : '',
    fill: el.style?.fillColor ?? defaultFill(el),
    stroke: el.style?.strokeColor ?? '#94a3b8',
    labelColor: el.style?.labelColor ?? '#0f172a',
    type: el.type,
    rect,
  };

  switch (el.type) {
    case 'centerpiece':
      return buildCenterpiece(base, el, includeSeats);
    case 'layer-ring':
      return buildRing(base, el, config.canvas.width, includeSeats);
    case 'layer-rect':
      return buildLayerRect(base, el, includeSeats);
    case 'block-grid':
      return buildBlockGrid(base, el, includeSeats);
    case 'seat-section':
      return buildSeatSection(base, el, includeSeats);
    case 'label':
      return buildTextLabel(base, el);
    default:
      return base;
  }
}

function buildCenterpiece(base: PreviewElement, el: CenterpieceElement, includeSeats: boolean): PreviewElement {
  const { rect } = base;
  const labelSize = Math.min(Math.max(Math.min(rect.width, rect.height) * 0.18, 10), 30);
  const labelPos = {
    x: rect.cx + ((el.labelOffsetXPct ?? 0) / 100) * rect.width,
    y: rect.cy + ((el.labelOffsetYPct ?? 0) / 100) * rect.height + labelSize * 0.32,
  };
  const centerLabel: PreviewLabel | undefined = el.label.trim()
    ? {
        text: el.label,
        x: labelPos.x,
        y: labelPos.y,
        fontSize: labelSize,
        weight: 800,
        color: base.labelColor,
      }
    : undefined;

  // Named shape (circle/triangle/…) is JSON metadata only — traced outline always wins.
  const outlinePts = el.customPoints ?? [];
  if (outlinePts.length >= 3) {
    const preview: PreviewElement = {
      ...base,
      shapeMode: 'polygon',
      pathD: localPointsToSvg(outlinePts, rect),
      centerLabel,
    };
    if (isCustomShapeSeatingEnabled(el)) {
      preview.seats = includeSeats ? buildCustomShapeSeatMap(el, rect).seats : [];
    }
    return preview;
  }

  switch (el.shape) {
    case 'rectangle':
    case 'square': {
      const curved = curvedRectanglePath(rect, el.curveDeg);
      if (curved) {
        return { ...base, shapeMode: 'path', pathD: curved, centerLabel };
      }
      return { ...base, shapeMode: 'rect', rectRx: 8, centerLabel };
    }
    case 'hexagon':
    case 'octagon':
      return {
        ...base,
        shapeMode: 'path',
        pathD: polygonPath(
          rect.cx,
          rect.cy,
          rect.width / 2,
          rect.height / 2,
          el.polygonSides ?? (el.shape === 'hexagon' ? 6 : 8),
        ),
        centerLabel,
      };
    case 'd-end':
      return {
        ...base,
        shapeMode: 'path',
        pathD: dEndPath(rect.cx, rect.cy, rect.width / 2, rect.height / 2),
        centerLabel,
      };
    case 'triangle': {
      const tri = [
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ];
      return {
        ...base,
        shapeMode: 'polygon',
        pathD: localPointsToSvg(tri, rect),
        centerLabel,
      };
    }
    case 'custom':
      return base;
    default:
      // oval / circle presets without customPoints
      return { ...base, shapeMode: 'ellipse', centerLabel };
  }
}

function buildRing(
  base: PreviewElement,
  el: Extract<LayoutElement, { type: 'layer-ring' }>,
  canvasWidth: number,
  includeSeats: boolean,
): PreviewElement {
  const { rect } = base;
  const outerRx = Math.max(0, rect.width / 2);
  const outerRy = Math.max(0, rect.height / 2);
  const thickness = Math.max(4, (el.thicknessPct / 100) * canvasWidth);
  const innerRx = Math.max(0, outerRx - thickness);
  const innerRy = Math.max(0, outerRy - thickness);
  const ringPath = annularEllipsePath(rect.cx, rect.cy, innerRx, innerRy, outerRx, outerRy);

  const sectors: PreviewSector[] = el.blocks.map((block) => {
    const path = radialSectorPath({
      cx: rect.cx,
      cy: rect.cy,
      innerRx,
      innerRy,
      outerRx,
      outerRy,
      startDeg: block.startAngleDeg,
      endDeg: block.endAngleDeg,
    });
    const map = includeSeats
      ? buildSectorSeatMapForBlock(
          block,
          {
            cx: rect.cx,
            cy: rect.cy,
            innerRx,
            innerRy,
            outerRx,
            outerRy,
            startDeg: block.startAngleDeg,
            endDeg: block.endAngleDeg,
          },
          el.rowLabelStyle,
        )
      : { seats: [] as SeatNode[] };
    const mid = (block.startAngleDeg + block.endAngleDeg) / 2;
    const midRad = (mid * Math.PI) / 180;
    const lr = (innerRx + outerRx) / 2;
    const tb = (innerRy + outerRy) / 2;
    return {
      path,
      seats: map.seats,
      code: block.code,
      displayLabel: (block.label?.trim() || block.code).trim(),
      fill: block.fillColor ?? el.style?.fillColor ?? '#ffffff',
      labelX: rect.cx + lr * Math.cos(midRad),
      labelY: rect.cy + tb * Math.sin(midRad),
    };
  });

  return { ...base, ringPath, sectors };
}

function buildLayerRect(
  base: PreviewElement,
  el: Extract<LayoutElement, { type: 'layer-rect' }>,
  includeSeats: boolean,
): PreviewElement {
  const { rect } = base;
  const pad = Math.min(rect.width, rect.height) * 0.12;
  const groundX = rect.x + pad;
  const groundY = rect.y + pad;
  const groundW = Math.max(0, rect.width - pad * 2);
  const groundH = Math.max(0, rect.height - pad * 2);

  const rectBlocks: PreviewRectBlock[] = el.blocks.map((block) => {
    const blockH = groundH * 0.22;
    const blockW = groundW * 0.22;
    let x = groundX;
    let y = groundY;
    let w = blockW;
    let h = blockH;
    switch (block.side) {
      case 'top':
        x = groundX + (groundW - blockW) / 2;
        y = groundY;
        w = blockW;
        h = blockH;
        break;
      case 'bottom':
        x = groundX + (groundW - blockW) / 2;
        y = groundY + groundH - blockH;
        break;
      case 'left':
        x = groundX;
        y = groundY + (groundH - blockH) / 2;
        w = blockH;
        h = blockW;
        break;
      case 'right':
        x = groundX + groundW - blockH;
        y = groundY + (groundH - blockW) / 2;
        w = blockH;
        h = blockW;
        break;
    }
    const blockRect = { x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
    const map = includeSeats
      ? buildGridSeatMap(blockRect, block.rows, block.seatsPerRow, el.rowLabelStyle)
      : { seats: [] as SeatNode[] };
    return {
      x,
      y,
      width: w,
      height: h,
      seats: map.seats,
      code: block.code,
      labelX: blockRect.cx,
      labelY: blockRect.cy,
    };
  });

  return { ...base, groundX, groundY, groundW, groundH, rectBlocks };
}

function buildBlockGrid(
  base: PreviewElement,
  el: Extract<LayoutElement, { type: 'block-grid' }>,
  includeSeats: boolean,
): PreviewElement {
  const map = includeSeats
    ? buildGridSeatMap(base.rect, el.rows, el.seatsPerRow, el.rowLabelStyle)
    : { seats: [] as SeatNode[] };
  return { ...base, seats: map.seats };
}

function buildSeatSection(
  base: PreviewElement,
  el: Extract<LayoutElement, { type: 'seat-section' }>,
  includeSeats: boolean,
): PreviewElement {
  const map = includeSeats
    ? buildSeatSectionSeatMap(base.rect, el.rows, el.rowGapPct, el.rowLabelStyle)
    : { seats: [] as SeatNode[] };
  return { ...base, seats: map.seats };
}

function buildTextLabel(base: PreviewElement, el: Extract<LayoutElement, { type: 'label' }>): PreviewElement {
  return {
    ...base,
    textLabel: {
      text: el.text,
      x: base.rect.cx,
      y: base.rect.cy,
      fontSize: el.fontSize,
      weight: el.fontWeight === 'bold' ? 700 : 400,
      color: base.labelColor,
    },
  };
}

function defaultFill(el: LayoutElement): string {
  switch (el.type) {
    case 'centerpiece':
      return '#86efac';
    case 'aisle':
      return '#e2e8f0';
    case 'label':
      return 'transparent';
    default:
      return '#dbeafe';
  }
}
