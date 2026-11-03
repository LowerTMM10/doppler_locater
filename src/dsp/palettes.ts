import { PaletteName } from '../types';

export type RGB = [number, number, number];

export const PALETTES: Record<PaletteName, (val: number) => RGB> = {
  inferno: (val: number): RGB => {
    // val normalized 0..1
    const r = Math.min(255, Math.max(0, val * 3.0 * 255));
    const g = Math.min(255, Math.max(0, (val - 0.35) * 3.0 * 255));
    const b = Math.min(255, Math.max(0, (val - 0.7) * 3.5 * 255));
    return [Math.round(r), Math.round(g), Math.round(b)];
  },
  viridis: (val: number): RGB => {
    const r = Math.min(255, Math.max(0, (0.5 * Math.sin(val * Math.PI * 2 - 1.5) + 0.5) * 255));
    const g = Math.min(255, Math.max(0, val * 255));
    const b = Math.min(255, Math.max(0, Math.cos(val * Math.PI * 0.5) * 255));
    return [Math.round(r), Math.round(g), Math.round(b)];
  },
  plasma: (val: number): RGB => {
    const r = Math.min(255, Math.max(0, (Math.sin(val * Math.PI) * 0.9 + 0.1) * 255));
    const g = Math.min(255, Math.max(0, (val * val) * 255));
    const b = Math.min(255, Math.max(0, Math.cos(val * Math.PI * 0.5) * 255));
    return [Math.round(r), Math.round(g), Math.round(b)];
  },
  radar: (val: number): RGB => {
    return [0, Math.round(val * 255), Math.round(val * 120)];
  },
  grayscale: (val: number): RGB => {
    const v = Math.round(val * 255);
    return [v, v, v];
  },
};
