import type { DopplerPoint, DopplerWave, SearchArea } from '../types';
import { dopplerShape } from './fitting';

export interface TimedFlight {
  hex: string;
  callsign: string;
  points: { t: number; lat: number; lon: number; altFt: number; gsKt: number }[];
}

export interface MultiWaveSettings {
  grid: number; // cells per side
  clockToleranceSec: number; // how wrong the recording clock may be (±)
  sigmaRel: number; // relative frequency tolerance, e.g. 0.004 = 0.4 %
  maxRangeM: number; // a plane further than this at the wave time can't be the source
  soundSpeed: number;
}

export interface WaveMatch {
  waveId: string;
  hex: string;
  callsign: string;
  score: number;
  f0: number;
  rmsRel: number;
  closestM: number;
  predicted: DopplerPoint[];
}

export interface MultiWaveResult {
  scores: Float32Array; // combined 0..1, row-major, row 0 = south
  cols: number;
  rows: number;
  area: SearchArea;
  best: { lat: number; lon: number; score: number; clockOffset: number; matches: WaveMatch[] } | null;
  top: { lat: number; lon: number; score: number }[];
  flightsUsed: number;
  ms: number;
}

const R = 6371000;
const deg = Math.PI / 180;

/** Measured samples of a wave in recording seconds. */
export function waveSamples(w: DopplerWave): DopplerPoint[] {
  if (w.points.length >= 4) return w.points;
  const { f0, v, dmin, t0 } = w.fit;
  const half = Math.min(20, Math.max(3, (3 * dmin) / Math.max(10, v)));
  const out: DopplerPoint[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = t0 - half + (2 * half * i) / 20;
    out.push({ t, f: f0 * dopplerShape(t, v, dmin, t0) });
  }
  return out;
}

interface Track {
  hex: string;
  callsign: string;
  t0: number; // unix second of index 0
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
}

function buildTrack(f: TimedFlight, cLat: number, cLon: number): Track | null {
  const p = f.points;
  if (p.length < 2) return null;
  const t0 = Math.floor(p[0].t);
  const n = Math.floor(p[p.length - 1].t) - t0 + 1;
  if (n < 2 || n > 20000) return null;
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n);
  const cos = Math.cos(cLat * deg);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i;
    while (k < p.length - 2 && p[k + 1].t < t) k++;
    const a = p[k], b = p[k + 1];
    const al = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-3, b.t - a.t)));
    const lat = a.lat + (b.lat - a.lat) * al;
    const lon = a.lon + (b.lon - a.lon) * al;
    x[i] = (lon - cLon) * deg * R * cos;
    y[i] = (lat - cLat) * deg * R;
    z[i] = (a.altFt + (b.altFt - a.altFt) * al) * 0.3048;
  }
  return { hex: f.hex, callsign: f.callsign, t0, n, x, y, z };
}

/** Predicted Doppler factor (f_obs / f0) heard at (ox, oy) at unix time tObs. */
function factorAt(tr: Track, ox: number, oy: number, tObs: number, c: number): number {
  let te = tObs;
  for (let it = 0; it < 3; it++) {
    const s = Math.max(0, Math.min(tr.n - 1.001, te - tr.t0));
    const i = Math.floor(s), a = s - i;
    const px = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * a;
    const py = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * a;
    const pz = tr.z[i] + (tr.z[i + 1] - tr.z[i]) * a;
    te = tObs - Math.hypot(px - ox, py - oy, pz) / c;
  }
  const s = te - tr.t0;
  if (s < 0 || s > tr.n - 1.001) return NaN;
  const i = Math.floor(s), a = s - i;
  const px = tr.x[i] + (tr.x[i + 1] - tr.x[i]) * a;
  const py = tr.y[i] + (tr.y[i + 1] - tr.y[i]) * a;
  const pz = tr.z[i] + (tr.z[i + 1] - tr.z[i]) * a;
  const vx = tr.x[i + 1] - tr.x[i], vy = tr.y[i + 1] - tr.y[i], vz = tr.z[i + 1] - tr.z[i];
  const dx = ox - px, dy = oy - py, dz = -pz;
  const r = Math.hypot(dx, dy, dz) || 1;
  const vr = (vx * dx + vy * dy + vz * dz) / r; // speed towards observer
  return c / (c - Math.min(c * 0.9, vr));
}

function posAt(tr: Track, t: number): [number, number] | null {
  const s = t - tr.t0;
  if (s < 0 || s > tr.n - 1) return null;
  const i = Math.min(tr.n - 1, Math.round(s));
  return [tr.x[i], tr.y[i]];
}

function evalWave(
  tr: Track, ox: number, oy: number, samples: DopplerPoint[], absStart: number, c: number,
): { f0: number; rms: number } | null {
  const g = new Float64Array(samples.length);
  let num = 0, den = 0;
  for (let k = 0; k < samples.length; k++) {
    const v = factorAt(tr, ox, oy, absStart + samples[k].t, c);
    if (!Number.isFinite(v)) return null;
    g[k] = v;
    num += samples[k].f * v;
    den += v * v;
  }
  const f0 = num / den;
  let se = 0;
  for (let k = 0; k < samples.length; k++) {
    const e = samples[k].f - f0 * g[k];
    se += e * e;
  }
  return { f0, rms: Math.sqrt(se / samples.length) / f0 };
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Finds where on the ground every wave is explained at once by a real aircraft
 * passing at that moment. No distance guess needed: the curve shape fixes it.
 */
export async function runMultiWaveSearch(
  waves: DopplerWave[],
  recStartUnix: number,
  flights: TimedFlight[],
  area: SearchArea,
  st: MultiWaveSettings,
  onProgress?: (p: number) => void,
): Promise<MultiWaveResult> {
  const t = performance.now();
  const cLat = (area.minLat + area.maxLat) / 2, cLon = (area.minLon + area.maxLon) / 2;
  const cos = Math.cos(cLat * deg);
  const minX = (area.minLon - cLon) * deg * R * cos, maxX = (area.maxLon - cLon) * deg * R * cos;
  const minY = (area.minLat - cLat) * deg * R, maxY = (area.maxLat - cLat) * deg * R;
  const cols = st.grid, rows = st.grid;
  const tracks = flights.map((f) => buildTrack(f, cLat, cLon)).filter((x): x is Track => !!x);
  const samples = waves.map(waveSamples);
  const offsets: number[] = [];
  for (let o = -st.clockToleranceSec; o <= st.clockToleranceSec + 1e-9; o += 1) offsets.push(o);

  // Per wave: flights that exist around the wave window.
  const cand = waves.map((w, wi) => {
    const s = samples[wi];
    const a = recStartUnix + s[0].t - st.clockToleranceSec - 60;
    const b = recStartUnix + s[s.length - 1].t + st.clockToleranceSec;
    return tracks.filter((tr) => tr.t0 < b && tr.t0 + tr.n > a);
  });

  const scores = new Float32Array(cols * rows);
  const inv = 1 / (2 * st.sigmaRel * st.sigmaRel);
  const range2 = st.maxRangeM * st.maxRangeM;
  let bestIdx = -1, bestScore = 0, bestOff = 0;

  const cellScore = (ox: number, oy: number) => {
    let best = 0, bOff = 0;
    for (const off of offsets) {
      let logSum = 0;
      let ok = true;
      for (let wi = 0; wi < waves.length && ok; wi++) {
        const s = samples[wi];
        const tc = recStartUnix + waves[wi].fit.t0 + off;
        let wb = 0;
        for (const tr of cand[wi]) {
          const p = posAt(tr, tc - 3);
          if (!p) continue;
          const dx = p[0] - ox, dy = p[1] - oy;
          if (dx * dx + dy * dy > range2) continue;
          const r = evalWave(tr, ox, oy, s, recStartUnix + off, st.soundSpeed);
          if (!r) continue;
          const sc = Math.exp(-r.rms * r.rms * inv);
          if (sc > wb) wb = sc;
        }
        if (wb < 1e-6) ok = false;
        else logSum += Math.log(wb);
      }
      if (!ok) continue;
      const sc = Math.exp(logSum / waves.length);
      if (sc > best) { best = sc; bOff = off; }
    }
    return [best, bOff] as const;
  };

  for (let r = 0; r < rows; r++) {
    const oy = minY + ((maxY - minY) * r) / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const ox = minX + ((maxX - minX) * c) / (cols - 1);
      const [sc, off] = cellScore(ox, oy);
      scores[r * cols + c] = sc;
      if (sc > bestScore) { bestScore = sc; bestIdx = r * cols + c; bestOff = off; }
    }
    if (r % 4 === 0) { onProgress?.(r / rows); await yieldUI(); }
  }

  const toLatLon = (idx: number) => {
    const r = Math.floor(idx / cols), c = idx % cols;
    const ox = minX + ((maxX - minX) * c) / (cols - 1);
    const oy = minY + ((maxY - minY) * r) / (rows - 1);
    return { ox, oy, lat: cLat + oy / R / deg, lon: cLon + ox / (R * cos) / deg };
  };

  let best: MultiWaveResult['best'] = null;
  if (bestIdx >= 0) {
    const { ox, oy, lat, lon } = toLatLon(bestIdx);
    const matches: WaveMatch[] = waves.map((w, wi) => {
      let m: WaveMatch = { waveId: w.id, hex: '', callsign: '—', score: 0, f0: 0, rmsRel: 1, closestM: 0, predicted: [] };
      for (const tr of cand[wi]) {
        const res = evalWave(tr, ox, oy, samples[wi], recStartUnix + bestOff, st.soundSpeed);
        if (!res) continue;
        const sc = Math.exp(-res.rms * res.rms * inv);
        if (sc > m.score) {
          let closest = Infinity;
          for (let i = 0; i < tr.n; i++) closest = Math.min(closest, Math.hypot(tr.x[i] - ox, tr.y[i] - oy, tr.z[i]));
          const s = samples[wi];
          const predicted: DopplerPoint[] = [];
          for (let k = 0; k <= 40; k++) {
            const tt = s[0].t + ((s[s.length - 1].t - s[0].t) * k) / 40;
            predicted.push({ t: tt, f: res.f0 * factorAt(tr, ox, oy, recStartUnix + bestOff + tt, st.soundSpeed) });
          }
          m = { waveId: w.id, hex: tr.hex, callsign: tr.callsign, score: sc, f0: res.f0, rmsRel: res.rms, closestM: closest, predicted };
        }
      }
      return m;
    });
    best = { lat, lon, score: bestScore, clockOffset: bestOff, matches };
  }

  const order = Array.from(scores.keys()).sort((a, b) => scores[b] - scores[a]).slice(0, 5);
  const top = order.filter((i) => scores[i] > 0).map((i) => ({ ...toLatLon(i), score: scores[i] }));

  onProgress?.(1);
  return { scores, cols, rows, area, best, top, flightsUsed: new Set(cand.flat()).size, ms: performance.now() - t };
}

/** Demo: two real-looking flights and the waves a hidden listener would have recorded. */
export function buildDemoScenario(): {
  flights: TimedFlight[]; waves: DopplerWave[]; recStartUnix: number; area: SearchArea; truth: { lat: number; lon: number };
} {
  const recStartUnix = Math.floor(Date.UTC(2026, 10, 3, 14, 32, 0) / 1000);
  const truth = { lat: 52.3105, lon: 4.9412 };
  const mk = (hex: string, cs: string, lat0: number, lon0: number, trk: number, gsKt: number, altFt: number, tStart: number): TimedFlight => {
    const pts = [];
    const v = gsKt * 0.514444;
    for (let s = 0; s <= 240; s += 10) {
      const d = v * s;
      pts.push({
        t: tStart + s,
        lat: lat0 + (d * Math.cos(trk * deg)) / R / deg,
        lon: lon0 + (d * Math.sin(trk * deg)) / (R * Math.cos(lat0 * deg)) / deg,
        altFt, gsKt,
      });
    }
    return { hex, callsign: cs, points: pts };
  };
  const flights = [
    mk('484c5a', 'KLM1735', 52.27, 4.80, 70, 165, 1500, recStartUnix - 60),
    mk('4ca7b3', 'RYR82QT', 52.38, 4.86, 160, 210, 2500, recStartUnix - 30),
    mk('3c6dd3', 'DLH9XK', 52.24, 5.05, 300, 240, 3000, recStartUnix - 90),
    mk('406b21', 'EZY73MN', 52.40, 5.10, 220, 200, 4000, recStartUnix + 20),
  ];
  const cLat = truth.lat, cLon = truth.lon;
  const area: SearchArea = { minLat: 52.25, maxLat: 52.37, minLon: 4.83, maxLon: 5.05 };
  const tracks = flights.map((f) => buildTrack(f, cLat, cLon)!);
  const synth = (tr: Track, f0: number, tFrom: number, tTo: number, id: string, label: string, color: string): DopplerWave => {
    const points: DopplerPoint[] = [];
    for (let t = tFrom; t <= tTo; t += 1) points.push({ t, f: f0 * factorAt(tr, 0, 0, recStartUnix + t, 343) * (1 + (Math.random() - 0.5) * 0.002) });
    // centre time = steepest change
    let tMid = tFrom, maxD = 0;
    for (let i = 1; i < points.length; i++) { const d = points[i - 1].f - points[i].f; if (d > maxD) { maxD = d; tMid = points[i].t; } }
    return { id, label, color, points, fit: { f0, v: 80, dmin: 500, t0: tMid } };
  };
  const waves = [
    synth(tracks[0], 820, 30, 75, 'demo1', 'Wave 1', '#f59e0b'),
    synth(tracks[1], 640, 55, 100, 'demo2', 'Wave 2', '#ec4899'),
  ];
  return { flights, waves, recStartUnix, area, truth };
}
