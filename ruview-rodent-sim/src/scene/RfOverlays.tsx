import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BANDS, C0, ROOM, lambdaOf } from '../physics/constants';
import { ANT_OFFSET } from '../physics/csi';
import { computeCoverage } from '../physics/coverage';
import { engine } from '../physics/sim';
import { buildSacks } from '../physics/layout';
import { getSettings, useSettings } from '../state/store';
import { RIM_FRAG, RIM_VERT } from '../shaders/slice';
import type { V3 } from '../physics/behavior';

// ------------------------------------------------------------ Fresnel ellipsoids
function rimMat(color: string, base: number) {
  return new THREE.ShaderMaterial({
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    uniforms: { uColor: { value: new THREE.Color(color) }, uPower: { value: 2.5 }, uBase: { value: base }, uIntensity: { value: 0.55 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

function FresnelLink({ tx, rx, lambda }: { tx: V3; rx: V3; lambda: number }) {
  const sphere = useMemo(() => new THREE.SphereGeometry(1, 48, 24), []);
  const mats = useMemo(() => [rimMat('#00e1ff', 0.03), rimMat('#a46bff', 0.015)], []);
  const wire = useMemo(() => new THREE.MeshBasicMaterial({ color: '#00e1ff', wireframe: true, transparent: true, opacity: 0.05, depthWrite: false }), []);
  const a = new THREE.Vector3(tx[0], tx[1] + ANT_OFFSET, tx[2]);
  const b = new THREE.Vector3(rx[0], rx[1] + ANT_OFFSET, rx[2]);
  const D = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return (
    <group position={mid} quaternion={q}>
      {[1, 2].map((n, i) => {
        const semiA = (D + (n * lambda) / 2) / 2;
        const semiB = Math.sqrt(Math.max(0, semiA * semiA - (D / 2) ** 2));
        return (
          <group key={n}>
            <mesh geometry={sphere} material={mats[i]} scale={[semiB, semiA, semiB]} renderOrder={8} />
            {n === 1 && <mesh geometry={sphere} material={wire} scale={[semiB, semiA, semiB]} renderOrder={8} />}
          </group>
        );
      })}
    </group>
  );
}

export function FresnelZones() {
  const show = useSettings((s) => s.showFresnel);
  const tx = useSettings((s) => s.tx);
  const rx = useSettings((s) => s.rx);
  const en = useSettings((s) => s.rxEnabled);
  const band = useSettings((s) => s.band);
  if (!show) return null;
  const lambda = lambdaOf(BANDS[band].fc);
  return (
    <group>
      {rx.map((r, i) => (en[i] ? <FresnelLink key={i} tx={tx} rx={r} lambda={lambda} /> : null))}
    </group>
  );
}

// ------------------------------------------------------------ multipath rays
const MAX_SEG = 3 * 20 * 2;
export function MultipathRays() {
  const show = useSettings((s) => s.showRays);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_SEG * 2 * 3), 3));
    return g;
  }, []);
  const col = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    if (!show) return;
    const s = getSettings();
    const f0 = BANDS[s.band].fc;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const clr = geo.attributes.color as THREE.BufferAttribute;
    let n = 0;
    for (const tel of engine.rx) {
      if (!tel.enabled || !tel.chan) continue;
      const los = Math.abs(tel.chan.paths[0]?.amp ?? 1e-9) || 1e-9;
      for (const p of tel.chan.paths) {
        const phase = ((2 * Math.PI * f0 * p.length) / C0) % (2 * Math.PI);
        const rel = Math.abs(p.amp) / los;
        const bright = Math.max(0.08, Math.min(1, 1 + Math.log10(rel + 1e-9) / 3));
        if (p.kind === 'los') col.setRGB(1, 1, 1);
        else if (p.kind === 'rodent') col.setHSL(((phase / (2 * Math.PI)) * 0.25 + 0.85) % 1, 1, 0.6);
        else if (p.kind === 'human') col.setRGB(1, 0.7, 0.1);
        else if (p.kind === 'fan') col.setRGB(0.6, 0.9, 0.3);
        else col.setHSL(phase / (2 * Math.PI), 0.85, 0.55);
        const k = p.kind === 'rodent' ? 1 : bright * (p.kind === 'los' ? 0.9 : 0.6);
        for (let q = 0; q + 1 < p.pts.length; q++) {
          if (n >= MAX_SEG) break;
          const A = p.pts[q];
          const B = p.pts[q + 1];
          pos.setXYZ(n * 2, A[0], A[1], A[2]);
          pos.setXYZ(n * 2 + 1, B[0], B[1], B[2]);
          clr.setXYZ(n * 2, col.r * k, col.g * k, col.b * k);
          clr.setXYZ(n * 2 + 1, col.r * k, col.g * k, col.b * k);
          n++;
        }
      }
    }
    geo.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
    clr.needsUpdate = true;
  });
  if (!show) return null;
  return (
    <lineSegments geometry={geo} frustumCulled={false} renderOrder={9}>
      <lineBasicMaterial vertexColors transparent opacity={0.85} depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

// ------------------------------------------------------------ floor coverage / blind spots
function marginColor(m: number): [number, number, number, number] {
  // m in dB: <-20 blind (deep blue), 0 threshold (yellow), >20 strong (red)
  const t = Math.max(-1, Math.min(1, m / 25));
  if (t < 0) {
    const k = -t;
    return [Math.round(30 * (1 - k)), Math.round(60 * (1 - k) + 10), Math.round(120 + 80 * k), Math.round(110 + 80 * k)];
  }
  const r = 255;
  const g = Math.round(230 - 200 * t);
  const b = Math.round(40 * (1 - t));
  return [r, g, b, Math.round(120 + 90 * t)];
}

export function CoverageHeatmap() {
  const show = useSettings((s) => s.showHeatmap);
  const band = useSettings((s) => s.band);
  const tx = useSettings((s) => s.tx);
  const rx = useSettings((s) => s.rx);
  const en = useSettings((s) => s.rxEnabled);
  const pol = useSettings((s) => s.pol);
  const moisture = useSettings((s) => s.moisture);
  const fill = useSettings((s) => s.fill);
  const species = useSettings((s) => s.species);
  const impair = useSettings((s) => s.impair);
  const duty = useSettings((s) => s.duty);
  const tex = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(96 * 72 * 4), 96, 72, THREE.RGBAFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    return t;
  }, []);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!show) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const map = computeCoverage({
        band,
        tx,
        rxs: rx.filter((_, i) => en[i]),
        pol,
        moisture,
        sacks: buildSacks(fill),
        species,
        snrDb: impair.awgn ? impair.snr : 60,
        packets: duty === 'flood' ? 512 : 64,
      });
      const data = tex.image.data as Uint8Array;
      for (let j = 0; j < map.gh; j++)
        for (let i = 0; i < map.gw; i++) data.set(marginColor(map.margin[j * map.gw + i]), ((map.gh - 1 - j) * map.gw + i) * 4);
      tex.needsUpdate = true;
      engine.coverage = map.coveredFrac;
    }, 120);
  }, [show, band, tx, rx, en, pol, moisture, fill, species, impair, duty, tex]);
  if (!show) return null;
  return (
    <mesh rotation-x={-Math.PI / 2} position-y={0.004} renderOrder={2}>
      <planeGeometry args={[ROOM.x, ROOM.z]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
