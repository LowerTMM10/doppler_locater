import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, AudioWaveform, Crosshair, Loader2, MapPin, Plane, Play, Copy, Check, FlaskConical } from 'lucide-react';
import type { DopplerWave, SearchArea } from '../types';
import { fetchHistoricalFlights } from '@/lib/flights.functions';
import {
  buildDemoScenario,
  runMultiWaveSearch,
  waveSamples,
  type MultiWaveResult,
  type TimedFlight,
} from '../dsp/multiWave';

interface Props {
  onBackToDirectory: () => void;
  onBackToSpectrogram: () => void;
  waves: DopplerWave[];
}

const pad = (n: number) => String(n).padStart(2, '0');
function toInputs(unix: number) {
  const d = new Date(unix * 1000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}
function fromInputs(date: string, time: string, tzOffsetMin: number) {
  const ms = Date.parse(`${date}T${time.length === 5 ? time + ':00' : time}Z`);
  return Math.floor(ms / 1000) - tzOffsetMin * 60;
}
function heatColor(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [
    [0, 20, 10, 60], [0.35, 120, 20, 140], [0.6, 230, 60, 60], [0.8, 250, 170, 30], [1, 255, 255, 200],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i];
      const k = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [255, 255, 200];
}
const areaKm = (a: SearchArea) => {
  const lat = (a.minLat + a.maxLat) / 2;
  return {
    w: (a.maxLon - a.minLon) * 111.32 * Math.cos((lat * Math.PI) / 180),
    h: (a.maxLat - a.minLat) * 110.57,
  };
};

export const MultiWaveLocator: React.FC<Props> = ({ onBackToDirectory, onBackToSpectrogram, waves: incoming }) => {
  const fetchFlights = useServerFn(fetchHistoricalFlights);
  const [waves, setWaves] = useState<DopplerWave[]>(incoming);
  const initial = toInputs(Math.floor(Date.now() / 1000) - 3600);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [tz, setTz] = useState<number>(() => -new Date().getTimezoneOffset());
  const [clockTol, setClockTol] = useState(5);
  const [sigmaPct, setSigmaPct] = useState(0.5);
  const [grid, setGrid] = useState(90);
  const [area, setArea] = useState<SearchArea>({ minLat: 52.25, maxLat: 52.37, minLon: 4.83, maxLon: 5.05 });
  const [flights, setFlights] = useState<TimedFlight[]>([]);
  const [flightMsg, setFlightMsg] = useState('');
  const [loadingFlights, setLoadingFlights] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MultiWaveResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [truth, setTruth] = useState<{ lat: number; lon: number } | null>(null);

  const recStart = fromInputs(date, time, tz);
  const sortedWaves = useMemo(() => [...waves].sort((a, b) => a.fit.t0 - b.fit.t0), [waves]);

  const mapDiv = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ area?: L.Rectangle; flights?: L.LayerGroup; heat?: L.ImageOverlay; marks?: L.LayerGroup }>({});

  useEffect(() => setWaves(incoming), [incoming]);

  useEffect(() => {
    if (!mapDiv.current || map.current) return;
    const m = L.map(mapDiv.current, { center: [52.31, 4.94], zoom: 11 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      className: 'map-tiles-dark',
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(m);
    layers.current.flights = L.layerGroup().addTo(m);
    layers.current.marks = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Search area rectangle
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layers.current.area?.remove();
    layers.current.area = L.rectangle(
      [[area.minLat, area.minLon], [area.maxLat, area.maxLon]],
      { color: '#00f2fe', weight: 1.5, fill: false, dashArray: '6 4' },
    ).addTo(m);
  }, [area]);

  // Flight tracks
  useEffect(() => {
    const g = layers.current.flights;
    if (!g) return;
    g.clearLayers();
    const best = new Set(result?.best?.matches.map((x) => x.hex));
    flights.forEach((f) => {
      const hit = best.has(f.hex);
      L.polyline(f.points.map((p) => [p.lat, p.lon] as [number, number]), {
        color: hit ? '#f59e0b' : '#94a3b8',
        weight: hit ? 3 : 1.5,
        opacity: hit ? 0.95 : 0.7,
      })
        .bindTooltip(`${f.callsign} (${f.hex})`)
        .addTo(g);
    });
  }, [flights, result]);

  // Heatmap + markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layers.current.heat?.remove();
    layers.current.marks?.clearLayers();
    if (truth) {
      L.circleMarker([truth.lat, truth.lon], { radius: 6, color: '#22c55e', weight: 2, fill: false })
        .bindTooltip('Demo: true recording spot')
        .addTo(layers.current.marks!);
    }
    if (!result) return;
    const { cols, rows, scores, area: a } = result;
    let max = 0;
    for (let i = 0; i < scores.length; i++) max = Math.max(max, scores[i]);
    const cv = document.createElement('canvas');
    cv.width = cols;
    cv.height = rows;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const s = scores[r * cols + c];
        const v = max > 0 && s > 0 ? Math.max(0, 1 + Math.log10(s / max) / 5) : 0;
        const o = ((rows - 1 - r) * cols + c) * 4;
        const [R, G, B] = heatColor(v);
        img.data[o] = R;
        img.data[o + 1] = G;
        img.data[o + 2] = B;
        img.data[o + 3] = v < 0.02 ? 0 : Math.round(60 + 170 * Math.pow(v, 0.6));
      }
    }
    ctx.putImageData(img, 0, 0);
    layers.current.heat = L.imageOverlay(cv.toDataURL(), [[a.minLat, a.minLon], [a.maxLat, a.maxLon]], {
      opacity: 0.85,
      className: 'heat-smooth',
    }).addTo(m);
    result.top.slice(1).forEach((t) =>
      L.circleMarker([t.lat, t.lon], { radius: 4, color: '#fbbf24', weight: 1 }).addTo(layers.current.marks!),
    );
    if (result.best) {
      L.marker([result.best.lat, result.best.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:22px;height:22px;border-radius:9999px;border:3px solid #00f2fe;box-shadow:0 0 14px #00f2fe;background:rgba(0,242,254,.15)"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      })
        .bindTooltip(`Best spot · ${(result.best.score * 100).toFixed(0)}%`)
        .addTo(layers.current.marks!);
    }
  }, [result, truth]);

  const useMapView = () => {
    const b = map.current?.getBounds();
    if (!b) return;
    setArea({ minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() });
    setResult(null);
  };

  const loadFlights = async () => {
    setError('');
    if (!sortedWaves.length) return setError('Save at least one Doppler wave in AeroDoppler first.');
    const s0 = waveSamples(sortedWaves[0]);
    const sl = waveSamples(sortedWaves[sortedWaves.length - 1]);
    const pad = 0.12;
    setLoadingFlights(true);
    setFlightMsg('Downloading flight history from adsb.lol… (can take ~10–20 s)');
    try {
      const res = await fetchFlights({
        data: {
          startUnix: recStart + s0[0].t - clockTol - 180,
          endUnix: recStart + sl[sl.length - 1].t + clockTol + 120,
          minLat: area.minLat - pad,
          maxLat: area.maxLat + pad,
          minLon: area.minLon - pad * 1.6,
          maxLon: area.maxLon + pad * 1.6,
        },
      });
      setFlights(res.flights);
      setResult(null);
      setTruth(null);
      setFlightMsg(
        res.flights.length
          ? `${res.flights.length} aircraft found · ${res.source}`
          : `No aircraft found in this area/time (${res.source}). Check the date, time and time zone.`,
      );
    } catch (e) {
      setFlightMsg('');
      setError(`Couldn't load flights: ${(e as Error).message}`);
    } finally {
      setLoadingFlights(false);
    }
  };

  const run = async () => {
    setError('');
    if (!sortedWaves.length) return setError('No waves to locate.');
    if (!flights.length) return setError('Load flights first.');
    setRunning(true);
    setProgress(0);
    try {
      const res = await runMultiWaveSearch(
        sortedWaves,
        recStart,
        flights,
        area,
        { grid, clockToleranceSec: clockTol, sigmaRel: sigmaPct / 100, maxRangeM: 12000, soundSpeed: 343 },
        setProgress,
      );
      setResult(res);
      if (!res.best) setError('No spot where a plane explains every wave. Try a larger clock tolerance, area or tolerance %.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const loadDemo = () => {
    const d = buildDemoScenario();
    setWaves(d.waves);
    setFlights(d.flights);
    setArea(d.area);
    setTz(0);
    const i = toInputs(d.recStartUnix);
    setDate(i.date);
    setTime(i.time);
    setTruth(d.truth);
    setResult(null);
    setFlightMsg(`Demo: ${d.flights.length} simulated aircraft, hidden listener (green ring).`);
    map.current?.fitBounds([[d.area.minLat, d.area.minLon], [d.area.maxLat, d.area.maxLon]]);
  };

  const km = areaKm(area);
  const input = 'bg-slate-950 border border-slate-700 rounded-md px-2 py-1 text-xs font-mono text-slate-200 w-full';
  const label = 'text-[10px] uppercase tracking-wider text-slate-400';

  return (
    <div className="h-screen w-screen flex flex-col bg-darkbg text-slate-200 overflow-hidden">
      <header className="h-12 shrink-0 border-b border-slate-800 bg-panelbg flex items-center gap-3 px-4">
        <button onClick={onBackToDirectory} className="text-slate-400 hover:text-slate-200 cursor-pointer"><ArrowLeft className="w-4 h-4" /></button>
        <Crosshair className="w-4 h-4 text-accentgreen" />
        <h1 className="font-semibold text-sm">Doppler Flight Locator</h1>
        <span className="text-[10px] font-mono text-slate-500 border border-slate-700 rounded px-1.5">MULTI-WAVE</span>
        <button onClick={onBackToSpectrogram} className="ml-auto text-xs flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 cursor-pointer">
          <AudioWaveform className="w-3.5 h-3.5" /> Back to AeroDoppler
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-[360px] shrink-0 border-r border-slate-800 bg-panelbg/60 overflow-y-auto p-3 space-y-3">
          {/* Waves */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className={label}>1 · Doppler waves ({sortedWaves.length})</h3>
              <button onClick={loadDemo} className="text-[10px] text-violet-300 hover:text-violet-200 flex items-center gap-1 cursor-pointer">
                <FlaskConical className="w-3 h-3" /> Demo scenario
              </button>
            </div>
            {sortedWaves.length === 0 && (
              <p className="text-[11px] text-slate-400">Mark one or more flyovers in AeroDoppler and press “Save as wave”.</p>
            )}
            {sortedWaves.map((w, i) => (
              <div key={w.id} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: w.color }} />
                <span className="font-semibold">{w.label}</span>
                <span className="text-slate-500">@ {w.fit.t0.toFixed(1)}s</span>
                {i > 0 && <span className="ml-auto text-cyan-400">+{(w.fit.t0 - sortedWaves[i - 1].fit.t0).toFixed(1)}s</span>}
              </div>
            ))}
            <p className="text-[10px] text-slate-500 leading-relaxed">
              No distance needed — the shape of each curve sets it. With 2+ waves, only spots where real planes passed at those exact time gaps light up.
            </p>
          </section>

          {/* Time */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
            <h3 className={label}>2 · When did the recording start?</h3>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
              <input type="time" step={1} value={time} onChange={(e) => setTime(e.target.value)} className={input} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className={label}>Time zone</span>
                <select value={tz} onChange={(e) => setTz(Number(e.target.value))} className={input}>
                  {Array.from({ length: 27 }, (_, i) => (i - 12) * 60).map((m) => (
                    <option key={m} value={m}>UTC{m >= 0 ? '+' : ''}{m / 60}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={label}>Clock unsure by</span>
                <select value={clockTol} onChange={(e) => setClockTol(Number(e.target.value))} className={input}>
                  {[0, 2, 5, 10, 20, 30].map((s) => <option key={s} value={s}>±{s} s</option>)}
                </select>
              </label>
            </div>
          </section>

          {/* Area + flights */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
            <h3 className={label}>3 · Search area & flights</h3>
            <div className="flex items-center gap-2">
              <button onClick={useMapView} className="flex-1 text-xs border border-cyan-500/40 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 rounded-md py-1.5 flex items-center justify-center gap-1.5 cursor-pointer">
                <MapPin className="w-3.5 h-3.5" /> Use current map view
              </button>
              <span className="text-[10px] font-mono text-slate-400">{km.w.toFixed(1)}×{km.h.toFixed(1)} km</span>
            </div>
            <button
              onClick={loadFlights}
              disabled={loadingFlights}
              className="w-full text-xs border border-slate-600 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-md py-1.5 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {loadingFlights ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plane className="w-3.5 h-3.5" />}
              Load flights from adsb.lol
            </button>
            {flightMsg && <p className="text-[10px] font-mono text-slate-400 leading-relaxed">{flightMsg}</p>}
          </section>

          {/* Settings */}
          <section className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2">
            <h3 className={label}>4 · Calculate</h3>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className={label}>Detail</span>
                <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} className={input}>
                  <option value={60}>Fast (60²)</option>
                  <option value={90}>Normal (90²)</option>
                  <option value={140}>Fine (140²)</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className={label}>Freq tolerance</span>
                <select value={sigmaPct} onChange={(e) => setSigmaPct(Number(e.target.value))} className={input}>
                  {[0.2, 0.35, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s}%</option>)}
                </select>
              </label>
            </div>
            <button
              onClick={run}
              disabled={running}
              className="w-full bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-300 border border-emerald-500/40 font-semibold py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              {running ? `Calculating… ${Math.round(progress * 100)}%` : 'Build heatmap'}
            </button>
            {error && <p className="text-[11px] text-rose-400">{error}</p>}
          </section>

          {/* Result */}
          {result?.best && (
            <section className="bg-slate-900/80 border border-cyan-500/30 rounded-xl p-3 space-y-2">
              <h3 className={label}>Most likely recording spot</h3>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="text-cyan-300">{result.best.lat.toFixed(5)}, {result.best.lon.toFixed(5)}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${result.best!.lat.toFixed(6)}, ${result.best!.lon.toFixed(6)}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                Match {(result.best.score * 100).toFixed(0)}% · clock offset {result.best.clockOffset >= 0 ? '+' : ''}{result.best.clockOffset}s · {result.flightsUsed} planes checked · {(result.ms / 1000).toFixed(1)}s
              </div>
              {result.best.matches.map((m) => {
                const w = sortedWaves.find((x) => x.id === m.waveId)!;
                return (
                  <div key={m.waveId} className="border-t border-slate-800 pt-2 space-y-1">
                    <div className="flex items-center gap-2 font-mono text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: w.color }} />
                      <span className="font-semibold">{w.label}</span>
                      <span className="text-amber-300">→ {m.callsign}</span>
                      <span className="ml-auto text-slate-400">{(m.score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="text-[10px] font-mono text-slate-500">
                      closest {Math.round(m.closestM)} m · engine tone {Math.round(m.f0)} Hz · error {(m.rmsRel * 100).toFixed(2)}%
                    </div>
                    <WaveChart wave={w} predicted={m.predicted} />
                  </div>
                );
              })}
            </section>
          )}
        </aside>

        <div className="flex-1 relative">
          <div ref={mapDiv} className="absolute inset-0" />
          <div className="absolute bottom-3 left-3 z-[500] bg-panelbg/90 border border-slate-700 rounded-lg px-3 py-2 text-[10px] font-mono text-slate-300 space-y-1">
            <div className="flex items-center gap-2"><span className="w-6 h-2 rounded" style={{ background: 'linear-gradient(90deg,#140a3c,#781489,#e63c3c,#faaa1e,#ffffc8)' }} /> how well all waves fit</div>
            <div className="flex items-center gap-2"><span className="w-6 h-0.5 bg-amber-500" /> matched plane · <span className="w-6 h-px bg-slate-500" /> other planes</div>
          </div>
        </div>
      </div>
    </div>
  );
};

function WaveChart({ wave, predicted }: { wave: DopplerWave; predicted: { t: number; f: number }[] }) {
  const meas = waveSamples(wave);
  const all = [...meas, ...predicted].filter((p) => Number.isFinite(p.f));
  if (!all.length) return null;
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const f0 = Math.min(...all.map((p) => p.f)), f1 = Math.max(...all.map((p) => p.f));
  const W = 320, H = 70;
  const x = (t: number) => ((t - t0) / Math.max(1e-6, t1 - t0)) * (W - 8) + 4;
  const y = (f: number) => H - 4 - ((f - f0) / Math.max(1e-6, f1 - f0)) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[70px] bg-slate-950 rounded border border-slate-800">
      <polyline
        fill="none"
        stroke="#00f2fe"
        strokeWidth={1.5}
        points={predicted.filter((p) => Number.isFinite(p.f)).map((p) => `${x(p.t)},${y(p.f)}`).join(' ')}
      />
      {meas.map((p, i) => <circle key={i} cx={x(p.t)} cy={y(p.f)} r={2.2} fill={wave.color} />)}
    </svg>
  );
}
