// E-field slice visualiser: total / scattered field, dielectric X-ray, SAR thermal cutaway.

export const SLICE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SLICE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTM;
uniform sampler2D uTE;
uniform sampler2D uBgTM;
uniform sampler2D uBgTE;
uniform sampler2D uMat;
uniform float uHasTM;
uniform float uHasTE;
uniform float uScattered;
uniform float uMode;      // 0 field, 1 x-ray, 2 SAR
uniform float uGain;      // 1 / incident amplitude
uniform float uAref;      // incident mean-square (for SAR normalisation)
uniform float uN;
uniform float uOpacity;

// material code -> colour / density (codes 0..10, see MAT_CODE)
const vec3 TCOL[11] = vec3[11](
  vec3(0.0), vec3(0.95, 0.72, 0.62), vec3(0.85, 0.28, 0.22), vec3(1.0, 0.62, 0.72),
  vec3(0.9, 0.05, 0.1), vec3(0.96, 0.96, 0.9), vec3(0.85, 0.55, 0.2), vec3(0.75, 0.62, 0.38),
  vec3(0.7, 0.74, 0.78), vec3(0.55, 0.3, 0.22), vec3(0.55, 0.4, 0.25));
const float RHO[11] = float[11](1.2, 1109.0, 1090.0, 394.0, 1081.0, 1908.0, 1088.0, 1000.0, 1000.0, 1000.0, 1000.0);

vec3 diverging(float v) {
  float c = clamp(v, -1.0, 1.0);
  vec3 mid = vec3(0.02, 0.03, 0.06);
  vec3 neg = mix(mid, vec3(0.05, 0.55, 1.0), max(-c, 0.0));
  vec3 pos = mix(mid, vec3(1.0, 0.35, 0.08), max(c, 0.0));
  return mix(neg, pos, step(0.0, c));
}

vec3 thermal(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.0, 0.0, 0.15), vec3(0.45, 0.0, 0.6), smoothstep(0.0, 0.3, t));
  c = mix(c, vec3(0.95, 0.15, 0.1), smoothstep(0.3, 0.6, t));
  c = mix(c, vec3(1.0, 0.8, 0.1), smoothstep(0.6, 0.85, t));
  return mix(c, vec3(1.0, 1.0, 0.9), smoothstep(0.85, 1.0, t));
}

void main() {
  float px = 1.0 / uN;
  vec4 m = texture2D(uMat, vUv);
  int ci = int(clamp(floor(m.a + 0.5), 0.0, 10.0));
  float code = float(ci);
  // material boundaries (unrolled, uniform control flow)
  float e1 = abs(texture2D(uMat, vUv + vec2(px, 0.0)).a - m.a);
  float e2 = abs(texture2D(uMat, vUv - vec2(px, 0.0)).a - m.a);
  float e3 = abs(texture2D(uMat, vUv + vec2(0.0, px)).a - m.a);
  float e4 = abs(texture2D(uMat, vUv - vec2(0.0, px)).a - m.a);
  float edge = step(0.5, max(max(e1, e2), max(e3, e4)));

  // fields: always sample, weight by flags (no divergent texture fetches)
  vec4 tm = texture2D(uTM, vUv);
  vec4 te = texture2D(uTE, vUv);
  float btm = texture2D(uBgTM, vUv).r;
  float bte = texture2D(uBgTE, vUv).r;
  float v = uHasTM * (tm.r - uScattered * btm) + uHasTE * (te.r - uScattered * bte);
  float a = uHasTM * tm.a + uHasTE * te.a;
  float both = max(1.0, uHasTM + uHasTE);
  v *= uGain / sqrt(both) * mix(1.0, 4.0, uScattered);
  float aRel = a / max(uAref * both, 1e-12);
  float wv = fwidth(v) * 1.5 + 1e-4; // derivative taken in uniform control flow

  float tissue = step(0.5, code) * step(code, 6.5);
  float pec = step(7.5, code) * step(code, 8.5);
  float grain = step(6.5, code) * step(code, 7.5);
  vec3 tcol = TCOL[ci];

  // mode 0: total/scattered field
  vec3 c0 = diverging(v);
  float a0 = clamp(0.15 + 0.85 * abs(v), 0.0, 0.92);
  c0 = mix(c0, tcol, 0.25 * tissue);
  a0 = mix(a0, max(a0, 0.6), tissue);
  c0 = mix(c0, mix(c0, vec3(0.7, 0.58, 0.35), 0.45), grain);
  a0 = mix(a0, max(a0, 0.5), grain);
  c0 = mix(c0, vec3(0.75, 0.78, 0.82), pec);
  a0 = mix(a0, 0.95, pec);
  c0 = mix(c0, vec3(1.0), edge * 0.8);
  a0 = max(a0, edge * 0.9);

  // mode 1: dielectric X-ray with phase-wavefront contours
  vec3 base = vec3(0.02, 0.05, 0.12);
  vec3 c1 = mix(base, tcol, step(0.5, code) * mix(0.35, 0.55, tissue));
  float contour = 1.0 - smoothstep(0.0, wv, abs(v));
  c1 += vec3(0.2, 0.95, 1.0) * contour * 0.9 + vec3(0.1, 0.4, 0.6) * abs(v) * 0.6;
  c1 = mix(c1, vec3(0.85, 0.95, 1.0), edge * 0.7);
  float a1 = 0.85;

  // mode 2: SAR = sigma |E|^2 / rho (relative to incident), log thermal scale
  float sar = m.g * aRel / RHO[ci];
  float tS = clamp((log(sar + 1e-9) / log(10.0) + 4.2) / 3.2, 0.0, 1.0);
  vec3 airC = vec3(0.05, 0.07, 0.1) + vec3(0.25, 0.35, 0.5) * sqrt(clamp(aRel, 0.0, 4.0)) * 0.5;
  vec3 c2 = mix(airC, thermal(tS), tissue);
  float a2 = mix(0.55, 0.97, tissue);
  c2 = mix(c2, vec3(0.6), pec);
  a2 = mix(a2, 0.95, pec);
  c2 = mix(c2, vec3(1.0), edge * 0.5);

  float s1 = step(0.5, uMode) * (1.0 - step(1.5, uMode));
  float s2 = step(1.5, uMode);
  float s0 = 1.0 - s1 - s2;
  vec3 col = c0 * s0 + c1 * s1 + c2 * s2;
  float alpha = a0 * s0 + a1 * s1 + a2 * s2;
  gl_FragColor = vec4(col, alpha * uOpacity);
}
`;

// ---------------------------------------------------------------- X-ray rim (skin / Fresnel zones)
export const RIM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
#include <clipping_planes_pars_vertex>
void main() {
  #include <begin_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <clipping_planes_vertex>
}
`;

export const RIM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uBase;
uniform float uIntensity;
varying vec3 vN;
varying vec3 vV;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
  float a = clamp(uBase + f * uIntensity, 0.0, 1.0);
  gl_FragColor = vec4(uColor * (0.4 + f), a);
}
`;

// ---------------------------------------------------------------- volumetric light shaft
export const SHAFT_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SHAFT_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float fall = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.55, 1.0, along));
  float edge = 1.0 - smoothstep(0.55, 1.0, across);
  float flicker = 0.85 + 0.15 * sin(uTime * 0.6 + along * 7.0);
  gl_FragColor = vec4(uColor * uStrength * fall * edge * flicker, 1.0);
}
`;

// ---------------------------------------------------------------- dust motes
export const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform float uSize;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.13 + aSeed * 31.0) * 0.12;
  p.y += mod(uTime * 0.02 * (0.5 + fract(aSeed * 7.3)) + aSeed, 1.0) * 0.4 - 0.2;
  p.z += cos(uTime * 0.11 + aSeed * 17.0) * 0.12;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + fract(aSeed * 13.1)) / -mv.z;
  vAlpha = 0.35 + 0.65 * fract(aSeed * 3.7);
}
`;

export const DUST_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a * 0.55, 1.0);
}
`;
