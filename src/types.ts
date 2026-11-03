export interface DopplerPoint {
  t: number;
  f: number;
}

export interface RidgePoint {
  t: number;
  f: number;
  s: number;
}

export interface FittedParams {
  f0: number;
  v: number;
  dmin: number;
  t0: number;
  sse?: number;
  score?: number;
  points?: number;
}

export interface CleanupSettings {
  bandpass: boolean;
  lowHz: number;
  highHz: number;
  noiseSub: boolean;
  noiseSeconds: number;
  noiseStrength: number;
  gate: number;
  histEq: boolean;
  liveAuto: boolean;
}

export interface SpectrogramView {
  t0: number;
  t1: number;
  f0: number;
  f1: number;
}

export type PaletteName = 'inferno' | 'viridis' | 'plasma' | 'radar' | 'grayscale';

export interface ToolItem {
  id: string;
  name: string;
  tag: string;
  description: string;
  icon: string;
  color: 'cyan' | 'emerald' | 'violet' | 'rose';
  status: 'live' | 'soon';
}
