import { useMemo } from 'react';
import * as THREE from 'three';

/** Screen-facing text label rendered from a canvas texture (no DOM portals). */
export function Label({ text, position, color = '#e6faff', border = '#38e1ff', dim = false, scale = 0.032 }: { text: string; position: [number, number, number]; color?: string; border?: string; dim?: boolean; scale?: number }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(0,30,45,0.78)';
    g.strokeStyle = border;
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(3, 3, 122, 42, 9);
    g.fill();
    g.stroke();
    g.fillStyle = color;
    g.font = 'bold 26px ui-monospace, Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 25);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [text, color, border]);
  return (
    <sprite position={position} scale={[scale * 2.67, scale, 1]} renderOrder={20}>
      <spriteMaterial map={tex} sizeAttenuation={false} transparent opacity={dim ? 0.45 : 1} depthTest={false} depthWrite={false} toneMapped={false} />
    </sprite>
  );
}
