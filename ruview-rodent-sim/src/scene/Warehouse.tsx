import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ROOM, ROOM_HALF } from '../physics/constants';
import { RACKS, PALLET_H, SACK_LAYER_H, buildSacks, type FillLevel } from '../physics/layout';
import { brickTextures, burlapTextures, concreteTextures, woodTexture } from './textures';
import { DUST_FRAG, DUST_VERT, SHAFT_FRAG, SHAFT_VERT } from '../shaders/slice';
import { useSettings } from '../state/store';

const WINDOWS_Z = [-1.8, 0, 1.8];
const WINDOW_Y = 2.75;
export const SUN_DIR = new THREE.Vector3(1, -0.8, -0.18).normalize();

function Shell() {
  const concrete = concreteTextures();
  const brick = brickTextures();
  const ceilingGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(ROOM.x, ROOM.z, 200, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) * 2 * Math.PI) / 0.076) * 0.012);
    g.computeVertexNormals();
    return g;
  }, []);
  const wallMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ map: brick.map, bumpMap: brick.bump, bumpScale: 1.2, roughness: 0.92, color: '#d8cfc4' }),
    [brick],
  );
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[ROOM.x, ROOM.z]} />
        <meshStandardMaterial map={concrete.map} roughnessMap={concrete.rough} roughness={0.95} metalness={0.02} />
      </mesh>
      <mesh geometry={ceilingGeo} rotation-x={Math.PI / 2} position-y={ROOM.h} receiveShadow>
        <meshStandardMaterial color="#9aa3a8" metalness={0.85} roughness={0.42} side={THREE.FrontSide} />
      </mesh>
      {/* walls (inward facing) */}
      <mesh position={[0, ROOM.h / 2, -ROOM_HALF.z]} material={wallMat} receiveShadow>
        <planeGeometry args={[ROOM.x, ROOM.h]} />
      </mesh>
      <mesh position={[0, ROOM.h / 2, ROOM_HALF.z]} rotation-y={Math.PI} material={wallMat} receiveShadow>
        <planeGeometry args={[ROOM.x, ROOM.h]} />
      </mesh>
      <mesh position={[-ROOM_HALF.x, ROOM.h / 2, 0]} rotation-y={Math.PI / 2} material={wallMat} receiveShadow>
        <planeGeometry args={[ROOM.z, ROOM.h]} />
      </mesh>
      <mesh position={[ROOM_HALF.x, ROOM.h / 2, 0]} rotation-y={-Math.PI / 2} material={wallMat} receiveShadow>
        <planeGeometry args={[ROOM.z, ROOM.h]} />
      </mesh>
      {/* skirting / damp line */}
      {[0, 1, 2, 3].map((k) => {
        const horiz = k < 2;
        const pos: [number, number, number] = horiz
          ? [0, 0.06, (k === 0 ? -1 : 1) * (ROOM_HALF.z - 0.005)]
          : [(k === 2 ? -1 : 1) * (ROOM_HALF.x - 0.005), 0.06, 0];
        return (
          <mesh key={k} position={pos} rotation-y={horiz ? (k === 0 ? 0 : Math.PI) : k === 2 ? Math.PI / 2 : -Math.PI / 2}>
            <planeGeometry args={[horiz ? ROOM.x : ROOM.z, 0.12]} />
            <meshStandardMaterial color="#4d4a45" roughness={1} />
          </mesh>
        );
      })}
      {/* high windows on the west wall */}
      {WINDOWS_Z.map((z) => (
        <group key={z} position={[-ROOM_HALF.x + 0.01, WINDOW_Y, z]} rotation-y={Math.PI / 2}>
          <mesh>
            <planeGeometry args={[1.1, 0.7]} />
            <meshBasicMaterial color={[3.2, 2.9, 2.4]} toneMapped={false} />
          </mesh>
          {[-0.37, 0, 0.37].map((x) => (
            <mesh key={x} position={[x, 0, 0.01]}>
              <boxGeometry args={[0.03, 0.72, 0.02]} />
              <meshStandardMaterial color="#333" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function LightShafts() {
  const mats = useRef<THREE.ShaderMaterial[]>([]);
  const shafts = useMemo(() => {
    const out: { pos: THREE.Vector3; quat: THREE.Quaternion; roll: number }[] = [];
    for (const z of WINDOWS_Z) {
      const start = new THREE.Vector3(-ROOM_HALF.x + 0.02, WINDOW_Y, z);
      const len = 4.2;
      const mid = start.clone().addScaledVector(SUN_DIR, len / 2);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), SUN_DIR);
      out.push({ pos: mid, quat: q, roll: 0 }, { pos: mid, quat: q, roll: Math.PI / 2 });
    }
    return out;
  }, []);
  useFrame(({ clock }) => mats.current.forEach((m) => m && (m.uniforms.uTime.value = clock.elapsedTime)));
  return (
    <group>
      {shafts.map((s, i) => (
        <group key={i} position={s.pos} quaternion={s.quat}>
          <mesh rotation-y={s.roll} renderOrder={5}>
            <planeGeometry args={[1.25, 4.2, 1, 1]} />
            <shaderMaterial
              ref={(m) => {
                if (m) mats.current[i] = m;
              }}
              vertexShader={SHAFT_VERT}
              fragmentShader={SHAFT_FRAG}
              uniforms={{ uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffe6bf') }, uStrength: { value: 0.11 } }}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Dust() {
  const show = useSettings((s) => s.showDust);
  const mat = useRef<THREE.ShaderMaterial>(null);
  const geo = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = WINDOWS_Z[i % 3];
      const t = Math.random() * 4.0;
      const p = new THREE.Vector3(-ROOM_HALF.x + 0.05, WINDOW_Y, z).addScaledVector(SUN_DIR, t);
      p.x += (Math.random() - 0.5) * 0.6;
      p.y += (Math.random() - 0.5) * 0.6;
      p.z += (Math.random() - 0.5) * 0.8;
      pos.set([p.x, p.y, p.z], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.uniforms.uTime.value = clock.elapsedTime;
  });
  if (!show) return null;
  return (
    <points geometry={geo} renderOrder={6}>
      <shaderMaterial
        ref={mat}
        vertexShader={DUST_VERT}
        fragmentShader={DUST_FRAG}
        uniforms={{ uTime: { value: 0 }, uSize: { value: 26 } }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Racks() {
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c3c8cc', metalness: 0.95, roughness: 0.32 }), []);
  const beam = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d2601c', metalness: 0.5, roughness: 0.45 }), []);
  const plate = useMemo(() => new THREE.MeshStandardMaterial({ color: '#aab0b5', metalness: 0.9, roughness: 0.38 }), []);
  return (
    <group>
      {RACKS.map((r) => {
        const w = r.max[0] - r.min[0];
        const d = r.max[2] - r.min[2];
        const cx = (r.min[0] + r.max[0]) / 2;
        const cz = (r.min[2] + r.max[2]) / 2;
        return (
          <group key={r.id}>
            {r.posts.map(([x, z], i) => (
              <mesh key={i} position={[x, r.max[1] / 2, z]} material={steel} castShadow receiveShadow>
                <boxGeometry args={[0.05, r.max[1], 0.05]} />
              </mesh>
            ))}
            {r.shelves.map((h) => (
              <group key={h}>
                <mesh position={[cx, h, cz]} material={plate} castShadow receiveShadow>
                  <boxGeometry args={[w, 0.012, d]} />
                </mesh>
                {[r.min[2], r.max[2]].map((z) => (
                  <mesh key={z} position={[cx, h - 0.03, z]} material={beam} castShadow>
                    <boxGeometry args={[w, 0.07, 0.035]} />
                  </mesh>
                ))}
              </group>
            ))}
            {/* a few cartons on shelves */}
            {r.shelves.slice(1, 3).map((h, k) => (
              <mesh key={k} position={[cx + (k ? 0.5 : -0.6), h + 0.16, cz]} castShadow receiveShadow>
                <boxGeometry args={[0.55, 0.3, 0.42]} />
                <meshStandardMaterial color={k ? '#b08a58' : '#9c7b4d'} roughness={0.95} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function pillowGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(0.56, SACK_LAYER_H * 0.92, 0.94, 14, 6, 20);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 0.28;
    const y = p.getY(i) / (SACK_LAYER_H * 0.46);
    const z = p.getZ(i) / 0.47;
    const bulge = (1 - x * x * 0.85) * (1 - z * z * 0.85);
    p.setY(i, p.getY(i) * (0.55 + 0.45 * bulge));
    p.setX(i, p.getX(i) * (1 - 0.08 * y * y));
    p.setZ(i, p.getZ(i) * (1 - 0.05 * y * y));
  }
  g.computeVertexNormals();
  return g;
}

function Sacks({ fill, moisture }: { fill: FillLevel; moisture: number }) {
  const burlap = burlapTextures();
  const wood = woodTexture();
  const geo = useMemo(pillowGeometry, []);
  const stacks = useMemo(() => buildSacks(fill), [fill]);
  const damp = (moisture - 10) / 15;
  const sackColor = useMemo(() => new THREE.Color().setRGB(1 - 0.38 * damp, 1 - 0.4 * damp, 1 - 0.42 * damp), [damp]);
  const items = useMemo(() => {
    const out: THREE.Matrix4[] = [];
    let seed = 3;
    const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (const s of stacks) {
      const cx = (s.pallet.min[0] + s.pallet.max[0]) / 2;
      const cz = (s.pallet.min[2] + s.pallet.max[2]) / 2;
      for (let l = 0; l < s.layers; l++) {
        for (const dx of [-0.29, 0.29]) {
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(cx + dx + (r() - 0.5) * 0.03, PALLET_H + SACK_LAYER_H * (l + 0.5), cz + (r() - 0.5) * 0.04),
            new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.04, (r() - 0.5) * 0.12, (r() - 0.5) * 0.04)),
            new THREE.Vector3(1, 1, 1),
          );
          out.push(m);
        }
      }
    }
    return out;
  }, [stacks]);
  const inst = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = inst.current;
    if (!m) return;
    items.forEach((mat, i) => m.setMatrixAt(i, mat));
    m.count = items.length;
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return (
    <group>
      <instancedMesh ref={inst} args={[geo, undefined, 48]} castShadow receiveShadow>
        <meshStandardMaterial map={burlap.map} bumpMap={burlap.bump} bumpScale={2.5} roughness={1} color={sackColor} />
      </instancedMesh>
      {stacks.map((s) => {
        const cx = (s.pallet.min[0] + s.pallet.max[0]) / 2;
        const cz = (s.pallet.min[2] + s.pallet.max[2]) / 2;
        return (
          <group key={s.id} position={[cx, 0, cz]}>
            <mesh position={[0, PALLET_H - 0.012, 0]} castShadow receiveShadow>
              <boxGeometry args={[1.2, 0.024, 1.0]} />
              <meshStandardMaterial map={wood} roughness={0.9} />
            </mesh>
            {[-0.5, 0, 0.5].map((x) => (
              <mesh key={x} position={[x, (PALLET_H - 0.024) / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.1, PALLET_H - 0.024, 1.0]} />
                <meshStandardMaterial map={wood} roughness={0.9} color="#c9b08c" />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Lamps() {
  return (
    <group>
      {[-2.4, 0, 2.4].map((x) => (
        <group key={x} position={[x, ROOM.h - 0.45, 0]}>
          <mesh position={[0, 0.25, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.4]} />
            <meshStandardMaterial color="#222" />
          </mesh>
          <mesh>
            <coneGeometry args={[0.24, 0.16, 24, 1, true]} />
            <meshStandardMaterial color="#2f3a36" metalness={0.7} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.05, 0]}>
            <sphereGeometry args={[0.05, 16, 12]} />
            <meshBasicMaterial color={[4, 3.6, 3]} toneMapped={false} />
          </mesh>
          <pointLight position={[0, -0.15, 0]} intensity={2.2} distance={7} decay={1.6} color="#ffe2b8" />
        </group>
      ))}
    </group>
  );
}

export function Warehouse() {
  const fill = useSettings((s) => s.fill);
  const moisture = useSettings((s) => s.moisture);
  return (
    <group>
      <Shell />
      <Racks />
      <Sacks fill={fill} moisture={moisture} />
      <Lamps />
      <LightShafts />
      <Dust />
    </group>
  );
}
