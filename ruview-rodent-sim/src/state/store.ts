import { useSyncExternalStore } from 'react';
import type { BandId, Species } from '../physics/constants';
import type { FillLevel } from '../physics/layout';
import type { Polarization } from '../physics/csi';
import type { V3 } from '../physics/behavior';

export type Lang = 'vi' | 'en';
export type VisualMode = 'normal' | 'xray' | 'sar';
export type CameraPreset = 'overview' | 'macro' | 'los' | 'top';
export type ScenarioId = 'free' | 'macro' | 'stealth' | 'climb' | 'swarm' | 'falsepos' | 'nearfield';
export type NodeId = 'tx' | 'rx0' | 'rx1' | 'rx2';

export interface Settings {
  lang: Lang;
  scenario: ScenarioId;
  band: BandId;
  bw: 20 | 80;
  txPower: number;
  duty: 'idle' | 'flood';
  pol: Polarization;
  moisture: number;
  fill: FillLevel;
  species: Species;
  rodentCount: number;
  tx: V3;
  rx: [V3, V3, V3];
  rxEnabled: [boolean, boolean, boolean];
  showSlice: boolean;
  showFresnel: boolean;
  showRays: boolean;
  showHeatmap: boolean;
  showDust: boolean;
  visualMode: VisualMode;
  fieldView: 'total' | 'scattered';
  sliceAuto: boolean;
  sliceHeight: number;
  fdtdRes: 256 | 384;
  impair: { cfo: boolean; sfo: boolean; awgn: boolean; snr: number; drop: boolean; agc: boolean };
  interf: { human: boolean; fan: boolean; rain: boolean; cochannel: boolean };
  camera: CameraPreset;
  cameraNonce: number;
  paused: boolean;
  slowmo: boolean;
  hudOpen: boolean;
  selected: NodeId | null;
  baselineNonce: number;
  respawnNonce: number;
}

export const DEFAULTS: Settings = {
  lang: 'vi',
  scenario: 'free',
  band: '2.4',
  bw: 20,
  txPower: 15,
  duty: 'flood',
  pol: 'vertical',
  moisture: 14,
  fill: 'half',
  species: 'rat',
  rodentCount: 1,
  tx: [-3.6, 0.12, 0.0],
  rx: [
    [3.6, 0.12, 0.0],
    [0.1, 0.12, -2.85],
    [0.1, 0.12, 2.85],
  ],
  rxEnabled: [true, true, false],
  showSlice: true,
  showFresnel: true,
  showRays: true,
  showHeatmap: false,
  showDust: true,
  visualMode: 'normal',
  fieldView: 'total',
  sliceAuto: true,
  sliceHeight: 0.03,
  fdtdRes: 256,
  impair: { cfo: true, sfo: true, awgn: true, snr: 30, drop: true, agc: true },
  interf: { human: false, fan: false, rain: false, cochannel: false },
  camera: 'overview',
  cameraNonce: 0,
  paused: false,
  slowmo: false,
  hudOpen: true,
  selected: null,
  baselineNonce: 0,
  respawnNonce: 0,
};

let state: Settings = DEFAULTS;
const listeners = new Set<() => void>();

export const getSettings = () => state;

export function setSettings(p: Partial<Settings> | ((s: Settings) => Partial<Settings>)): void {
  const patch = typeof p === 'function' ? p(state) : p;
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings<T>(sel: (s: Settings) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(state),
    () => sel(state),
  );
}

/** One-click scenario presets. Rodent placement is handled by the engine on respawn. */
export function applyScenario(id: ScenarioId): void {
  const base: Partial<Settings> = {
    scenario: id,
    interf: { human: false, fan: false, rain: false, cochannel: false },
    paused: false,
    slowmo: false,
    sliceAuto: true,
  };
  let p: Partial<Settings> = {};
  switch (id) {
    case 'free':
      p = { species: 'rat', rodentCount: 1, visualMode: 'normal', camera: 'overview', fill: 'half' };
      break;
    case 'macro':
      p = {
        species: 'rat',
        rodentCount: 1,
        visualMode: 'xray',
        camera: 'macro',
        showSlice: true,
        fill: 'half',
        tx: [-0.6, 0.12, 0],
        rx: [[0.6, 0.12, 0], DEFAULTS.rx[1], DEFAULTS.rx[2]],
        rxEnabled: [true, false, false],
      };
      break;
    case 'stealth':
      p = {
        species: 'rat',
        rodentCount: 1,
        moisture: 22,
        fill: 'full',
        visualMode: 'normal',
        camera: 'overview',
        tx: DEFAULTS.tx,
        rx: DEFAULTS.rx,
        rxEnabled: [true, false, true],
      };
      break;
    case 'climb':
      p = {
        species: 'rat',
        rodentCount: 1,
        fill: 'half',
        visualMode: 'normal',
        camera: 'overview',
        tx: [-3.6, 0.12, -1.6],
        rx: [[3.6, 0.12, -1.6], [0.1, 1.65, -1.95], DEFAULTS.rx[2]],
        rxEnabled: [true, true, false],
      };
      break;
    case 'swarm':
      p = { species: 'mouse', rodentCount: 3, visualMode: 'normal', camera: 'overview', fill: 'half', tx: DEFAULTS.tx, rx: DEFAULTS.rx, rxEnabled: [true, true, true] };
      break;
    case 'falsepos':
      p = {
        species: 'mouse',
        rodentCount: 1,
        visualMode: 'normal',
        camera: 'overview',
        fill: 'half',
        tx: DEFAULTS.tx,
        rx: DEFAULTS.rx,
        rxEnabled: [true, true, false],
        interf: { human: true, fan: true, rain: true, cochannel: true },
      };
      break;
    case 'nearfield':
      p = {
        species: 'rat',
        rodentCount: 1,
        visualMode: 'sar',
        camera: 'macro',
        fill: 'half',
        tx: DEFAULTS.tx,
        rx: [[3.6, 0.0, 0.0], DEFAULTS.rx[1], DEFAULTS.rx[2]],
        rxEnabled: [true, false, false],
      };
      break;
  }
  setSettings((s) => ({ ...base, ...p, cameraNonce: s.cameraNonce + 1, respawnNonce: s.respawnNonce + 1, baselineNonce: s.baselineNonce + 1 }));
}
