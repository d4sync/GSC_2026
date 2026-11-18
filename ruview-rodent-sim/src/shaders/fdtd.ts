// 2D Yee-grid FDTD kernels (normalised units: E and eta0*H). Two passes per time step.
// TM_z (E perpendicular to the horizontal slice = vertical polarisation): R=Ez, G=Hx, B=Hy
// TE_z (E in the slice plane = horizontal polarisation):                 R=Hz, G=Ex, B=Ey
// A channel = exponential moving average of |E|^2 (for time-averaged SAR).
// Lossy dielectric update: ca = (1-L)/(1+L), cb = (Sc/er)/(1+L), L = sigma*dt/(2 eps0 er)
// PEC cells force tangential E = 0. 1st-order Mur ABC on the outer boundary.

export const FDTD_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uField;
uniform sampler2D uMat;
uniform float uN;
uniform float uSc;
uniform float uDt;
uniform float uSrc;
uniform float uSrcCol;
uniform float uAvg;
const float EPS0 = 8.8541878128e-12;

ivec2 cl(ivec2 p) { return clamp(p, ivec2(0), ivec2(int(uN) - 1)); }
vec4 F(ivec2 p) { return texelFetch(uField, cl(p), 0); }
vec4 M(ivec2 p) { return texelFetch(uMat, cl(p), 0); }

void coeffs(vec4 m, out float ca, out float cb) {
  float er = max(m.r, 1.0);
  float L = m.g * uDt / (2.0 * EPS0 * er);
  ca = (1.0 - L) / (1.0 + L);
  cb = (uSc / er) / (1.0 + L);
}

float srcAt(ivec2 p) {
  if (p.x != int(uSrcCol)) return 0.0;
  float y = (float(p.y) + 0.5) / uN;
  float taper = smoothstep(0.0, 0.2, y) * smoothstep(1.0, 0.8, y);
  return uSrc * taper;
}
`;

/** Pass that updates the R channel (Ez for TM, Hz for TE) with Mur ABC + soft source. */
export const fdtdPassR = (te: boolean) => /* glsl */ `
${te ? '#define TE 1' : ''}
${COMMON}
float newR(ivec2 p) {
  vec4 f = F(p);
#ifdef TE
  float curl = (F(p + ivec2(1, 0)).b - f.b) - (F(p + ivec2(0, 1)).g - f.g);
  return f.r - uSc * curl + srcAt(p);
#else
  vec4 m = M(p);
  float ca, cb;
  coeffs(m, ca, cb);
  float curl = (f.b - F(p - ivec2(1, 0)).b) - (f.g - F(p - ivec2(0, 1)).g);
  float v = ca * f.r + cb * curl;
  if (m.b > 0.5) v = 0.0;
  return v + srcAt(p);
#endif
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  int n = int(uN) - 1;
  vec4 f = F(p);
  float k = (uSc - 1.0) / (uSc + 1.0);
  float v;
  if (p.x == 0) v = F(p + ivec2(1, 0)).r + k * (newR(p + ivec2(1, 0)) - f.r);
  else if (p.x == n) v = F(p - ivec2(1, 0)).r + k * (newR(p - ivec2(1, 0)) - f.r);
  else if (p.y == 0) v = F(p + ivec2(0, 1)).r + k * (newR(p + ivec2(0, 1)) - f.r);
  else if (p.y == n) v = F(p - ivec2(0, 1)).r + k * (newR(p - ivec2(0, 1)) - f.r);
  else v = newR(p);
  // guard against any non-finite value ever propagating
  if (!(abs(v) < 1e6)) v = 0.0;
#ifdef TE
  float a = f.a;
#else
  float a = mix(f.a, v * v, uAvg);
#endif
  gl_FragColor = vec4(v, f.g, f.b, a);
}
`;

/** Pass that updates the G,B channels (Hx,Hy for TM; Ex,Ey for TE). */
export const fdtdPassGB = (te: boolean) => /* glsl */ `
${te ? '#define TE 1' : ''}
${COMMON}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 f = F(p);
#ifdef TE
  vec4 m = M(p);
  float ca, cb;
  coeffs(m, ca, cb);
  float ex = ca * f.g + cb * (f.r - F(p - ivec2(0, 1)).r);
  float ey = ca * f.b - cb * (f.r - F(p - ivec2(1, 0)).r);
  if (m.b > 0.5) { ex = 0.0; ey = 0.0; }
  if (!(abs(ex) < 1e6)) ex = 0.0;
  if (!(abs(ey) < 1e6)) ey = 0.0;
  float a = mix(f.a, ex * ex + ey * ey, uAvg);
  gl_FragColor = vec4(f.r, ex, ey, a);
#else
  float hx = f.g - uSc * (F(p + ivec2(0, 1)).r - f.r);
  float hy = f.b + uSc * (F(p + ivec2(1, 0)).r - f.r);
  gl_FragColor = vec4(f.r, hx, hy, f.a);
#endif
}
`;
