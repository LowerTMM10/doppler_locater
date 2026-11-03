import { DopplerPoint, FittedParams, RidgePoint, CleanupSettings, SpectrogramView } from '../types';

export const SPEED_OF_SOUND = 343.0; // m/s in air

export function dopplerShape(t: number, v: number, d: number, t0: number): number {
  const dt = t - t0;
  return 1 - (v / SPEED_OF_SOUND) * ((v * dt) / Math.sqrt(d * d + v * v * dt * dt));
}

export function evalFit(
  pts: DopplerPoint[],
  v: number,
  d: number,
  t0: number
): { f0: number; v: number; dmin: number; t0: number; sse: number } {
  let num = 0;
  let den = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const g = dopplerShape(p.t, v, d, t0);
    num += p.f * g;
    den += g * g;
  }
  const f0 = den > 0 ? num / den : 0;
  let sse = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const e = f0 * dopplerShape(p.t, v, d, t0) - p.f;
    sse += e * e;
  }
  return { f0, v, dmin: d, t0, sse };
}

/**
 * High precision Doppler curve fitting for landmark points
 * Coarse search across speed, log distance, and CPA time, followed by Nelder-Mead simplex
 */
export function fitDopplerPoints(pts: DopplerPoint[]): FittedParams | null {
  if (pts.length < 3) return null;
  const tStart = pts[0].t;
  const tEnd = pts[pts.length - 1].t;
  const span = Math.max(0.5, tEnd - tStart);

  let best: { f0: number; v: number; dmin: number; t0: number; sse: number } | null = null;

  for (let v = 15; v <= 350; v += 10) {
    for (let k = 0; k < 30; k++) {
      const d = 20 * Math.pow(8000 / 20, k / 29);
      for (let j = 0; j <= 40; j++) {
        const t0 = tStart - span * 0.3 + (span * 1.6 * j) / 40;
        const r = evalFit(pts, v, d, t0);
        if (!best || r.sse < best.sse) {
          best = r;
        }
      }
    }
  }

  if (!best) return null;

  // Nelder-Mead Simplex on (v, log d, t0)
  const cost = (x: number[]) => {
    const v = x[0];
    const d = Math.exp(x[1]);
    if (v < 3 || v > 400 || d < 5 || d > 20000) return Infinity;
    return evalFit(pts, v, d, x[2]).sse;
  };

  let simplex: number[][] = [[best.v, Math.log(best.dmin), best.t0]];
  const steps = [5, 0.2, span * 0.03];
  for (let i = 0; i < 3; i++) {
    const x = simplex[0].slice();
    x[i] += steps[i];
    simplex.push(x);
  }

  let vals = simplex.map(cost);

  for (let it = 0; it < 400; it++) {
    const indices = [0, 1, 2, 3].sort((a, b) => vals[a] - vals[b]);
    simplex = indices.map((i) => simplex[i]);
    vals = indices.map((i) => vals[i]);

    const c = [0, 1, 2].map(
      (i) => (simplex[0][i] + simplex[1][i] + simplex[2][i]) / 3
    );
    const pt = (t: number) => c.map((ci, i) => ci + t * (simplex[3][i] - ci));

    const xr = pt(-1);
    const fr = cost(xr);

    if (fr < vals[0]) {
      const xe = pt(-2);
      const fe = cost(xe);
      if (fe < fr) {
        simplex[3] = xe;
        vals[3] = fe;
      } else {
        simplex[3] = xr;
        vals[3] = fr;
      }
    } else if (fr < vals[2]) {
      simplex[3] = xr;
      vals[3] = fr;
    } else {
      const xc = pt(0.5);
      const fc = cost(xc);
      if (fc < vals[3]) {
        simplex[3] = xc;
        vals[3] = fc;
      } else {
        for (let i = 1; i < 4; i++) {
          simplex[i] = simplex[i].map((x, k) => simplex[0][k] + 0.5 * (x - simplex[0][k]));
          vals[i] = cost(simplex[i]);
        }
      }
    }
  }

  const x = simplex[0];
  const r = evalFit(pts, x[0], Math.exp(x[1]), x[2]);
  return r.sse <= best.sse ? r : best;
}

export function computeNoiseProfile(
  spectrogramData: Float32Array[],
  spectrogramTimes: number[],
  duration: number,
  isMicActive: boolean,
  noiseSeconds: number
): Float32Array | null {
  if (!spectrogramData.length) return null;
  const n = spectrogramData.length;

  let nFrames: number;
  if (isMicActive) {
    nFrames = Math.round(noiseSeconds * 60);
    if (n < nFrames) return null;
  } else {
    nFrames = 0;
    while (
      nFrames < n &&
      (spectrogramTimes.length === n
        ? spectrogramTimes[nFrames]
        : (nFrames / Math.max(1, n)) * duration) < noiseSeconds
    ) {
      nFrames++;
    }
    nFrames = Math.max(1, nFrames);
  }

  const bins = spectrogramData[0].length;
  const prof = new Float32Array(bins);
  for (let f = 0; f < nFrames; f++) {
    const s = spectrogramData[f];
    for (let i = 0; i < bins; i++) {
      prof[i] += s[i];
    }
  }
  for (let i = 0; i < bins; i++) {
    prof[i] /= nFrames;
  }
  return prof;
}

export function cleanMagnitude(
  spectrum: Float32Array,
  binIdx: number,
  binHz: number,
  cleanup: CleanupSettings,
  prof: Float32Array | null
): number {
  const hz = binIdx * binHz;
  if (cleanup.bandpass && (hz < cleanup.lowHz || hz > cleanup.highHz)) {
    return 0;
  }
  let m = spectrum[binIdx] || 0;
  if (cleanup.noiseSub && prof) {
    m = Math.max(0, m - prof[binIdx] * cleanup.noiseStrength);
  }
  return m;
}

export function detectRidge(
  spectrogramData: Float32Array[],
  spectrogramTimes: number[],
  duration: number,
  sampleRate: number,
  isMicActive: boolean,
  view: SpectrogramView,
  cleanup: CleanupSettings,
  prof: Float32Array | null
): RidgePoint[] {
  if (!spectrogramData.length) return [];
  const bins = spectrogramData[0].length;
  const nyquist = sampleRate / 2;
  const binHz = nyquist / bins;

  const lo = Math.max(1, Math.floor(Math.max(view.f0, cleanup.bandpass ? cleanup.lowHz : 50) / binHz));
  const hi = Math.min(bins - 2, Math.ceil(Math.min(view.f1, cleanup.bandpass ? cleanup.highHz : nyquist) / binHz));

  const timeToFrame = (t: number) => {
    const n = spectrogramData.length;
    if (!isMicActive && spectrogramTimes && spectrogramTimes.length === n && n > 1) {
      const hop = spectrogramTimes[1] - spectrogramTimes[0];
      return Math.round((t - spectrogramTimes[0]) / hop);
    }
    return Math.floor((t / (duration || 1)) * n);
  };

  const frameTime = (idx: number) => {
    const n = spectrogramData.length;
    if (!isMicActive && spectrogramTimes && spectrogramTimes.length === n) {
      return spectrogramTimes[idx];
    }
    return (idx / Math.max(1, n)) * duration;
  };

  const fStart = Math.max(0, timeToFrame(view.t0));
  const fEnd = Math.min(spectrogramData.length, timeToFrame(view.t1) + 1);
  if (hi <= lo + 2) return [];

  const raw: RidgePoint[] = [];
  const step = Math.max(1, Math.floor((fEnd - fStart) / 600));
  const band = new Float32Array(hi - lo + 1);

  for (let f = fStart; f < fEnd; f += step) {
    const s = spectrogramData[f];
    if (!s) continue;
    let best = -1;
    let bestV = 0;
    for (let i = lo; i <= hi; i++) {
      const v = cleanMagnitude(s, i, binHz, cleanup, prof);
      band[i - lo] = v;
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    }
    if (best < 0 || bestV <= 0) continue;

    // Prominence against band median
    const sorted = Array.from(band).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] + 1e-9;
    if (bestV / median < 4) continue;

    // Parabolic interpolation for sub-bin frequency
    const a = cleanMagnitude(s, best - 1, binHz, cleanup, prof);
    const c = cleanMagnitude(s, best + 1, binHz, cleanup, prof);
    const denom = a - 2 * bestV + c;
    const off = denom !== 0 ? (0.5 * (a - c)) / denom : 0;

    raw.push({
      t: frameTime(f),
      f: (best + off) * binHz,
      s: bestV / median,
    });
  }

  // Continuity filter
  const ridge: RidgePoint[] = [];
  const K = 4;
  for (let i = 0; i < raw.length; i++) {
    const neigh: number[] = [];
    for (let j = Math.max(0, i - K); j <= Math.min(raw.length - 1, i + K); j++) {
      if (j !== i) neigh.push(raw[j].f);
    }
    if (neigh.length < 2) continue;
    neigh.sort((a, b) => a - b);
    const med = neigh[Math.floor(neigh.length / 2)];
    if (Math.abs(raw[i].f - med) < Math.max(25, med * 0.03)) {
      ridge.push(raw[i]);
    }
  }

  // Link points into continuous tracks
  const tracks: RidgePoint[][] = [];
  for (const p of ridge) {
    let bestTrack: RidgePoint[] | null = null;
    let bestD = Infinity;
    for (const tr of tracks) {
      const last = tr[tr.length - 1];
      const gap = p.t - last.t;
      const df = Math.abs(p.f - last.f);
      if (gap <= 1.0 && df < Math.max(40, last.f * 0.05) && df < bestD) {
        bestD = df;
        bestTrack = tr;
      }
    }
    if (bestTrack) {
      bestTrack.push(p);
    } else {
      tracks.push([p]);
    }
  }

  let longest: RidgePoint[] = [];
  for (const tr of tracks) {
    const dur = tr[tr.length - 1].t - tr[0].t;
    if (tr.length > longest.length && dur > 0.5) {
      longest = tr;
    }
  }
  return longest;
}

export function fitRidge(points: RidgePoint[]): FittedParams | null {
  if (points.length < 8) return null;
  let pts: DopplerPoint[] = points;
  if (pts.length > 120) {
    const k = pts.length / 120;
    pts = Array.from({ length: 120 }, (_, i) => points[Math.floor(i * k)]);
  }

  const tStart = pts[0].t;
  const tEnd = pts[pts.length - 1].t;
  let best = fitDopplerPoints(pts);
  if (!best) return null;

  // Robust step: drop outliers (> 3x median residual) and refine
  const res = pts.map((p) => Math.abs(best!.f0 * dopplerShape(p.t, best!.v, best!.dmin, best!.t0) - p.f));
  const mad = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] || 1;
  const kept = pts.filter((_, i) => res[i] <= Math.max(5, 3 * mad));
  if (kept.length >= 8 && kept.length < pts.length) {
    pts = kept;
    const refined = fitDopplerPoints(pts);
    if (refined) best = refined;
  }

  const mean = pts.reduce((a, p) => a + p.f, 0) / pts.length;
  const sst = pts.reduce((a, p) => a + (p.f - mean) ** 2, 0) || 1;
  const r2 = Math.max(0, 1 - (best.sse || 0) / sst);
  const spread = (best.f0 * 2 * best.v) / SPEED_OF_SOUND;
  const cpaInside = best.t0 > tStart && best.t0 < tEnd;

  const score = spread > 10 && cpaInside ? r2 : r2 * 0.5;
  return {
    ...best,
    score,
    points: pts.length,
  };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.0';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m.toString().padStart(2, '0')}:${s.padStart(4, '0')}`;
}

export function niceStep(raw: number, steps: number[]): number {
  for (const st of steps) {
    if (st >= raw) return st;
  }
  return steps[steps.length - 1];
}
