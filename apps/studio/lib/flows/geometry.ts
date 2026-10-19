// Ported StackProc rope geometry, with canonical coordinates for hydration.
type Point = { x: number; y: number };
function ropePoints(source: Point, target: Point, sagScale = 1) {
  const distance = Math.hypot(target.x - source.x, target.y - source.y);
  const direction = target.x >= source.x ? 1 : -1;
  const verticalBias = Math.abs(target.y - source.y) > Math.abs(target.x - source.x);
  const sag = Math.min(110, Math.max(20, distance * (verticalBias ? 0.08 : 0.13))) * sagScale;
  return Array.from({ length: 16 }, (_, index) => {
    const progress = index / 15;
    const bow = Math.sin(Math.PI * progress);
    return {
      x: source.x + (target.x - source.x) * progress + (verticalBias ? bow * 18 * direction : 0),
      y: source.y + (target.y - source.y) * progress + (verticalBias ? 0 : bow * sag),
    };
  });
}

function smoothThrough(points: Point[]) {
  // Canonicalize floating-point coordinates before producing SSR attributes.
  // JS engines can differ in the last bits of trigonometric results.
  points = points.map((point) => ({ x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)) }));
  const first = points[0];
  if (!first) return '';
  let path = `M ${first.x} ${first.y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current && next) {
      path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
    }
  }
  const last = points[points.length - 1];
  if (last) path += ` T ${last.x} ${last.y}`;
  return path;
}

export function ropePath(source: Point, target: Point, sagScale = 1) {
  const points = ropePoints(source, target, sagScale);
  const mid = points[Math.floor(points.length / 2)] ?? source;
  return { d: smoothThrough(points), labelX: Number(mid.x.toFixed(3)), labelY: Number(mid.y.toFixed(3)) };
}
