import React, { useRef } from 'react';
import { Plane, FileAudio, Mic, Download, Sparkles, ArrowLeft } from 'lucide-react';

interface HeaderProps {
  onBackToDirectory: () => void;
  onOpenLocator?: () => void;
  onOpenColstoFinder?: () => void;
  onFileUpload: (file: File) => void;
  onGenerateDemo: () => void;
  onToggleMic: () => void;
  isMicActive: boolean;
  onExportCsv: () => void;
  hasAudio: boolean;
  hasPoints: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onBackToDirectory,
  onOpenLocator,
  onOpenColstoFinder,
  onFileUpload,
  onGenerateDemo,
  onToggleMic,
  isMicActive,
  onExportCsv,
  hasAudio,
  hasPoints,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileUpload(file);
      // Reset input value so same file can be reloaded if desired
      e.target.value = '';
    }
  };

  return (
    <header className="bg-panelbg border-b border-slate-800 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-lg z-30 shrink-0">
      <div className="flex items-center space-x-3">
        <button
          onClick={onBackToDirectory}
          title="Back to all tools"
          className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/20 hover:border-cyan-500/50 transition duration-150 flex items-center justify-center cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 hidden sm:block" />
          <Plane className="w-5 h-5 sm:hidden" />
        </button>

        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-wide text-slate-100 flex items-center gap-2">
            AeroDoppler{' '}
            <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
              OSINT DSP v1.2
            </span>
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400">
            Aircraft Audio Doppler Spectrum Extractor &amp; Location Finder
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3 flex-wrap">
        <input
          type="file"
          ref={fileInputRef}
          accept="audio/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Demo Flyby Audio for instant verification */}
        <button
          onClick={onGenerateDemo}
          title="Synthesize a realistic aircraft flyover with Doppler shift"
          className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-cyan-500/40 hover:border-cyan-400 font-medium px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Demo Flyby</span>
        </button>

        {/* Open Audio File */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 shadow-lg shadow-cyan-500/20 cursor-pointer"
        >
          <FileAudio className="w-3.5 h-3.5 text-slate-950" />
          <span>Open Audio File</span>
        </button>

        {/* Live Mic */}
        <button
          onClick={onToggleMic}
          className={`font-semibold px-3.5 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 cursor-pointer ${
            isMicActive
              ? 'bg-rose-600 hover:bg-rose-500 text-white animate-pulse'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
          }`}
        >
          <Mic className={`w-3.5 h-3.5 ${isMicActive ? 'text-white' : 'text-rose-400'}`} />
          <span>{isMicActive ? 'Stop Mic' : 'Live Mic'}</span>
        </button>

        {/* Doppler Geolocation Heatmap Finder */}
        <button
          onClick={onOpenLocator || onOpenColstoFinder}
          title="Open Doppler Flight Geolocation Heatmap (WASM)"
          className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 cursor-pointer shadow-lg shadow-emerald-500/10"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Flight Locator</span>
        </button>

        {/* Export CSV */}
        <button
          onClick={onExportCsv}
          disabled={!hasPoints}
          title={hasPoints ? 'Export points to CSV' : 'Plot points first to export'}
          className={`border font-semibold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 ${
            hasPoints
              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
              : 'bg-slate-900/60 text-slate-500 border-slate-800 cursor-not-allowed opacity-50'
          }`}
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden md:inline">Export Mapped Points (CSV)</span>
          <span className="md:hidden">CSV</span>
        </button>
      </div>
    </header>
  );
};
