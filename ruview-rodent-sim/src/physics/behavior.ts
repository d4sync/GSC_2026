// Rodent / human / fan kinematics. Rodents: thigmotaxis (wall hugging), stop-and-go darting,
// vertical climbing of rack posts, near-field antenna sniffing, hiding.
import { ROOM_HALF, SPECIES, type Species } from './constants';
import { RACKS, insideXZ, type SackStack } from './layout';

export type V3 = [number, number, number];
export type RodentMode = 'wander' | 'freeze' | 'climb' | 'perched' | 'sniff' | 'hide';

export interface RodentAgent {
  id: number;
  species: Species;
  pos: V3; // contact point (feet / claws)
  vel: V3;
  heading: number; // rad, in XZ plane (0 = +x)
  climbing: boolean;
  wallNormal: [number, number]; // outward normal while climbing
  mode: RodentMode;
  target: [number, number];
  speed: number;
  timer: number;
  dashing: boolean;
  breathHz: number;
  breathPhase: number;
  heartHz: number;
  heartPhase: number;
  gait: number;
  climbPost?: [number, number];
  climbTarget?: number;
  anchor?: V3;
}

export interface BodyFrame {
  center: V3;
  f: V3; // forward (local +x)
  u: V3; // dorsal (local +y)
  w: V3; // right (local +z) = f x u
}

let seed = 1234567;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
export const randRange = (a: number, b: number) => a + (b - a) * rand();

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function bodyFrame(a: RodentAgent): BodyFrame {
  const r = SPECIES[a.species].radius;
  if (a.climbing) {
    const f: V3 = [0, 1, 0];
    const u: V3 = [a.wallNormal[0], 0, a.wallNormal[1]];
    const w = cross(f, u);
    return { center: [a.pos[0] + u[0] * r * 1.1, a.pos[1], a.pos[2] + u[2] * r * 1.1], f, u, w };
  }
  const f: V3 = [Math.cos(a.heading), 0, Math.sin(a.heading)];
  const u: V3 = [0, 1, 0];
  const w = cross(f, u);
  return { center: [a.pos[0], a.pos[1] + r * 1.15, a.pos[2]], f, u, w };
}

export function localToWorld(fr: BodyFrame, p: V3): V3 {
  return [
    fr.center[0] + fr.f[0] * p[0] + fr.u[0] * p[1] + fr.w[0] * p[2],
    fr.center[1] + fr.f[1] * p[0] + fr.u[1] * p[1] + fr.w[1] * p[2],
    fr.center[2] + fr.f[2] * p[0] + fr.u[2] * p[1] + fr.w[2] * p[2],
  ];
}

export function worldToLocal(fr: BodyFrame, p: V3): V3 {
  const d: V3 = [p[0] - fr.center[0], p[1] - fr.center[1], p[2] - fr.center[2]];
  return [
    d[0] * fr.f[0] + d[1] * fr.f[1] + d[2] * fr.f[2],
    d[0] * fr.u[0] + d[1] * fr.u[1] + d[2] * fr.u[2],
    d[0] * fr.w[0] + d[1] * fr.w[1] + d[2] * fr.w[2],
  ];
}

export function makeRodent(id: number, species: Species, x: number, z: number, mode: RodentMode = 'wander'): RodentAgent {
  const sp = SPECIES[species];
  return {
    id,
    species,
    pos: [x, 0, z],
    vel: [0, 0, 0],
    heading: randRange(0, Math.PI * 2),
    climbing: false,
    wallNormal: [0, 1],
    mode,
    target: [x, z],
    speed: 0,
    timer: randRange(0.2, 1.0),
    dashing: false,
    breathHz: randRange(sp.breathHz[0], sp.breathHz[1]),
    breathPhase: rand() * Math.PI * 2,
    heartHz: randRange(sp.heartHz[0], sp.heartHz[1]),
    heartPhase: rand() * Math.PI * 2,
    gait: 0,
  };
}

const PERIM = 0.09;
const PERIM_PTS: [number, number][] = [
  [-ROOM_HALF.x + PERIM, -ROOM_HALF.z + PERIM],
  [0, -ROOM_HALF.z + PERIM],
  [ROOM_HALF.x - PERIM, -ROOM_HALF.z + PERIM],
  [ROOM_HALF.x - PERIM, 0],
  [ROOM_HALF.x - PERIM, ROOM_HALF.z - PERIM],
  [0, ROOM_HALF.z - PERIM],
  [-ROOM_HALF.x + PERIM, ROOM_HALF.z - PERIM],
  [-ROOM_HALF.x + PERIM, 0],
];

function blocked(x: number, z: number, sacks: SackStack[]): boolean {
  if (Math.abs(x) > ROOM_HALF.x - 0.06 || Math.abs(z) > ROOM_HALF.z - 0.06) return true;
  for (const s of sacks) if (insideXZ(s.pallet, x, z, 0.03)) return true;
  for (const r of RACKS) for (const p of r.posts) if (Math.hypot(x - p[0], z - p[1]) < 0.05) return true;
  return false;
}

function pickTarget(a: RodentAgent, sacks: SackStack[]): [number, number] {
  if (rand() < 0.65) {
    // thigmotaxis: nearest perimeter waypoint, then step along the loop
    let best = 0;
    let bd = Infinity;
    PERIM_PTS.forEach((p, i) => {
      const d = Math.hypot(p[0] - a.pos[0], p[1] - a.pos[2]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const dir = rand() < 0.5 ? 1 : PERIM_PTS.length - 1;
    const idx = bd < 0.3 ? (best + dir) % PERIM_PTS.length : best;
    return PERIM_PTS[idx];
  }
  for (let k = 0; k < 30; k++) {
    const x = randRange(-ROOM_HALF.x + 0.2, ROOM_HALF.x - 0.2);
    const z = randRange(-ROOM_HALF.z + 0.2, ROOM_HALF.z - 0.2);
    if (!blocked(x, z, sacks)) return [x, z];
  }
  return [a.pos[0], a.pos[2]];
}

export function stepRodent(a: RodentAgent, dt: number, sacks: SackStack[]): void {
  a.breathPhase += 2 * Math.PI * a.breathHz * dt;
  a.heartPhase += 2 * Math.PI * a.heartHz * dt;
  const prev: V3 = [...a.pos];

  switch (a.mode) {
    case 'wander': {
      a.timer -= dt;
      if (a.timer <= 0) {
        a.dashing = !a.dashing;
        if (a.dashing) {
          a.target = pickTarget(a, sacks);
          a.speed = randRange(0.1, 1.5);
          a.timer = randRange(0.3, 1.6);
        } else {
          a.speed = 0;
          a.timer = randRange(0.3, 2.2);
        }
      }
      if (a.dashing) moveToward(a, dt, sacks);
      break;
    }
    case 'climb': {
      const post = a.climbPost!;
      if (!a.climbing) {
        a.target = [post[0], post[1] + 0.06];
        a.speed = 0.5;
        const arrived = moveToward(a, dt, sacks, 0.02);
        if (arrived) {
          a.climbing = true;
          a.wallNormal = [0, 1];
          a.pos = [post[0], 0.0, post[1] + 0.03];
        }
      } else {
        a.pos[1] += 0.28 * dt * (0.6 + 0.4 * Math.abs(Math.sin(a.breathPhase * 0.5)));
        if (a.pos[1] >= (a.climbTarget ?? 1.6)) {
          a.climbing = false;
          a.mode = 'perched';
          a.pos = [post[0] + 0.25, a.climbTarget ?? 1.6, post[1] - 0.25];
          a.heading = 0;
        }
      }
      break;
    }
    case 'sniff': {
      const an = a.anchor!;
      a.target = [an[0], an[2]];
      a.speed = 0.35;
      moveToward(a, dt, sacks, 0.004);
      a.heading += Math.sin(a.breathPhase * 0.7) * dt * 0.8;
      break;
    }
    case 'hide': {
      const an = a.anchor!;
      a.pos[0] = an[0] + 0.004 * Math.sin(a.breathPhase * 0.13);
      a.pos[2] = an[2] + 0.004 * Math.cos(a.breathPhase * 0.11);
      break;
    }
    case 'perched':
    case 'freeze':
      break;
  }
  a.gait += a.speed * dt * 40;
  const idt = dt > 0 ? 1 / dt : 0;
  a.vel = [(a.pos[0] - prev[0]) * idt, (a.pos[1] - prev[1]) * idt, (a.pos[2] - prev[2]) * idt];
}

function moveToward(a: RodentAgent, dt: number, sacks: SackStack[], tol = 0.05): boolean {
  const dx = a.target[0] - a.pos[0];
  const dz = a.target[1] - a.pos[2];
  const d = Math.hypot(dx, dz);
  if (d < tol) {
    a.speed = 0;
    return true;
  }
  const desired = Math.atan2(dz, dx);
  let dh = desired - a.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  a.heading += Math.max(-8 * dt, Math.min(8 * dt, dh));
  const step = Math.min(d, a.speed * dt);
  const nx = a.pos[0] + Math.cos(a.heading) * step;
  const nz = a.pos[2] + Math.sin(a.heading) * step;
  if (blocked(nx, nz, sacks)) {
    a.target = pickTarget(a, sacks);
    a.heading += Math.PI * 0.5;
    return false;
  }
  a.pos[0] = nx;
  a.pos[2] = nz;
  return false;
}

/** Breathing inspiration fraction 0..1 and heart pulse 0..1 */
export function breathOf(a: RodentAgent): number {
  return 0.5 - 0.5 * Math.cos(a.breathPhase);
}
export function heartOf(a: RodentAgent): number {
  const s = Math.sin(a.heartPhase);
  return Math.max(0, s) ** 3;
}

// ---------------------------------------------------------------- human worker
export interface HumanState {
  pos: V3;
  heading: number;
  vel: V3;
  breathDisp: number; // chest displacement (m)
  gait: number;
}

export const HUMAN_X = 0.25;
export function humanAt(t: number): HumanState {
  const span = 4.6;
  const v = 1.05;
  const period = (2 * span) / v;
  const ph = ((t % period) + period) % period;
  const forward = ph < span / v;
  const s = forward ? ph * v : span - (ph - span / v) * v;
  const z = -span / 2 + s;
  const breathDisp = 0.005 * Math.sin(2 * Math.PI * 0.28 * t);
  return {
    pos: [HUMAN_X, 0, z],
    heading: forward ? Math.PI / 2 : -Math.PI / 2,
    vel: [0, 0, forward ? v : -v],
    breathDisp,
    gait: t * v * 3.2,
  };
}

// ---------------------------------------------------------------- ventilation fan
export const FAN_POS: V3 = [3.88, 2.55, -1.3];
export const FAN_RPS = 8;
export const FAN_BLADES = 3;
