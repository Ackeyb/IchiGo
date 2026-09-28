import { describe, expect, it } from 'vitest';
import { getOutTrajectory, isOutAnimationComplete } from '../../src/dice/outTrajectory';

describe('OUT presentation trajectory', () => {
  const start = { x: 0, y: 6, z: -6 };

  it('rolls and bounces on the tray before crossing its edge', () => {
    const rolling = getOutTrajectory(start, 0, 0.5);
    expect(Math.abs(rolling.x)).toBeLessThan(6.5);
    expect(rolling.y).toBeGreaterThanOrEqual(0);

    const overEdge = getOutTrajectory(start, 0, 0.7);
    expect(Math.abs(overEdge.x)).toBeGreaterThan(6.5);
    expect(overEdge.y).toBeGreaterThan(-0.4);
  });

  it('falls below the tray and leaves the view before cleanup', () => {
    const falling = getOutTrajectory(start, 1, 0.86);
    const finished = getOutTrajectory(start, 1, 1);
    expect(falling.y).toBeLessThan(-1);
    expect(finished.y).toBeLessThan(-9);
    expect(isOutAnimationComplete(0.99)).toBe(false);
    expect(isOutAnimationComplete(1)).toBe(true);
  });

  it('varies exit direction without creating a SAFE face value', () => {
    expect(getOutTrajectory(start, 0, 0.8).x).toBeLessThan(0);
    expect(getOutTrajectory(start, 1, 0.8).x).toBeGreaterThan(0);
    expect(getOutTrajectory(start, 0, 1)).not.toHaveProperty('value');
  });
});
