import React from 'react';
import {
  Play,
  Pause,
  Sliders,
  Wand2,
  LineChart,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Crosshair,
  ArrowUpDown,
} from 'lucide-react';
import { CleanupSettings, FittedParams, PaletteName, SpectrogramView } from '../types';
import { formatTime } from '../dsp/fitting';

interface SidebarProps {
  // Playback
  isPlaying: boolean;
  onTogglePlayPause: () => void;
  currentTime: number;
  totalTime: number;
  onSeek: (time: number) => void;
  audioStatus: { text: string; type: 'idle' | 'loading' | 'success' | 'error' | 'mic' };
  hasAudio: boolean;

  // Signal & Display
  fftSize: number;
  onChangeFftSize: (size: number) => void;
  palette: PaletteName;
  onChangePalette: (pal: PaletteName) => void;
  gain: number;
  onChangeGain: (gain: number) => void;

  // Zoom
  view: SpectrogramView;
  onZoomTime: (factor: number) => void;
  onZoomFreq: (factor: number) => void;
  onResetView: () => void;

  // Noise Cleanup
  cleanup: CleanupSettings;
  onChangeCleanup: (partial: Partial<CleanupSettings>) => void;
  onAutoDetect: () => void;
  autoDetectStatus: string;

  // Doppler Stats
  plottedPointsCount: number;
  fittedParams: FittedParams | null;
  onClearPoints: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isPlaying,
  onTogglePlayPause,
  currentTime,
  totalTime,
  onSeek,
  audioStatus,
  hasAudio,
  fftSize,
  onChangeFftSize,
  palette,
  onChangePalette,
  gain,
  onChangeGain,
  view,
  onZoomTime,
  onZoomFreq,
  onResetView,
  cleanup,
  onChangeCleanup,
  onAutoDetect,
  autoDetectStatus,
  plottedPointsCount,
  fittedParams,
  onClearPoints,
}) => {
  const timeSpan = view.t1 - view.t0;
  const viewInfoStr = `${timeSpan >= 60 ? formatTime(timeSpan) : `${timeSpan.toFixed(1)}s`} · ${Math.round(
    view.f0
  )}–${Math.round(view.f1)} Hz`;

  return (
    <aside className="w-80 bg-panelbg border-r border-slate-800 p-3.5 flex flex-col space-y-4 overflow-y-auto shrink-0 select-none text-xs">
      {/* 1. Audio Playback Control Box */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
            Playback &amp; Stream
          </span>
          <span
            className={`font-mono text-xs ${
              audioStatus.type === 'success'
                ? 'text-emerald-400'
                : audioStatus.type === 'error'
                ? 'text-rose-400'
                : audioStatus.type === 'mic'
                ? 'text-rose-400 animate-pulse'
                : audioStatus.type === 'loading'
                ? 'text-cyan-400 animate-pulse'
                : 'text-amber-400'
            }`}
          >
            {audioStatus.text}
          </span>
        </div>

        <div className="flex items-center space-x-2.5">
          <button
            onClick={onTogglePlayPause}
            disabled={!hasAudio}
            className="w-9 h-9 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-30 disabled:hover:bg-cyan-500 text-slate-950 rounded-lg flex items-center justify-center font-bold transition cursor-pointer disabled:cursor-not-allowed shrink-0"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <div className="flex-1">
            <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(totalTime)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={totalTime > 0 ? totalTime : 100}
              step={0.05}
              value={currentTime}
              disabled={!hasAudio}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-40"
            />
          </div>
        </div>
      </div>

      {/* 2. Spectrogram Settings Box */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-3.5">
        <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Signal &amp; Display Tuning
        </h3>

        {/* FFT Size */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-slate-300">FFT Window Size</label>
            <span className="font-mono text-cyan-400 text-xs">{fftSize}</span>
          </div>
          <select
            value={fftSize}
            onChange={(e) => onChangeFftSize(parseInt(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none font-mono"
          >
            <option value="512">512 (High Time Resolution)</option>
            <option value="1024">1024 (Balanced)</option>
            <option value="2048">2048 (Standard Frequency)</option>
            <option value="4096">4096 (High Frequency Res)</option>
            <option value="8192">8192 (Ultra Low-Hz Res)</option>
            <option value="16384">16384 (Extreme Resolution)</option>
            <option value="32768">32768 (Max 32k High-Res FFT)</option>
          </select>
        </div>

        {/* Zoom & Scroll */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-slate-300">Zoom &amp; Scroll</label>
            <span className="font-mono text-cyan-400 text-[10px]">{viewInfoStr}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <button
              onClick={() => onZoomTime(0.5)}
              title="Zoom in (time)"
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-1 text-slate-200 flex items-center justify-center cursor-pointer"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onZoomTime(2.0)}
              title="Zoom out (time)"
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-1 text-slate-200 flex items-center justify-center cursor-pointer"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onZoomFreq(0.5)}
              title="Zoom in (frequency)"
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-1 text-slate-200 flex items-center justify-center gap-0.5 cursor-pointer"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span className="text-[10px]">+</span>
            </button>
            <button
              onClick={onResetView}
              title="Show everything"
              className="bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md py-1 text-slate-200 flex items-center justify-center cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[10px] text-slate-500 font-mono mt-1.5 leading-relaxed">
            Scroll wheel: zoom time · Shift + wheel: zoom freq · Drag: move · Click: plot point
          </p>
        </div>

        {/* Color Palette */}
        <div>
          <label className="text-slate-300 text-xs block mb-1">Spectrogram Color Palette</label>
          <select
            value={palette}
            onChange={(e) => onChangePalette(e.target.value as PaletteName)}
            className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-1.5 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
          >
            <option value="inferno">Inferno (Thermal Fire)</option>
            <option value="viridis">Viridis (High Contrast Green/Yellow)</option>
            <option value="plasma">Plasma (Magenta/Cyan)</option>
            <option value="radar">Classic Radar Green</option>
            <option value="grayscale">Grayscale / Forensic</option>
          </select>
        </div>

        {/* Spectral Gain / Contrast */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <label className="text-slate-300">Spectral Gain / Contrast</label>
            <span className="font-mono text-cyan-400 text-xs">{gain.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={20.0}
            step={0.1}
            value={gain}
            onChange={(e) => onChangeGain(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-0.5">
            <span>0.1x (Attenuate)</span>
            <span>1.0x</span>
            <span>20x (Extreme)</span>
          </div>
        </div>
      </div>

      {/* 3. Noise Cleanup & Auto Detection Box */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-3">
        <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
          <Wand2 className="w-3.5 h-3.5 text-rose-400" /> Noise Cleanup &amp; Auto Detect
        </h3>

        {/* Bandpass */}
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={cleanup.bandpass}
            onChange={(e) => onChangeCleanup({ bandpass: e.target.checked })}
            className="accent-cyan-400 rounded cursor-pointer"
          />
          <span>Band-pass filter</span>
        </label>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Low cut</span>
            <span className="font-mono text-cyan-400">{cleanup.lowHz} Hz</span>
          </div>
          <input
            type="range"
            min={20}
            max={1000}
            step={10}
            value={cleanup.lowHz}
            onChange={(e) => onChangeCleanup({ lowHz: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">High cut</span>
            <span className="font-mono text-cyan-400">{cleanup.highHz} Hz</span>
          </div>
          <input
            type="range"
            min={500}
            max={8000}
            step={50}
            value={cleanup.highHz}
            onChange={(e) => onChangeCleanup({ highHz: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Noise subtraction */}
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1 border-t border-slate-800">
          <input
            type="checkbox"
            checked={cleanup.noiseSub}
            onChange={(e) => onChangeCleanup({ noiseSub: e.target.checked })}
            className="accent-cyan-400 rounded cursor-pointer"
          />
          <span>Noise subtraction (learn from start)</span>
        </label>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Noise sample length</span>
            <span className="font-mono text-cyan-400">{cleanup.noiseSeconds} s</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={10}
            step={0.5}
            value={cleanup.noiseSeconds}
            onChange={(e) => onChangeCleanup({ noiseSeconds: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Subtraction strength</span>
            <span className="font-mono text-cyan-400">{cleanup.noiseStrength.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.1}
            value={cleanup.noiseStrength}
            onChange={(e) => onChangeCleanup({ noiseStrength: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Noise floor gate */}
        <div className="pt-1 border-t border-slate-800">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400">Noise floor gate</span>
            <span className="font-mono text-cyan-400">{Math.round(cleanup.gate * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.01}
            value={cleanup.gate}
            onChange={(e) => onChangeCleanup({ gate: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Histogram Equalization */}
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={cleanup.histEq}
            onChange={(e) => onChangeCleanup({ histEq: e.target.checked })}
            className="accent-cyan-400 rounded cursor-pointer"
          />
          <span>Histogram equalization</span>
        </label>

        {/* Auto detect button */}
        <button
          onClick={onAutoDetect}
          className="w-full bg-rose-600 hover:bg-rose-500 text-white font-semibold px-3 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition duration-150 cursor-pointer shadow-lg shadow-rose-600/20"
        >
          <Crosshair className="w-3.5 h-3.5" /> Auto-detect Doppler curve
        </button>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={cleanup.liveAuto}
            onChange={(e) => onChangeCleanup({ liveAuto: e.target.checked })}
            className="accent-rose-400 rounded cursor-pointer"
          />
          <span>Keep detecting on live mic</span>
        </label>

        {autoDetectStatus && (
          <p
            className="text-[11px] font-mono leading-tight"
            dangerouslySetInnerHTML={{ __html: autoDetectStatus }}
          />
        )}
      </div>

      {/* 4. Doppler Curve Fitting Parameters Box */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-2.5 flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <LineChart className="w-3.5 h-3.5 text-emerald-400" /> Doppler Parameters
          </h3>
          <button
            onClick={onClearPoints}
            className="text-[11px] text-rose-400 hover:text-rose-300 underline font-mono cursor-pointer"
          >
            Clear Points
          </button>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          Click points along an engine harmonic curve in the spectrogram to solve physics model parameters.
        </p>

        {/* Stats */}
        <div className="space-y-2 bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 font-mono text-xs">
          <div className="flex justify-between items-center pb-1.5 border-b border-slate-800">
            <span className="text-slate-400">Plotted Points:</span>
            <span className="text-cyan-400 font-bold">{plottedPointsCount}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Est. Base Freq (f₀):</span>
            <span className="text-emerald-400 font-bold">
              {fittedParams ? `${Math.round(fittedParams.f0)} Hz` : '-- Hz'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Est. Ground Speed (v):</span>
            <span className="text-cyan-400 font-bold">
              {fittedParams
                ? `${Math.round(fittedParams.v * 3.6)} km/h (${Math.round(fittedParams.v)} m/s)`
                : '-- km/h'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Closest Distance (d_min):</span>
            <span className="text-amber-400 font-bold">
              {fittedParams ? `${Math.round(fittedParams.dmin)} m` : '-- m'}
            </span>
          </div>
          <div className="flex justify-between items-center pt-1 border-t border-slate-800">
            <span className="text-slate-400">CPA Time (t₀):</span>
            <span className="text-slate-200">
              {fittedParams ? `${fittedParams.t0.toFixed(2)} s` : '-- s'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
