// Automated 3-band sweep on the active scenario (SYNTHETIC channel model + the same DSP).
import { BANDS, BAND_IDS, ROOM_HALF, SPECIES, type BandId } from './constants';
import { anatomy } from './anatomy';
import { bodyFrame, humanAt, type RodentAgent, type V3 } from './behavior';
import {
  buildPaths,
  impair,
  makeRng,
  sanitize,
  subcarrierOffsets,
  synthesize,
  type RodentScat,
} from './csi';
import { LinkAnalyzer, type Bands } from './dsp';
import { computeCoverage } from './coverage';
import { estimateSar } from './sar';
import type { Settings } from '../state/store';
import type { SackStack } from './layout';

export interface BandReport {
  band: BandId;
  snrGainDb: number;
  fprRaw: number;
  fprOverride: number;
  peakSkinSar: number;
  peakThoraxSar: number;
  dTmK: number;
  coverage: number;
  regime: string;
  score: number;
}

export interface BenchReport {
  bands: BandReport[];
  best: BandId;
  layout: { pos: V3; gain: number; base: number } | null;
}

function scatterersAt(rodents: RodentAgent[], t: number): RodentScat[] {
  return rodents.map((a) => {
    const sp = SPECIES[a.species];
    const bp = a.breathPhase + 2 * Math.PI * a.breathHz * t;
    const hp = a.heartPhase + 2 * Math.PI * a.heartHz * t;
    const breath = 0.5 - 0.5 * Math.cos(bp);
    const heart = Math.max(0, Math.sin(hp)) ** 3;
    const fr = bodyFrame(a);
    const an = anatomy(a.species, breath, heart);
    const tc = an.thoraxCenter[0];
    return {
      center: [fr.center[0] + fr.f[0] * tc, fr.center[1] + fr.f[1] * tc, fr.center[2] + fr.f[2] * tc] as V3,
      axis: fr.f,
      r: sp.radius + an.expansion,
      L: sp.length,
      expansion: an.expansion,
      heartDisp: heart * sp.ribExpansion * 0.06,
      vel: [0, 0, 0] as V3,
    };
  });
}

function trial(s: Settings, band: BandId, sacks: SackStack[], rodents: RodentAgent[] | null, seed: number, t0: number): Bands[] {
  const fs = s.duty === 'flood' ? 100 : 10;
  const nPk = fs === 100 ? 560 : 70;
  const bw = band === '2.4' ? 20 : s.bw;
  const offs = subcarrierOffsets(bw);
  const f0 = BANDS[band].fc;
  const rxIdx = [0, 1, 2].filter((i) => s.rxEnabled[i]);
  const analyzers = rxIdx.map(() => {
    const a = new LinkAnalyzer();
    a.reset(fs);
    return a;
  });
  const st = rxIdx.map((i) => ({ agcGain: 1, agcReported: 1, sfoDrift: 0, rng: makeRng(seed * 31 + i) }));
  const refs = rxIdx.map(() => 0);
  const re = new Float64Array(offs.length);
  const im = new Float64Array(offs.length);
  const amp = new Float64Array(offs.length);
  const ph = new Float64Array(offs.length);
  for (let n = 0; n < nPk; n++) {
    const t = t0 + n / fs;
    const sc = rodents ? scatterersAt(rodents, t - t0) : [];
    rxIdx.forEach((ri, q) => {
      const chan = buildPaths({
        band,
        f0,
        tx: s.tx,
        rx: s.rx[ri],
        pol: s.pol,
        moisture: s.moisture,
        sacks,
        rodents: sc,
        human: s.interf.human ? humanAt(t) : null,
        fan: s.interf.fan,
        rain: s.interf.rain,
        t,
      });
      synthesize(chan, f0, offs, re, im);
      const g = impair(re, im, s.impair, st[q], s.interf.cochannel ? 0.25 : 0);
      if (g === 0) {
        analyzers[q].push(amp, ph);
        return;
      }
      const m = sanitize(re, im, amp, ph, undefined, g, refs[q]);
      if (refs[q] === 0) refs[q] = m;
      analyzers[q].push(amp, ph);
    });
  }
  analyzers.forEach((a) => a.analyze(false));
  return analyzers.map((a) => a.lastBands!);
}

const ratioDb = (a: number, b: number) => 10 * Math.log10((a + 1e-18) / (b + 1e-18));

export async function runBenchmark(
  s: Settings,
  sacks: SackStack[],
  rodents: RodentAgent[],
  onProgress: (p: number) => void,
): Promise<BenchReport> {
  const frozen = rodents.map((r) => ({ ...r, pos: [...r.pos] as V3, vel: [0, 0, 0] as V3 }));
  const reports: BandReport[] = [];
  const t0 = performance.now();
  const totalSteps = BAND_IDS.length * 13;
  let step = 0;
  const tick = async () => {
    step++;
    onProgress(Math.min(0.99, step / totalSteps));
    await new Promise((r) => setTimeout(r, 0));
  };
  for (const band of BAND_IDS) {
    const base = trial(s, band, sacks, null, 1, 0);
    await tick();
    const withR = trial(s, band, sacks, frozen, 2, 0);
    await tick();
    const gain = Math.max(...withR.map((b, i) => ratioDb(b.rodent, base[i].rodent)), -99);
    let fpRaw = 0;
    let fpOv = 0;
    const M = 10;
    for (let m = 0; m < M; m++) {
      const b = trial(s, band, sacks, null, 10 + m, 1.7 * (m + 1));
      const trig = b.some((x, i) => ratioDb(x.rodent, base[i].rodent) > 6 || ratioDb(x.motion, base[i].motion) > 8);
      const human = b.some((x, i) => ratioDb(x.human, base[i].human) > 18 && x.human > 4 * x.rodent);
      if (trig) fpRaw++;
      if (trig && !human) fpOv++;
      await tick();
    }
    const f0 = BANDS[band].fc;
    const r0 = frozen[0];
    let dmin = 1;
    if (r0) {
      const c = bodyFrame(r0).center;
      dmin = Math.min(...[s.tx, ...s.rx.filter((_, i) => s.rxEnabled[i])].map((n) => Math.hypot(c[0] - n[0], c[1] - n[1] - 0.075, c[2] - n[2])));
    }
    const sp = SPECIES[r0?.species ?? s.species];
    const sar = estimateSar(band, f0, s.txPower, s.duty === 'flood' ? 1 : 0.1, dmin, sp.radius * 0.22);
    const cov = computeCoverage(
      { band, tx: s.tx, rxs: s.rx.filter((_, i) => s.rxEnabled[i]), pol: s.pol, moisture: s.moisture, sacks, species: s.species, snrDb: s.impair.awgn ? s.impair.snr : 60, packets: s.duty === 'flood' ? 512 : 64 },
      48,
      36,
    );
    const k = (2 * Math.PI * f0) / 3e8;
    const ka = k * Math.cbrt(0.36 * sp.length * sp.radius * sp.radius);
    const regime = ka < 0.6 ? 'Rayleigh' : ka < 3 ? 'Mie' : 'Optical';
    const fprO = fpOv / M;
    reports.push({
      band,
      snrGainDb: gain,
      fprRaw: fpRaw / M,
      fprOverride: fprO,
      peakSkinSar: sar.skinSar,
      peakThoraxSar: Math.max(sar.thoraxSar, sar.lungSar),
      dTmK: Math.max(sar.dTskin_mK, sar.dTthorax_mK),
      coverage: cov.coveredFrac,
      regime: `${regime} (ka=${ka.toFixed(2)})`,
      score: Math.min(gain, 30) - 25 * fprO + 20 * cov.coveredFrac,
    });
  }
  const best = reports.slice().sort((a, b) => b.score - a.score)[0].band;
  // layout recommendation: try one extra floor-level RX on the perimeter for the best band
  const candidates: V3[] = [];
  for (let i = 0; i <= 6; i++) {
    const x = -ROOM_HALF.x + 0.4 + (i * (2 * ROOM_HALF.x - 0.8)) / 6;
    candidates.push([x, 0.08, -ROOM_HALF.z + 0.15], [x, 0.08, ROOM_HALF.z - 0.15]);
  }
  candidates.push([ROOM_HALF.x - 0.15, 0.08, -1.5], [ROOM_HALF.x - 0.15, 0.08, 1.5], [-ROOM_HALF.x + 0.15, 0.08, 1.8]);
  const params = (rxs: V3[]) => ({
    band: best,
    tx: s.tx,
    rxs,
    pol: s.pol,
    moisture: s.moisture,
    sacks,
    species: s.species,
    snrDb: s.impair.awgn ? s.impair.snr : 60,
    packets: s.duty === 'flood' ? 512 : 64,
  });
  const active = s.rx.filter((_, i) => s.rxEnabled[i]);
  const baseCov = computeCoverage(params(active), 40, 30).coveredFrac;
  let layout: BenchReport['layout'] = null;
  for (const c of candidates) {
    const cv = computeCoverage(params([...active, c]), 40, 30).coveredFrac;
    if (!layout || cv > layout.gain) layout = { pos: c, gain: cv, base: baseCov };
  }
  // keep the sweep visible for ~5 s so users can follow it
  const elapsed = performance.now() - t0;
  if (elapsed < 5000) {
    const steps = 20;
    for (let i = 0; i < steps; i++) {
      await new Promise((r) => setTimeout(r, (5000 - elapsed) / steps));
      onProgress(0.99);
    }
  }
  onProgress(1);
  return { bands: reports, best, layout };
}
