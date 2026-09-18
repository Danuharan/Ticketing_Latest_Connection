import { VenueLayoutConfig } from '../../../core/models/venue-layout-config.model';
import { buildLayoutPreviewElements, PreviewElement } from './layout-preview-render';

/** Builds a compact SVG data URL for list-card thumbnails (blocks/sectors only). */
export function buildLayoutThumbnailDataUrl(config: VenueLayoutConfig): string {
  const svg = buildLayoutPreviewSvg(config, false);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildLayoutPreviewSvg(config: VenueLayoutConfig, includeSeats: boolean): string {
  const items = buildLayoutPreviewElements(config, { includeSeats });
  const { width, height } = config.canvas;
  const body = items.map((item) => renderPreviewElement(item)).join('');
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    body,
    '</svg>',
  ].join('');
}

function renderPreviewElement(vm: PreviewElement): string {
  const transform = vm.transform ? `<g transform="${escapeAttr(vm.transform)}">` : '<g>';
  const inner = renderPreviewContent(vm);
  return `${transform}${inner}</g>`;
}

function renderPreviewContent(vm: PreviewElement): string {
  switch (vm.type) {
    case 'centerpiece':
      return renderCenterpiece(vm);
    case 'layer-ring':
      return renderLayerRing(vm);
    case 'layer-rect':
      return renderLayerRect(vm);
    case 'block-grid':
      return renderShapedBlock(vm);
    case 'seat-section':
      return renderRectBlock(vm.rect.x, vm.rect.y, vm.rect.width, vm.rect.height, 8, vm.fill, vm.stroke);
    case 'aisle':
      return renderRectBlock(vm.rect.x, vm.rect.y, vm.rect.width, vm.rect.height, 2, vm.fill, vm.stroke);
    case 'label':
      return vm.textLabel
        ? `<text x="${vm.textLabel.x}" y="${vm.textLabel.y}" text-anchor="middle" font-size="${vm.textLabel.fontSize}" font-weight="${vm.textLabel.weight}" fill="${escapeAttr(vm.textLabel.color)}">${escapeText(vm.textLabel.text)}</text>`
        : '';
    default:
      return renderRectBlock(vm.rect.x, vm.rect.y, vm.rect.width, vm.rect.height, 6, vm.fill, vm.stroke);
  }
}

function renderCenterpiece(vm: PreviewElement): string {
  return renderShapedBlock(vm);
}

function renderShapedBlock(vm: PreviewElement): string {
  let shape = '';
  switch (vm.shapeMode) {
    case 'ellipse':
      shape = `<ellipse cx="${vm.rect.cx}" cy="${vm.rect.cy}" rx="${vm.rect.width / 2}" ry="${vm.rect.height / 2}" fill="${escapeAttr(vm.fill)}" stroke="${escapeAttr(vm.stroke)}" stroke-width="1"/>`;
      break;
    case 'rect':
      shape = `<rect x="${vm.rect.x}" y="${vm.rect.y}" width="${vm.rect.width}" height="${vm.rect.height}" rx="${vm.rectRx ?? 0}" fill="${escapeAttr(vm.fill)}" stroke="${escapeAttr(vm.stroke)}" stroke-width="1"/>`;
      break;
    case 'path':
    case 'polygon':
      if (vm.pathD) {
        const tag = vm.shapeMode === 'polygon' ? 'polygon' : 'path';
        const pointsOrD = vm.shapeMode === 'polygon' ? `points="${escapeAttr(vm.pathD)}"` : `d="${escapeAttr(vm.pathD)}"`;
        shape = `<${tag} ${pointsOrD} fill="${escapeAttr(vm.fill)}" stroke="${escapeAttr(vm.stroke)}" stroke-width="1"/>`;
      }
      break;
    default:
      shape = renderRectBlock(
        vm.rect.x,
        vm.rect.y,
        vm.rect.width,
        vm.rect.height,
        vm.rectRx ?? 6,
        vm.fill,
        vm.stroke,
      );
      break;
  }

  const label = vm.centerLabel
    ? `<text x="${vm.centerLabel.x}" y="${vm.centerLabel.y}" text-anchor="middle" font-size="${vm.centerLabel.fontSize}" font-weight="${vm.centerLabel.weight}" fill="${escapeAttr(vm.centerLabel.color)}">${escapeText(vm.centerLabel.text)}</text>`
    : '';

  const seats = (vm.seats ?? [])
    .map(
      (seat) =>
        `<circle cx="${seat.x}" cy="${seat.y}" r="${seat.radius}" fill="#ffffff" stroke="#64748b" stroke-width="0.6"/>`,
    )
    .join('');

  return `${shape}${label}${seats}`;
}

function renderLayerRing(vm: PreviewElement): string {
  const ring = vm.ringPath
    ? `<path d="${escapeAttr(vm.ringPath)}" fill="${escapeAttr(vm.fill)}" stroke="${escapeAttr(vm.stroke)}" stroke-width="1" fill-rule="evenodd"/>`
    : '';
  const sectors = (vm.sectors ?? [])
    .map((sector) => {
      const sectorPath = `<path d="${escapeAttr(sector.path)}" fill="${escapeAttr(sector.fill)}" fill-opacity="0.72" stroke="${escapeAttr(vm.stroke)}" stroke-width="1"/>`;
      const label = `<text x="${sector.labelX}" y="${sector.labelY}" text-anchor="middle" font-size="10" font-weight="700" fill="${escapeAttr(vm.labelColor)}">${escapeText(sector.displayLabel)}</text>`;
      return `${sectorPath}${label}`;
    })
    .join('');
  return `${ring}${sectors}`;
}

function renderLayerRect(vm: PreviewElement): string {
  const ground =
    vm.groundX != null && vm.groundY != null && vm.groundW != null && vm.groundH != null
      ? `<rect x="${vm.groundX}" y="${vm.groundY}" width="${vm.groundW}" height="${vm.groundH}" rx="6" fill="${escapeAttr(vm.fill)}" stroke="${escapeAttr(vm.stroke)}" stroke-width="1"/>`
      : '';
  const blocks = (vm.rectBlocks ?? [])
    .map((block) => {
      const rect = renderRectBlock(block.x, block.y, block.width, block.height, 3, '#ffffff', vm.stroke);
      const label = `<text x="${block.labelX}" y="${block.labelY}" text-anchor="middle" font-size="9" font-weight="700" fill="${escapeAttr(vm.labelColor)}">${escapeText(block.code)}</text>`;
      return `${rect}${label}`;
    })
    .join('');
  return `${ground}${blocks}`;
}

function renderRectBlock(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  fill: string,
  stroke: string,
): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${escapeAttr(fill)}" fill-opacity="${fill === '#ffffff' ? '0.6' : '1'}" stroke="${escapeAttr(stroke)}" stroke-width="1"/>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
