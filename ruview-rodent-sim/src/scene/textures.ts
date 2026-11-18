// Procedural canvas textures (no external assets): concrete, brick, burlap weave, wood.
import * as THREE from 'three';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function tex(c: HTMLCanvasElement, repeat: [number, number], srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, unknown>();
function cached<T>(k: string, f: () => T): T {
  if (!cache.has(k)) cache.set(k, f());
  return cache.get(k) as T;
}

export function concreteTextures() {
  return cached('concrete', () => {
    const S = 1024;
    const [c, g] = canvas(S);
    const [rc, rg] = canvas(S);
    const r = rng(7);
    g.fillStyle = '#8a8780';
    g.fillRect(0, 0, S, S);
    rg.fillStyle = '#b0b0b0';
    rg.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const x = r() * S;
      const y = r() * S;
      const s = r() * 3 + 0.5;
      const l = 95 + r() * 70;
      g.fillStyle = `rgba(${l},${l - 3},${l - 8},${0.25 + r() * 0.3})`;
      g.fillRect(x, y, s, s);
      const rl = 120 + r() * 120;
      rg.fillStyle = `rgba(${rl},${rl},${rl},0.35)`;
      rg.fillRect(x, y, s * 2, s * 2);
    }
    for (let i = 0; i < 40; i++) {
      // stains & tyre marks
      const x = r() * S;
      const y = r() * S;
      const rad = 30 + r() * 140;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, 'rgba(60,55,48,0.18)');
      grd.addColorStop(1, 'rgba(60,55,48,0)');
      g.fillStyle = grd;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.strokeStyle = 'rgba(40,38,35,0.55)';
    g.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo((k * S) / 4, 0);
      g.lineTo((k * S) / 4, S);
      g.moveTo(0, (k * S) / 4);
      g.lineTo(S, (k * S) / 4);
      g.stroke();
    }
    return { map: tex(c, [2, 1.5]), rough: tex(rc, [2, 1.5], false) };
  });
}

export function brickTextures() {
  return cached('brick', () => {
    const S = 1024;
    const [c, g] = canvas(S);
    const [bc, bg] = canvas(S);
    const r = rng(11);
    g.fillStyle = '#9c9488';
    g.fillRect(0, 0, S, S);
    bg.fillStyle = '#202020';
    bg.fillRect(0, 0, S, S);
    const bw = 128;
    const bh = 56;
    for (let row = 0; row * bh < S; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col * bw < S + bw; col++) {
        const x = col * bw + off + 3;
        const y = row * bh + 3;
        const h = 8 + r() * 12;
        const l = 38 + r() * 14;
        g.fillStyle = `hsl(${h},${32 + r() * 18}%,${l}%)`;
        g.fillRect(x, y, bw - 6, bh - 6);
        for (let k = 0; k < 40; k++) {
          g.fillStyle = `rgba(0,0,0,${r() * 0.12})`;
          g.fillRect(x + r() * (bw - 8), y + r() * (bh - 8), 2 + r() * 5, 2 + r() * 4);
        }
        bg.fillStyle = `rgb(${200 + r() * 40},${200 + r() * 40},${200 + r() * 40})`;
        bg.fillRect(x, y, bw - 6, bh - 6);
      }
    }
    return { map: tex(c, [4, 2]), bump: tex(bc, [4, 2], false) };
  });
}

export function burlapTextures() {
  return cached('burlap', () => {
    const S = 512;
    const [c, g] = canvas(S);
    const [bc, bg] = canvas(S);
    const r = rng(23);
    g.fillStyle = '#a88a5c';
    g.fillRect(0, 0, S, S);
    bg.fillStyle = '#808080';
    bg.fillRect(0, 0, S, S);
    const step = 8;
    for (let y = 0; y < S; y += step) {
      for (let x = 0; x < S; x += step) {
        const over = ((x / step + y / step) & 1) === 0;
        const l = 52 + r() * 14;
        g.fillStyle = `hsl(${33 + r() * 6},${38 + r() * 10}%,${over ? l : l - 9}%)`;
        if (over) g.fillRect(x, y + 1, step, step - 2);
        else g.fillRect(x + 1, y, step - 2, step);
        bg.fillStyle = over ? '#d0d0d0' : '#606060';
        if (over) bg.fillRect(x, y + 2, step, step - 4);
        else bg.fillRect(x + 2, y, step - 4, step);
      }
    }
    // stencilled band
    g.fillStyle = 'rgba(120,30,25,0.55)';
    g.fillRect(0, S * 0.42, S, S * 0.05);
    g.fillStyle = 'rgba(30,60,120,0.55)';
    g.font = 'bold 54px sans-serif';
    g.fillText('GẠO 50kg', S * 0.2, S * 0.66);
    return { map: tex(c, [1, 1]), bump: tex(bc, [1, 1], false) };
  });
}

export function woodTexture() {
  return cached('wood', () => {
    const S = 512;
    const [c, g] = canvas(S);
    const r = rng(5);
    g.fillStyle = '#9b7a52';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const y = r() * S;
      g.strokeStyle = `rgba(${70 + r() * 40},${48 + r() * 30},${28 + r() * 20},${0.2 + r() * 0.3})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4);
      g.stroke();
    }
    return tex(c, [1, 1]);
  });
}
