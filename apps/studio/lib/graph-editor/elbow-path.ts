import type { HandleSide, Point } from './contracts';
type Box = { position: Point; size: { width: number; height: number } };
const vectors: Record<HandleSide, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
/** Orthogonal visibility-grid routing. Stubs respect the chosen ports; card interiors are obstacles. */
export function elbowPath(
  source: Point,
  target: Point,
  sourceSide: HandleSide = 'right',
  targetSide: HandleSide = 'left',
  boxes: Box[] = [],
) {
  const clearance = 20,
    stub = 28;
  const offset = (p: Point, side: HandleSide) => ({ x: p.x + vectors[side].x * stub, y: p.y + vectors[side].y * stub });
  const a = offset(source, sourceSide),
    b = offset(target, targetSide);
  const obstacles = boxes.map(({ position: p, size: s }) => ({
    left: p.x - clearance,
    right: p.x + s.width + clearance,
    top: p.y - clearance,
    bottom: p.y + s.height + clearance,
  }));
  const clear = (p: Point, q: Point) =>
    !obstacles.some((r) =>
      p.x === q.x
        ? p.x > r.left && p.x < r.right && Math.max(p.y, q.y) > r.top && Math.min(p.y, q.y) < r.bottom
        : p.y > r.top && p.y < r.bottom && Math.max(p.x, q.x) > r.left && Math.min(p.x, q.x) < r.right,
    );
  const length = (p: Point, q: Point) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
  const simplify = (points: Point[]) =>
    points
      .filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y)
      .reduce<Point[]>((out, p) => {
        while (out.length > 1) {
          const u = out[out.length - 2],
            v = out[out.length - 1];
          if (
            !(
              (u.x === v.x && v.x === p.x && (v.y - u.y) * (p.y - v.y) >= 0) ||
              (u.y === v.y && v.y === p.y && (v.x - u.x) * (p.x - v.x) >= 0)
            )
          )
            break;
          out.pop();
        }
        out.push(p);
        return out;
      }, []);
  const candidates = [
    [a, { x: b.x, y: a.y }, b],
    [a, { x: a.x, y: b.y }, b],
  ];
  const xs = [...new Set([a.x, b.x, (a.x + b.x) / 2, ...obstacles.flatMap((r) => [r.left, r.right])])].sort(
    (x, y) => x - y,
  );
  const ys = [...new Set([a.y, b.y, (a.y + b.y) / 2, ...obstacles.flatMap((r) => [r.top, r.bottom])])].sort(
    (x, y) => x - y,
  );
  for (const x of xs) candidates.push([a, { x, y: a.y }, { x, y: b.y }, b]);
  for (const y of ys) candidates.push([a, { x: a.x, y }, { x: b.x, y }, b]);
  const score = (ps: Point[]) => ps.slice(1).reduce((v, p, i) => v + length(ps[i], p), 0) + ps.length * 16;
  let middle = candidates
    .map(simplify)
    .filter((ps) => ps.every((p, i) => !i || clear(ps[i - 1], p)))
    .sort((p, q) => score(p) - score(q))[0];
  if (!middle) {
    // A* visits grid intersections only when a simpler two-bend corridor is blocked.
    const start = ys.indexOf(a.y) * xs.length + xs.indexOf(a.x),
      end = ys.indexOf(b.y) * xs.length + xs.indexOf(b.x);
    const point = (id: number) => ({ x: xs[id % xs.length], y: ys[Math.floor(id / xs.length)] });
    const open = [{ id: start, cost: 0, estimate: length(a, b) }],
      best = new Map([[start, 0]]),
      previous = new Map<number, number>();
    while (open.length) {
      open.sort((u, v) => v.estimate - u.estimate);
      const current = open.pop()!;
      if (current.cost !== best.get(current.id)) continue;
      if (current.id === end) {
        const path = [b];
        let id = end;
        while (id !== start) {
          id = previous.get(id)!;
          path.unshift(point(id));
        }
        middle = path;
        break;
      }
      const x = current.id % xs.length,
        y = Math.floor(current.id / xs.length),
        p = point(current.id);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (nx < 0 || nx >= xs.length || ny < 0 || ny >= ys.length) continue;
        const id = ny * xs.length + nx,
          q = point(id);
        if (!clear(p, q)) continue;
        const cost = current.cost + length(p, q);
        if (cost >= (best.get(id) ?? Infinity)) continue;
        best.set(id, cost);
        previous.set(id, current.id);
        open.push({ id, cost, estimate: cost + length(q, b) });
      }
    }
  }
  // Overlapping cards can enclose a port. Retain an orthogonal editable connector in that case.
  const points = simplify([source, ...(middle ?? [a, { x: b.x, y: a.y }, b]), target]);
  const total = points.slice(1).reduce((sum, p, i) => sum + length(points[i], p), 0);
  let remaining = total / 2,
    label = source;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1],
      q = points[i],
      distance = length(p, q);
    if (remaining <= distance) {
      const t = distance ? remaining / distance : 0;
      label = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
      break;
    }
    remaining -= distance;
  }
  return {
    d: points.map((p, i) => `${i ? 'L' : 'M'} ${Number(p.x.toFixed(3))} ${Number(p.y.toFixed(3))}`).join(' '),
    labelX: label.x,
    labelY: label.y,
    points,
  };
}
