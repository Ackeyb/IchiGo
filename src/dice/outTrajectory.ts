export type Point3 = Readonly<{ x: number; y: number; z: number }>;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const smoothstep = (value: number) => value * value * (3 - 2 * value);

/** Presentation-only path: rolls on the tray, clears its lip, then falls under gravity. */
export function getOutTrajectory(start: Point3, index: number, progress: number): Point3 {
  const value = clamp01(progress);
  const direction = index % 2 === 0 ? -1 : 1;
  const laneZ = ((index % 3) - 1) * 0.9;

  if (value < 0.56) {
    const time = smoothstep(value / 0.56);
    return {
      x: lerp(start.x, direction * 5.6, time),
      y: lerp(start.y, 0, time) + Math.abs(Math.sin(time * Math.PI * 3)) * (1 - time) * 1.05,
      z: lerp(start.z, laneZ, time) + Math.sin(time * Math.PI) * direction * 0.8,
    };
  }

  if (value < 0.72) {
    const time = smoothstep((value - 0.56) / 0.16);
    return {
      x: lerp(direction * 5.6, direction * 6.95, time),
      y: Math.sin(time * Math.PI) * 0.5 - time * 0.3,
      z: laneZ + Math.sin(time * Math.PI) * direction * 0.25,
    };
  }

  const fallTime = (value - 0.72) / 0.28;
  return {
    x: direction * (6.95 + fallTime * 1.8),
    y: -0.3 - 9 * fallTime * fallTime,
    z: laneZ + direction * fallTime * 0.45,
  };
}

export function isOutAnimationComplete(progress: number): boolean {
  return progress >= 1;
}
