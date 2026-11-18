// Analytic exposure estimate (plane-wave, normal incidence, 1D layered approximation) and
// Pennes steady-state bioheat temperature rise. These are order-of-magnitude ESTIMATES.
import { DENSITY, EPS0, TISSUE, lambdaOf, powerPenetrationDepth, type BandId } from './constants';

export interface SarEstimate {
  eIncRms: number; // V/m at the rodent
  skinSar: number; // W/kg
  thoraxSar: number; // W/kg (heart / lung depth)
  lungSar: number;
  peakSar: number;
  dTskin_mK: number;
  dTthorax_mK: number;
  penDepthMuscle: number; // m (power)
  penDepthSkin: number;
  wallDepth: number; // m
}

/** |2/(1+sqrt(ec))| for normal incidence air->tissue (field transmission). */
function transmission(er: number, sigma: number, f: number): number {
  const ei = sigma / (2 * Math.PI * f * EPS0);
  // sqrt of complex (er - j ei)
  const mag = Math.hypot(er, ei);
  const sr = Math.sqrt((mag + er) / 2);
  const si = -Math.sqrt(Math.max(0, (mag - er) / 2));
  const dr = 1 + sr;
  const di = si;
  return 2 / Math.hypot(dr, di);
}

/** Pennes steady state (conduction neglected): dT = SAR * rho / (w_b * rho_b * c_b) */
const PERFUSION = 0.008 * 1050 * 3800; // W/(m^3 K), small-mammal perfusion

export function estimateSar(
  band: BandId,
  f: number,
  txPowerDbm: number,
  dutyFrac: number,
  distM: number,
  wallDepthM: number,
): SarEstimate {
  const P = Math.pow(10, (txPowerDbm - 30) / 10);
  const G = 1.64;
  const lambda = lambdaOf(f);
  // far-field E; inside the reactive near-field (d < lambda/2pi) grow ~ d^-1.5 as a bounded heuristic
  const d = Math.max(0.005, distM);
  const dnf = lambda / (2 * Math.PI);
  let e = Math.sqrt(30 * P * G) / d;
  if (d < dnf) e *= Math.pow(dnf / d, 0.5);
  const eAvg2 = e * e * dutyFrac;
  const skin = TISSUE.skin[band];
  const muscle = TISSUE.muscle[band];
  const lung = TISSUE.lungInflated[band];
  const T = transmission(skin.er, skin.sigma, f);
  const eT2 = eAvg2 * T * T;
  const skinSar = (skin.sigma * eT2) / DENSITY.skin;
  const dpM = powerPenetrationDepth(muscle, f);
  const dpS = powerPenetrationDepth(skin, f);
  const att = Math.exp(-wallDepthM / dpM);
  const thoraxSar = (muscle.sigma * eT2 * att) / DENSITY.heart;
  const lungSar = (lung.sigma * eT2 * att * 1.4) / DENSITY.lungInflated;
  const peak = Math.max(skinSar, thoraxSar, lungSar);
  return {
    eIncRms: e,
    skinSar,
    thoraxSar,
    lungSar,
    peakSar: peak,
    dTskin_mK: ((skinSar * DENSITY.skin) / PERFUSION) * 1000,
    dTthorax_mK: ((Math.max(thoraxSar, lungSar) * DENSITY.heart) / PERFUSION) * 1000,
    penDepthMuscle: dpM,
    penDepthSkin: dpS,
    wallDepth: wallDepthM,
  };
}
