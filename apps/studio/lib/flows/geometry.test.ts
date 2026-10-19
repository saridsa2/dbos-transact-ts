import { expect, it, vi } from 'vitest';
import { ropePath } from './geometry';
it('canonicalizes edge paths and labels across tiny engine differences in trigonometry', () => {
  const source = { x: -380, y: -37 };
  const target = { x: -280, y: -23 };
  const original = ropePath(source, target);
  const sin = Math.sin;
  const mock = vi.spyOn(Math, 'sin').mockImplementation((angle) => sin(angle) + Number.EPSILON);
  try {
    expect(ropePath(source, target)).toEqual(original);
  } finally {
    mock.mockRestore();
  }
});
