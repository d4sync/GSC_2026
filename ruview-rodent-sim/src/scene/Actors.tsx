// Interference sources: walking human worker and a wall ventilation fan.
import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { FAN_BLADES, FAN_POS } from '../physics/behavior';
import { engine } from '../physics/sim';
import { useSettings } from '../state/store';

export function HumanWorker() {
  const on = useSettings((s) => s.interf.human);
  const g = useRef<THREE.Group>(null);
  const legs = useRef<THREE.Mesh[]>([]);
  const arms = useRef<THREE.Mesh[]>([]);
  const chest = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const h = engine.human;
    if (!g.current) return;
    g.current.visible = !!h;
    if (!h) return;
    g.current.position.set(h.pos[0], 0, h.pos[2]);
    g.current.rotation.y = -h.heading + Math.PI / 2;
    const sw = Math.sin(h.gait);
    legs.current.forEach((m, i) => m && (m.rotation.x = (i ? 1 : -1) * sw * 0.45));
    arms.current.forEach((m, i) => m && (m.rotation.x = (i ? -1 : 1) * sw * 0.4));
    if (chest.current) chest.current.scale.set(1 + h.breathDisp * 4, 1, 1 + h.breathDisp * 8);
  });
  if (!on) return null;
  const work = '#2b4f7a';
  return (
    <group ref={g}>
      {[-1, 1].map((sd, i) => (
        <group key={sd} position={[sd * 0.1, 0.88, 0]}>
          <mesh
            ref={(m) => {
              if (m) legs.current[i] = m;
            }}
            position={[0, -0.44, 0]}
            castShadow
          >
            <capsuleGeometry args={[0.07, 0.72, 6, 12]} />
            <meshStandardMaterial color="#2c2f36" roughness={0.9} />
          </mesh>
        </group>
      ))}
      <mesh ref={chest} position={[0, 1.22, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.42, 8, 16]} />
        <meshStandardMaterial color={work} roughness={0.85} />
      </mesh>
      {[-1, 1].map((sd, i) => (
        <group key={sd} position={[sd * 0.26, 1.42, 0]}>
          <mesh
            ref={(m) => {
              if (m) arms.current[i] = m;
            }}
            position={[0, -0.3, 0]}
            castShadow
          >
            <capsuleGeometry args={[0.05, 0.5, 6, 10]} />
            <meshStandardMaterial color={work} roughness={0.85} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.66, 0]} castShadow>
        <sphereGeometry args={[0.11, 20, 16]} />
        <meshStandardMaterial color="#c99a7a" roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.73, 0]} castShadow>
        <sphereGeometry args={[0.125, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f2c200" roughness={0.4} />
      </mesh>
    </group>
  );
}

export function VentFan() {
  const on = useSettings((s) => s.interf.fan);
  const rotor = useRef<THREE.Group>(null);
  useFrame(() => {
    if (rotor.current) rotor.current.rotation.x = engine.fanAngle;
  });
  return (
    <group position={FAN_POS} rotation-y={-Math.PI / 2}>
      <mesh rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.3, 0.025, 10, 40]} />
        <meshStandardMaterial color="#5d6468" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.02]}>
        <cylinderGeometry args={[0.32, 0.32, 0.04, 40, 1, true]} />
        <meshStandardMaterial color="#4a5054" metalness={0.7} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <group ref={rotor} rotation-y={Math.PI / 2}>
        <mesh rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.06, 20]} />
          <meshStandardMaterial color="#2b2f31" metalness={0.6} />
        </mesh>
        {Array.from({ length: FAN_BLADES }, (_, i) => (
          <group key={i} rotation-x={(i * 2 * Math.PI) / FAN_BLADES}>
            <mesh position={[0, 0.15, 0]} rotation-y={0.35}>
              <boxGeometry args={[0.008, 0.22, 0.1]} />
              <meshStandardMaterial color={on ? '#8d969b' : '#6f777b'} metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
