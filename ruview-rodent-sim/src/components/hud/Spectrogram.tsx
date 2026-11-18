import { useEffect, useRef } from 'react';
import { engine } from '../../physics/sim';
import { RODENT_BAND, HUMAN_BAND } from '../../physics/dsp';

function heat(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const r = Math.min(255, Math.max(0, 255 * (1.6 * t - 0.25)));
  const g = Math.min(255, Math.max(0, 255 * (1.8 * t - 0.8)));
  const b = Math.min(255, Math.max(0, 255 * (t < 0.4 ? 0.3 + 1.5 * t : 1.4 - 1.6 * t)));
  return [r, g, b];
}

/** Rolling time-frequency waterfall of the best (most rodent-band energy) RX link. */
export function Spectrogram() {
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
      const links = engine.rx.filter((r) => r.enabled);
      if (!links.length) return;
      const best = links.slice().sort((a, b) => b.analyzer.status.rodentDb - a.analyzer.status.rodentDb)[0].analyzer;
      const cols = best.spectroCols;
      if (!cols.length) return;
      const rows = best.SPEC_ROWS;
      const img = g.createImageData(W, H);
      let lo = Infinity;
      let hi = -Infinity;
      for (const col of cols) for (const v of col) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      lo = Math.max(lo, hi - 45);
      const cw = W / best.SPEC_COLS;
      const off = best.SPEC_COLS - cols.length;
      for (let x = 0; x < W; x++) {
        const ci = Math.floor(x / cw) - off;
        if (ci < 0) continue;
        const col = cols[ci];
        for (let y = 0; y < H; y++) {
          const r = Math.floor((1 - y / H) * (rows - 1));
          const [R, G, B] = heat((col[r] - lo) / (hi - lo + 1e-9));
          const p = (y * W + x) * 4;
          img.data[p] = R;
          img.data[p + 1] = G;
          img.data[p + 2] = B;
          img.data[p + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      const fmax = Math.min(12, best.fs / 2);
      const yOf = (f: number) => H * (1 - f / fmax);
      g.strokeStyle = 'rgba(255,60,60,0.9)';
      g.setLineDash([4, 3]);
      for (const f of RODENT_BAND) {
        if (f > fmax) continue;
        g.beginPath();
        g.moveTo(0, yOf(f));
        g.lineTo(W, yOf(f));
        g.stroke();
      }
      g.strokeStyle = 'rgba(255,190,40,0.9)';
      for (const f of HUMAN_BAND) {
        g.beginPath();
        g.moveTo(0, yOf(f));
        g.lineTo(W, yOf(f));
        g.stroke();
      }
      g.setLineDash([]);
      g.font = '10px ui-monospace, monospace';
      g.fillStyle = '#fff';
      for (let f = 0; f <= fmax; f += fmax > 6 ? 2 : 1) g.fillText(`${f} Hz`, 3, Math.max(10, yOf(f) - 2));
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} width={330} height={130} className="chart" />;
}
