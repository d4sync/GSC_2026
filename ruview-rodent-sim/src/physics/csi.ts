// Warehouse-scale multipath channel model -> per-subcarrier CSI (SYNTHETIC).
// Paths: LOS (with Fresnel-zone forward shadowing), floor/ceiling/wall image reflections,
// steel-rack scatterers, rodent bistatic scattering (Rayleigh->Mie RCS with breathing
// modulation), human worker, ventilation fan. Blockage: steel racks (PEC shelving) and
// lossy grain sacks whose attenuation depends on moisture and frequency.
import {
  C0,
  EPS0,
  ROOM,
  ROOM_HALF,
  TISSUE,
  attenuationDbPerM,
  grainDielectric,
  lambdaOf,
  type BandId,
} from './constants';
import { RACKS, segmentBoxLength, type SackStack } from './layout';
import { FAN_BLADES, FAN_POS, FAN_RPS, type HumanState, type V3 } from './behavior';

export type Polarization = 'vertical' | 'slant' | 'horizontal';
export type PathKind = 'los' | 'floor' | 'ceiling' | 'wall' | 'rack' | 'rodent' | 'human' | 'fan';

export interface RodentScat {
  center: V3; // thorax centre (world)
  axis: V3; // body forward axis (unit)
  r: number; // trunk radius incl. current ribcage expansion
  L: number; // body length
  expansion: number; // current ribcage excursion (m)
  heartDisp: number; // cardiac surface displacement (m)
  vel: V3;
}

export interface ChannelInputs {
  band: BandId;
  f0: number;
  tx: V3;
  rx: V3;
  pol: Polarization;
  moisture: number;
  sacks: SackStack[];
  rodents: RodentScat[];
  human: HumanState | null;
  fan: boolean;
  rain: boolean;
  t: number;
}

export interface PathInfo {
  kind: PathKind;
  amp: number; // linear field amplitude (Friis-normalised, i.e. lambda/4pi d)
  length: number; // total electrical path length (m)
  pts: V3[]; // polyline for visualisation
  doppler: number; // Hz
}

export interface NearField {
  dist: number;
  gain: number; // amplitude factor from antenna detuning
  phase: number; // rad
  saturated: boolean;
}

export interface ChannelResult {
  paths: PathInfo[];
  near: NearField;
  losShadow: number; // fractional LOS amplitude reduction from bodies
  blockDb: number; // LOS blockage (dB)
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const dist = (a: V3, b: V3) => len(sub(a, b));

export const ANT_OFFSET = 0.075; // antenna feed above board

/** Blockage (dB) along a straight segment through racks and sacks. */
export function segmentBlockDb(p: V3, q: V3, band: BandId, f0: number, moisture: number, sacks: SackStack[]): number {
  let db = 0;
  for (const r of RACKS) {
    const shelfZone = segmentBoxLength(p, q, { min: [r.min[0], 0.11, r.min[2]], max: [r.max[0], r.max[1], r.max[2]] });
    const floorZone = segmentBoxLength(p, q, { min: [r.min[0], 0, r.min[2]], max: [r.max[0], 0.11, r.max[2]] });
    if (shelfZone > 0) db += 14 + 6 * Math.min(1, shelfZone / 0.6);
    else if (floorZone > 0) db += 2.5;
  }
  const g = grainDielectric(moisture, f0);
  const aGrain = attenuationDbPerM(g, f0);
  for (const s of sacks) {
    if (s.layers > 0) {
      const l = segmentBoxLength(p, q, s);
      if (l > 0) db += Math.min(70, aGrain * l + 1.5);
    }
    const lp = segmentBoxLength(p, q, s.pallet);
    if (lp > 0) db += 1.0 + 3 * lp;
  }
  void band;
  return db;
}

const dbToAmp = (db: number) => Math.pow(10, -db / 20);

/** Complex relative permittivity of muscle-like tissue. */
function tissueEc(band: BandId, f: number): [number, number] {
  const d = TISSUE.muscle[band];
  return [d.er, -d.sigma / (2 * Math.PI * f * EPS0)];
}

export interface RcsInfo {
  sigma: number;
  ka: number;
  regime: 'Rayleigh' | 'Mie' | 'Optical';
}

/**
 * Approximate bistatic RCS of a rodent trunk (lossy prolate body) with polarisation coupling.
 * Rayleigh: sigma = 4 pi k^4 a^6 |K|^2 ; blended into the geometric limit with a Mie ripple.
 */
export function rodentRcs(r: number, L: number, f: number, band: BandId, polCoupling: number): RcsInfo {
  const k = (2 * Math.PI * f) / C0;
  const aEq = Math.cbrt(0.36 * L * r * r);
  const [er, ei] = tissueEc(band, f);
  // K = (ec-1)/(ec+2)
  const nr = er - 1;
  const ni = ei;
  const dr = er + 2;
  const di = ei;
  const den = dr * dr + di * di;
  const Kr = (nr * dr + ni * di) / den;
  const Ki = (ni * dr - nr * di) / den;
  const K2 = Kr * Kr + Ki * Ki;
  const ka = k * aEq;
  const sR = 4 * Math.PI * Math.pow(k, 4) * Math.pow(aEq, 6) * K2;
  const sO = Math.PI * aEq * aEq * 0.85;
  let s = (sR * sO) / (sR + sO);
  const mie = Math.min(1, Math.max(0, (ka - 0.6) / 0.6));
  s *= 1 + 0.45 * mie * Math.sin(4 * ka - 1.2) * Math.exp(-0.25 * Math.max(0, ka - 1));
  s *= polCoupling;
  return { sigma: s, ka, regime: ka < 0.6 ? 'Rayleigh' : ka < 3 ? 'Mie' : 'Optical' };
}

/** Unit E-field direction for the given antenna polarisation and propagation direction. */
export function eFieldDir(pol: Polarization, prop: V3): V3 {
  const v: V3 = [0, 1, 0];
  let h: V3 = [-prop[2], 0, prop[0]];
  const hl = Math.hypot(h[0], h[2]) || 1;
  h = [h[0] / hl, 0, h[2] / hl];
  if (pol === 'vertical') return v;
  if (pol === 'horizontal') return h;
  const s = Math.SQRT1_2;
  return [h[0] * s, s, h[2] * s];
}

export function polCouplingFor(pol: Polarization, prop: V3, axis: V3): number {
  const e = eFieldDir(pol, prop);
  const c = dot(e, axis);
  return 0.45 + 1.1 * c * c;
}

/** Point-to-segment distance and the projected distances along the segment. */
function losGeometry(p: V3, a: V3, b: V3): { h: number; d1: number; d2: number } {
  const ab = sub(b, a);
  const D = len(ab);
  const t = Math.max(0.02, Math.min(0.98, dot(sub(p, a), ab) / (D * D)));
  const proj: V3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return { h: dist(p, proj), d1: D * t, d2: D * (1 - t) };
}

/** Fractional LOS field reduction by a body of projected area A at offset h from the LOS line. */
export function fresnelShadow(A: number, opacity: number, h: number, d1: number, d2: number, lambda: number): number {
  const rF = Math.sqrt((lambda * d1 * d2) / (d1 + d2));
  const AF = Math.PI * rF * rF;
  return Math.min(0.95, 1.25 * opacity * (A / AF) * Math.exp(-((h / rF) ** 2)));
}

export function firstFresnelRadius(lambda: number, d1: number, d2: number): number {
  return Math.sqrt((lambda * d1 * d2) / (d1 + d2));
}

function bistaticAmp(lambda: number, sigma: number, d1: number, d2: number): number {
  return (lambda / (4 * Math.PI)) * Math.sqrt(sigma / (4 * Math.PI)) / (d1 * d2);
}

function reflCoef(kind: 'floor' | 'ceiling' | 'wall', pol: Polarization): number {
  if (kind === 'ceiling') return 0.85;
  if (kind === 'wall') return pol === 'vertical' ? 0.42 : pol === 'horizontal' ? 0.35 : 0.38;
  return pol === 'vertical' ? 0.35 : pol === 'horizontal' ? 0.62 : 0.48;
}

export function buildPaths(inp: ChannelInputs): ChannelResult {
  const { f0, tx, rx, pol, sacks, moisture, band } = inp;
  const lambda = lambdaOf(f0);
  const txA: V3 = [tx[0], tx[1] + ANT_OFFSET, tx[2]];
  const rxA: V3 = [rx[0], rx[1] + ANT_OFFSET, rx[2]];
  const paths: PathInfo[] = [];
  const blk = (p: V3, q: V3) => segmentBlockDb(p, q, band, f0, moisture, sacks);

  // ---- LOS with forward (Fresnel) shadowing by rodents / human
  const D = dist(txA, rxA);
  const losBlk = blk(txA, rxA);
  const losDir: V3 = sub(rxA, txA).map((v) => v / D) as V3;
  let shadowKeep = 1;
  const muscle = TISSUE.muscle[band];
  const w = 2 * Math.PI * f0;
  const lossTan = muscle.sigma / (w * EPS0 * muscle.er);
  const alpha = (w / C0) * Math.sqrt(muscle.er / 2) * Math.sqrt(Math.sqrt(1 + lossTan * lossTan) - 1);
  for (const r of inp.rodents) {
    const g = losGeometry(r.center, txA, rxA);
    const sinAx = Math.sqrt(Math.max(0, 1 - dot(r.axis, losDir) ** 2));
    const A = Math.PI * r.r * (r.r + (0.36 * r.L - r.r) * sinAx);
    const opacity = 1 - Math.exp(-2 * alpha * 2 * r.r);
    shadowKeep *= 1 - fresnelShadow(A, opacity, g.h, g.d1, g.d2, lambda);
  }
  if (inp.human) {
    const hc: V3 = [inp.human.pos[0], Math.min(1.0, Math.max(0.1, txA[1])), inp.human.pos[2]];
    const g = losGeometry(hc, txA, rxA);
    const hy = Math.max(0, txA[1] - 1.75);
    const A = 0.28 + 0.12 * Math.abs(Math.sin(inp.human.gait));
    shadowKeep *= 1 - fresnelShadow(A, 1, Math.hypot(g.h, hy), g.d1, g.d2, lambda);
  }
  paths.push({ kind: 'los', amp: (lambda / (4 * Math.PI * D)) * dbToAmp(losBlk) * shadowKeep, length: D, pts: [txA, rxA], doppler: 0 });

  // ---- image-method single reflections
  const images: { kind: 'floor' | 'ceiling' | 'wall'; img: V3; plane: (a: V3, b: V3) => V3 | null }[] = [];
  const planeHit = (axis: 0 | 1 | 2, value: number) => (a: V3, b: V3): V3 | null => {
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) return null;
    const t = (value - a[axis]) / d;
    if (t <= 0 || t >= 1) return null;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  images.push({ kind: 'floor', img: [rxA[0], -rxA[1], rxA[2]], plane: planeHit(1, 0) });
  images.push({ kind: 'ceiling', img: [rxA[0], 2 * ROOM.h - rxA[1], rxA[2]], plane: planeHit(1, ROOM.h) });
  images.push({ kind: 'wall', img: [2 * ROOM_HALF.x - rxA[0], rxA[1], rxA[2]], plane: planeHit(0, ROOM_HALF.x) });
  images.push({ kind: 'wall', img: [-2 * ROOM_HALF.x - rxA[0], rxA[1], rxA[2]], plane: planeHit(0, -ROOM_HALF.x) });
  images.push({ kind: 'wall', img: [rxA[0], rxA[1], 2 * ROOM_HALF.z - rxA[2]], plane: planeHit(2, ROOM_HALF.z) });
  images.push({ kind: 'wall', img: [rxA[0], rxA[1], -2 * ROOM_HALF.z - rxA[2]], plane: planeHit(2, -ROOM_HALF.z) });
  for (const im of images) {
    const P = im.plane(txA, im.img);
    if (!P) continue;
    const L = dist(txA, im.img);
    let amp = (lambda / (4 * Math.PI * L)) * reflCoef(im.kind, pol) * dbToAmp(blk(txA, P) + blk(P, rxA));
    let extra = 0;
    if (im.kind === 'ceiling' && inp.rain) {
      // corrugated roof vibrating under rain: small fast phase jitter
      const t = inp.t;
      extra = 0.0009 * (Math.sin(2 * Math.PI * 13.7 * t) + 0.7 * Math.sin(2 * Math.PI * 21.3 * t + 1.1) + 0.5 * Math.sin(2 * Math.PI * 7.9 * t + 2.3));
      amp *= 1 + 0.03 * Math.sin(2 * Math.PI * 17.1 * t);
    }
    paths.push({ kind: im.kind, amp: -amp, length: L + extra, pts: [txA, P, rxA], doppler: 0 });
  }

  // ---- steel rack scatterers (shelf edges / uprights)
  for (const r of RACKS) {
    const P: V3 = [(r.min[0] + r.max[0]) / 2, 1.0, r.max[2] > 0 ? r.min[2] : r.max[2]];
    const d1 = dist(txA, P);
    const d2 = dist(P, rxA);
    const amp = bistaticAmp(lambda, 0.5, d1, d2) * dbToAmp(0.5 * (blk(txA, P) + blk(P, rxA)));
    paths.push({ kind: 'rack', amp, length: d1 + d2, pts: [txA, P, rxA], doppler: 0 });
  }

  // ---- rodents (bistatic scattering with ribcage breathing modulation)
  for (const r of inp.rodents) {
    const P = r.center;
    const v1 = sub(P, txA);
    const v2 = sub(P, rxA);
    const d1 = Math.max(0.01, len(v1));
    const d2 = Math.max(0.01, len(v2));
    const u1: V3 = [v1[0] / d1, v1[1] / d1, v1[2] / d1];
    const u2: V3 = [v2[0] / d2, v2[1] / d2, v2[2] / d2];
    const coupling = polCouplingFor(pol, u1, r.axis);
    const rcs = rodentRcs(r.r, r.L, f0, band, coupling);
    // bisector factor: chest displacement changes the bistatic path by ~ 2 d cos(beta/2)
    const cosBeta = -dot(u1, u2);
    const cosHalf = Math.sqrt(Math.max(0, (1 + cosBeta) / 2));
    const breathPath = 2 * (r.expansion + r.heartDisp) * cosHalf;
    const amp = bistaticAmp(lambda, rcs.sigma, d1, d2) * dbToAmp(blk(txA, P) + blk(P, rxA));
    const dLdt = dot(r.vel, u1) + dot(r.vel, u2);
    paths.push({ kind: 'rodent', amp, length: d1 + d2 + breathPath, pts: [txA, P, rxA], doppler: -dLdt / lambda });
  }

  // ---- human worker
  if (inp.human) {
    const P: V3 = [inp.human.pos[0], 1.1, inp.human.pos[2]];
    const d1 = dist(txA, P);
    const d2 = dist(P, rxA);
    const u1 = sub(P, txA).map((x) => x / d1) as V3;
    const u2 = sub(P, rxA).map((x) => x / d2) as V3;
    const amp = bistaticAmp(lambda, 0.8, d1, d2) * dbToAmp(0.5 * (blk(txA, P) + blk(P, rxA)));
    const dLdt = dot(inp.human.vel, u1) + dot(inp.human.vel, u2);
    paths.push({ kind: 'human', amp, length: d1 + d2 + 2 * inp.human.breathDisp, pts: [txA, P, rxA], doppler: -dLdt / lambda });
  }

  // ---- ventilation fan (rotating blades: periodic RCS + micro-Doppler)
  if (inp.fan) {
    const P = FAN_POS;
    const d1 = dist(txA, P);
    const d2 = dist(P, rxA);
    const bp = 2 * Math.PI * FAN_RPS * FAN_BLADES * inp.t;
    const sigma = 0.05 * (1 + 0.8 * Math.sin(bp));
    const amp = bistaticAmp(lambda, sigma, d1, d2);
    paths.push({ kind: 'fan', amp, length: d1 + d2 + 0.004 * Math.sin(bp), pts: [txA, P, rxA], doppler: 0 });
  }

  // ---- near-field antenna coupling (rodent within a few cm of the RX dipole)
  let nd = Infinity;
  const seg = antennaSegment(rx, pol);
  for (const r of inp.rodents) {
    const head: V3 = [r.center[0] + r.axis[0] * r.L * 0.45, r.center[1] + r.axis[1] * r.L * 0.45, r.center[2] + r.axis[2] * r.L * 0.45];
    nd = Math.min(nd, pointSegmentDist(head, seg[0], seg[1]) - r.r * 0.6 - r.expansion);
  }
  const nf = Math.exp(-Math.max(0, nd) / 0.025);
  const near: NearField = {
    dist: nd,
    gain: 1 - 0.6 * nf,
    phase: 0.9 * nf,
    saturated: nd < 0.03,
  };

  return { paths, near, losShadow: 1 - shadowKeep, blockDb: losBlk };
}

/** Dipole rod end points for a node (board at `p`). */
export function antennaSegment(p: V3, pol: Polarization): [V3, V3] {
  const y = p[1] + ANT_OFFSET;
  if (pol === 'vertical') return [[p[0], y - 0.05, p[2]], [p[0], y + 0.05, p[2]]];
  if (pol === 'horizontal') return [[p[0] - 0.05, y, p[2]], [p[0] + 0.05, y, p[2]]];
  const s = 0.05 * Math.SQRT1_2;
  return [[p[0] - s, y - s, p[2]], [p[0] + s, y + s, p[2]]];
}

export function pointSegmentDist(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}

/** Subcarrier frequency offsets (Hz) for a 20 MHz (64) or 80 MHz (234) capture. */
export function subcarrierOffsets(bw: 20 | 80): Float64Array {
  if (bw === 20) {
    const o = new Float64Array(64);
    for (let k = 0; k < 64; k++) o[k] = (k - 32) * 312.5e3;
    return o;
  }
  const o = new Float64Array(234);
  for (let k = 0; k < 234; k++) {
    const idx = k < 117 ? k - 122 : k - 111; // skip DC region
    o[k] = idx * 312.5e3;
  }
  return o;
}

/** H_k = sum_p a_p exp(-j 2 pi f_k L_p / c) */
export function synthesize(res: ChannelResult, f0: number, offs: Float64Array, re: Float64Array, im: Float64Array): void {
  re.fill(0);
  im.fill(0);
  for (const p of res.paths) {
    const tau = p.length / C0;
    for (let k = 0; k < offs.length; k++) {
      const ph = -2 * Math.PI * (f0 + offs[k]) * tau;
      re[k] += p.amp * Math.cos(ph);
      im[k] += p.amp * Math.sin(ph);
    }
  }
  const g = res.near.gain;
  const c = Math.cos(res.near.phase);
  const s = Math.sin(res.near.phase);
  for (let k = 0; k < offs.length; k++) {
    const a = re[k] * g;
    const b = im[k] * g;
    re[k] = a * c - b * s;
    im[k] = a * s + b * c;
  }
  if (res.near.saturated) {
    // LNA compression: soft-limit the strongest subcarriers
    let mx = 0;
    for (let k = 0; k < offs.length; k++) mx = Math.max(mx, Math.hypot(re[k], im[k]));
    const lim = mx * 0.7;
    for (let k = 0; k < offs.length; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > 0) {
        const f = (lim * Math.tanh(m / lim)) / m;
        re[k] *= f;
        im[k] *= f;
      }
    }
  }
}

// ------------------------------------------------------------------ impairments
export interface ImpairCfg {
  cfo: boolean;
  sfo: boolean;
  awgn: boolean;
  snr: number;
  drop: boolean;
  agc: boolean;
}

export interface ImpairState {
  agcGain: number;
  agcReported: number;
  sfoDrift: number;
  rng: () => number;
}

export function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Apply ESP32-style impairments in place. Returns the AGC gain the firmware would REPORT
 * (rx_ctrl gain fields, quantised), or 0 if the packet is dropped.
 */
export function impair(
  re: Float64Array,
  im: Float64Array,
  cfg: ImpairCfg,
  st: ImpairState,
  extraDrop: number,
): number {
  const n = re.length;
  if (cfg.drop && st.rng() < 0.02 + extraDrop) return 0;
  let pw = 0;
  for (let k = 0; k < n; k++) pw += re[k] * re[k] + im[k] * im[k];
  const rms = Math.sqrt(pw / n);
  if (cfg.awgn) {
    const sd = (rms / Math.pow(10, cfg.snr / 20)) * Math.SQRT1_2;
    for (let k = 0; k < n; k++) {
      re[k] += sd * gaussian(st.rng);
      im[k] += sd * gaussian(st.rng);
    }
  }
  let g = 1;
  let reported = 1;
  if (cfg.agc) {
    if (st.rng() < 0.012) {
      const stepDb = (Math.floor(st.rng() * 5) - 2) * 1.5;
      st.agcGain = Math.pow(10, stepDb / 20);
      // reported gain is quantised to 0.5 dB -> small residual after compensation
      st.agcReported = Math.pow(10, (Math.round((stepDb + (st.rng() - 0.5) * 0.4) * 2) / 2) / 20);
    }
    g = st.agcGain;
    reported = st.agcReported;
  }
  const cfoPh = cfg.cfo ? st.rng() * 2 * Math.PI : 0;
  st.sfoDrift += cfg.sfo ? (st.rng() - 0.5) * 0.002 : 0;
  st.sfoDrift *= 0.995;
  const slope = cfg.sfo ? (st.rng() - 0.5) * 0.2 + st.sfoDrift : 0;
  for (let k = 0; k < n; k++) {
    const ph = cfoPh + slope * (k - n / 2);
    const c = Math.cos(ph) * g;
    const s = Math.sin(ph) * g;
    const a = re[k];
    const b = im[k];
    re[k] = a * c - b * s;
    im[k] = a * s + b * c;
  }
  return reported;
}

/**
 * RuView-style sanitisation. Amplitude: divide by the firmware-reported AGC gain and a SLOW
 * reference level (refAmp) so common-mode body shadowing is preserved (per-packet mean
 * normalisation would erase it). Phase: unwrap across subcarriers and remove the
 * least-squares linear fit (removes CFO + STO/SFO). Returns the packet mean amplitude.
 */
export function sanitize(
  re: Float64Array,
  im: Float64Array,
  ampOut: Float64Array,
  phOut: Float64Array,
  rawPhOut?: Float64Array,
  agcReported = 1,
  refAmp = 0,
): number {
  const n = re.length;
  let mean = 0;
  for (let k = 0; k < n; k++) {
    ampOut[k] = Math.hypot(re[k], im[k]) / agcReported;
    mean += ampOut[k];
  }
  mean /= n;
  const norm = refAmp > 0 ? refAmp : mean || 1;
  for (let k = 0; k < n; k++) ampOut[k] /= norm;
  let prev = Math.atan2(im[0], re[0]);
  let off = 0;
  phOut[0] = prev;
  if (rawPhOut) rawPhOut[0] = prev;
  for (let k = 1; k < n; k++) {
    const p = Math.atan2(im[k], re[k]);
    if (rawPhOut) rawPhOut[k] = p;
    let d = p - prev;
    if (d > Math.PI) off -= 2 * Math.PI;
    else if (d < -Math.PI) off += 2 * Math.PI;
    prev = p;
    phOut[k] = p + off;
    void d;
  }
  // linear fit
  let sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0;
  for (let k = 0; k < n; k++) {
    sx += k;
    sy += phOut[k];
    sxx += k * k;
    sxy += k * phOut[k];
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  for (let k = 0; k < n; k++) phOut[k] -= a + b * k;
  return mean;
}
