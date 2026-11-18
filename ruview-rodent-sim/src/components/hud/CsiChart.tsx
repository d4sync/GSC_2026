import { useEffect, useRef } from 'react';
import { engine } from '../../physics/sim';

const RX_COLORS = ['#38e1ff', '#ff6bd6', '#ffd23f'];

/** Live amplitude (all RX) and sanitised vs raw phase (RX1) across OFDM subcarriers. */
export function CsiChart({ ampLabel, phLabel }: { ampLabel: string; phLabel: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = ref.current;
      if (!c) return;
      const g = c.getContext('2d')!;
      const W = c.width;
      const H = c.height;
      g.clearRect(0, 0, W, H);
      const h1 = H * 0.55;
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.fillRect(0, 0, W, h1 - 4);
      g.fillRect(0, h1 + 4, W, H - h1 - 4);
      g.font = '10px ui-monospace, monospace';
      g.fillStyle = '#8fa3b8';
      g.fillText(ampLabel, 6, 12);
      g.fillText(phLabel, 6, h1 + 16);
      // amplitude
      let lo = Infinity;
      let hi = -Infinity;
      engine.rx.forEach((t) => {
        if (!t.enabled) return;
        for (const v of t.ampDb) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      });
      if (!Number.isFinite(lo)) return;
      if (hi - lo < 6) {
        const m = (hi + lo) / 2;
        lo = m - 3;
        hi = m + 3;
      }
      engine.rx.forEach((t, i) => {
        if (!t.enabled) return;
        const n = t.ampDb.length;
        g.strokeStyle = RX_COLORS[i];
        g.lineWidth = 1.4;
        g.beginPath();
        for (let k = 0; k < n; k++) {
          const x = 4 + ((W - 8) * k) / (n - 1);
          const y = 18 + (h1 - 26) * (1 - (t.ampDb[k] - lo) / (hi - lo));
          if (k === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      });
      g.fillStyle = '#6c7f93';
      g.fillText(`${hi.toFixed(0)} dB`, W - 48, 12);
      g.fillText(`${lo.toFixed(0)} dB`, W - 48, h1 - 8);
      // phase (RX index of first enabled)
      const t = engine.rx.find((r) => r.enabled);
      if (!t) return;
      const n = t.phase.length;
      const yOf = (v: number, range: number) => h1 + 22 + (H - h1 - 28) * (0.5 - v / (2 * range));
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const x = 4 + ((W - 8) * k) / (n - 1);
        const y = yOf(t.rawPhase[k], Math.PI);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.strokeStyle = '#7dffb2';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const x = 4 + ((W - 8) * k) / (n - 1);
        const y = yOf(t.phase[k], 0.6);
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = '#6c7f93';
      g.fillText('raw ±π (grey) · sanitised ±0.6 (green)', 6, H - 4);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [ampLabel, phLabel]);
  return <canvas ref={ref} width={330} height={190} className="chart" />;
}

export { RX_COLORS };
