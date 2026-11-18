// Warehouse floor plan: steel racks (PEC) and burlap grain sacks on pallets (lossy dielectric).
import { ROOM_HALF } from './constants';

export type FillLevel = 'empty' | 'half' | 'full';

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Rack extends Box3 {
  id: string;
  shelves: number[]; // shelf plate heights (m)
  posts: [number, number][]; // (x,z) of upright posts
}

export interface SackStack extends Box3 {
  id: string;
  layers: number;
  pallet: Box3;
}

export const POST_SIZE = 0.05;
export const SHELF_HEIGHTS = [0.12, 0.86, 1.6, 2.2];
export const PALLET_H = 0.14;
export const SACK_LAYER_H = 0.24;

function makeRack(id: string, x0: number, x1: number, z0: number, z1: number): Rack {
  const posts: [number, number][] = [];
  const nx = Math.round((x1 - x0) / 1.2);
  for (let i = 0; i <= nx; i++) {
    const x = x0 + ((x1 - x0) * i) / nx;
    posts.push([x, z0], [x, z1]);
  }
  return { id, min: [x0, 0, z0], max: [x1, 2.22, z1], shelves: SHELF_HEIGHTS, posts };
}

export const RACKS: Rack[] = [
  makeRack('A', -2.8, -0.4, -2.75, -2.15),
  makeRack('B', 0.6, 3.0, -2.75, -2.15),
  makeRack('C', -2.8, -0.4, 2.15, 2.75),
  makeRack('D', 0.6, 3.0, 2.15, 2.75),
];

const PALLET_SPOTS: [number, number][] = [
  [-2.2, -1.0],
  [-0.9, -1.0],
  [1.0, -1.0],
  [2.3, -1.0],
  [-2.2, 1.0],
  [-0.9, 1.0],
  [1.0, 1.0],
  [2.3, 1.0],
];

export function buildSacks(fill: FillLevel): SackStack[] {
  const out: SackStack[] = [];
  PALLET_SPOTS.forEach(([cx, cz], i) => {
    let layers = 0;
    if (fill === 'half') layers = i % 2 === 0 ? 2 : 0;
    if (fill === 'full') layers = 3;
    const hx = 0.6;
    const hz = 0.5;
    const pallet: Box3 = { min: [cx - hx, 0, cz - hz], max: [cx + hx, PALLET_H, cz + hz] };
    out.push({
      id: `S${i}`,
      layers,
      pallet,
      min: [cx - hx, PALLET_H, cz - hz],
      max: [cx + hx, PALLET_H + layers * SACK_LAYER_H, cz + hz],
    });
  });
  return out;
}

export function insideXZ(b: Box3, x: number, z: number, pad = 0): boolean {
  return x > b.min[0] - pad && x < b.max[0] + pad && z > b.min[2] - pad && z < b.max[2] + pad;
}

export function insideRoom(x: number, z: number, pad = 0.05): boolean {
  return Math.abs(x) < ROOM_HALF.x - pad && Math.abs(z) < ROOM_HALF.z - pad;
}

/**
 * Length (m) of the 3D segment p->q inside an axis-aligned box (slab method).
 */
export function segmentBoxLength(
  p: [number, number, number],
  q: [number, number, number],
  b: Box3,
): number {
  let t0 = 0;
  let t1 = 1;
  for (let a = 0; a < 3; a++) {
    const d = q[a] - p[a];
    if (Math.abs(d) < 1e-12) {
      if (p[a] < b.min[a] || p[a] > b.max[a]) return 0;
    } else {
      let ta = (b.min[a] - p[a]) / d;
      let tb = (b.max[a] - p[a]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 >= t1) return 0;
    }
  }
  const L = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  return (t1 - t0) * L;
}
