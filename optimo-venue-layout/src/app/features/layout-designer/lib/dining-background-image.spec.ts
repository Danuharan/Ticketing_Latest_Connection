import { describe, expect, it } from 'vitest';
import {
  diningBackgroundClipSignature,
  diningBackgroundContainScale,
  diningBackgroundCoverScale,
  diningBackgroundDraw,
  diningBackgroundFitFromRef,
  diningBackgroundNeedsReadjustment,
  diningBackgroundPreviewLayout,
  diningBackgroundUsesManualFit,
  diningBackgroundUserScaleForMode,
} from './dining-background-image';

describe('dining-background-image', () => {
  it('uses cover scale so the image fills the block', () => {
    expect(diningBackgroundCoverScale(200, 100, 100, 100)).toBe(1);
    expect(diningBackgroundContainScale(200, 100, 100, 100)).toBe(0.5);
  });

  it('detects a manual pan/zoom fit', () => {
    expect(diningBackgroundUsesManualFit({ dataUrl: 'x' })).toBe(false);
    expect(diningBackgroundUsesManualFit({ dataUrl: 'x', scale: 1.2 })).toBe(true);
    expect(diningBackgroundUsesManualFit({ dataUrl: 'x', fitMode: 'cover' })).toBe(true);
  });

  it('draws the image centred at 50/50 with cover scale', () => {
    const draw = diningBackgroundDraw(
      {
        dataUrl: 'x',
        imageWidth: 200,
        imageHeight: 100,
        scale: 1,
        offsetXPct: 50,
        offsetYPct: 50,
        rotationDeg: 0,
      },
      { x: 10, y: 20, width: 100, height: 100, cx: 60, cy: 70 },
    );
    expect(draw).toBeTruthy();
    expect(draw!.width).toBe(200);
    expect(draw!.height).toBe(100);
    expect(draw!.x).toBe(-40);
    expect(draw!.y).toBe(20);
    expect(diningBackgroundFitFromRef({ dataUrl: 'x' }).visible).toBe(true);
    expect(diningBackgroundFitFromRef({ dataUrl: 'x' }).fitMode).toBe('cover');
    expect(diningBackgroundFitFromRef({ dataUrl: 'x' }).opacity).toBe(1);
  });

  it('makes Fit a contain scale relative to cover', () => {
    const rect = { x: 0, y: 0, width: 100, height: 100, cx: 50, cy: 50 };
    expect(diningBackgroundUserScaleForMode(200, 100, rect, 0, 'cover')).toBe(1);
    expect(diningBackgroundUserScaleForMode(200, 100, rect, 0, 'contain')).toBe(0.5);
  });

  it('builds a polygon clip preview from the block outline', () => {
    const layout = diningBackgroundPreviewLayout(
      [
        { xPct: 50, yPct: 0 },
        { xPct: 100, yPct: 100 },
        { xPct: 0, yPct: 100 },
      ],
      1,
      { maxWidth: 200, maxHeight: 200, pad: 10 },
    );
    expect(layout.clipKind).toBe('polygon');
    expect(layout.polygonPoints.split(' ').length).toBe(3);
    expect(layout.overlayPath.startsWith('M0,0')).toBe(true);
    expect(layout.polygonPoints).toContain(',');
    expect(layout.cssClip).toContain('polygon(');
    expect(layout.cssClip).toContain('50% 0%');
  });

  it('uses hexagon path geometry when the block is not a custom polygon', () => {
    const layout = diningBackgroundPreviewLayout(
      { shape: 'hexagon', polygonSides: 6 },
      1,
      { maxWidth: 200, maxHeight: 200, pad: 10 },
    );
    expect(layout.clipKind).toBe('path');
    expect(layout.pathD.startsWith('M')).toBe(true);
  });

  it('warns when the stored clip signature no longer matches the block', () => {
    const triangle = [
      { xPct: 50, yPct: 0 },
      { xPct: 100, yPct: 100 },
      { xPct: 0, yPct: 100 },
    ];
    const sig = diningBackgroundClipSignature(triangle);
    expect(
      diningBackgroundNeedsReadjustment({ dataUrl: 'x', clipSignature: sig }, triangle),
    ).toBe(false);
    expect(
      diningBackgroundNeedsReadjustment(
        { dataUrl: 'x', clipSignature: sig },
        [
          { xPct: 0, yPct: 0 },
          { xPct: 100, yPct: 0 },
          { xPct: 100, yPct: 100 },
          { xPct: 0, yPct: 100 },
        ],
      ),
    ).toBe(true);
  });
});
