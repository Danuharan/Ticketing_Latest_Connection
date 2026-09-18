/** Shared upload guidance for AI layout detection & blueprint OCR. */
export const BLUEPRINT_IMAGE_SPEC = {
  minLongEdgePx: 1000,
  recommendedLongEdgeMinPx: 1800,
  recommendedLongEdgeMaxPx: 2400,
  maxUsefulLongEdgePx: 3000,
  minFileMb: 0.5,
  recommendedFileMinMb: 1,
  recommendedFileMaxMb: 4,
  maxFileMb: 8,
  formatsLabel: 'PNG · JPG · JPEG · WEBP · GIF',
  acceptMime: 'image/png,image/jpeg,image/webp,image/gif',
} as const;

export const BLUEPRINT_IMAGE_SPEC_SUMMARY =
  `Best: ${BLUEPRINT_IMAGE_SPEC.recommendedLongEdgeMinPx}–${BLUEPRINT_IMAGE_SPEC.recommendedLongEdgeMaxPx}px, ` +
  `${BLUEPRINT_IMAGE_SPEC.recommendedFileMinMb}–${BLUEPRINT_IMAGE_SPEC.recommendedFileMaxMb} MB`;

export const BLUEPRINT_IMAGE_SPEC_TOOLTIP_LINES: readonly string[] = [
  `Resolution (longest side): min ${BLUEPRINT_IMAGE_SPEC.minLongEdgePx}px · best ${BLUEPRINT_IMAGE_SPEC.recommendedLongEdgeMinPx}–${BLUEPRINT_IMAGE_SPEC.recommendedLongEdgeMaxPx}px · up to ~${BLUEPRINT_IMAGE_SPEC.maxUsefulLongEdgePx}px`,
  `File size: min ~${BLUEPRINT_IMAGE_SPEC.minFileMb} MB · best ${BLUEPRINT_IMAGE_SPEC.recommendedFileMinMb}–${BLUEPRINT_IMAGE_SPEC.recommendedFileMaxMb} MB · max ${BLUEPRINT_IMAGE_SPEC.maxFileMb} MB`,
  `Formats: ${BLUEPRINT_IMAGE_SPEC.formatsLabel.replace(/ · /g, ', ')}`,
  'Use a clear seating chart with visible block borders and readable section numbers.',
];
