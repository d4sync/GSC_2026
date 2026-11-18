// Physical constants, band definitions and dielectric tables.
// Tissue values are approximate, Gabriel-database-style numbers (IT'IS / Gabriel 1996
// parametric model) rounded for simulation. They are SYNTHETIC inputs, not measurements.

export const C0 = 299_792_458;
export const EPS0 = 8.8541878128e-12;
export const MU0 = 4e-7 * Math.PI;

export type BandId = '2.4' | '5.8' | '6.5';

export interface BandInfo {
  id: BandId;
  fc: number; // Hz
  label: string;
}

export const BANDS: Record<BandId, BandInfo> = {
  '2.4': { id: '2.4', fc: 2.437e9, label: '2.4 GHz (ch 6)' },
  '5.8': { id: '5.8', fc: 5.785e9, label: '5.8 GHz (ch 157)' },
  '6.5': { id: '6.5', fc: 6.525e9, label: '6.5 GHz (WiFi 6E)' },
};

export const BAND_IDS: BandId[] = ['2.4', '5.8', '6.5'];

export const lambdaOf = (f: number) => C0 / f;

export type TissueId =
  | 'air'
  | 'skin'
  | 'muscle'
  | 'lungInflated'
  | 'lungDeflated'
  | 'heart'
  | 'bone'
  | 'viscera';

export interface Dielectric {
  er: number; // relative permittivity (real part)
  sigma: number; // conductivity S/m
}

/** Tissue dielectric properties per band (approximate). */
export const TISSUE: Record<Exclude<TissueId, 'air'>, Record<BandId, Dielectric>> = {
  skin: { '2.4': { er: 38.0, sigma: 1.46 }, '5.8': { er: 35.1, sigma: 3.72 }, '6.5': { er: 34.6, sigma: 4.25 } },
  muscle: { '2.4': { er: 52.7, sigma: 1.74 }, '5.8': { er: 48.5, sigma: 5.2 }, '6.5': { er: 47.9, sigma: 6.0 } },
  heart: { '2.4': { er: 52.7, sigma: 1.74 }, '5.8': { er: 48.5, sigma: 5.2 }, '6.5': { er: 47.9, sigma: 6.0 } },
  lungInflated: { '2.4': { er: 20.5, sigma: 0.8 }, '5.8': { er: 19.1, sigma: 2.4 }, '6.5': { er: 18.7, sigma: 2.8 } },
  lungDeflated: { '2.4': { er: 48.4, sigma: 1.68 }, '5.8': { er: 44.6, sigma: 4.9 }, '6.5': { er: 44.0, sigma: 5.6 } },
  bone: { '2.4': { er: 11.4, sigma: 0.39 }, '5.8': { er: 9.7, sigma: 1.15 }, '6.5': { er: 9.4, sigma: 1.3 } },
  viscera: { '2.4': { er: 54.5, sigma: 2.1 }, '5.8': { er: 49.6, sigma: 5.6 }, '6.5': { er: 48.9, sigma: 6.4 } },
};

/** Tissue mass densities kg/m^3 */
export const DENSITY: Record<Exclude<TissueId, 'air'>, number> = {
  skin: 1109,
  muscle: 1090,
  heart: 1081,
  lungInflated: 394,
  lungDeflated: 1050,
  bone: 1908,
  viscera: 1088,
};

/** Integer codes written into the FDTD material texture (alpha channel). */
export const MAT_CODE = {
  air: 0,
  skin: 1,
  muscle: 2,
  lung: 3,
  heart: 4,
  bone: 5,
  viscera: 6,
  grain: 7,
  pec: 8,
  brick: 9,
  wood: 10,
} as const;

/** Grain (rice/paddy in burlap) dielectric vs. moisture content (% wet basis). */
export function grainDielectric(moisturePct: number, f: number): Dielectric {
  const m = Math.min(25, Math.max(10, moisturePct));
  const t = (m - 10) / 15; // 0..1
  const er = 2.8 + 1.7 * t; // 2.8 dry .. 4.5 damp
  // loss tangent rises steeply with free water; mild frequency increase
  const tanD = (0.05 + 0.18 * t * t + 0.02 * t) * (1 + 0.08 * (f / 1e9 - 2.4));
  const sigma = 2 * Math.PI * f * EPS0 * er * tanD;
  return { er, sigma };
}

/** Plane-wave attenuation in a lossy medium, dB per metre. */
export function attenuationDbPerM(d: Dielectric, f: number): number {
  const w = 2 * Math.PI * f;
  const lossTan = d.sigma / (w * EPS0 * d.er);
  const alpha = w * Math.sqrt((MU0 * EPS0 * d.er) / 2) * Math.sqrt(Math.sqrt(1 + lossTan * lossTan) - 1);
  return 8.686 * alpha;
}

/** Power penetration depth (1/e of power) in metres. */
export function powerPenetrationDepth(d: Dielectric, f: number): number {
  const w = 2 * Math.PI * f;
  const lossTan = d.sigma / (w * EPS0 * d.er);
  const alpha = w * Math.sqrt((MU0 * EPS0 * d.er) / 2) * Math.sqrt(Math.sqrt(1 + lossTan * lossTan) - 1);
  return 1 / (2 * alpha);
}

export const BRICK: Dielectric = { er: 4.2, sigma: 0.04 };
export const WOOD: Dielectric = { er: 2.0, sigma: 0.02 };

export type Species = 'mouse' | 'rat';

export interface SpeciesInfo {
  length: number; // nose-to-rump body length (m)
  radius: number; // trunk radius (m)
  ribExpansion: number; // peak ribcage radial excursion (m)
  breathHz: [number, number];
  heartHz: [number, number];
  massKg: number;
}

export const SPECIES: Record<Species, SpeciesInfo> = {
  mouse: { length: 0.08, radius: 0.0125, ribExpansion: 0.0015, breathHz: [2.4, 3.5], heartHz: [6.5, 8.0], massKg: 0.025 },
  rat: { length: 0.2, radius: 0.031, ribExpansion: 0.003, breathHz: [1.5, 2.6], heartHz: [5.0, 6.5], massKg: 0.35 },
};

export const ROOM = { x: 8, z: 6, h: 3.5 } as const;
export const ROOM_HALF = { x: ROOM.x / 2, z: ROOM.z / 2 } as const;
