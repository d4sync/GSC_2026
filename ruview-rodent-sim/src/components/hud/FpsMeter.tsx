import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/** FPS + GPU resource counters, written straight into a DOM node outside the canvas. */
export const fpsState = { text: '' };

export function FpsMeter() {
  const gl = useThree((s) => s.gl);
  const acc = useRef({ t: 0, n: 0 });
  useFrame((_, dt) => {
    acc.current.t += dt;
    acc.current.n++;
    if (acc.current.t >= 0.5) {
      const fps = acc.current.n / acc.current.t;
      const info = gl.info;
      fpsState.text = `${fps.toFixed(0)} FPS · tex ${info.memory.textures} · geo ${info.memory.geometries}`;
      const el = document.getElementById('fps-meter');
      if (el) el.textContent = fpsState.text;
      acc.current = { t: 0, n: 0 };
    }
  });
  return null;
}
