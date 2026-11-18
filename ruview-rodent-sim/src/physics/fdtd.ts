// GPU ping-pong FDTD solver (WebGL2 float render targets).
import * as THREE from 'three';
import { C0 } from './constants';
import { FDTD_VERT, fdtdPassGB, fdtdPassR } from '../shaders/fdtd';

export const COURANT = 0.5; // 2D CFL limit is 1/sqrt(2) ~ 0.707; we lock Sc = 0.5 (< 0.70)

export class FdtdSolver {
  readonly N: number;
  readonly te: boolean;
  readonly floatOk: boolean;
  rtA: THREE.WebGLRenderTarget;
  rtB: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private passR: THREE.ShaderMaterial;
  private passGB: THREE.ShaderMaterial;
  private readBuf: Float32Array | Uint16Array;
  stepCount = 0;
  phase = 0;

  constructor(renderer: THREE.WebGLRenderer, N: number, te: boolean, matTex: THREE.Texture) {
    this.N = N;
    this.te = te;
    this.floatOk = renderer.extensions.has('EXT_color_buffer_float');
    const type = this.floatOk ? THREE.FloatType : THREE.HalfFloatType;
    const opts: THREE.RenderTargetOptions = {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.rtA = new THREE.WebGLRenderTarget(N, N, opts);
    this.rtB = new THREE.WebGLRenderTarget(N, N, opts);
    this.readBuf = this.floatOk ? new Float32Array(4) : new Uint16Array(4);
    const uniforms = () => ({
      uField: { value: null as THREE.Texture | null },
      uMat: { value: matTex },
      uN: { value: N },
      uSc: { value: COURANT },
      uDt: { value: 1e-12 },
      uSrc: { value: 0 },
      uSrcCol: { value: 4 },
      uAvg: { value: 0.01 },
    });
    this.passR = new THREE.ShaderMaterial({ vertexShader: FDTD_VERT, fragmentShader: fdtdPassR(te), uniforms: uniforms(), depthTest: false, depthWrite: false });
    this.passGB = new THREE.ShaderMaterial({ vertexShader: FDTD_VERT, fragmentShader: fdtdPassGB(te), uniforms: uniforms(), depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.passR);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.reset(renderer);
  }

  get texture(): THREE.Texture {
    return this.rtA.texture;
  }

  reset(renderer: THREE.WebGLRenderer): void {
    const prev = renderer.getRenderTarget();
    const cc = new THREE.Color();
    renderer.getClearColor(cc);
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    for (const rt of [this.rtA, this.rtB]) {
      renderer.setRenderTarget(rt);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(prev);
    renderer.setClearColor(cc, ca);
    this.stepCount = 0;
    this.phase = 0;
  }

  /**
   * Advance n time steps. dx in metres, f in Hz. Source ramps in over 3 periods.
   */
  step(renderer: THREE.WebGLRenderer, n: number, dx: number, f: number, srcAmp: number): void {
    const dt = (COURANT * dx) / C0;
    const wdt = 2 * Math.PI * f * dt;
    const period = (2 * Math.PI) / wdt;
    const avg = Math.min(0.05, 1 / (1.5 * period));
    const prev = renderer.getRenderTarget();
    const order = this.te ? [this.passR, this.passGB] : [this.passGB, this.passR];
    for (let s = 0; s < n; s++) {
      this.phase += wdt;
      this.stepCount++;
      const ramp = Math.min(1, this.stepCount / (3 * period));
      const src = srcAmp * ramp * Math.sin(this.phase);
      // pass 1: A -> B ; pass 2: B -> A
      const m1 = order[0];
      const m2 = order[1];
      for (const m of [m1, m2]) {
        m.uniforms.uDt.value = dt;
        m.uniforms.uSrc.value = src;
        m.uniforms.uAvg.value = avg;
      }
      m1.uniforms.uField.value = this.rtA.texture;
      this.quad.material = m1;
      renderer.setRenderTarget(this.rtB);
      renderer.render(this.scene, this.cam);
      m2.uniforms.uField.value = this.rtB.texture;
      this.quad.material = m2;
      renderer.setRenderTarget(this.rtA);
      renderer.render(this.scene, this.cam);
    }
    renderer.setRenderTarget(prev);
  }

  /** Read RGBA at a texel (synchronous; call sparingly). */
  read(renderer: THREE.WebGLRenderer, i: number, j: number): [number, number, number, number] {
    const x = Math.max(0, Math.min(this.N - 1, Math.round(i)));
    const y = Math.max(0, Math.min(this.N - 1, Math.round(j)));
    renderer.readRenderTargetPixels(this.rtA, x, y, 1, 1, this.readBuf);
    if (this.readBuf instanceof Float32Array) return [this.readBuf[0], this.readBuf[1], this.readBuf[2], this.readBuf[3]];
    const h = THREE.DataUtils.fromHalfFloat;
    return [h(this.readBuf[0]), h(this.readBuf[1]), h(this.readBuf[2]), h(this.readBuf[3])];
  }

  /** Non-blocking readback (WebGL2 PBO + fence); resolves a frame or two later. */
  async readAsync(renderer: THREE.WebGLRenderer, i: number, j: number): Promise<number> {
    const x = Math.max(0, Math.min(this.N - 1, Math.round(i)));
    const y = Math.max(0, Math.min(this.N - 1, Math.round(j)));
    const buf = this.floatOk ? new Float32Array(4) : new Uint16Array(4);
    await renderer.readRenderTargetPixelsAsync(this.rtA, x, y, 1, 1, buf);
    return buf instanceof Float32Array ? buf[3] : THREE.DataUtils.fromHalfFloat(buf[3]);
  }

  dispose(): void {
    this.rtA.dispose();
    this.rtB.dispose();
    this.passR.dispose();
    this.passGB.dispose();
    this.quad.geometry.dispose();
  }
}
