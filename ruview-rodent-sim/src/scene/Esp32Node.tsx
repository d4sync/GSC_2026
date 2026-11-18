// ESP32-S3 DevKit + external SMA dipole + emissive RGB status LED. Draggable on its height plane.
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Label } from './Label';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ROOM_HALF } from '../physics/constants';
import { engine } from '../physics/sim';
import { getSettings, setSettings, useSettings, type NodeId } from '../state/store';
import type { V3 } from '../physics/behavior';
import { ANT_OFFSET } from '../physics/csi';

const pcbMat = new THREE.MeshStandardMaterial({ color: '#0d2b1f', roughness: 0.55, metalness: 0.1 });
const shieldMat = new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.25, metalness: 1 });
const blackMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
const goldMat = new THREE.MeshStandardMaterial({ color: '#d4a640', roughness: 0.3, metalness: 1 });
const usbMat = new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.3, metalness: 1 });
const rubberMat = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.75 });
const standMat = new THREE.MeshStandardMaterial({ color: '#3a3d40', roughness: 0.5, metalness: 0.6 });

const pinGeo = new THREE.BoxGeometry(0.0006, 0.004, 0.0006);

/** 2 x 22 header pins as a single instanced draw call. */
function PinHeaders() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const mat = new THREE.Matrix4();
    let n = 0;
    for (const sd of [-1, 1])
      for (let k = 0; k < 22; k++) m.setMatrixAt(n++, mat.makeTranslation(-0.029 + k * 0.00254, 0.006, sd * 0.0115));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, []);
  return <instancedMesh ref={ref} args={[pinGeo, goldMat, 44]} />;
}

export function Esp32Node({ id, pos, label, enabled }: { id: NodeId; pos: V3; label: string; enabled: boolean }) {
  const pol = useSettings((s) => s.pol);
  const selected = useSettings((s) => s.selected === id);
  const controls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;
  const led = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.PointLight>(null);
  const dragging = useRef(false);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  const antRot: [number, number, number] = pol === 'vertical' ? [0, 0, 0] : pol === 'horizontal' ? [Math.PI / 2, 0, 0] : [Math.PI / 4, 0, 0];

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    let state = engine.globalState;
    if (id !== 'tx') {
      const i = Number(id.slice(2));
      state = engine.rx[i]?.analyzer.status.state ?? 'calibrating';
    }
    const c = new THREE.Color();
    let k = 1;
    if (!enabled) {
      c.set('#202020');
      k = 0.3;
    } else if (state === 'calibrating') {
      c.set('#00e5ff');
      k = 0.6 + 0.4 * Math.sin(t * 4);
    } else if (state === 'rodent') {
      c.set('#ff1a1a');
      k = Math.sin(t * 22) > 0 ? 1 : 0.15;
    } else if (state === 'human') {
      c.set('#ffb000');
      k = 0.8;
    } else {
      c.set('#20ff60');
      k = 0.85;
    }
    if (led.current) led.current.color.copy(c).multiplyScalar(3.5 * k);
    if (halo.current) {
      halo.current.color.copy(c);
      halo.current.intensity = 0.06 * k;
    }
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    dragging.current = true;
    plane.constant = -pos[1];
    if (controls) controls.enabled = false;
    setSettings({ selected: id });
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    if (!e.ray.intersectPlane(plane, hit)) return;
    const x = Math.max(-ROOM_HALF.x + 0.08, Math.min(ROOM_HALF.x - 0.08, hit.x));
    const z = Math.max(-ROOM_HALF.z + 0.08, Math.min(ROOM_HALF.z - 0.08, hit.z));
    const s = getSettings();
    if (id === 'tx') setSettings({ tx: [x, s.tx[1], z] });
    else {
      const i = Number(id.slice(2));
      const rx = [...s.rx] as Settings['rx'];
      rx[i] = [x, s.rx[i][1], z];
      setSettings({ rx });
    }
  };
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    dragging.current = false;
    (e.target as unknown as Element).releasePointerCapture?.(e.pointerId);
    if (controls) controls.enabled = true;
  };

  return (
    <group position={pos}>
      {/* stand */}
      {pos[1] > 0.03 && (
        <group>
          <mesh position={[0, -pos[1] / 2, 0]} material={standMat} castShadow>
            <cylinderGeometry args={[0.006, 0.006, pos[1], 10]} />
          </mesh>
          <mesh position={[0, -pos[1] + 0.004, 0]} material={standMat} receiveShadow>
            <cylinderGeometry args={[0.05, 0.055, 0.008, 24]} />
          </mesh>
        </group>
      )}
      <group visible={enabled || id === 'tx'}>
        {/* PCB 69 x 25.5 mm */}
        <mesh material={pcbMat} castShadow receiveShadow>
          <boxGeometry args={[0.069, 0.0016, 0.0255]} />
        </mesh>
        {/* ESP32-S3-WROOM-1U shield */}
        <mesh position={[0.014, 0.0025, 0]} material={shieldMat} castShadow>
          <boxGeometry args={[0.0255, 0.0032, 0.018]} />
        </mesh>
        <mesh position={[0.031, 0.0012, 0]} material={blackMat}>
          <boxGeometry args={[0.006, 0.0008, 0.018]} />
        </mesh>
        {/* pin headers */}
        {[-1, 1].map((sd) => (
          <group key={sd}>
            <mesh position={[-0.002, 0.0035, sd * 0.0115]} material={blackMat}>
              <boxGeometry args={[0.056, 0.0025, 0.0025]} />
            </mesh>
          </group>
        ))}
        <PinHeaders />
        {/* USB-C x2 */}
        {[-0.006, 0.006].map((z) => (
          <mesh key={z} position={[-0.033, 0.0022, z]} material={usbMat}>
            <boxGeometry args={[0.007, 0.0032, 0.009]} />
          </mesh>
        ))}
        {/* RGB LED (WS2812) */}
        <mesh position={[-0.02, 0.0016, 0.006]}>
          <boxGeometry args={[0.005, 0.0016, 0.005]} />
          <meshStandardMaterial color="#eee" />
        </mesh>
        <mesh position={[-0.02, 0.0028, 0.006]}>
          <sphereGeometry args={[0.0022, 12, 8]} />
          <meshBasicMaterial ref={led} toneMapped={false} />
        </mesh>
        <pointLight ref={halo} position={[-0.02, 0.01, 0.006]} distance={0.25} decay={2} />
        {/* SMA connector + dipole */}
        <group position={[0.033, 0.002, 0]}>
          <mesh rotation-z={Math.PI / 2} material={goldMat}>
            <cylinderGeometry args={[0.003, 0.003, 0.009, 14]} />
          </mesh>
          <group position={[0.006, ANT_OFFSET - 0.06, 0]} rotation={antRot}>
            <mesh position={[0, 0.012, 0]} material={blackMat}>
              <cylinderGeometry args={[0.0045, 0.0045, 0.014, 14]} />
            </mesh>
            <mesh position={[0, 0.07, 0]} material={rubberMat} castShadow>
              <capsuleGeometry args={[0.005, 0.1, 6, 14]} />
            </mesh>
          </group>
        </group>
      </group>
      {/* invisible pick volume */}
      <mesh position={[0, 0.06, 0]} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <boxGeometry args={[0.2, 0.22, 0.2]} />
        <meshBasicMaterial transparent opacity={selected ? 0.08 : 0} depthWrite={false} color="#00e5ff" />
      </mesh>
      <Label text={label} position={[0, 0.22, 0]} border={selected ? '#ffffff' : '#38e1ff'} dim={!enabled} />
    </group>
  );
}

type Settings = ReturnType<typeof getSettings>;

export function Nodes() {
  const tx = useSettings((s) => s.tx);
  const rx = useSettings((s) => s.rx);
  const en = useSettings((s) => s.rxEnabled);
  return (
    <group>
      <Esp32Node id="tx" pos={tx} label="TX" enabled />
      {rx.map((p, i) => (
        <Esp32Node key={i} id={`rx${i}` as NodeId} pos={p} label={`RX${i + 1}`} enabled={en[i]} />
      ))}
    </group>
  );
}
