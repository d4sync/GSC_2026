// Drives the GPU FDTD solvers each frame and renders the auto-tracking thoracic E-field slice.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { BANDS, TISSUE, lambdaOf } from '../physics/constants';
import { anatomy } from '../physics/anatomy';
import { bodyFrame, breathOf, heartOf } from '../physics/behavior';
import { COURANT, FdtdSolver } from '../physics/fdtd';
import { MaterialRaster, worldToWindow, type SliceWindow } from '../physics/raster';
import { engine } from '../physics/sim';
import { getSettings, useSettings } from '../state/store';
import { SLICE_FRAG, SLICE_VERT } from '../shaders/slice';

/** Shared, mutable slice pose (read by the rodent cutaway + camera rig). */
export const sliceState = {
  win: null as SliceWindow | null,
  thorax: new THREE.Vector3(),
};

interface SolverSet {
  tm: FdtdSolver | null;
  te: FdtdSolver | null;
  bgTm: FdtdSolver | null;
  bgTe: FdtdSolver | null;
}

const DBG = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

const dummy = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
dummy.minFilter = THREE.NearestFilter;
dummy.magFilter = THREE.NearestFilter;
dummy.needsUpdate = true;

export function FieldSlice() {
  const gl = useThree((s) => s.gl);
  const N = useSettings((s) => s.fdtdRes);
  const pol = useSettings((s) => s.pol);
  const show = useSettings((s) => s.showSlice);
  const raster = useMemo(() => new MaterialRaster(N), [N]);
  const solvers = useRef<SolverSet>({ tm: null, te: null, bgTm: null, bgTe: null });
  const frame = useRef(0);
  const stepAcc = useRef(0);
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const needTM = pol !== 'horizontal';
    const needTE = pol !== 'vertical';
    const s: SolverSet = {
      tm: needTM ? new FdtdSolver(gl, N, false, raster.texture) : null,
      te: needTE ? new FdtdSolver(gl, N, true, raster.texture) : null,
      bgTm: needTM ? new FdtdSolver(gl, N, false, raster.baseTexture) : null,
      bgTe: needTE ? new FdtdSolver(gl, N, true, raster.baseTexture) : null,
    };
    solvers.current = s;
    sliceState.win = null;
    return () => {
      Object.values(s).forEach((v) => v?.dispose());
    };
  }, [gl, N, pol, raster]);

  useEffect(() => () => raster.dispose(), [raster]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, []);

  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SLICE_VERT,
        fragmentShader: SLICE_FRAG,
        uniforms: {
          uTM: { value: dummy },
          uTE: { value: dummy },
          uBgTM: { value: dummy },
          uBgTE: { value: dummy },
          uMat: { value: dummy },
          uHasTM: { value: 0 },
          uHasTE: { value: 0 },
          uScattered: { value: 0 },
          uMode: { value: 0 },
          uGain: { value: 1 },
          uAref: { value: 1 },
          uN: { value: 256 },
          uOpacity: { value: 0.95 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const gainRef = useRef({ gain: 1, aref: 1 });
  const reading = useRef(false);

  useFrame(() => {
    const s = getSettings();
    const set = solvers.current;
    const all = [set.tm, set.te, set.bgTm, set.bgTe].filter(Boolean) as FdtdSolver[];
    if (!all.length) return;
    const f0 = BANDS[s.band].fc;
    const a0 = engine.rodents[0];
    const L = (a0?.species ?? s.species) === 'rat' ? 0.5 : 0.3;
    // thorax world position
    let tx = (s.tx[0] + s.rx[0][0]) / 2;
    let ty = 0.03;
    let tz = (s.tx[2] + s.rx[0][2]) / 2;
    if (a0) {
      const fr = bodyFrame(a0);
      const an = anatomy(a0.species, breathOf(a0), heartOf(a0));
      const c = an.thoraxCenter[0];
      tx = fr.center[0] + fr.f[0] * c;
      ty = fr.center[1] + fr.f[1] * c;
      tz = fr.center[2] + fr.f[2] * c;
    }
    sliceState.thorax.set(tx, ty, tz);
    const psi = Math.atan2(tz - s.tx[2], tx - s.tx[0]);
    const ys = s.sliceAuto ? ty : s.sliceHeight;
    let w = sliceState.win;
    const dpsi = w ? Math.abs(Math.atan2(Math.sin(psi - w.psi), Math.cos(psi - w.psi))) : 0;
    const recentre = !w || w.N !== N || w.L !== L || Math.hypot(tx - w.cx, tz - w.cz) > 0.16 * L || dpsi > 0.1 || (w as SliceWindow & { band?: string }).band !== s.band;
    if (recentre) {
      w = { cx: tx, cz: tz, psi, ys, L, N };
      (w as SliceWindow & { band?: string }).band = s.band;
      sliceState.win = w;
      all.forEach((sv) => sv.reset(gl));
    }
    w = w!;
    w.ys = ys;
    if (!DBG.has('noraster')) {
      raster.buildStatic(w, s.band, f0, s.moisture, engine.sacks);
      raster.composite(w, s.band, engine.rodents);
    }

    const dx = L / N;
    if (!s.paused) {
      stepAcc.current += (N === 384 ? 12 : 8) * (s.slowmo ? 0.12 : 1);
      const n = Math.floor(stepAcc.current);
      stepAcc.current -= n;
      if (n > 0 && !DBG.has('nostep')) all.forEach((sv) => sv.step(gl, n, dx, f0, 0.05));
    }

    // ---- readbacks (sparse; synchronous GPU reads)
    frame.current++;
    if (frame.current % 20 === 0 && !s.paused && !DBG.has('noread')) {
      const refI = N * 0.16;
      const refJ = N * 0.5;
      const [ti, tj] = worldToWindow(w, tx, tz);
      const [pi, pj] = worldToWindow(w, tx + Math.cos(w.psi) * 0.32 * L, tz + Math.sin(w.psi) * 0.32 * L);
      const pairs = ([
        [set.tm, set.bgTm],
        [set.te, set.bgTe],
      ] as [FdtdSolver | null, FdtdSolver | null][]).filter((p): p is [FdtdSolver, FdtdSolver] => !!p[0] && !!p[1]);
      const band = s.band;
      const solverSet = set;
      if (!reading.current) {
        reading.current = true;
        // async PBO readbacks: no pipeline stall on the render thread
        Promise.all(
          pairs.map(([tot, bg]) =>
            Promise.all([bg.readAsync(gl, refI, refJ), tot.readAsync(gl, ti, tj), tot.readAsync(gl, pi, pj), bg.readAsync(gl, pi, pj)]),
          ),
        )
          .then((vals) => {
            if (solvers.current !== solverSet) return;
            let aref = 0;
            let athor = 0;
            let aprobe = 0;
            let abgProbe = 0;
            for (const [r0, r1, r2, r3] of vals) {
              aref += r0;
              athor += r1;
              aprobe += r2;
              abgProbe += r3;
            }
            publish(aref, athor, aprobe, abgProbe, band);
          })
          .catch(() => undefined)
          .finally(() => {
            reading.current = false;
          });
      }
    }
    const publish = (aref: number, athor: number, aprobe: number, abgProbe: number, band: typeof s.band) => {
      if (aref > 0) {
        const nMode = (set.tm ? 1 : 0) + (set.te ? 1 : 0);
        gainRef.current.gain = 1 / Math.sqrt((2 * aref) / nMode);
        gainRef.current.aref = aref / nMode;
        const lam = lambdaOf(f0);
        engine.fdtd = {
          thoraxRatio: athor / aref,
          shadowDb: 10 * Math.log10((aprobe + 1e-12) / (abgProbe + 1e-12)),
          probeRatio: aprobe / aref,
          windowM: L,
          dx,
          cellsPerLambda: lam / Math.sqrt(TISSUE.muscle[band].er) / dx,
          courant: COURANT,
          mode: set.tm && set.te ? 'TMz + TEz (slant)' : set.tm ? 'TMz (E vertical)' : 'TEz (E horizontal)',
          floatOk: all[0].floatOk,
        };
      }
    };

    // ---- slice mesh pose + uniforms
    const c = Math.cos(w.psi);
    const sn = Math.sin(w.psi);
    const h = L / 2;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const corners: [number, number][] = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ];
    corners.forEach(([si, ti], k) => pos.setXYZ(k, w!.cx + si * c - ti * sn, ys + 0.0004, w!.cz + si * sn + ti * c));
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
    const u = mat.uniforms;
    u.uTM.value = set.tm?.texture ?? dummy;
    u.uTE.value = set.te?.texture ?? dummy;
    u.uBgTM.value = set.bgTm?.texture ?? dummy;
    u.uBgTE.value = set.bgTe?.texture ?? dummy;
    u.uMat.value = raster.texture;
    u.uHasTM.value = set.tm ? 1 : 0;
    u.uHasTE.value = set.te ? 1 : 0;
    u.uScattered.value = s.fieldView === 'scattered' ? 1 : 0;
    u.uMode.value = s.visualMode === 'xray' ? 1 : s.visualMode === 'sar' ? 2 : 0;
    u.uGain.value = gainRef.current.gain;
    u.uAref.value = gainRef.current.aref;
    u.uN.value = N;
    if (meshRef.current) meshRef.current.visible = s.showSlice && !DBG.has('nomesh');
  });

  return <mesh ref={meshRef} geometry={geo} material={mat} renderOrder={10} visible={show} frustumCulled={false} />;
}
