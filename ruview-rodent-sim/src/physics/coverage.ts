// Floor detectability map: for a rodent breathing at each floor cell, how far above the
// detector's noise floor would its CSI perturbation be on the best RX link (dB margin)?
import { BANDS, ROOM, ROOM_HALF, SPECIES, lambdaOf, type BandId, type Species } from './constants';
import {
  ANT_OFFSET,
  fresnelShadow,
  rodentRcs,
  segmentBlockDb,
  type Polarization,
} from './csi';
import type { V3 } from './behavior';
import type { SackStack } from './layout';

export interface CoverageParams {
  band: BandId;
  tx: V3;
  rxs: V3[];
  pol: Polarization;
  moisture: number;
  sacks: SackStack[];
  species: Species;
  snrDb: number;
  packets: number; // integration length
}

export interface CoverageMap {
  gw: number;
  gh: number;
  margin: Float32Array; // dB above detection threshold
  coveredFrac: number;
}

const DETECT_DB = 6;
const BINS_FUSED = 6;

export function detectionMarginAt(p: CoverageParams, P: V3): number {
  const f0 = BANDS[p.band].fc;
  const lambda = lambdaOf(f0);
  const sp = SPECIES[p.species];
  const delta = sp.ribExpansion;
  const txA: V3 = [p.tx[0], p.tx[1] + ANT_OFFSET, p.tx[2]];
  const intGain = 10 * Math.log10(p.packets * BINS_FUSED);
  let best = -200;
  for (const rx of p.rxs) {
    const rxA: V3 = [rx[0], rx[1] + ANT_OFFSET, rx[2]];
    const D = Math.hypot(rxA[0] - txA[0], rxA[1] - txA[1], rxA[2] - txA[2]);
    const a0 = (lambda / (4 * Math.PI * D)) * Math.pow(10, -segmentBlockDb(txA, rxA, p.band, f0, p.moisture, p.sacks) / 20);
    const aMp = (0.45 * lambda) / (4 * Math.PI * D);
    const H = Math.hypot(a0, aMp);
    const d1 = Math.max(0.02, Math.hypot(P[0] - txA[0], P[1] - txA[1], P[2] - txA[2]));
    const d2 = Math.max(0.02, Math.hypot(P[0] - rxA[0], P[1] - rxA[1], P[2] - rxA[2]));
    const blk = segmentBlockDb(txA, P, p.band, f0, p.moisture, p.sacks) + segmentBlockDb(P, rxA, p.band, f0, p.moisture, p.sacks);
    const rcs = rodentRcs(sp.radius, sp.length, f0, p.band, 1);
    const aS = ((lambda / (4 * Math.PI)) * Math.sqrt(rcs.sigma / (4 * Math.PI)) / (d1 * d2)) * Math.pow(10, -blk / 20);
    // bistatic half-angle
    const u1 = [(P[0] - txA[0]) / d1, (P[1] - txA[1]) / d1, (P[2] - txA[2]) / d1];
    const u2 = [(P[0] - rxA[0]) / d2, (P[1] - rxA[1]) / d2, (P[2] - rxA[2]) / d2];
    const cosBeta = -(u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]);
    const cosHalf = Math.sqrt(Math.max(0, (1 + cosBeta) / 2));
    const dScatter = aS * ((2 * Math.PI) / lambda) * 2 * delta * cosHalf;
    // forward shadow modulation (projected-area breathing)
    const ab: V3 = [rxA[0] - txA[0], rxA[1] - txA[1], rxA[2] - txA[2]];
    const t = Math.max(0.02, Math.min(0.98, ((P[0] - txA[0]) * ab[0] + (P[1] - txA[1]) * ab[1] + (P[2] - txA[2]) * ab[2]) / (D * D)));
    const h = Math.hypot(P[0] - (txA[0] + ab[0] * t), P[1] - (txA[1] + ab[1] * t), P[2] - (txA[2] + ab[2] * t));
    const A = Math.PI * sp.radius * (sp.radius + (0.36 * sp.length - sp.radius) * 0.7);
    const S = fresnelShadow(A, 0.95, h, D * t, D * (1 - t), lambda);
    const dShadow = a0 * S * ((2 * delta) / sp.radius);
    const rel = (dScatter + dShadow) / H;
    const m = 20 * Math.log10(rel + 1e-30) + p.snrDb + intGain - DETECT_DB;
    best = Math.max(best, m);
  }
  return best;
}

export function computeCoverage(p: CoverageParams, gw = 96, gh = 72): CoverageMap {
  const margin = new Float32Array(gw * gh);
  const r = SPECIES[p.species].radius * 1.15;
  let covered = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = -ROOM_HALF.x + ((i + 0.5) / gw) * ROOM.x;
      const z = -ROOM_HALF.z + ((j + 0.5) / gh) * ROOM.z;
      const m = detectionMarginAt(p, [x, r, z]);
      margin[j * gw + i] = m;
      if (m > 0) covered++;
    }
  }
  return { gw, gh, margin, coveredFrac: covered / (gw * gh) };
}
