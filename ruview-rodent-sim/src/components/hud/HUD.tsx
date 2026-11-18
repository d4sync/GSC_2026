import { useState } from 'react';
import {
  Activity,
  Atom,
  Camera,
  Clock,
  Cpu,
  Eye,
  FlaskConical,
  Gauge,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Radio,
  RotateCcw,
  Snail,
  Warehouse,
  Zap,
} from 'lucide-react';
import { useT } from '../../i18n';
import { applyScenario, getSettings, setSettings, useSettings, type ScenarioId, type NodeId } from '../../state/store';
import { BANDS, lambdaOf, type BandId } from '../../physics/constants';
import { engine } from '../../physics/sim';
import { firstFresnelRadius } from '../../physics/csi';
import { runBenchmark, type BenchReport } from '../../physics/benchmark';
import { Section, Seg, Slider, Toggle, fmt, fmtSci, useTicker } from './ui';
import { CsiChart, RX_COLORS } from './CsiChart';
import { Spectrogram } from './Spectrogram';

const SCENARIOS: ScenarioId[] = ['free', 'macro', 'stealth', 'climb', 'swarm', 'falsepos', 'nearfield'];

function Controls() {
  const t = useT();
  const s = useSettings((x) => x);
  const set = setSettings;
  const sel = s.selected;
  const selPos = sel === 'tx' ? s.tx : sel ? s.rx[Number(sel.slice(2))] : null;
  const setNodeY = (y: number) => {
    if (!sel) return;
    if (sel === 'tx') set({ tx: [s.tx[0], y, s.tx[2]] });
    else {
      const i = Number(sel.slice(2));
      const rx = [...s.rx] as typeof s.rx;
      rx[i] = [rx[i][0], y, rx[i][2]];
      set({ rx });
    }
  };
  return (
    <div className="panel left">
      <Section title={t('scenarios')} icon={<FlaskConical size={14} />}>
        <div className="grid2">
          {SCENARIOS.map((id) => (
            <button key={id} className={`btn ${s.scenario === id ? 'on' : ''}`} onClick={() => applyScenario(id)}>
              {t(`sc_${id}` as const)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={`${t('camera')} · ${t('time')}`} icon={<Camera size={14} />}>
        <Seg
          value={s.camera}
          options={(['overview', 'macro', 'los', 'top'] as const).map((v) => ({ v, label: t(`cam_${v}` as const) }))}
          onChange={(v) => set((p) => ({ camera: v, cameraNonce: p.cameraNonce + 1 }))}
        />
        <div className="row">
          <button className="btn icon" onClick={() => set({ paused: !s.paused })}>
            {s.paused ? <Play size={14} /> : <Pause size={14} />} {s.paused ? t('play') : t('pause')}
          </button>
          <button className={`btn icon ${s.slowmo ? 'on' : ''}`} onClick={() => set({ slowmo: !s.slowmo })}>
            <Snail size={14} /> {t('slowmo')}
          </button>
          <button className="btn icon" onClick={() => set((p) => ({ baselineNonce: p.baselineNonce + 1 }))}>
            <RotateCcw size={14} /> {t('resetBaseline')}
          </button>
        </div>
      </Section>
      <Section title={t('radio')} icon={<Radio size={14} />}>
        <div className="lbl">{t('band')}</div>
        <Seg value={s.band} options={(['2.4', '5.8', '6.5'] as BandId[]).map((v) => ({ v, label: `${v} GHz` }))} onChange={(v) => set({ band: v })} />
        <div className="lbl">{t('bandwidth')}</div>
        <Seg
          value={s.band === '2.4' ? 20 : s.bw}
          options={[
            { v: 20, label: '20 MHz · 64 sc' },
            { v: 80, label: '80 MHz · 234 sc' },
          ]}
          onChange={(v) => set({ bw: s.band === '2.4' ? 20 : (v as 20 | 80) })}
        />
        <Slider label={t('txPower')} value={s.txPower} min={0} max={20} step={1} unit="dBm" onChange={(v) => set({ txPower: v })} />
        <div className="lbl">{t('duty')}</div>
        <Seg value={s.duty} options={[{ v: 'idle', label: t('duty_idle') }, { v: 'flood', label: t('duty_flood') }]} onChange={(v) => set({ duty: v })} />
        <div className="lbl">{t('pol')}</div>
        <Seg
          value={s.pol}
          options={(['vertical', 'slant', 'horizontal'] as const).map((v) => ({ v, label: t(`pol_${v}` as const) }))}
          onChange={(v) => set({ pol: v })}
        />
      </Section>
      <Section title={t('nodes')} icon={<Cpu size={14} />}>
        <div className="hint">{t('dragHint')}</div>
        <div className="row">
          {[0, 1, 2].map((i) => (
            <Toggle
              key={i}
              label={`RX${i + 1}`}
              value={s.rxEnabled[i]}
              onChange={(v) => {
                const e = [...s.rxEnabled] as typeof s.rxEnabled;
                e[i] = v;
                if (e.some(Boolean)) set({ rxEnabled: e });
              }}
            />
          ))}
        </div>
        <Seg
          value={(sel ?? 'tx') as NodeId}
          options={(['tx', 'rx0', 'rx1', 'rx2'] as NodeId[]).map((v) => ({ v, label: v === 'tx' ? 'TX' : `RX${Number(v.slice(2)) + 1}` }))}
          onChange={(v) => set({ selected: v })}
        />
        {selPos && <Slider label={t('height')} value={selPos[1]} min={0} max={2.2} step={0.01} unit="m" onChange={setNodeY} />}
      </Section>
      <Section title={t('env')} icon={<Warehouse size={14} />}>
        <Slider label={t('moisture')} value={s.moisture} min={10} max={25} step={0.5} unit="%" onChange={(v) => set({ moisture: v })} />
        <div className="lbl">{t('fill')}</div>
        <Seg value={s.fill} options={(['empty', 'half', 'full'] as const).map((v) => ({ v, label: t(`fill_${v}` as const) }))} onChange={(v) => set({ fill: v })} />
        <div className="lbl">{t('species')}</div>
        <Seg value={s.species} options={[{ v: 'mouse', label: t('mouse') }, { v: 'rat', label: t('rat') }]} onChange={(v) => set((p) => ({ species: v, respawnNonce: p.respawnNonce + 1 }))} />
        <Slider label={t('count')} value={s.rodentCount} min={1} max={5} step={1} onChange={(v) => set((p) => ({ rodentCount: v, scenario: p.scenario === 'swarm' ? 'swarm' : 'free', respawnNonce: p.respawnNonce + 1 }))} />
      </Section>
      <Section title={t('visual')} icon={<Eye size={14} />}>
        <Seg value={s.visualMode} options={(['normal', 'xray', 'sar'] as const).map((v) => ({ v, label: t(`mode_${v}` as const) }))} onChange={(v) => set({ visualMode: v })} />
        <Seg value={s.fieldView} options={(['total', 'scattered'] as const).map((v) => ({ v, label: t(`field_${v}` as const) }))} onChange={(v) => set({ fieldView: v })} />
        <div className="grid2">
          <Toggle label={t('slice')} value={s.showSlice} onChange={(v) => set({ showSlice: v })} />
          <Toggle label={t('fresnel')} value={s.showFresnel} onChange={(v) => set({ showFresnel: v })} />
          <Toggle label={t('rays')} value={s.showRays} onChange={(v) => set({ showRays: v })} />
          <Toggle label={t('heatmap')} value={s.showHeatmap} onChange={(v) => set({ showHeatmap: v })} />
          <Toggle label={t('dust')} value={s.showDust} onChange={(v) => set({ showDust: v })} />
          <Toggle label={t('sliceAuto')} value={s.sliceAuto} onChange={(v) => set({ sliceAuto: v })} />
        </div>
        {!s.sliceAuto && <Slider label={t('sliceH')} value={s.sliceHeight} min={0.005} max={2.0} step={0.005} unit="m" onChange={(v) => set({ sliceHeight: v })} />}
        <div className="lbl">{t('fdtdRes')}</div>
        <Seg value={s.fdtdRes} options={[{ v: 256, label: '256²' }, { v: 384, label: '384² High' }]} onChange={(v) => set({ fdtdRes: v })} />
      </Section>
      <Section title={t('impair')} icon={<Zap size={14} />} open={false}>
        <div className="grid2">
          <Toggle label="CFO" value={s.impair.cfo} onChange={(v) => set({ impair: { ...s.impair, cfo: v } })} />
          <Toggle label="SFO / STO" value={s.impair.sfo} onChange={(v) => set({ impair: { ...s.impair, sfo: v } })} />
          <Toggle label="AWGN" value={s.impair.awgn} onChange={(v) => set({ impair: { ...s.impair, awgn: v } })} />
          <Toggle label={t('drop')} value={s.impair.drop} onChange={(v) => set({ impair: { ...s.impair, drop: v } })} />
          <Toggle label={t('agc')} value={s.impair.agc} onChange={(v) => set({ impair: { ...s.impair, agc: v } })} />
        </div>
        <Slider label={t('snr')} value={s.impair.snr} min={5} max={45} step={1} unit="dB" onChange={(v) => set({ impair: { ...s.impair, snr: v } })} />
      </Section>
      <Section title={t('interf')} icon={<Activity size={14} />} open={false}>
        <div className="grid2">
          <Toggle label={t('human')} value={s.interf.human} onChange={(v) => set({ interf: { ...s.interf, human: v } })} />
          <Toggle label={t('fan')} value={s.interf.fan} onChange={(v) => set({ interf: { ...s.interf, fan: v } })} />
          <Toggle label={t('rain')} value={s.interf.rain} onChange={(v) => set({ interf: { ...s.interf, rain: v } })} />
          <Toggle label={t('cochannel')} value={s.interf.cochannel} onChange={(v) => set({ interf: { ...s.interf, cochannel: v } })} />
        </div>
      </Section>
    </div>
  );
}

function StatusCard() {
  const t = useT();
  useTicker(200);
  const st = engine.globalState;
  const links = engine.rx.filter((r) => r.enabled);
  const best = links.slice().sort((a, b) => b.analyzer.status.rodentDb - a.analyzer.status.rodentDb)[0]?.analyzer.status;
  return (
    <div className={`status st-${st}`}>
      <div className="status-big">{t(`st_${st}` as const)}</div>
      {best && (
        <div className="kv">
          <span>{t('breathBand')}</span>
          <b>{fmt(best.rodentDb)} dB</b>
          <span>{t('motionBand')}</span>
          <b>{fmt(best.motionDb)} dB</b>
          <span>{t('humanBand')}</span>
          <b>{fmt(best.humanDb)} dB</b>
          <span>{t('peak')}</span>
          <b>
            {fmt(best.peakHz, 2)} Hz · {fmt(best.peakHz * 60, 0)} /min
          </b>
        </div>
      )}
    </div>
  );
}

function LinksTable() {
  const t = useT();
  useTicker(300);
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Link</th>
          <th>RSSI</th>
          <th>LOS blk</th>
          <th>Shadow</th>
          <th>Breath</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {engine.rx.map((r, i) =>
          r.enabled ? (
            <tr key={i}>
              <td style={{ color: RX_COLORS[i] }}>RX{i + 1}</td>
              <td>{fmt(r.rssiDbm, 0)} dBm</td>
              <td>{fmt(r.chan?.blockDb ?? 0, 0)} dB</td>
              <td>{fmt((r.chan?.losShadow ?? 0) * 100, 2)} %</td>
              <td>{fmt(r.analyzer.status.rodentDb)} dB</td>
              <td className={`st-${r.analyzer.status.state}`}>{t(`st_${r.analyzer.status.state}` as const).split(' ')[0]}</td>
            </tr>
          ) : null,
        )}
      </tbody>
    </table>
  );
}

function PhysicsCard() {
  const t = useT();
  useTicker(300);
  const s = getSettings();
  const f0 = BANDS[s.band].fc;
  const lam = lambdaOf(f0);
  const rx0 = engine.rx.find((r) => r.enabled);
  const rp = rx0?.chan?.paths.find((p) => p.kind === 'rodent');
  let rF = NaN;
  if (rp) {
    const [a, P, b] = rp.pts;
    const d1 = Math.hypot(P[0] - a[0], P[1] - a[1], P[2] - a[2]);
    const d2 = Math.hypot(P[0] - b[0], P[1] - b[1], P[2] - b[2]);
    rF = firstFresnelRadius(lam, d1, d2);
  }
  const fd = engine.fdtd;
  const sar = engine.sar;
  const nf = rx0?.chan?.near;
  return (
    <>
      <Section title={t('physics')} icon={<Atom size={14} />}>
        <div className="kv">
          <span>λ₀</span>
          <b>{fmt(lam * 100, 2)} cm</b>
          <span>ka · regime</span>
          <b>
            {fmt(engine.rcs?.ka ?? NaN, 2)} · {engine.rcs?.regime ?? '—'}
          </b>
          <span>RCS σ (bistatic)</span>
          <b>{fmt((engine.rcs?.sigma ?? 0) * 1e4, 2)} cm²</b>
          <span>Doppler f_D (RX1)</span>
          <b>{fmt(rp?.doppler ?? 0, 2)} Hz</b>
          <span>Fresnel r_F @ rodent</span>
          <b>{fmt(rF * 100, 1)} cm</b>
          <span>Near-field d · detune</span>
          <b>
            {nf && Number.isFinite(nf.dist) ? `${fmt(nf.dist * 100, 1)} cm · ${fmt(20 * Math.log10(nf.gain), 1)} dB${nf.saturated ? ' · LNA SAT' : ''}` : '—'}
          </b>
        </div>
      </Section>
      <Section title={t('fdtd')} icon={<Gauge size={14} />}>
        <div className="kv">
          <span>Mode</span>
          <b>{fd.mode || '—'}</b>
          <span>Window · Δx</span>
          <b>
            {fmt(fd.windowM * 100, 0)} cm · {fmt(fd.dx * 1000, 2)} mm
          </b>
          <span>Courant S_c</span>
          <b>{fmt(fd.courant, 2)} (≤ 0.70)</b>
          <span>cells/λ (muscle)</span>
          <b className={fd.cellsPerLambda < 6 ? 'warn' : ''}>{fmt(fd.cellsPerLambda, 1)}</b>
          <span>|E_thorax|²/|E_inc|²</span>
          <b>{fmtSci(fd.thoraxRatio)}</b>
          <span>Shadow behind thorax (2D)</span>
          <b>{fmt(fd.shadowDb, 2)} dB</b>
          <span>Float RT</span>
          <b>{fd.floatOk ? 'FP32' : 'FP16 (fallback)'}</b>
        </div>
      </Section>
      <Section title={t('sar')} icon={<Zap size={14} />}>
        <div className="kv">
          <span>E_inc (rms)</span>
          <b>{fmt(sar?.eIncRms ?? NaN, 2)} V/m</b>
          <span>SAR skin</span>
          <b>{fmtSci(sar?.skinSar ?? NaN)} W/kg</b>
          <span>SAR thorax / lung</span>
          <b>
            {fmtSci(sar?.thoraxSar ?? NaN)} / {fmtSci(sar?.lungSar ?? NaN)}
          </b>
          <span>ΔT skin / thorax</span>
          <b>
            {fmt(sar?.dTskin_mK ?? NaN, 3)} / {fmt(sar?.dTthorax_mK ?? NaN, 3)} mK
          </b>
          <span>δ_p muscle · skin</span>
          <b>
            {fmt((sar?.penDepthMuscle ?? NaN) * 1000, 1)} · {fmt((sar?.penDepthSkin ?? NaN) * 1000, 1)} mm
          </b>
          <span>ICNIRP local 2 W/kg</span>
          <b>{fmt(((sar?.peakSar ?? 0) / 2) * 100, 4)} %</b>
        </div>
      </Section>
    </>
  );
}

function Benchmark() {
  const t = useT();
  const [prog, setProg] = useState<number | null>(null);
  const [rep, setRep] = useState<BenchReport | null>(null);
  const run = async () => {
    setProg(0);
    setRep(null);
    const r = await runBenchmark(getSettings(), engine.sacks, engine.rodents, setProg);
    setRep(r);
    setProg(null);
  };
  return (
    <Section title={t('bench')} icon={<Clock size={14} />}>
      <button className="btn wide" disabled={prog !== null} onClick={run}>
        {prog !== null ? `${Math.round(prog * 100)} %` : t('runBench')}
      </button>
      {prog !== null && (
        <div className="bar">
          <i style={{ width: `${prog * 100}%` }} />
        </div>
      )}
      {rep && (
        <>
          <table className="tbl">
            <thead>
              <tr>
                <th>Band</th>
                <th>{t('snrGain')}</th>
                <th>{t('fpr')}</th>
                <th>SAR pk</th>
                <th>{t('coverage')}</th>
              </tr>
            </thead>
            <tbody>
              {rep.bands.map((b) => (
                <tr key={b.band} className={b.band === rep.best ? 'best' : ''}>
                  <td>
                    {b.band} GHz
                    <br />
                    <small>{b.regime}</small>
                  </td>
                  <td>{fmt(b.snrGainDb)} dB</td>
                  <td>
                    {fmt(b.fprRaw * 100, 0)}%
                    <br />
                    <small>
                      {fmt(b.fprOverride * 100, 0)}% {t('fprOv')}
                    </small>
                  </td>
                  <td>
                    {fmtSci(Math.max(b.peakSkinSar, b.peakThoraxSar))}
                    <br />
                    <small>ΔT {fmt(b.dTmK, 3)} mK</small>
                  </td>
                  <td>{fmt(b.coverage * 100, 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="reco">
            <b>{t('recommend')}:</b> {t('bestBand')} <b>{rep.best} GHz</b>.{' '}
            {rep.layout && (
              <>
                {t('addRx')} ({fmt(rep.layout.pos[0], 1)}, {fmt(rep.layout.pos[1], 2)}, {fmt(rep.layout.pos[2], 1)}) m → {t('coverage')} {fmt(rep.layout.base * 100, 0)}% → {fmt(rep.layout.gain * 100, 0)}%.
              </>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function Telemetry() {
  const t = useT();
  return (
    <div className="panel right">
      <Section title={t('detection')} icon={<Activity size={14} />}>
        <StatusCard />
      </Section>
      <Section title={t('csi')} icon={<Radio size={14} />}>
        <CsiChart ampLabel={t('amp')} phLabel={t('phase')} />
        <div className="lbl">{t('links')}</div>
        <LinksTable />
      </Section>
      <Section title={t('spectro')} icon={<Activity size={14} />}>
        <Spectrogram />
      </Section>
      <PhysicsCard />
      <Benchmark />
    </div>
  );
}

function FooterBar() {
  useTicker(500);
  const t = useT();
  return (
    <div className="footer">
      <span className="badge">{t('synthetic')}</span>
      <span>t = {engine.t.toFixed(1)} s</span>
      <span>pkts {engine.packetsSent}</span>
      <span>drop {engine.packetsDropped}</span>
      <span className="muted">{t('disclaimer')}</span>
    </div>
  );
}

export function HUD() {
  const t = useT();
  const open = useSettings((s) => s.hudOpen);
  const lang = useSettings((s) => s.lang);
  return (
    <div className="hud">
      <div className="topbar">
        <button className="btn icon" onClick={() => setSettings({ hudOpen: !open })}>
          {open ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <div className="title">{t('title')}</div>
        <button className="btn icon" onClick={() => setSettings({ lang: lang === 'vi' ? 'en' : 'vi' })}>
          <Languages size={15} /> {lang === 'vi' ? 'EN' : 'VI'}
        </button>
      </div>
      {open && <Controls />}
      {open && <Telemetry />}
      <FooterBar />
    </div>
  );
}
