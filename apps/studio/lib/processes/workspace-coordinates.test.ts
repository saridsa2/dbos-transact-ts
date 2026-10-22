import { describe, it, expect } from 'vitest';
import { processSheetPoint } from './workspace-coordinates';
describe('scrolling process workspace coordinates', () => {
  for (const zoom of [0.5, 1, 1.5])
    it(`roundtrips activity and connector positions after two-axis scrolling at ${zoom} zoom`, () => {
      const origin = { x: -550, y: -360 },
        rect = { left: 20, top: 180 },
        scroll = { x: 270, y: 420 },
        world = { x: 390, y: 500 };
      const screen = {
        x: rect.left + (world.x - origin.x) * zoom - scroll.x,
        y: rect.top + (world.y - origin.y) * zoom - scroll.y,
      };
      expect(processSheetPoint(screen, rect, scroll, zoom, origin)).toEqual(world);
    });
  it('maps the top-left to the sheet origin without a viewport-center offset', () => {
    expect(
      processSheetPoint({ x: 50, y: 120 }, { left: 50, top: 120 }, { x: 0, y: 0 }, 1, { x: -200, y: -300 }),
    ).toEqual({ x: -200, y: -300 });
  });
});
