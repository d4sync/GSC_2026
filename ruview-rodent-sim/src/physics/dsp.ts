// Detection DSP for one RX link (mirrors the RuView edge pipeline: per-subcarrier variance
// tracking, top-K subcarrier selection, band-pass analysis, baseline-relative detection).

export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = (-2 * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export const BINS = 32; // subcarriers are grouped into <=32 feature bins
export const CAP = 1024;

export interface Bands {
  human: number;
  rodent: number;
  motion: number;
  total: number;
}

export interface LinkStatus {
  state: 'calibrating' | 'clear' | 'rodent' | 'human';
  rodentDb: number; // breathing-band power vs. baseline
  motionDb: number;
  humanDb: number;
  peakHz: number; // strongest frequency inside the rodent band
}

export const RODENT_BAND: [number, number] = [1.5, 3.5];
export const HUMAN_BAND: [number, number] = [0.1, 0.6];

export class LinkAnalyzer {
  fs = 100;
  ring: Float32Array[] = [];
  cm = new Float32Array(CAP); // common-mode (subcarrier-mean) amplitude per packet
  ampStd = 0;
  head = 0;
  count = 0;
  baseline: Bands | null = null;
  calib: Bands[] = [];
  calibrating = true;
  spec: Float64Array = new Float64Array(0);
  lastBands: Bands | null = null;
  status: LinkStatus = { state: 'calibrating', rodentDb: 0, motionDb: 0, humanDb: 0, peakHz: 0 };
  spectroCols: Float32Array[] = [];
  readonly SPEC_ROWS = 96;
  readonly SPEC_COLS = 180;

  constructor() {
    for (let b = 0; b < BINS; b++) this.ring.push(new Float32Array(CAP));
  }

  reset(fs: number): void {
    this.fs = fs;
    this.head = 0;
    this.count = 0;
    this.baseline = null;
    this.calib = [];
    this.calibrating = true;
    this.spectroCols = [];
    this.status = { state: 'calibrating', rodentDb: 0, motionDb: 0, humanDb: 0, peakHz: 0 };
  }

  /** Push one sanitised packet: amplitude (normalised) and sanitised phase per subcarrier. */
  push(amp: Float64Array, ph: Float64Array): void {
    const n = amp.length;
    let mean = 0;
    for (let k = 0; k < n; k++) mean += amp[k];
    this.cm[this.head] = mean / n;
    const per = n / BINS;
    for (let b = 0; b < BINS; b++) {
      let s = 0;
      let c = 0;
      const k0 = Math.floor(b * per);
      const k1 = Math.max(k0 + 1, Math.floor((b + 1) * per));
      for (let k = k0; k < k1 && k < n; k++) {
        s += ph[k] + (amp[k] - 1);
        c++;
      }
      this.ring[b][this.head] = c ? s / c : 0;
    }
    this.head = (this.head + 1) % CAP;
    this.count = Math.min(CAP, this.count + 1);
  }

  windowLen(): number {
    return this.fs >= 50 ? 256 : 64;
  }

  /** Seconds of empty-room capture needed before the first baseline window is complete. */
  calibSeconds(): number {
    return this.windowLen() / this.fs + 1.6;
  }

  /** Fused breathing/motion signal from the top-K variance bins (sign-aligned). */
  fused(N: number): Float64Array | null {
    if (this.count < N) return null;
    const series: Float64Array[] = [];
    const vars: number[] = [];
    for (let b = 0; b < BINS; b++) {
      const s = new Float64Array(N);
      let m = 0;
      for (let i = 0; i < N; i++) {
        const idx = (this.head - N + i + CAP) % CAP;
        s[i] = this.ring[b][idx];
        m += s[i];
      }
      m /= N;
      // linear detrend
      let sx = 0,
        sxy = 0,
        sxx = 0;
      for (let i = 0; i < N; i++) {
        s[i] -= m;
        const x = i - (N - 1) / 2;
        sxy += x * s[i];
        sxx += x * x;
        sx += x;
      }
      void sx;
      const slope = sxy / sxx;
      let v = 0;
      for (let i = 0; i < N; i++) {
        s[i] -= slope * (i - (N - 1) / 2);
        v += s[i] * s[i];
      }
      series.push(s);
      vars.push(v / N);
    }
    const order = vars.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const K = 6;
    const ref = series[order[0][1]];
    const out = new Float64Array(N);
    for (let q = 0; q < K; q++) {
      const s = series[order[q][1]];
      let c = 0;
      for (let i = 0; i < N; i++) c += s[i] * ref[i];
      const sg = c >= 0 ? 1 : -1;
      for (let i = 0; i < N; i++) out[i] += (sg * s[i]) / K;
    }
    return out;
  }

  analyze(calibrationActive: boolean): void {
    const N = this.windowLen();
    const s = this.fused(N);
    if (!s) return;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = s[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fftInPlace(re, im);
    const half = N / 2;
    const spec = new Float64Array(half);
    for (let i = 0; i < half; i++) spec[i] = (re[i] * re[i] + im[i] * im[i]) / N;
    this.spec = spec;
    const df = this.fs / N;
    const nyq = this.fs / 2;
    const bandPow = (lo: number, hi: number): number => {
      const a = Math.max(1, Math.round(lo / df));
      const b = Math.min(half - 1, Math.round(Math.min(hi, nyq - df) / df));
      let p = 0;
      for (let i = a; i <= b; i++) p += spec[i];
      return p / Math.max(1, b - a + 1);
    };
    const bands: Bands = {
      human: bandPow(HUMAN_BAND[0], HUMAN_BAND[1]),
      rodent: bandPow(RODENT_BAND[0], RODENT_BAND[1]),
      motion: bandPow(4, Math.min(20, nyq - 0.5)),
      total: bandPow(0.1, nyq - df),
    };
    this.lastBands = bands;
    // common-mode amplitude spread over the window (people move |H| by >>5 %, rodents by <1-2 %)
    let cmMean = 0;
    for (let i = 0; i < N; i++) cmMean += this.cm[(this.head - N + i + CAP) % CAP];
    cmMean /= N;
    let cmVar = 0;
    for (let i = 0; i < N; i++) cmVar += (this.cm[(this.head - N + i + CAP) % CAP] - cmMean) ** 2;
    this.ampStd = Math.sqrt(cmVar / N) / Math.max(1e-9, Math.abs(cmMean));
    // spectrogram column (0 .. min(12 Hz, Nyquist))
    const fmax = Math.min(12, nyq);
    const col = new Float32Array(this.SPEC_ROWS);
    for (let r = 0; r < this.SPEC_ROWS; r++) {
      const f = (r / (this.SPEC_ROWS - 1)) * fmax;
      const i = Math.min(half - 1, Math.round(f / df));
      col[r] = 10 * Math.log10(spec[i] + 1e-14);
    }
    this.spectroCols.push(col);
    if (this.spectroCols.length > this.SPEC_COLS) this.spectroCols.shift();

    if (calibrationActive) {
      this.calibrating = true;
      this.calib.push(bands);
      this.status = { ...this.status, state: 'calibrating' };
      return;
    }
    if (this.calibrating) {
      this.calibrating = false;
      const med = (k: keyof Bands) => {
        const v = this.calib.map((b) => b[k]).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : bands[k];
      };
      this.baseline = { human: med('human'), rodent: med('rodent'), motion: med('motion'), total: med('total') };
    }
    const base = this.baseline ?? bands;
    const db = (a: number, b: number) => 10 * Math.log10((a + 1e-16) / (b + 1e-16));
    const rodentDb = db(bands.rodent, base.rodent);
    const motionDb = db(bands.motion, base.motion);
    const humanDb = db(bands.human, base.human);
    // peak frequency in rodent band
    let pk = 0;
    let pf = 0;
    for (let i = Math.round(RODENT_BAND[0] / df); i <= Math.min(half - 1, Math.round(RODENT_BAND[1] / df)); i++) {
      if (spec[i] > pk) {
        pk = spec[i];
        pf = i * df;
      }
    }
    let state: LinkStatus['state'] = 'clear';
    // human override: large low-frequency (gait + 0.2-0.4 Hz breathing) energy dominates
    // (a person's RCS ~0.5-1 m^2 is ~30 dB above a rodent's, so very large broadband motion
    //  energy or a dominant 0.1-0.6 Hz component is attributed to a human and suppressed)
    const big = this.ampStd > 0.08;
    if (big && ((humanDb > 18 && bands.human > 4 * bands.rodent) || motionDb > 24)) state = 'human';
    else if (rodentDb > 6 || motionDb > 8) state = 'rodent';
    this.status = { state, rodentDb, motionDb, humanDb, peakHz: pf };
  }
}
