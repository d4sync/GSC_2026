// Shared parametric rodent anatomy. Both the 3D mesh and the FDTD permittivity mask are
// generated from THIS function each frame, so the solver always sees the exact deformed
// geometry that is rendered (body-local frame: x = forward/cranial, y = dorsal/up, z = right).
import { SPECIES, type Species } from './constants';

export interface Ellipsoid {
  c: [number, number, number];
  r: [number, number, number];
}

export interface Rib {
  x: number; // axial position
  R: number; // ring radius (centre of bone tube)
  tube: number; // bone tube radius
  arcMin: number; // angular extent (rad), measured from dorsal (+y) around the ring
  arcMax: number;
}

export interface AnatomyState {
  L: number;
  r: number;
  body: Ellipsoid; // trunk (skin envelope)
  thoraxInner: Ellipsoid; // inner thoracic cavity (inside the ribs)
  head: Ellipsoid;
  lungs: [Ellipsoid, Ellipsoid];
  heart: Ellipsoid;
  viscera: Ellipsoid;
  ribs: Rib[];
  spine: { x0: number; x1: number; y: number; rad: number };
  sternum: { x0: number; x1: number; y: number; rad: number };
  thoraxCenter: [number, number, number];
  breath: number; // 0..1 inspiration
  expansion: number; // current radial excursion (m)
  lungFill: number; // 0..1 alveolar air fraction (drives lung permittivity)
}

export function anatomy(species: Species, breath: number, heartPulse: number): AnatomyState {
  const sp = SPECIES[species];
  const L = sp.length;
  const r = sp.radius;
  const exp = sp.ribExpansion * breath;
  const thoraxX0 = -0.03 * L;
  const thoraxX1 = 0.27 * L;
  const thoraxC: [number, number, number] = [(thoraxX0 + thoraxX1) / 2, 0, 0];

  const ribs: Rib[] = [];
  for (let i = 0; i < 13; i++) {
    const t = i / 12; // 0 cranial .. 1 caudal
    const x = thoraxX1 - t * (thoraxX1 - thoraxX0);
    const taper = 0.7 + 0.3 * Math.sin(Math.PI * (0.25 + 0.75 * t));
    const R = r * 0.82 * taper + exp * (0.6 + 0.4 * t);
    // false/floating ribs (last 3 pairs) do not reach the sternum
    const ventralGap = i >= 10 ? 0.75 : 0.18;
    ribs.push({ x, R, tube: r * 0.055 + 0.0003, arcMin: 0.22, arcMax: Math.PI - ventralGap });
  }

  const lungScale = 1 + 0.22 * breath;
  const lungY = r * 0.08;
  const lung = (side: 1 | -1): Ellipsoid => ({
    c: [thoraxC[0] + 0.01 * L, lungY, side * r * 0.36],
    r: [0.13 * L * (1 + 0.08 * breath), r * 0.5 * lungScale, r * 0.3 * lungScale],
  });
  const hp = 1 + 0.1 * heartPulse;

  return {
    L,
    r,
    body: { c: [0, 0, 0], r: [0.5 * L * 0.72, r + exp * 0.9, r * 1.05 + exp] },
    thoraxInner: { c: thoraxC, r: [0.16 * L, r * 0.76 + exp * 0.7, r * 0.8 + exp * 0.7] },
    head: { c: [0.43 * L, 0.05 * r, 0], r: [0.16 * L, r * 0.62, r * 0.6] },
    lungs: [lung(1), lung(-1)],
    heart: { c: [thoraxC[0] + 0.03 * L, -0.22 * r, 0.06 * r], r: [0.055 * L * hp, r * 0.3 * hp, r * 0.27 * hp] },
    viscera: { c: [-0.19 * L, -0.05 * r, 0], r: [0.15 * L, r * 0.72 + exp * 0.3, r * 0.82 + exp * 0.3] },
    ribs,
    spine: { x0: -0.34 * L, x1: 0.33 * L, y: r * 0.84 + exp * 0.5, rad: r * 0.09 },
    sternum: { x0: thoraxX0 + 0.04 * L, x1: thoraxX1 - 0.01 * L, y: -(r * 0.84 + exp), rad: r * 0.06 },
    thoraxCenter: thoraxC,
    breath,
    expansion: exp,
    lungFill: 0.55 + 0.45 * breath,
  };
}

export function inEllipsoid(e: Ellipsoid, x: number, y: number, z: number): boolean {
  const dx = (x - e.c[0]) / e.r[0];
  const dy = (y - e.c[1]) / e.r[1];
  const dz = (z - e.c[2]) / e.r[2];
  return dx * dx + dy * dy + dz * dz <= 1;
}

/** Is a body-local point inside rib bone tissue? */
export function inRib(rib: Rib, x: number, y: number, z: number): boolean {
  const dx = x - rib.x;
  if (Math.abs(dx) > rib.tube) return false;
  const rho = Math.hypot(y, z);
  const d = Math.hypot(dx, rho - rib.R);
  if (d > rib.tube) return false;
  // angle from dorsal (+y) around to ventral (-y), symmetric left/right
  const ang = Math.acos(Math.max(-1, Math.min(1, y / Math.max(rho, 1e-9))));
  return ang >= rib.arcMin && ang <= rib.arcMax;
}

export type TissueHit = 'air' | 'skin' | 'muscle' | 'lung' | 'heart' | 'bone' | 'viscera';

/** Classify a body-local point into a tissue (priority: bone > heart > lung > viscera > muscle > skin). */
export function classify(a: AnatomyState, x: number, y: number, z: number): TissueHit {
  const inBody = inEllipsoid(a.body, x, y, z) || inEllipsoid(a.head, x, y, z);
  if (!inBody) return 'air';
  for (const rib of a.ribs) if (inRib(rib, x, y, z)) return 'bone';
  const sp = a.spine;
  if (x > sp.x0 && x < sp.x1 && Math.hypot(y - sp.y, z) < sp.rad) return 'bone';
  const st = a.sternum;
  if (x > st.x0 && x < st.x1 && Math.hypot(y - st.y, z) < st.rad) return 'bone';
  if (inEllipsoid(a.heart, x, y, z)) return 'heart';
  if (inEllipsoid(a.lungs[0], x, y, z) || inEllipsoid(a.lungs[1], x, y, z)) return 'lung';
  if (inEllipsoid(a.viscera, x, y, z)) return 'viscera';
  // thin skin shell: outer ~1.2 mm of the envelope
  const b = a.body;
  const shrink = (k: number): boolean => {
    const dx = (x - b.c[0]) / (b.r[0] - k);
    const dy = (y - b.c[1]) / (b.r[1] - k);
    const dz = (z - b.c[2]) / (b.r[2] - k);
    return dx * dx + dy * dy + dz * dz <= 1;
  };
  if (!shrink(0.0012) && inEllipsoid(b, x, y, z)) return 'skin';
  return 'muscle';
}
