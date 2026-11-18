import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { engine } from '../physics/sim';
import { getSettings, useSettings } from '../state/store';
import { Warehouse, SUN_DIR } from './Warehouse';
import { Rodents } from './Rodent';
import { Nodes } from './Esp32Node';
import { HumanWorker, VentFan } from './Actors';
import { FieldSlice, sliceState } from './FieldSlice';
import { CoverageHeatmap, FresnelZones, MultipathRays } from './RfOverlays';
import { SPECIES } from '../physics/constants';

type Controls = { target: THREE.Vector3; update: () => void; enabled: boolean };

/** Debug switches for bisecting GPU issues: ?nofdtd&nopost&nowarehouse&norodent */
const DBG = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function SimDriver() {
  useFrame((_, dt) => engine.update(dt, getSettings()));
  return null;
}

function CameraRig() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const preset = useSettings((s) => s.camera);
  const nonce = useSettings((s) => s.cameraNonce);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; t: number } | null>(null);
  const lastThorax = useRef(new THREE.Vector3());

  const pending = useRef(3);
  // defer aiming a few frames so a scenario respawn has placed the rodent first
  useEffect(() => {
    pending.current = 3;
  }, [preset, nonce]);

  const aim = () => {
    const s = getSettings();
    const th = sliceState.thorax.clone();
    const L = SPECIES[s.species].length;
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    switch (preset) {
      case 'macro':
        target = th.clone();
        pos = th.clone().add(new THREE.Vector3(1.4 * L, 1.1 * L, 1.9 * L));
        break;
      case 'los': {
        const a = new THREE.Vector3(...s.tx);
        const b = new THREE.Vector3(...s.rx[0]);
        target = a.clone().add(b).multiplyScalar(0.5).setY(0.15);
        const d = b.clone().sub(a);
        const perp = new THREE.Vector3(-d.z, 0, d.x).normalize();
        pos = target.clone().addScaledVector(perp, Math.max(1.5, d.length() * 0.45)).setY(0.55);
        break;
      }
      case 'top': {
        const w = sliceState.win;
        target = new THREE.Vector3(w ? w.cx : th.x, w ? w.ys : 0, w ? w.cz : th.z);
        pos = target.clone().add(new THREE.Vector3(0.001, (w ? w.L : 0.5) * 1.6, 0.001));
        break;
      }
      default:
        target = new THREE.Vector3(0, 0.4, 0);
        pos = new THREE.Vector3(5.6, 4.6, 6.6);
    }
    goal.current = { pos, target, t: 0 };
    lastThorax.current.copy(th);
  };

  useFrame((_, dt) => {
    if (!controls) return;
    if (pending.current > 0 && --pending.current === 0) aim();
    const g = goal.current;
    if (g) {
      g.t = Math.min(1, g.t + dt * 1.6);
      const k = 1 - Math.pow(1 - g.t, 3);
      camera.position.lerp(g.pos, k);
      controls.target.lerp(g.target, k);
      if (g.t >= 1) goal.current = null;
    }
    // follow-cam: translate camera + target with the thorax (macro) or slice centre (top)
    const s = getSettings();
    if (!g && (s.camera === 'macro' || s.camera === 'top')) {
      const now = sliceState.thorax;
      const d = now.clone().sub(lastThorax.current);
      if (d.lengthSq() < 0.25) {
        camera.position.add(d);
        controls.target.add(d);
      } else {
        pending.current = 1; // large jump (respawn / recentre): re-aim
      }
    }
    lastThorax.current.copy(sliceState.thorax);
    controls.update();
  });
  return null;
}

function Lights() {
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
  }, []);
  const sunPos = SUN_DIR.clone().multiplyScalar(-9);
  return (
    <>
      <hemisphereLight args={['#b9c7d6', '#3b3127', 0.35]} />
      <ambientLight intensity={0.08} />
      <directionalLight
        ref={sun}
        position={sunPos}
        intensity={2.4}
        color="#ffe7c4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-camera-near={1}
        shadow-camera-far={25}
      />
    </>
  );
}

export function Scene() {
  return (
    <>
      <color attach="background" args={['#0b0d10']} />
      <fog attach="fog" args={['#14161a', 9, 22]} />
      <SimDriver />
      <Lights />
      {!DBG.has('nowarehouse') && <Warehouse />}
      <Nodes />
      {!DBG.has('norodent') && <Rodents />}
      <HumanWorker />
      <VentFan />
      {!DBG.has('nofdtd') && <FieldSlice />}
      <FresnelZones />
      <MultipathRays />
      <CoverageHeatmap />
      <CameraRig />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={0.04} maxDistance={18} maxPolarAngle={Math.PI * 0.495} />
      {!DBG.has('nopost') && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.85} luminanceThreshold={0.92} luminanceSmoothing={0.15} />
          <Vignette eskil={false} offset={0.25} darkness={0.55} />
        </EffectComposer>
      )}
    </>
  );
}
