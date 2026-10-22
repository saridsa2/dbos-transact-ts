import { describe, it, expect } from 'vitest';
import { elbowPath } from './elbow-path';
import type { HandleSide } from './contracts';
describe('orthogonal process connectors', () => {
  const boxes = [
    { position: { x: 0, y: 0 }, size: { width: 284, height: 142 } },
    { position: { x: 700, y: 340 }, size: { width: 284, height: 142 } },
  ];
  const port = (box: (typeof boxes)[number], side: HandleSide) => ({
    x: box.position.x + (side === 'left' ? 0 : side === 'right' ? 284 : 142),
    y: box.position.y + (side === 'top' ? 0 : side === 'bottom' ? 142 : 71),
  });
  for (const sourceSide of ['top', 'right', 'bottom', 'left'] as HandleSide[])
    for (const targetSide of ['top', 'right', 'bottom', 'left'] as HandleSide[])
      it(`${sourceSide} to ${targetSide} preserves ports and right angles`, () => {
        const source = port(boxes[0], sourceSide),
          target = port(boxes[1], targetSide),
          path = elbowPath(source, target, sourceSide, targetSide, boxes);
        expect(path.points[0]).toEqual(source);
        expect(path.points.at(-1)).toEqual(target);
        expect(path.d).not.toMatch(/[QCT]/);
        path.points.slice(1).forEach((p, i) => {
          const q = path.points[i];
          expect(p.x === q.x || p.y === q.y).toBe(true);
        });
        const first = path.points[1],
          last = path.points.at(-2)!;
        expect(
          sourceSide === 'left'
            ? first.x < source.x
            : sourceSide === 'right'
              ? first.x > source.x
              : sourceSide === 'top'
                ? first.y < source.y
                : first.y > source.y,
        ).toBe(true);
        expect(
          targetSide === 'left'
            ? last.x < target.x
            : targetSide === 'right'
              ? last.x > target.x
              : targetSide === 'top'
                ? last.y < target.y
                : last.y > target.y,
        ).toBe(true);
      });
  it('detours around intervening activities and positions labels on a routed segment', () => {
    const obstacle = { position: { x: 350, y: -120 }, size: { width: 284, height: 360 } },
      path = elbowPath({ x: 284, y: 71 }, { x: 700, y: 71 }, 'right', 'left', [
        boxes[0],
        obstacle,
        { position: { x: 700, y: 0 }, size: { width: 284, height: 142 } },
      ]);
    for (let i = 1; i < path.points.length; i++) {
      const p = path.points[i - 1],
        q = path.points[i];
      expect(
        p.x === q.x
          ? p.x <= 350 || p.x >= 634 || Math.max(p.y, q.y) <= -120 || Math.min(p.y, q.y) >= 240
          : p.y <= -120 || p.y >= 240 || Math.max(p.x, q.x) <= 350 || Math.min(p.x, q.x) >= 634,
      ).toBe(true);
    }
    expect(
      path.points.some((p, i) => {
        const q = path.points[i + 1];
        return (
          q &&
          ((p.x === q.x &&
            path.labelX === p.x &&
            path.labelY >= Math.min(p.y, q.y) &&
            path.labelY <= Math.max(p.y, q.y)) ||
            (p.y === q.y &&
              path.labelY === p.y &&
              path.labelX >= Math.min(p.x, q.x) &&
              path.labelX <= Math.max(p.x, q.x)))
        );
      }),
    ).toBe(true);
  });
  it('remains deterministic for backwards and aligned flows', () => {
    const p = elbowPath({ x: 700, y: 71 }, { x: 284, y: 71 }, 'right', 'left', boxes);
    expect(p).toEqual(elbowPath({ x: 700, y: 71 }, { x: 284, y: 71 }, 'right', 'left', boxes));
    expect(p.d).not.toMatch(/NaN|Infinity/);
  });
});
