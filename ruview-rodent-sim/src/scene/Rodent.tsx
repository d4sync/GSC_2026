// Articulated rodent: fur body, head, ears, whiskers, segmented tail, gait limbs, and an
// internal thorax (13 rib pairs, sternum, spine, breathing lungs, beating heart, viscera).
// Geometry is driven every frame by the shared parametric anatomy (physics/anatomy.ts).
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { anatomy } from '../physics/anatomy';
import { bodyFrame, breathOf, heartOf } from '../physics/behavior';
import { SPECIES, type Species } from '../physics/constants';
import { engine } from '../physics/sim';
import { getSettings, useSettings } from '../state/store';
import { RIM_FRAG, RIM_VERT } from '../shaders/slice';
import { sliceState } from './FieldSlice';

const TAIL_SEG = 16;
const unitSphere = new THREE.SphereGeometry(1, 32, 22);
const lowSphere = new THREE.SphereGeometry(1, 16, 12);

function ribGeometry(arcStart: number, arcLen: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(1, 0.06, 5, 22, arcLen);
  g.rotateZ(arcStart);
  g.rotateY(Math.PI / 2);
  return g;
}

export function thermalColor(t: number, out = new THREE.Color()): THREE.Color {
  t = Math.max(0, Math.min(1, t));
  const stops = [
    [0, 0.05, 0.0, 0.25],
    [0.3, 0.5, 0.0, 0.6],
    [0.6, 0.95, 0.15, 0.1],
    [0.85, 1.0, 0.8, 0.1],
    [1, 1, 1, 0.9],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      const k = (t - a[0]) / (b[0] - a[0]);
      return out.setRGB(a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
    }
  }
  return out.setRGB(1, 1, 0.9);
}

function RodentMesh({ index, species }: { index: number; species: Species }) {
  const sp = SPECIES[species];
  const L = sp.length;
  const r = sp.radius;
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const internals = useRef<THREE.Group>(null);
  const ribRefs = useRef<THREE.Mesh[]>([]);
  const lungRefs = useRef<THREE.Mesh[]>([]);
  const heart = useRef<THREE.Mesh>(null);
  const viscera = useRef<THREE.Mesh>(null);
  const spine = useRef<THREE.Mesh>(null);
  const sternum = useRef<THREE.Mesh>(null);
  const tailRefs = useRef<THREE.Mesh[]>([]);
  const legRefs = useRef<THREE.Mesh[]>([]);
  const headGroup = useRef<THREE.Group>(null);

  const ribGeos = useMemo(() => {
    const a0 = anatomy(species, 0, 0);
    // true ribs vs floating ribs, right (+z) and left (-z) halves
    const mk = (rib: (typeof a0.ribs)[number], side: 1 | -1) => {
      const len = rib.arcMax - rib.arcMin;
      const start = side === 1 ? Math.PI / 2 + rib.arcMin : Math.PI / 2 - rib.arcMax;
      return ribGeometry(start, len);
    };
    return a0.ribs.map((rib) => [mk(rib, 1), mk(rib, -1)] as const);
  }, [species]);

  const mats = useMemo(() => {
    const fur = new THREE.MeshStandardMaterial({ color: species === 'rat' ? '#5e4f43' : '#857b70', roughness: 0.93, metalness: 0 });
    const rim = new THREE.ShaderMaterial({
      vertexShader: RIM_VERT,
      fragmentShader: RIM_FRAG,
      uniforms: { uColor: { value: new THREE.Color('#7fd8ff') }, uPower: { value: 2.2 }, uBase: { value: 0.05 }, uIntensity: { value: 0.9 } },
      transparent: true,
      depthWrite: false,
      clipping: true,
    });
    const pink = new THREE.MeshStandardMaterial({ color: '#d99a9a', roughness: 0.7 });
    const eye = new THREE.MeshStandardMaterial({ color: '#080808', roughness: 0.1, metalness: 0.3 });
    const bone = new THREE.MeshStandardMaterial({ color: '#f2efe4', emissive: '#4a4a40', roughness: 0.5 });
    const lung = new THREE.MeshStandardMaterial({ color: '#ff9fb4', emissive: '#5a1f2c', transparent: true, opacity: 0.78, roughness: 0.6 });
    const heartM = new THREE.MeshStandardMaterial({ color: '#d4101c', emissive: '#550006', roughness: 0.4 });
    const visc = new THREE.MeshStandardMaterial({ color: '#c9792d', emissive: '#3a1c05', transparent: true, opacity: 0.6, roughness: 0.7 });
    return { fur, rim, pink, eye, bone, lung, heartM, visc };
  }, [species]);

  const whiskers = useMemo(() => {
    const pts: number[] = [];
    for (const side of [1, -1]) {
      for (let k = 0; k < 6; k++) {
        const y = (k % 3) * 0.12 * r - 0.12 * r;
        pts.push(0, y, side * 0.1 * r, -0.05 * L, y + (k - 2.5) * 0.06 * r, side * (0.55 * L));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [L, r]);

  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), []);
  const basis = useMemo(() => new THREE.Matrix4(), []);
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const a = engine.rodents[index];
    const g = root.current;
    if (!g) return;
    if (!a) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const s = getSettings();
    const fr = bodyFrame(a);
    basis.makeBasis(new THREE.Vector3(...fr.f), new THREE.Vector3(...fr.u), new THREE.Vector3(...fr.w));
    basis.setPosition(fr.center[0], fr.center[1], fr.center[2]);
    g.matrix.copy(basis);
    g.matrixWorldNeedsUpdate = true;

    const an = anatomy(a.species, breathOf(a), heartOf(a));
    const xray = s.visualMode !== 'normal';
    body.current!.scale.set(...an.body.r);
    body.current!.material = xray ? mats.rim : mats.fur;
    head.current!.material = xray ? mats.rim : mats.fur;
    mats.rim.clippingPlanes = s.visualMode === 'sar' && sliceState.win ? [clipPlane] : [];
    clipPlane.constant = sliceState.win ? sliceState.win.ys + 0.0005 : 0;
    mats.rim.uniforms.uColor.value.set(s.visualMode === 'sar' ? '#ffb070' : '#7fd8ff');
    internals.current!.visible = xray;

    an.ribs.forEach((rib, i) => {
      for (const side of [0, 1]) {
        const m = ribRefs.current[i * 2 + side];
        if (!m) continue;
        m.position.set(rib.x, 0, 0);
        m.scale.setScalar(rib.R);
      }
    });
    an.lungs.forEach((e, i) => {
      const m = lungRefs.current[i];
      m.position.set(...e.c);
      m.scale.set(...e.r);
    });
    heart.current!.position.set(...an.heart.c);
    heart.current!.scale.set(...an.heart.r);
    viscera.current!.position.set(...an.viscera.c);
    viscera.current!.scale.set(...an.viscera.r);
    spine.current!.position.set((an.spine.x0 + an.spine.x1) / 2, an.spine.y, 0);
    spine.current!.scale.set(an.spine.rad, an.spine.x1 - an.spine.x0, an.spine.rad);
    sternum.current!.position.set((an.sternum.x0 + an.sternum.x1) / 2, an.sternum.y, 0);
    sternum.current!.scale.set(an.sternum.rad, an.sternum.x1 - an.sternum.x0, an.sternum.rad);

    // SAR colouring of organs (analytic estimate, relative to peak)
    if (s.visualMode === 'sar' && engine.sar) {
      const pk = engine.sar.peakSar || 1;
      const lg = (v: number) => 1 + Math.log10(Math.max(1e-6, v / pk)) / 3;
      mats.heartM.color.copy(thermalColor(lg(engine.sar.thoraxSar), tmpColor));
      mats.lung.color.copy(thermalColor(lg(engine.sar.lungSar), tmpColor));
      mats.visc.color.copy(thermalColor(lg(engine.sar.thoraxSar * 0.8), tmpColor));
      mats.bone.color.copy(thermalColor(lg(engine.sar.thoraxSar * 0.25), tmpColor));
      mats.heartM.emissive.copy(mats.heartM.color).multiplyScalar(0.4);
      mats.lung.emissive.copy(mats.lung.color).multiplyScalar(0.4);
    } else {
      mats.heartM.color.set('#d4101c');
      mats.heartM.emissive.set('#550006');
      mats.lung.color.set('#ff9fb4');
      mats.lung.emissive.set('#5a1f2c');
      mats.visc.color.set('#c9792d');
      mats.bone.color.set('#f2efe4');
    }

    // head bob / sniff
    const sniff = a.mode === 'sniff' ? Math.sin(a.breathPhase * 3.1) * 0.06 : 0;
    headGroup.current!.rotation.set(0, sniff, Math.sin(a.breathPhase * 0.5) * 0.04);

    // tail sway
    const tailLen = L * (species === 'rat' ? 0.95 : 1.0);
    const segL = tailLen / TAIL_SEG;
    let px = -0.36 * L;
    let pz = 0;
    let py = -0.2 * r;
    let ang = Math.PI;
    for (let i = 0; i < TAIL_SEG; i++) {
      const m = tailRefs.current[i];
      ang += Math.sin(a.gait * 0.15 + a.breathPhase * 0.08 + i * 0.45) * 0.07 + (a.climbing ? 0 : 0.0);
      const nx = px + Math.cos(ang) * segL;
      const nz = pz + Math.sin(ang) * segL;
      const ny = py - (i < 3 ? 0.18 * r : 0) / 3;
      m.position.set((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2);
      m.rotation.set(0, -ang, Math.PI / 2);
      const tr = r * (0.16 - (0.11 * i) / TAIL_SEG);
      m.scale.set(tr, segL * 1.05, tr);
      px = nx;
      pz = nz;
      py = ny;
    }
    // gait
    legRefs.current.forEach((m, i) => {
      if (!m) return;
      const front = i < 2;
      const side = i % 2 ? 1 : -1;
      const ph = a.gait + (front ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
      m.position.set((front ? 0.2 : -0.22) * L + Math.sin(ph) * 0.05 * L * Math.min(1, a.speed), -0.78 * r, side * 0.62 * r);
      m.rotation.set(0, 0, Math.sin(ph) * 0.5 * Math.min(1, a.speed + 0.1));
    });
  });

  return (
    <group ref={root} matrixAutoUpdate={false}>
      <mesh ref={body} geometry={unitSphere} castShadow material={mats.fur} />
      <group ref={headGroup}>
        <mesh ref={head} geometry={unitSphere} position={[0.43 * L, 0.05 * r, 0]} scale={[0.16 * L, 0.62 * r, 0.6 * r]} castShadow material={mats.fur} />
        <mesh position={[0.585 * L, 0.0, 0]} scale={0.11 * r} geometry={lowSphere} material={mats.pink} />
        {[1, -1].map((sd) => (
          <group key={sd}>
            <mesh position={[0.49 * L, 0.32 * r, sd * 0.33 * r]} scale={0.09 * r} geometry={lowSphere} material={mats.eye} />
            <mesh position={[0.39 * L, 0.6 * r, sd * 0.42 * r]} rotation={[sd * 0.5, sd * 0.3, 0]} scale={[0.05 * r, (species === 'mouse' ? 0.42 : 0.3) * r, (species === 'mouse' ? 0.42 : 0.3) * r]} geometry={lowSphere} material={mats.pink} />
          </group>
        ))}
        <lineSegments geometry={whiskers} position={[0.58 * L, 0, 0]}>
          <lineBasicMaterial color="#e8e2d6" transparent opacity={0.7} />
        </lineSegments>
      </group>
      {Array.from({ length: TAIL_SEG }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) tailRefs.current[i] = m;
          }}
          material={mats.pink}
          castShadow
        >
          <cylinderGeometry args={[1, 1, 1, 8]} />
        </mesh>
      ))}
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) legRefs.current[i] = m;
          }}
          material={mats.pink}
          scale={[0.13 * r, 0.32 * r, 0.13 * r]}
          geometry={lowSphere}
        />
      ))}
      <group ref={internals} visible={false}>
        {ribGeos.map(([right, left], i) => (
          <group key={i}>
            <mesh
              geometry={right}
              material={mats.bone}
              ref={(m) => {
                if (m) ribRefs.current[i * 2] = m;
              }}
            />
            <mesh
              geometry={left}
              material={mats.bone}
              ref={(m) => {
                if (m) ribRefs.current[i * 2 + 1] = m;
              }}
            />
          </group>
        ))}
        <mesh ref={spine} material={mats.bone} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[1, 1, 1, 10]} />
        </mesh>
        <mesh ref={sternum} material={mats.bone} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[1, 1, 1, 8]} />
        </mesh>
        {[0, 1].map((i) => (
          <mesh
            key={i}
            geometry={unitSphere}
            material={mats.lung}
            ref={(m) => {
              if (m) lungRefs.current[i] = m;
            }}
          />
        ))}
        <mesh ref={heart} geometry={unitSphere} material={mats.heartM} />
        <mesh ref={viscera} geometry={unitSphere} material={mats.visc} />
      </group>
    </group>
  );
}

export function Rodents() {
  const species = useSettings((s) => s.species);
  const count = useSettings((s) => s.rodentCount);
  const scenario = useSettings((s) => s.scenario);
  const nonce = useSettings((s) => s.respawnNonce);
  const n = scenario === 'free' || scenario === 'swarm' ? Math.max(1, Math.min(5, count)) : 1;
  return (
    <group key={`${species}-${nonce}`}>
      {Array.from({ length: n }, (_, i) => (
        <RodentMesh key={i} index={i} species={species} />
      ))}
    </group>
  );
}
