// Rasterises the horizontal FDTD slice: permittivity, conductivity, PEC flag, material code.
// Static obstacles are cached per window pose; rodents are re-rasterised EVERY frame from the
// same deformed anatomy used for rendering (anatomy.ts), so breathing/organ motion couples
// directly into the solver.
import * as THREE from 'three';
import {
  BRICK,
  MAT_CODE,
  ROOM_HALF,
  TISSUE,
  WOOD,
  grainDielectric,
  type BandId,
} from './constants';
import { anatomy, classify, type TissueHit } from './anatomy';
import { bodyFrame, breathOf, heartOf, worldToLocal, type RodentAgent } from './behavior';
import { RACKS, POST_SIZE, type SackStack } from './layout';

export interface SliceWindow {
  cx: number;
  cz: number;
  psi: number; // direction of +s axis (propagation) in XZ: (cos psi, sin psi)
  ys: number;
  L: number; // metres
  N: number;
}

export function windowToWorld(w: SliceWindow, i: number, j: number): [number, number] {
  const s = ((i + 0.5) / w.N - 0.5) * w.L;
  const t = ((j + 0.5) / w.N - 0.5) * w.L;
  const c = Math.cos(w.psi);
  const sn = Math.sin(w.psi);
  return [w.cx + s * c - t * sn, w.cz + s * sn + t * c];
}

export function worldToWindow(w: SliceWindow, x: number, z: number): [number, number] {
  const dx = x - w.cx;
  const dz = z - w.cz;
  const c = Math.cos(w.psi);
  const sn = Math.sin(w.psi);
  const s = dx * c + dz * sn;
  const t = -dx * sn + dz * c;
  return [(s / w.L + 0.5) * w.N - 0.5, (t / w.L + 0.5) * w.N - 0.5];
}

export class MaterialRaster {
  N: number;
  data: Float32Array;
  base: Float32Array;
  texture: THREE.DataTexture;
  baseTexture: THREE.DataTexture;
  private key = '';

  constructor(N: number) {
    this.N = N;
    this.data = new Float32Array(N * N * 4);
    this.base = new Float32Array(N * N * 4);
    this.texture = new THREE.DataTexture(this.data, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.baseTexture = new THREE.DataTexture(this.base, N, N, THREE.RGBAFormat, THREE.FloatType);
    this.baseTexture.minFilter = THREE.NearestFilter;
    this.baseTexture.magFilter = THREE.NearestFilter;
    this.baseTexture.needsUpdate = true;
  }

  private set(arr: Float32Array, idx: number, er: number, sigma: number, pec: number, code: number): void {
    arr[idx] = er;
    arr[idx + 1] = sigma;
    arr[idx + 2] = pec;
    arr[idx + 3] = code;
  }

  buildStatic(w: SliceWindow, band: BandId, f: number, moisture: number, sacks: SackStack[]): void {
    const key = [w.cx.toFixed(4), w.cz.toFixed(4), w.psi.toFixed(4), w.ys.toFixed(4), w.L, band, moisture, sacks.map((s) => s.layers).join('')].join('|');
    if (key === this.key) return;
    this.key = key;
    const N = this.N;
    const g = grainDielectric(moisture, f);
    // cull obstacles to those overlapping the (rotated) window's bounding square
    const R = w.L * 0.7072;
    const bx0 = w.cx - R;
    const bx1 = w.cx + R;
    const bz0 = w.cz - R;
    const bz1 = w.cz + R;
    const hits = (mn: number[], mx: number[]) => mx[0] > bx0 && mn[0] < bx1 && mx[2] > bz0 && mn[2] < bz1;
    const racks = RACKS.filter((r) => hits(r.min, r.max));
    const sackList = sacks.filter((s) => hits(s.pallet.min, s.pallet.max));
    const nearWall = bx0 < -ROOM_HALF.x || bx1 > ROOM_HALF.x || bz0 < -ROOM_HALF.z || bz1 > ROOM_HALF.z;
    if (!racks.length && !sackList.length && !nearWall) {
      for (let k = 0; k < N * N; k++) this.set(this.base, k * 4, 1, 0, 0, MAT_CODE.air);
      this.baseTexture.needsUpdate = true;
      return;
    }
    const c = Math.cos(w.psi);
    const sn = Math.sin(w.psi);
    const ds = w.L / N;
    for (let j = 0; j < N; j++) {
      const t = ((j + 0.5) / N - 0.5) * w.L;
      const s0 = (0.5 / N - 0.5) * w.L;
      let x = w.cx + s0 * c - t * sn;
      let z = w.cz + s0 * sn + t * c;
      for (let i = 0; i < N; i++, x += ds * c, z += ds * sn) {
        const idx = (j * N + i) * 4;
        let done = false;
        // brick walls (0.24 m thick), partially reflective
        if (Math.abs(x) > ROOM_HALF.x || Math.abs(z) > ROOM_HALF.z) {
          const out = Math.max(Math.abs(x) - ROOM_HALF.x, Math.abs(z) - ROOM_HALF.z);
          if (out < 0.24) this.set(this.base, idx, BRICK.er, BRICK.sigma, 0, MAT_CODE.brick);
          else this.set(this.base, idx, 1, 0, 0, MAT_CODE.air);
          continue;
        }
        // steel rack uprights and shelf plates (PEC)
        for (const r of racks) {
          for (const p of r.posts) {
            if (Math.abs(x - p[0]) < POST_SIZE / 2 && Math.abs(z - p[1]) < POST_SIZE / 2 && w.ys < r.max[1]) {
              this.set(this.base, idx, 1, 0, 1, MAT_CODE.pec);
              done = true;
            }
          }
          if (!done && x > r.min[0] && x < r.max[0] && z > r.min[2] && z < r.max[2]) {
            for (const h of r.shelves) {
              if (Math.abs(w.ys - h) < 0.008) {
                this.set(this.base, idx, 1, 0, 1, MAT_CODE.pec);
                done = true;
              }
            }
          }
          if (done) break;
        }
        if (done) continue;
        // grain sacks and wooden pallets
        for (const s of sackList) {
          if (s.layers > 0 && x > s.min[0] && x < s.max[0] && z > s.min[2] && z < s.max[2] && w.ys > s.min[1] && w.ys < s.max[1]) {
            this.set(this.base, idx, g.er, g.sigma, 0, MAT_CODE.grain);
            done = true;
            break;
          }
          const p = s.pallet;
          if (x > p.min[0] && x < p.max[0] && z > p.min[2] && z < p.max[2] && w.ys < p.max[1]) {
            // slatted pallet: ~50 % wood fill
            const slat = Math.floor((x - p.min[0]) / 0.1) % 2 === 0;
            if (slat) this.set(this.base, idx, WOOD.er, WOOD.sigma, 0, MAT_CODE.wood);
            else this.set(this.base, idx, 1, 0, 0, MAT_CODE.air);
            done = true;
            break;
          }
        }
        if (done) continue;
        this.set(this.base, idx, 1, 0, 0, MAT_CODE.air);
      }
    }
    this.baseTexture.needsUpdate = true;
  }

  /** Copy static base, then rasterise every rodent from its current deformed anatomy. */
  composite(w: SliceWindow, band: BandId, rodents: RodentAgent[]): void {
    this.data.set(this.base);
    const N = this.N;
    for (const a of rodents) {
      const fr = bodyFrame(a);
      const an = anatomy(a.species, breathOf(a), heartOf(a));
      const reach = an.L * 0.62 + an.r * 1.5;
      if (Math.abs(fr.center[1] - w.ys) > reach) continue;
      const [ci, cj] = worldToWindow(w, fr.center[0], fr.center[2]);
      const rp = (reach / w.L) * N;
      const i0 = Math.max(0, Math.floor(ci - rp));
      const i1 = Math.min(N - 1, Math.ceil(ci + rp));
      const j0 = Math.max(0, Math.floor(cj - rp));
      const j1 = Math.min(N - 1, Math.ceil(cj + rp));
      if (i0 > i1 || j0 > j1) continue;
      const lungMix = an.lungFill;
      // body-local coords are affine in (i, j): p = p00 + i*dI + j*dJ
      const [x00, z00] = windowToWorld(w, 0, 0);
      const p00 = worldToLocal(fr, [x00, w.ys, z00]);
      const [x10, z10] = windowToWorld(w, 1, 0);
      const p10 = worldToLocal(fr, [x10, w.ys, z10]);
      const [x01, z01] = windowToWorld(w, 0, 1);
      const p01 = worldToLocal(fr, [x01, w.ys, z01]);
      const dI = [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]];
      const dJ = [p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]];
      const bx = an.body.r[0] * 1.02 + 0.2 * an.L;
      const by = Math.max(an.body.r[1], an.head.r[1]) * 1.02;
      const bz = Math.max(an.body.r[2], an.head.r[2]) * 1.02;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const px = p00[0] + i * dI[0] + j * dJ[0];
          const py = p00[1] + i * dI[1] + j * dJ[1];
          const pz = p00[2] + i * dI[2] + j * dJ[2];
          // cheap bounding-box reject before full tissue classification
          if (px < -bx || px > an.head.c[0] + an.head.r[0] || Math.abs(py) > by || Math.abs(pz) > bz) continue;
          const hit: TissueHit = classify(an, px, py, pz);
          if (hit === 'air') continue;
          const idx = (j * N + i) * 4;
          let er: number;
          let sg: number;
          let code: number;
          switch (hit) {
            case 'lung': {
              const inf = TISSUE.lungInflated[band];
              const def = TISSUE.lungDeflated[band];
              er = def.er + (inf.er - def.er) * lungMix;
              sg = def.sigma + (inf.sigma - def.sigma) * lungMix;
              code = MAT_CODE.lung;
              break;
            }
            case 'heart':
              er = TISSUE.heart[band].er;
              sg = TISSUE.heart[band].sigma;
              code = MAT_CODE.heart;
              break;
            case 'bone':
              er = TISSUE.bone[band].er;
              sg = TISSUE.bone[band].sigma;
              code = MAT_CODE.bone;
              break;
            case 'viscera':
              er = TISSUE.viscera[band].er;
              sg = TISSUE.viscera[band].sigma;
              code = MAT_CODE.viscera;
              break;
            case 'skin':
              er = TISSUE.skin[band].er;
              sg = TISSUE.skin[band].sigma;
              code = MAT_CODE.skin;
              break;
            default:
              er = TISSUE.muscle[band].er;
              sg = TISSUE.muscle[band].sigma;
              code = MAT_CODE.muscle;
          }
          this.set(this.data, idx, er, sg, 0, code);
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.baseTexture.dispose();
  }
}
