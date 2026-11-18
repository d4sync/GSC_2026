# RuView Rodent RF Simulator

Interactive 3D simulator (Vite + React + TypeScript + three.js / R3F) showing how 2.4 / 5.8 / 6.5 GHz
WiFi interacts with a breathing rodent in a grain warehouse, and what an ESP32-S3 CSI link running a
RuView-style detection pipeline would see. **All output is SYNTHETIC** and is not hardware-validated.

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # tsc + vite build -> dist/
```

## How the physics is split

| Layer | Method | Scope / honest limits |
|---|---|---|
| Warehouse channel → CSI | Ray/image method: LOS, floor/ceiling/4-wall reflections, rack scatterers, bistatic rodent/human/fan scattering, Fresnel-zone forward shadowing, rack (PEC) + grain-sack (moisture-dependent) blockage | Single-bounce; RCS is a Rayleigh→geometric blend with a Mie ripple, not an exact Mie series |
| Near-body fields | GPU 2D FDTD (Yee, TMz/TEz, Courant 0.5, lossy update, Mur ABC) on a 0.3–0.5 m window that tracks the thorax; permittivity mask re-rasterised every frame from the same parametric anatomy that is rendered | 2D slice = body treated as infinitely tall, so shadowing is overstated vs 3D; at 5.8/6.5 GHz muscle is only ~3–4 cells/λ (HUD warns) |
| Exposure | Plane-wave transmission + penetration depth + Pennes steady state | Order-of-magnitude estimate |
| Detection | ESP32 impairments (CFO, SFO/STO, AWGN, drops, AGC steps) → AGC-compensated amplitude + linear-fit phase sanitisation → top-K subcarrier fusion → FFT band powers vs empty-room baseline | Thresholds are illustrative |

Source layout: `src/physics/` (models + DSP), `src/shaders/` (GLSL), `src/scene/` (3D), `src/components/hud/` (UI).

Debug URL switches for GPU troubleshooting: `?nofdtd`, `?nopost`, `?nowarehouse`, `?norodent`, `?nostep`, `?noread`, `?noraster`, `?nomesh`.
