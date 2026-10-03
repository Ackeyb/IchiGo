import { Quaternion, Vector3 } from 'three';
import type { DieValue } from '../game/types';

const UP = new Vector3(0, 1, 0);
const FACE_NORMALS: Readonly<Record<DieValue, readonly [number, number, number]>> = {
  1: [0, 1, 0],
  2: [1, 0, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
  5: [-1, 0, 0],
  6: [0, -1, 0],
};

export function getD6FaceNormal(value: DieValue): Vector3 {
  return new Vector3(...FACE_NORMALS[value]);
}

/** Maps the requested local face normal to world-up; yaw may be added without changing the top face. */
export function getD6TargetQuaternion(value: DieValue, yaw = 0): Quaternion {
  const faceUp = new Quaternion().setFromUnitVectors(getD6FaceNormal(value), UP);
  return new Quaternion().setFromAxisAngle(UP, yaw).multiply(faceUp).normalize();
}

export function getDisplayedTopValue(quaternion: Quaternion): DieValue {
  // This reads presentation orientation for verification only; it is not a game roll result.
  let best: DieValue = 1;
  let bestY = -Infinity;
  for (const value of [1, 2, 3, 4, 5, 6] as const) {
    const y = getD6FaceNormal(value).applyQuaternion(quaternion).y;
    if (y > bestY) {
      best = value;
      bestY = y;
    }
  }
  return best;
}
