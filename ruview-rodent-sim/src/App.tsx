import { Suspense, useCallback, useState } from 'react';
import * as THREE from 'three';
import { Canvas, type RootState } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import { HUD } from './components/hud/HUD';
import { useT } from './i18n';
import { FpsMeter } from './components/hud/FpsMeter';

export default function App() {
  const [canvasKey, setCanvasKey] = useState(0);
  const [lost, setLost] = useState(false);
  const t = useT();

  const onCreated = useCallback((state: RootState) => {
    const gl = state.gl;
    gl.localClippingEnabled = true;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.shadowMap.type = THREE.PCFShadowMap;
    // clean shader compilation logging
    gl.debug.checkShaderErrors = true;
    gl.debug.onShaderError = (ctx, program, vs, fs) => {
      const log = (s: WebGLShader) => ctx.getShaderInfoLog(s) || '';
      console.groupCollapsed('%c[shader] compile/link error', 'color:#ff6b6b');
      console.error('program:', ctx.getProgramInfoLog(program));
      console.error('vertex:', log(vs));
      console.error('fragment:', log(fs));
      console.groupEnd();
    };
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[webgl] context lost');
      setLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.info('[webgl] context restored - remounting scene');
      setLost(false);
      setCanvasKey((k) => k + 1);
    });
  }, []);

  return (
    <div className="app">
      <Canvas
        key={canvasKey}
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [5.6, 4.6, 6.6], fov: 45, near: 0.01, far: 60 }}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
        onCreated={onCreated}
      >
        <Suspense fallback={null}>
          <Scene />
          <FpsMeter />
        </Suspense>
      </Canvas>
      <HUD />
      <div id="fps-meter" className="fps" />
      {lost && <div className="lost">{t('contextLost')}</div>}
    </div>
  );
}
