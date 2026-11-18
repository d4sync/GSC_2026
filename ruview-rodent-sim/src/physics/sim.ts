// Real-time simulation engine (non-React singleton). Advances kinematics, generates ESP32
// CSI packets at the configured rate, runs sanitisation + detection DSP per RX link.
import { BANDS, SPECIES, type Species } from './constants';
import { anatomy } from './anatomy';
import {
  bodyFrame,
  breathOf,
  heartOf,
  humanAt,
  makeRodent,
  stepRodent,
  type HumanState,
  type RodentAgent,
  type V3,
} from './behavior';
import {
  buildPaths,
  impair,
  makeRng,
  rodentRcs,
  polCouplingFor,
  sanitize,
  subcarrierOffsets,
  synthesize,
  type ChannelResult,
  type ImpairState,
  type RcsInfo,
  type RodentScat,
} from './csi';
import { LinkAnalyzer, type LinkStatus } from './dsp';
import { buildSacks, type FillLevel, type SackStack } from './layout';
import { estimateSar, type SarEstimate } from './sar';
import type { Settings } from '../state/store';

export interface RxTelemetry {
  enabled: boolean;
  ampDb: Float64Array;
  phase: Float64Array;
  rawPhase: Float64Array;
  rssiDbm: number;
  chan: ChannelResult | null;
  analyzer: LinkAnalyzer;
}

export interface FdtdReadout {
  thoraxRatio: number; // |E_thorax|^2 / |E_inc|^2 (time-averaged, 2D slice)
  shadowDb: number; // field behind thorax vs incident (dB)
  probeRatio: number;
  windowM: number;
  dx: number;
  cellsPerLambda: number;
  courant: number;
  mode: string;
  floatOk: boolean;
}

export type GlobalState = LinkStatus['state'];

const CALIB_SECONDS = 3.5;

class Engine {
  t = 0;
  rodents: RodentAgent[] = [];
  human: HumanState | null = null;
  fanAngle = 0;
  sacks: SackStack[] = buildSacks('half');
  private fill: FillLevel = 'half';
  rx: RxTelemetry[] = [0, 1, 2].map(() => ({
    enabled: false,
    ampDb: new Float64Array(64),
    phase: new Float64Array(64),
    rawPhase: new Float64Array(64),
    rssiDbm: -100,
    chan: null,
    analyzer: new LinkAnalyzer(),
  }));
  globalState: GlobalState = 'calibrating';
  calibUntil = CALIB_SECONDS;
  packetAcc = 0;
  analysisAcc = 0;
  packetsSent = 0;
  packetsDropped = 0;
  sar: SarEstimate | null = null;
  coverage = 0;
  rcs: RcsInfo | null = null;
  fdtd: FdtdReadout = { thoraxRatio: 0, shadowDb: 0, probeRatio: 0, windowM: 0, dx: 0, cellsPerLambda: 0, courant: 0, mode: '', floatOk: true };
  private impairState: ImpairState[] = [0, 1, 2].map((i) => ({ agcGain: 1, agcReported: 1, sfoDrift: 0, rng: makeRng(1000 + i * 7919) }));
  private sig = '';
  private respawnNonce = -1;
  private baselineNonce = -1;
  private bufRe = new Float64Array(234);
  private bufIm = new Float64Array(234);

  sacksFor(fill: FillLevel): SackStack[] {
    if (fill !== this.fill) {
      this.fill = fill;
      this.sacks = buildSacks(fill);
    }
    return this.sacks;
  }

  respawn(s: Settings): void {
    const sp: Species = s.species;
    const L = SPECIES[sp].length;
    this.rodents = [];
    const n = Math.max(1, Math.min(5, s.rodentCount));
    switch (s.scenario) {
      case 'macro': {
        const a = makeRodent(0, sp, 0.0, 0.03, 'freeze');
        a.heading = Math.PI / 2;
        a.breathHz = sp === 'rat' ? 2.5 : 2.5;
        this.rodents.push(a);
        break;
      }
      case 'stealth': {
        const a = makeRodent(0, sp, -0.9, 1.62, 'hide');
        a.anchor = [-0.9, 0, 1.62];
        a.heading = 0;
        this.rodents.push(a);
        break;
      }
      case 'climb': {
        const a = makeRodent(0, sp, -2.3, -1.75, 'climb');
        a.climbPost = [-1.6, -2.15];
        a.climbTarget = 1.6;
        this.rodents.push(a);
        break;
      }
      case 'falsepos': {
        const a = makeRodent(0, sp, -1.4, 0.05, 'freeze');
        a.heading = Math.PI / 2;
        this.rodents.push(a);
        break;
      }
      case 'nearfield': {
        const rx = s.rx[0];
        const a = makeRodent(0, sp, rx[0] - 0.02 - 0.58 * L, rx[2], 'sniff');
        a.anchor = [rx[0] - 0.02 - 0.58 * L, 0, rx[2]];
        a.heading = 0;
        this.rodents.push(a);
        break;
      }
      case 'swarm':
      case 'free':
      default: {
        const spots: [number, number][] = [
          [-3.2, -0.6],
          [-1.5, 0.25],
          [0.4, -0.3],
          [2.1, 0.3],
          [3.3, -0.5],
        ];
        for (let i = 0; i < n; i++) this.rodents.push(makeRodent(i, sp, spots[i][0], spots[i][1], 'wander'));
      }
    }
  }

  private refAmp = [0, 0, 0];

  resetBaseline(s: Settings): void {
    this.refAmp = [0, 0, 0];
    const fs = s.duty === 'flood' ? 100 : 10;
    this.rx.forEach((r) => r.analyzer.reset(fs));
    this.calibUntil = this.t + Math.max(CALIB_SECONDS, this.rx[0].analyzer.calibSeconds());
  }

  rodentScatterers(tOffset: number): RodentScat[] {
    return this.rodents.map((a) => {
      const sp = SPECIES[a.species];
      const bp = a.breathPhase + 2 * Math.PI * a.breathHz * tOffset;
      const hp = a.heartPhase + 2 * Math.PI * a.heartHz * tOffset;
      const breath = 0.5 - 0.5 * Math.cos(bp);
      const heart = Math.max(0, Math.sin(hp)) ** 3;
      const fr = bodyFrame(a);
      const an = anatomy(a.species, breath, heart);
      const tc = an.thoraxCenter[0];
      const center: V3 = [fr.center[0] + fr.f[0] * tc, fr.center[1] + fr.f[1] * tc, fr.center[2] + fr.f[2] * tc];
      return {
        center,
        axis: fr.f,
        r: sp.radius + an.expansion,
        L: sp.length,
        expansion: an.expansion,
        heartDisp: heart * sp.ribExpansion * 0.06,
        vel: a.vel,
      };
    });
  }

  update(dtReal: number, s: Settings): void {
    const sacks = this.sacksFor(s.fill);
    if (s.respawnNonce !== this.respawnNonce || this.rodents.length === 0) {
      this.respawnNonce = s.respawnNonce;
      this.respawn(s);
    }
    const sig = [s.band, s.bw, s.duty, s.pol, s.fill, s.moisture, s.tx.join(), s.rx.map((r) => r.join()).join(), s.rxEnabled.join(), s.species, s.rodentCount].join('|');
    if (sig !== this.sig) {
      const speciesChanged = this.sig && this.sig.split('|')[9] !== s.species;
      const countChanged = this.sig && this.sig.split('|')[10] !== String(s.rodentCount);
      this.sig = sig;
      if (speciesChanged || countChanged) this.respawn(s);
      this.resetBaseline(s);
    }
    if (s.baselineNonce !== this.baselineNonce) {
      this.baselineNonce = s.baselineNonce;
      this.resetBaseline(s);
    }
    if (s.paused) return;
    const dt = Math.min(0.05, dtReal) * (s.slowmo ? 0.1 : 1);
    this.t += dt;
    for (const a of this.rodents) stepRodent(a, dt, sacks);
    this.human = s.interf.human ? humanAt(this.t) : null;
    this.fanAngle += dt * 2 * Math.PI * 8 * (s.interf.fan ? 1 : 0);

    // ---- CSI packets
    const fs = s.duty === 'flood' ? 100 : 10;
    const bw = s.band === '2.4' ? 20 : s.bw;
    const offs = subcarrierOffsets(bw);
    const f0 = BANDS[s.band].fc;
    const nSc = offs.length;
    this.packetAcc += dt * fs;
    const calibrating = this.t < this.calibUntil;
    while (this.packetAcc >= 1) {
      this.packetAcc -= 1;
      const tOff = -this.packetAcc / fs;
      const rodents = calibrating ? [] : this.rodentScatterers(tOff);
      const tPkt = this.t + tOff + (s.interf.cochannel ? (Math.random() - 0.5) * 0.004 : 0);
      for (let i = 0; i < 3; i++) {
        const tel = this.rx[i];
        tel.enabled = s.rxEnabled[i];
        if (!tel.enabled) continue;
        const chan = buildPaths({
          band: s.band,
          f0,
          tx: s.tx,
          rx: s.rx[i],
          pol: s.pol,
          moisture: s.moisture,
          sacks,
          rodents,
          human: s.interf.human ? humanAt(tPkt) : null,
          fan: s.interf.fan,
          rain: s.interf.rain,
          t: tPkt,
        });
        const re = this.bufRe.subarray(0, nSc);
        const im = this.bufIm.subarray(0, nSc);
        synthesize(chan, f0, offs, re, im);
        // RSSI from clean channel power
        let pw = 0;
        for (let k = 0; k < nSc; k++) pw += re[k] * re[k] + im[k] * im[k];
        tel.rssiDbm = s.txPower + 2.15 * 2 + 10 * Math.log10(pw / nSc + 1e-30);
        this.packetsSent++;
        const gainRep = impair(re, im, s.impair, this.impairState[i], s.interf.cochannel ? 0.25 : 0);
        if (gainRep === 0) {
          this.packetsDropped++;
          // hold-last-sample (packet loss): re-push previous sanitised values
          tel.analyzer.push(tel.ampDb.length === nSc ? this.lastAmp(i, nSc) : new Float64Array(nSc).fill(1), tel.phase.length === nSc ? tel.phase : new Float64Array(nSc));
          continue;
        }
        if (tel.ampDb.length !== nSc) {
          tel.ampDb = new Float64Array(nSc);
          tel.phase = new Float64Array(nSc);
          tel.rawPhase = new Float64Array(nSc);
        }
        const amp = new Float64Array(nSc);
        // slow reference level (~4 s EMA), frozen outside calibration so body shadowing is kept
        const ref = this.refAmp[i];
        const mean = sanitize(re, im, amp, tel.phase, tel.rawPhase, gainRep, ref);
        if (ref === 0) this.refAmp[i] = mean;
        const scale = ref > 0 ? ref : mean;
        for (let k = 0; k < nSc; k++) tel.ampDb[k] = 20 * Math.log10(amp[k] * scale * gainRep + 1e-30);
        this.lastAmpBuf[i] = amp;
        tel.analyzer.push(amp, tel.phase);
        tel.chan = chan;
      }
    }

    // ---- DSP analysis every 0.2 s of simulated time
    this.analysisAcc += dt;
    if (this.analysisAcc >= 0.2) {
      this.analysisAcc = 0;
      for (const tel of this.rx) if (tel.enabled) tel.analyzer.analyze(calibrating);
      const st = this.rx.filter((r) => r.enabled).map((r) => r.analyzer.status.state);
      this.globalState = calibrating || st.includes('calibrating') ? 'calibrating' : st.includes('human') ? 'human' : st.includes('rodent') ? 'rodent' : 'clear';
    }

    // ---- exposure estimate for the primary rodent (nearest radiating node)
    const a0 = this.rodents[0];
    if (a0) {
      const sc = this.rodentScatterers(0)[0];
      const nodes = [s.tx, ...s.rx.filter((_, i) => s.rxEnabled[i])];
      let dmin = Infinity;
      for (const n of nodes) dmin = Math.min(dmin, Math.hypot(sc.center[0] - n[0], sc.center[1] - n[1] - 0.075, sc.center[2] - n[2]));
      const wall = SPECIES[a0.species].radius * 0.22;
      this.sar = estimateSar(s.band, f0, s.txPower, s.duty === 'flood' ? 1 : 0.1, dmin, wall);
      const prop: V3 = [sc.center[0] - s.tx[0], sc.center[1] - s.tx[1], sc.center[2] - s.tx[2]];
      const pl = Math.hypot(...prop) || 1;
      this.rcs = rodentRcs(sc.r, sc.L, f0, s.band, polCouplingFor(s.pol, [prop[0] / pl, prop[1] / pl, prop[2] / pl], sc.axis));
    }
  }

  private lastAmpBuf: Float64Array[] = [];
  private lastAmp(i: number, n: number): Float64Array {
    const b = this.lastAmpBuf[i];
    return b && b.length === n ? b : new Float64Array(n).fill(1);
  }

  /** Primary rodent breathing state for rendering helpers */
  primaryBreath(): number {
    return this.rodents[0] ? breathOf(this.rodents[0]) : 0;
  }
  primaryHeart(): number {
    return this.rodents[0] ? heartOf(this.rodents[0]) : 0;
  }
}

export const engine = new Engine();
