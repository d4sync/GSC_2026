import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function Section({ title, icon, children, open: initial = true }: { title: string; icon?: ReactNode; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="sec">
      <button className="sec-h" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className="sec-b">{children}</div>}
    </section>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="sld">
      <span className="sld-l">
        {label}
        <b>
          {value.toFixed(step < 1 ? (step < 0.1 ? 2 : 1) : 0)}
          {unit ? ` ${unit}` : ''}
        </b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="tgl">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="tgl-k" />
      <span>{label}</span>
    </label>
  );
}

/** Re-render the caller at a fixed rate (telemetry numbers). */
export function useTicker(ms = 250): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

export const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
export const fmtSci = (v: number) => (Number.isFinite(v) && v !== 0 ? v.toExponential(2) : '—');
