import React, { useState } from 'react';
import { Search, Wrench, Plane, Radio, ArrowRight, ShieldCheck, Cpu } from 'lucide-react';
import { ToolItem } from '../types';

interface HomeDirectoryProps {
  onSelectTool: (toolId: string) => void;
}

const TOOLS: ToolItem[] = [
  {
    id: 'aerodoppler',
    name: 'AeroDoppler',
    tag: 'OSINT DSP',
    description: "Find a plane's Doppler curve in an audio recording and estimate its speed, closest distance and time of fly-over.",
    icon: 'plane',
    color: 'cyan',
    status: 'live',
  },
  {
    id: 'locator',
    name: 'Doppler Flight Locator',
    tag: 'WASM DSP',
    description: 'Invert aircraft Doppler curves against regional ADS-B flight trajectories to find ground recording locations on an interactive map.',
    icon: 'radio',
    color: 'emerald',
    status: 'live',
  },
  {
    id: 'acoustic_rf',
    name: 'Acoustic RF Triangulator',
    tag: 'GEOLOCATION',
    description: 'Multi-receiver TDOA (Time Difference of Arrival) acoustic triangulation for low-altitude drones and light aircraft.',
    icon: 'cpu',
    color: 'violet',
    status: 'soon',
  },
];

const COLOR_CLASSES = {
  cyan: {
    box: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400',
    hover: 'hover:border-cyan-500/50 hover:shadow-cyan-500/10',
    cta: 'text-cyan-400 group-hover:text-cyan-300',
  },
  emerald: {
    box: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    hover: 'hover:border-emerald-500/50 hover:shadow-emerald-500/10',
    cta: 'text-emerald-400 group-hover:text-emerald-300',
  },
  violet: {
    box: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
    hover: 'hover:border-violet-500/50 hover:shadow-violet-500/10',
    cta: 'text-violet-400 group-hover:text-violet-300',
  },
  rose: {
    box: 'bg-rose-500/10 border-rose-500/30 text-rose-400',
    hover: 'hover:border-rose-500/50 hover:shadow-rose-500/10',
    cta: 'text-rose-400 group-hover:text-rose-300',
  },
};

export const HomeDirectory: React.FC<HomeDirectoryProps> = ({ onSelectTool }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredTools = TOOLS.filter((tool) => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return true;
    return (
      tool.name.toLowerCase().includes(q) ||
      tool.tag.toLowerCase().includes(q) ||
      tool.description.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col font-sans bg-darkbg text-slate-200">
      {/* Header */}
      <header className="bg-panelbg border-b border-slate-800 px-6 py-3.5 flex items-center justify-between shadow-lg shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide text-slate-100 flex items-center gap-2">
              Tools{' '}
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                LowerTMM10
              </span>
            </h1>
            <p className="text-xs text-slate-400">Aircraft &amp; signal analysis toolkit</p>
          </div>
        </div>
        <span className="text-xs text-slate-400 font-mono">
          {filteredTools.length} tool{filteredTools.length === 1 ? '' : 's'}
        </span>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-6 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:border-cyan-500/50 shadow-inner"
          />
        </div>

        {/* Tool Cards */}
        {filteredTools.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTools.map((tool) => {
              const c = COLOR_CLASSES[tool.color] || COLOR_CLASSES.cyan;
              const isLive = tool.status === 'live';

              return (
                <div
                  key={tool.id}
                  onClick={() => isLive && onSelectTool(tool.id)}
                  className={`group bg-slate-900/80 border border-slate-800 rounded-xl p-5 flex flex-col gap-3.5 transition duration-150 shadow-lg ${
                    isLive
                      ? `${c.hover} hover:-translate-y-0.5 cursor-pointer`
                      : 'opacity-60 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className={`p-2.5 border rounded-lg ${c.box}`}>
                      {tool.icon === 'plane' && <Plane className="w-5 h-5" />}
                      {tool.icon === 'radio' && <Radio className="w-5 h-5" />}
                      {tool.icon === 'cpu' && <Cpu className="w-5 h-5" />}
                    </div>
                    {isLive ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold tracking-wider">
                        LIVE
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-700 font-semibold tracking-wider">
                        SOON
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                      {tool.name}
                      <span className="text-[10px] font-mono text-slate-500 border border-slate-800 px-1.5 py-0.5 rounded">
                        {tool.tag}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-400 leading-relaxed mt-2">
                      {tool.description}
                    </p>
                  </div>

                  {isLive && (
                    <span className={`mt-auto text-xs font-semibold flex items-center gap-1.5 pt-2 ${c.cta}`}>
                      Open tool <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-center text-sm text-slate-500 font-mono py-12">
            No tools match your search "{searchTerm}".
          </p>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-3.5 text-[11px] text-slate-500 font-mono text-center shrink-0">
        {new Date().getFullYear()} · LowerTMM10 Aircraft &amp; Signal Analysis
      </footer>
    </div>
  );
};
