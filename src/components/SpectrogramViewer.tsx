import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  CleanupSettings,
  DopplerPoint,
  FittedParams,
  PaletteName,
  RidgePoint,
  SpectrogramView,
} from '../types';
import { PALETTES } from '../dsp/palettes';
import { cleanMagnitude, dopplerShape, formatTime, niceStep, SPEED_OF_SOUND } from '../dsp/fitting';

interface SpectrogramViewerProps {
  spectrogramData: Float32Array[];
  spectrogramTimes: number[];
  sampleRate: number;
  duration: number;
  isMicActive: boolean;
  isPlaying: boolean;
  currentTime: number;
  view: SpectrogramView;
  onUpdateView: (updater: (prev: SpectrogramView) => SpectrogramView) => void;
  palette: PaletteName;
  gain: number;
  cleanup: CleanupSettings;
  noiseProfile: Float32Array | null;
  plottedPoints: DopplerPoint[];
  onAddPoint: (pt: DopplerPoint) => void;
  fittedParams: FittedParams | null;
  autoFit: FittedParams | null;
  ridgePoints: RidgePoint[];
}

export const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  spectrogramData,
  spectrogramTimes,
  sampleRate,
  duration,
  isMicActive,
  isPlaying,
  currentTime,
  view,
  onUpdateView,
  palette,
  gain,
  cleanup,
  noiseProfile,
  plottedPoints,
  onAddPoint,
  fittedParams,
  autoFit,
  ridgePoints,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const overCanvasRef = useRef<HTMLCanvasElement>(null);

  const [hoverInfo, setHoverInfo] = useState({
    time: 0,
    freq: 0,
    amp: '--',
  });

  // Track dragging vs clicking
  const dragRef = useRef({
    isDown: false,
    startX: 0,
    startY: 0,
    v0: { ...view },
    hasMoved: false,
  });

  const timeToFrame = useCallback(
    (t: number) => {
      const n = spectrogramData.length;
      if (!isMicActive && spectrogramTimes && spectrogramTimes.length === n && n > 1) {
        const hop = spectrogramTimes[1] - spectrogramTimes[0];
        return Math.round((t - spectrogramTimes[0]) / hop);
      }
      return Math.floor((t / (duration || 1)) * n);
    },
    [spectrogramData.length, isMicActive, spectrogramTimes, duration]
  );

  // Resize canvases
  const resizeCanvases = useCallback(() => {
    if (!containerRef.current || !specCanvasRef.current || !overCanvasRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(rect.height);

    if (w > 0 && h > 0) {
      if (specCanvasRef.current.width !== w || specCanvasRef.current.height !== h) {
        specCanvasRef.current.width = w;
        specCanvasRef.current.height = h;
      }
      if (overCanvasRef.current.width !== w || overCanvasRef.current.height !== h) {
        overCanvasRef.current.width = w;
        overCanvasRef.current.height = h;
      }
    }
  }, []);

  useEffect(() => {
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    return () => window.removeEventListener('resize', resizeCanvases);
  }, [resizeCanvases]);

  // Coordinate transforms
  const tToX = useCallback((t: number, w: number) => ((t - view.t0) / (view.t1 - view.t0)) * w, [view.t0, view.t1]);
  const xToT = useCallback((x: number, w: number) => view.t0 + (x / w) * (view.t1 - view.t0), [view.t0, view.t1]);
  const fToY = useCallback((f: number, h: number) => h * (1 - (f - view.f0) / (view.f1 - view.f0)), [view.f0, view.f1]);
  const yToF = useCallback((y: number, h: number) => view.f0 + (1 - y / h) * (view.f1 - view.f0), [view.f0, view.f1]);

  // Render Spectrogram Canvas
  useEffect(() => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    if (!spectrogramData.length) {
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, width, height);

      // Draw subtle placeholder grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.font = '13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('NO AUDIO LOADED — Open an audio file or click Demo Flyby', width / 2, height / 2);
      ctx.textAlign = 'left';
      return;
    }

    const imgData = ctx.createImageData(width, height);
    const pixels = imgData.data;

    const fftBins = spectrogramData[0].length;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / fftBins;
    const paletteFunc = PALETTES[palette] || PALETTES.inferno;
    const gate = cleanup.gate;

    const norms = new Float32Array(width * height);
    const hist = new Uint32Array(256);
    let counted = 0;

    for (let x = 0; x < width; x++) {
      const curT = xToT(x, width);
      const frameIdx = timeToFrame(curT);
      const spectrum = spectrogramData[frameIdx];
      if (!spectrum) continue;

      for (let y = 0; y < height; y++) {
        const freqHz = yToF(y, height);
        const binIdx = Math.floor((freqHz / nyquist) * fftBins);

        let mag = 0;
        if (binIdx >= 0 && binIdx < fftBins) {
          mag = cleanMagnitude(spectrum, binIdx, binHz, cleanup, noiseProfile) * gain;
        }

        let norm = Math.min(1, Math.max(0, Math.log10(1 + mag * 50) / 1.5));
        norm = norm <= gate ? 0 : (norm - gate) / (1 - gate);

        norms[y * width + x] = norm;
        if (norm > 0) {
          hist[Math.min(255, Math.floor(norm * 255))]++;
          counted++;
        }
      }
    }

    let cdf: Float32Array | null = null;
    if (cleanup.histEq && counted > 0) {
      cdf = new Float32Array(256);
      let acc = 0;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        cdf[i] = acc / counted;
      }
    }

    for (let p = 0; p < norms.length; p++) {
      let v = norms[p];
      if (cdf && v > 0) {
        v = cdf[Math.min(255, Math.floor(v * 255))];
      }
      const [r, g, b] = paletteFunc(v);
      const i = p * 4;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }, [
    spectrogramData,
    sampleRate,
    duration,
    view,
    palette,
    gain,
    cleanup,
    noiseProfile,
    xToT,
    yToF,
    timeToFrame,
  ]);

  // Render Overlay Vector Layer (Grid, Curves, Landmark Points)
  useEffect(() => {
    const canvas = overCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    if (width === 0 || height === 0) return;

    ctx.clearRect(0, 0, width, height);

    // 1. Gridlines & Axes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.font = '10px monospace';

    // Frequency gridlines
    const fSpan = view.f1 - view.f0;
    const stepHz = niceStep(fSpan / 6, [10, 20, 50, 100, 200, 250, 500, 1000, 2000]);
    for (let hz = Math.ceil(view.f0 / stepHz) * stepHz; hz < view.f1; hz += stepHz) {
      if (hz <= view.f0) continue;
      const y = fToY(hz, height);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillText(`${hz} Hz`, 8, y - 4);
    }

    // Time gridlines
    if (duration > 0) {
      const timeSpan = view.t1 - view.t0;
      const timeStep = niceStep(timeSpan / 8, [
        0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
      ]);
      for (let t = Math.ceil(view.t0 / timeStep) * timeStep; t < view.t1; t += timeStep) {
        if (t <= view.t0) continue;
        const x = tToX(t, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillText(t >= 60 ? formatTime(t) : `${t.toFixed(1)}s`, x + 4, height - 8);
      }
    }

    // 2. Playback Head Line
    if (duration > 0 && currentTime >= 0) {
      const playX = tToX(currentTime, width);
      ctx.strokeStyle = '#00f2fe';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playX, 0);
      ctx.lineTo(playX, height);
      ctx.stroke();
    }

    // 3. Auto-detected Ridge Points
    if (ridgePoints.length > 0) {
      ctx.fillStyle = 'rgba(251, 113, 133, 0.6)';
      for (let i = 0; i < ridgePoints.length; i++) {
        const p = ridgePoints[i];
        ctx.fillRect(tToX(p.t, width) - 1, fToY(p.f, height) - 1, 2.5, 2.5);
      }
    }

    // 4. Auto-detected Doppler Curve (Red Dashed)
    if (autoFit && duration > 0) {
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      let first = true;
      for (let x = 0; x < width; x += 2) {
        const t = xToT(x, width);
        const freq = autoFit.f0 * dopplerShape(t, autoFit.v, autoFit.dmin, autoFit.t0);
        const y = fToY(freq, height);
        if (y < 0 || y > height) {
          first = true;
          continue;
        }
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      const cx = tToX(autoFit.t0, width);
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(
        `AUTO ${Math.round(autoFit.v * 3.6)} km/h · ${Math.round((autoFit.score || 0) * 100)}%`,
        cx + 8,
        18
      );
    }

    // 5. Fitted Doppler Curve from Manual Points (Neon Emerald)
    if (fittedParams && duration > 0) {
      const { f0, v, dmin, t0 } = fittedParams;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.beginPath();
      let first = true;
      for (let x = 0; x < width; x += 2) {
        const t = xToT(x, width);
        const freq = f0 * dopplerShape(t, v, dmin, t0);
        const y = fToY(freq, height);

        if (y >= 0 && y <= height) {
          if (first) {
            ctx.moveTo(x, y);
            first = false;
          } else {
            ctx.lineTo(x, y);
          }
        }
      }
      ctx.stroke();
    }

    // 6. Plotted Landmark Points (Violet ring + Cyan core + number)
    plottedPoints.forEach((pt, idx) => {
      const x = tToX(pt.t, width);
      const y = fToY(pt.f, height);

      // Outer ring
      ctx.fillStyle = '#7c3aed';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();

      // Inner core
      ctx.fillStyle = '#00f2fe';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Number label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${idx + 1}`, x + 10, y + 3);
    });
  }, [
    duration,
    currentTime,
    view,
    plottedPoints,
    fittedParams,
    autoFit,
    ridgePoints,
    tToX,
    fToY,
    xToT,
  ]);

  // Mouse wheel: time & frequency zoom + horizontal trackpad scrolling
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    e.preventDefault();
    const canvas = overCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = canvas.width;
    const h = canvas.height;

    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    // Trackpad horizontal swipe: scroll time
    if (Math.abs(dx) > Math.abs(dy) && !e.shiftKey) {
      const shift = (dx / w) * (view.t1 - view.t0);
      onUpdateView((prev) => {
        const span = prev.t1 - prev.t0;
        let t0 = Math.max(0, Math.min(duration - span, prev.t0 + shift));
        let t1 = t0 + span;
        return { ...prev, t0, t1 };
      });
      return;
    }

    const factor = Math.exp(dy * 0.0015);
    if (e.shiftKey) {
      // Zoom frequency around anchor
      const anchorF = yToF(e.clientY - rect.top, h);
      onUpdateView((prev) => {
        const fSpan = prev.f1 - prev.f0;
        const nextSpan = Math.max(100, Math.min(sampleRate / 2, fSpan * factor));
        const r = (anchorF - prev.f0) / fSpan;
        let f0 = Math.max(0, anchorF - r * nextSpan);
        let f1 = f0 + nextSpan;
        if (f1 > sampleRate / 2) {
          f1 = sampleRate / 2;
          f0 = Math.max(0, f1 - nextSpan);
        }
        return { ...prev, f0, f1 };
      });
    } else {
      // Zoom time around anchor
      const anchorT = xToT(e.clientX - rect.left, w);
      onUpdateView((prev) => {
        const tSpan = prev.t1 - prev.t0;
        const nextSpan = Math.max(0.5, Math.min(duration, tSpan * factor));
        const r = (anchorT - prev.t0) / tSpan;
        let t0 = Math.max(0, anchorT - r * nextSpan);
        let t1 = t0 + nextSpan;
        if (t1 > duration) {
          t1 = duration;
          t0 = Math.max(0, t1 - nextSpan);
        }
        return { ...prev, t0, t1 };
      });
    }
  };

  // Mouse Down: Start drag or prepare for click
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration || e.button !== 0) return;
    dragRef.current = {
      isDown: true,
      startX: e.clientX,
      startY: e.clientY,
      v0: { ...view },
      hasMoved: false,
    };

    const handleWindowMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current.isDown || !overCanvasRef.current) return;
      const ddx = ev.clientX - dragRef.current.startX;
      const ddy = ev.clientY - dragRef.current.startY;

      if (!dragRef.current.hasMoved && Math.hypot(ddx, ddy) < 4) return;
      dragRef.current.hasMoved = true;

      const w = overCanvasRef.current.width;
      const h = overCanvasRef.current.height;
      const v0 = dragRef.current.v0;

      const dt = (ddx / w) * (v0.t1 - v0.t0);
      const df = (ddy / h) * (v0.f1 - v0.f0);

      onUpdateView((prev) => {
        const tSpan = v0.t1 - v0.t0;
        const fSpan = v0.f1 - v0.f0;

        let t0 = Math.max(0, Math.min(duration - tSpan, v0.t0 - dt));
        let t1 = t0 + tSpan;

        const maxHz = sampleRate / 2;
        let f0 = Math.max(0, Math.min(maxHz - fSpan, v0.f0 + df));
        let f1 = f0 + fSpan;

        return { ...prev, t0, t1, f0, f1 };
      });
    };

    const handleWindowMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);

      const wasDrag = dragRef.current.hasMoved;
      dragRef.current.isDown = false;

      // If it wasn't a drag, it's a point plot click!
      if (!wasDrag && overCanvasRef.current) {
        const rect = overCanvasRef.current.getBoundingClientRect();
        const mouseX = ev.clientX - rect.left;
        const mouseY = ev.clientY - rect.top;

        const w = overCanvasRef.current.width;
        const h = overCanvasRef.current.height;

        const pointTime = xToT(mouseX, w);
        const pointFreq = yToF(mouseY, h);

        if (pointTime >= 0 && pointTime <= duration && pointFreq >= 0) {
          onAddPoint({ t: pointTime, f: pointFreq });
        }
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  // Mouse Move: Hover Telemetry
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = overCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const w = canvas.width;
    const h = canvas.height;

    const hoverT = xToT(mouseX, w);
    const hoverF = yToF(mouseY, h);

    let ampStr = '-- dB';
    if (spectrogramData.length > 0 && duration > 0) {
      const frameIdx = timeToFrame(hoverT);
      const spectrum = spectrogramData[frameIdx];
      if (spectrum) {
        const binIdx = Math.floor((hoverF / (sampleRate / 2)) * spectrum.length);
        const mag = spectrum[binIdx] || 0;
        ampStr = `${(20 * Math.log10(mag + 1e-6)).toFixed(1)} dB`;
      }
    }

    setHoverInfo({
      time: Math.max(0, hoverT),
      freq: Math.max(0, hoverF),
      amp: ampStr,
    });
  };

  // Horizontal scroll slider
  const tSpan = view.t1 - view.t0;
  const freeTime = Math.max(0, (duration || 1) - tSpan);
  const scrollVal = freeTime > 0 ? Math.round((view.t0 / freeTime) * 1000) : 0;

  const handleScrollChange = (val: number) => {
    if (freeTime <= 0) return;
    const t0 = (val / 1000) * freeTime;
    onUpdateView((prev) => ({
      ...prev,
      t0,
      t1: t0 + (prev.t1 - prev.t0),
    }));
  };

  return (
    <main className="flex-1 flex flex-col bg-darkbg p-3 sm:p-4 gap-3 relative overflow-hidden h-full">
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl relative overflow-hidden shadow-2xl flex flex-col">
        {/* Canvases */}
        <div ref={containerRef} className="flex-1 relative w-full h-full canvas-container overflow-hidden">
          <canvas ref={specCanvasRef} className="absolute inset-0 w-full h-full block" />
          <canvas
            ref={overCanvasRef}
            className="absolute inset-0 w-full h-full block z-10 pointer-events-auto"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
          />
        </div>

        {/* View Scroll Slider */}
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-1.5 z-20 shrink-0">
          <input
            type="range"
            min={0}
            max={1000}
            value={scrollVal}
            disabled={freeTime <= 0}
            onChange={(e) => handleScrollChange(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-30"
          />
        </div>

        {/* Telemetry Bar */}
        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between text-xs font-mono text-slate-400 z-20 shrink-0 gap-2">
          <div className="flex items-center space-x-4 sm:space-x-6">
            <div>
              <span className="text-slate-500">CURSOR TIME:</span>
              <span className="text-cyan-400 font-bold ml-1">{hoverInfo.time.toFixed(2)} s</span>
            </div>
            <div>
              <span className="text-slate-500">CURSOR FREQ:</span>
              <span className="text-emerald-400 font-bold ml-1">{Math.round(hoverInfo.freq)} Hz</span>
            </div>
            <div>
              <span className="text-slate-500">MAGNITUDE:</span>
              <span className="text-amber-400 font-bold ml-1">{hoverInfo.amp}</span>
            </div>
          </div>
          <div className="flex items-center space-x-2 text-[11px] text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Click canvas to plot curve points</span>
          </div>
        </div>
      </div>
    </main>
  );
};
