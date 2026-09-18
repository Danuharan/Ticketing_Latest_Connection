import type { DiningLayoutReferenceImage } from '../models/layout-element.model';

/** True when the reference image has alignment metadata from layout detection. */
export function hasDiningReferenceAlignment(
  ref: DiningLayoutReferenceImage | null | undefined,
): ref is DiningLayoutReferenceImage & {
  contentBounds: NonNullable<DiningLayoutReferenceImage['contentBounds']>;
  imageWidth: number;
  imageHeight: number;
} {
  return Boolean(
    ref?.contentBounds &&
      ref.imageWidth != null &&
      ref.imageWidth > 0 &&
      ref.imageHeight != null &&
      ref.imageHeight > 0,
  );
}

/** SVG viewBox cropping the ink region so detected % positions line up with the block. */
export function diningReferenceImageViewBox(ref: {
  contentBounds: NonNullable<DiningLayoutReferenceImage['contentBounds']>;
  imageWidth: number;
  imageHeight: number;
}): string {
  const { contentBounds: b, imageWidth: w, imageHeight: h } = ref;
  const minX = (b.minXPct / 100) * w;
  const minY = (b.minYPct / 100) * h;
  const vbW = ((b.maxXPct - b.minXPct) / 100) * w;
  const vbH = ((b.maxYPct - b.minYPct) / 100) * h;
  return `${minX} ${minY} ${vbW} ${vbH}`;
}
