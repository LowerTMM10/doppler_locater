import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import {
  ColstoCandidate,
  ColstoSearchResult,
  ColstoSettings,
  DopplerPoint,
  FittedParams,
  FlightTrajectory,
  SearchArea,
} from '../types';
import {
  BENCHMARK_FLIGHTS,
  fetchAdsbLol,
  parseCustomAdsbFile,
} from '../services/adsbService';
import { runColstoGeolocationSearch } from '../wasm/wasmEngine';
import {
  Play,
  RotateCcw,
  Zap,
  MapPin,
  Download,
  Upload,
  Globe,
  Radio,
  Sliders,
  CheckCircle2,
  ExternalLink,
  Copy,
  Info,
  Calendar,
  Clock,
  Layers,
  ArrowLeft,
} from 'lucide-react';

interface ColstoHeatmapFinderProps {
  onBackToSpectrogram: () => void;
  fittedParams: FittedParams | null;
  recordedPoints: DopplerPoint[];
}

export const ColstoHeatmapFinder: React.FC<ColstoHeatmapFinderProps> = ({
  onBackToSpectrogram,
  fittedParams,
  recordedPoints,
}) => {
  // Doppler Target parameters (syncable from AeroDoppler or manually adjustable)
  const [targetParams, setTargetParams] = useState<FittedParams>(() => {
    if (fittedParams) return fittedParams;
    return {
      f0: 850,
      v: 240, // ~864 km/h
      dmin: 520, // 520 meters
      t0: 12.0, // 12 seconds CPA
    };
  });

  // Flight Data Source
  const [sourceType, setSourceType] = useState<'benchmark' | 'adsblol' | 'upload'>('benchmark');
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('typhoon_salisbury');
  const [trajectories, setTrajectories] = useState<FlightTrajectory[]>(BENCHMARK_FLIGHTS);
  const [selectedTrajectory, setSelectedTrajectory] = useState<FlightTrajectory>(BENCHMARK_FLIGHTS[0]);
  const [isLoadingAdsb, setIsLoadingAdsb] = useState(false);
  const [adsbStatusMsg, setAdsbStatusMsg] = useState('');

  // Date and Time window
  const [recordingDate, setRecordingDate] = useState('2026-11-03');
  const [recordingTime, setRecordingTime] = useState('14:32:00');
  const [timeWindowMin, setTimeWindowMin] = useState(15);

  // Search Area (lat/lon bounds)
  const [searchArea, setSearchArea] = useState<SearchArea>(() => {
    // Default Salisbury military test corridor
    return {
      minLat: 51.0500,
      maxLat: 51.2200,
      minLon: -1.9800,
      maxLon: -1.7200,
    };
  });

  // Settings & Optimization
  const [settings, setSettings] = useState<ColstoSettings>({
    useWasm: true,
    gridResolution: 80, // 80x80 = 6,400 points
    searchRadiusKm: 25,
    spatialPruning: true,
    elevationModel: false,
    soundSpeed: 343.0,
    sigmaDist: 45.0,
    sigmaTime: 0.8,
  });

  // Calculation Results
  const [isCalculating, setIsCalculating] = useState(false);
  const [searchResult, setSearchResult] = useState<ColstoSearchResult | null>(null);
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Leaflet Map Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const heatmapLayerRef = useRef<L.ImageOverlay | null>(null);
  const flightPathLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const searchBoundsLayerRef = useRef<L.Rectangle | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [51.1300, -1.8500],
      zoom: 12,
      zoomControl: true,
    });

    // Dark Matter tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    const flightGroup = L.layerGroup().addTo(map);
    const markersGroup = L.layerGroup().addTo(map);

    flightPathLayerRef.current = flightGroup;
    markerLayerRef.current = markersGroup;
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Flight Path Layer on Map when Trajectory changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const flightGroup = flightPathLayerRef.current;
    if (!map || !flightGroup || !selectedTrajectory) return;

    flightGroup.clearLayers();

    const latlngs: [number, number][] = selectedTrajectory.waypoints.map((wp) => [wp.lat, wp.lon]);
    if (latlngs.length < 2) return;

    // Glowing cyan flight path polyline
    const polyline = L.polyline(latlngs, {
      color: '#00f2fe',
      weight: 3.5,
      opacity: 0.9,
      lineCap: 'round',
    }).addTo(flightGroup);

    // Waypoints markers
    selectedTrajectory.waypoints.forEach((wp, idx) => {
      const isMid = idx === Math.floor(selectedTrajectory.waypoints.length / 2);
      const icon = L.divIcon({
        className: 'custom-wp-icon',
        html: `<div style="background-color: ${
          isMid ? '#ef4444' : '#00f2fe'
        }; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid #0f172a; box-shadow: 0 0 6px ${
          isMid ? '#ef4444' : '#00f2fe'
        };"></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      });

      const marker = L.marker([wp.lat, wp.lon], { icon }).addTo(flightGroup);
      marker.bindPopup(`
        <div style="font-family: monospace; font-size: 11px; color: #1e293b;">
          <strong>Waypoint #${idx + 1}</strong><br/>
          Time: ${wp.timestamp.toFixed(1)}s<br/>
          Altitude: ${Math.round(wp.alt)} m (${Math.round(wp.alt * 3.28084)} ft)<br/>
          Speed: ${Math.round(wp.groundSpeed * 3.6)} km/h (${Math.round(wp.groundSpeed)} m/s)<br/>
          Track: ${Math.round(wp.track || 0)}°
        </div>
      `);
    });

    // Fit map bounds to flight
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });

    // Update search area to enclose flight with buffer
    const bounds = polyline.getBounds();
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lonSpan = bounds.getEast() - bounds.getWest();

    setSearchArea({
      minLat: bounds.getSouth() - latSpan * 0.4,
      maxLat: bounds.getNorth() + latSpan * 0.4,
      minLon: bounds.getWest() - lonSpan * 0.4,
      maxLon: bounds.getEast() + lonSpan * 0.4,
    });
  }, [selectedTrajectory]);

  // Update Search Area Rectangle on Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (searchBoundsLayerRef.current) {
      map.removeLayer(searchBoundsLayerRef.current);
    }

    const bounds: L.LatLngBoundsExpression = [
      [searchArea.minLat, searchArea.minLon],
      [searchArea.maxLat, searchArea.maxLon],
    ];

    const rect = L.rectangle(bounds, {
      color: '#38bdf8',
      weight: 1.5,
      dashArray: '5, 5',
      fillColor: '#38bdf8',
      fillOpacity: 0.03,
    }).addTo(map);

    searchBoundsLayerRef.current = rect;
  }, [searchArea]);

  // Render Heatmap overlay onto Leaflet map when searchResult changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerGroup = markerLayerRef.current;
    if (!map || !markerGroup) return;

    // Remove existing heatmap overlay
    if (heatmapLayerRef.current) {
      map.removeLayer(heatmapLayerRef.current);
      heatmapLayerRef.current = null;
    }
    markerGroup.clearLayers();

    if (!searchResult) return;

    const { gridScores, cols, rows, searchArea: area, topLocation } = searchResult;

    // Create offscreen canvas to generate heatmap image
    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let r = 0; r < rows; r++) {
      // Leaflet image overlay expects North at top (row 0), South at bottom
      const srcRow = rows - 1 - r;
      for (let c = 0; c < cols; c++) {
        const val = gridScores[srcRow * cols + c];
        const pixelIdx = (r * cols + c) * 4;

        if (val < 0.02) {
          // Transparent
          pixels[pixelIdx + 3] = 0;
          continue;
        }

        // Color thermal ramp: transparent -> deep blue -> violet -> red -> yellow -> white
        let red = 0, green = 0, blue = 0, alpha = Math.min(235, Math.floor(val * 240 + 40));

        if (val < 0.25) {
          const t = val / 0.25;
          red = Math.floor(30 * (1 - t) + 124 * t);
          green = Math.floor(58 * (1 - t) + 58 * t);
          blue = Math.floor(138 * (1 - t) + 237 * t);
        } else if (val < 0.6) {
          const t = (val - 0.25) / 0.35;
          red = Math.floor(124 * (1 - t) + 239 * t);
          green = Math.floor(58 * (1 - t) + 68 * t);
          blue = Math.floor(237 * (1 - t) + 68 * t);
        } else if (val < 0.85) {
          const t = (val - 0.6) / 0.25;
          red = Math.floor(239 * (1 - t) + 234 * t);
          green = Math.floor(68 * (1 - t) + 179 * t);
          blue = Math.floor(68 * (1 - t) + 8 * t);
        } else {
          const t = (val - 0.85) / 0.15;
          red = 255;
          green = Math.floor(179 * (1 - t) + 255 * t);
          blue = Math.floor(8 * (1 - t) + 255 * t);
          alpha = 255;
        }

        pixels[pixelIdx] = red;
        pixels[pixelIdx + 1] = green;
        pixels[pixelIdx + 2] = blue;
        pixels[pixelIdx + 3] = alpha;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const dataUrl = canvas.toDataURL();
    const imageBounds: L.LatLngBoundsExpression = [
      [area.minLat, area.minLon],
      [area.maxLat, area.maxLon],
    ];

    const overlay = L.imageOverlay(dataUrl, imageBounds, {
      opacity: 0.85,
      interactive: false,
    }).addTo(map);

    heatmapLayerRef.current = overlay;

    // Add Top Candidate Marker
    if (topLocation && topLocation.score > 0.05) {
      const topIcon = L.divIcon({
        className: 'top-candidate-marker',
        html: `
          <div style="position: relative; width: 28px; height: 28px;">
            <div style="position: absolute; inset: 0; border: 2.5px solid #10b981; border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite; opacity: 0.75;"></div>
            <div style="position: absolute; inset: 4px; background: rgba(16, 185, 129, 0.4); border: 2px solid #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px #10b981;">
              <div style="width: 6px; height: 6px; background: #ffffff; border-radius: 50%;"></div>
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const topMarker = L.marker([topLocation.lat, topLocation.lon], { icon: topIcon }).addTo(markerGroup);

      topMarker
        .bindPopup(
          `
          <div style="font-family: monospace; font-size: 12px; color: #0f172a; min-width: 180px;">
            <div style="font-weight: bold; color: #059669; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px;">
              📍 MOST LIKELY RECORDING LOCATION
            </div>
            <div><strong>Latitude:</strong> ${topLocation.lat.toFixed(5)}°</div>
            <div><strong>Longitude:</strong> ${topLocation.lon.toFixed(5)}°</div>
            <div><strong>Est. CPA Distance:</strong> ${Math.round(topLocation.dmin)} m</div>
            <div><strong>Est. CPA Time:</strong> ${topLocation.tcpa.toFixed(2)} s</div>
            <div><strong>Confidence:</strong> ${(topLocation.score * 100).toFixed(1)}%</div>
          </div>
        `
        )
        .openPopup();
    }
  }, [searchResult]);

  // Execute Colsto Geolocation Search
  const handleRunSearch = async () => {
    setIsCalculating(true);
    setCopiedCoords(false);

    try {
      // Small timeout to allow UI loading state to paint
      await new Promise((r) => setTimeout(r, 40));

      const res = await runColstoGeolocationSearch(
        selectedTrajectory,
        targetParams,
        searchArea,
        settings
      );
      setSearchResult(res);
    } catch (err) {
      alert(`Search failed: ${(err as Error).message}`);
    } finally {
      setIsCalculating(false);
    }
  };

  // Sync parameters from AeroDoppler
  const handleSyncFromAeroDoppler = () => {
    if (fittedParams) {
      setTargetParams({ ...fittedParams });
    } else {
      alert('No fitted parameters available in AeroDoppler yet. Plot points or run auto-detect first.');
    }
  };

  // Fetch from adsb.lol API
  const handleFetchAdsbLol = async () => {
    setIsLoadingAdsb(true);
    setAdsbStatusMsg('Querying adsb.lol API...');

    try {
      const centerLat = (searchArea.minLat + searchArea.maxLat) / 2;
      const centerLon = (searchArea.minLon + searchArea.maxLon) / 2;
      const res = await fetchAdsbLol(centerLat, centerLon, settings.searchRadiusKm * 0.539957);

      if (res.length > 0) {
        setTrajectories(res);
        setSelectedTrajectory(res[0]);
        setAdsbStatusMsg(`Successfully loaded ${res.length} aircraft flights from adsb.lol!`);
      } else {
        setAdsbStatusMsg('No aircraft found in this radius right now. Loaded fallback corridor.');
      }
    } catch (err) {
      setAdsbStatusMsg(`adsb.lol query failed (${(err as Error).message}). Using benchmark flight.`);
    } finally {
      setIsLoadingAdsb(false);
    }
  };

  // Custom File Upload
  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const traj = parseCustomAdsbFile(text, file.name);
        setTrajectories([traj]);
        setSelectedTrajectory(traj);
        alert(`Loaded flight trajectory "${traj.callsign}" with ${traj.waypoints.length} waypoints.`);
      } catch (err) {
        alert(`File error: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Benchmark Flight Selection
  const handleSelectBenchmark = (id: string) => {
    setSelectedBenchmarkId(id);
    const f = BENCHMARK_FLIGHTS.find((b) => b.id === id);
    if (f) {
      setSelectedTrajectory(f);
    }
  };

  // Copy coordinates
  const handleCopyCoords = () => {
    if (!searchResult?.topLocation) return;
    const text = `${searchResult.topLocation.lat.toFixed(6)}, ${searchResult.topLocation.lon.toFixed(6)}`;
    navigator.clipboard.writeText(text);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden bg-darkbg text-slate-200">
      {/* Top Header */}
      <header className="bg-panelbg border-b border-slate-800 px-4 sm:px-6 py-2.5 flex items-center justify-between shadow-lg z-30 shrink-0">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToSpectrogram}
            title="Back to AeroDoppler Spectrogram"
            className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/20 transition duration-150 flex items-center justify-center cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-wide text-slate-100 flex items-center gap-2">
              Colsto Geolocation Heatmap Finder{' '}
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono border border-rose-500/30">
                WASM ACCELERATED
              </span>
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Acoustic Flight Path Matching &amp; Ground Observer Heatmap Inversion
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {searchResult && (
            <button
              onClick={handleCopyCoords}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition cursor-pointer"
            >
              {copiedCoords ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-400" />}
              <span>{copiedCoords ? 'Copied Lat/Lon!' : 'Copy Top Location'}</span>
            </button>
          )}

          <button
            onClick={handleRunSearch}
            disabled={isCalculating}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-4 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition duration-150 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 fill-current ${isCalculating ? 'animate-spin' : ''}`} />
            <span>{isCalculating ? 'Calculating Heatmap...' : 'Run Colsto Finder'}</span>
          </button>
        </div>
      </header>

      {/* Main Body: Map on Left/Center, Settings Panel on Right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Map Visualization Area */}
        <div className="flex-1 relative flex flex-col overflow-hidden bg-slate-950">
          <div ref={mapContainerRef} className="flex-1 w-full h-full relative z-10" />

          {/* Floating Performance / Result Overlay Badge */}
          {searchResult && (
            <div className="absolute top-4 left-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-3 shadow-2xl max-w-sm text-xs font-mono space-y-1.5 pointer-events-auto">
              <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5" /> Best Recording Location
                </span>
                <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  {searchResult.engineUsed === 'wasm' ? 'RUST WASM' : 'VECTOR JS'}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Coordinates:</span>
                <span className="text-cyan-400 font-bold">
                  {searchResult.topLocation.lat.toFixed(5)}°, {searchResult.topLocation.lon.toFixed(5)}°
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Closest Distance (d_min):</span>
                <span className="text-amber-400 font-bold">{Math.round(searchResult.topLocation.dmin)} m</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>CPA Time (t_cpa):</span>
                <span className="text-slate-200">{searchResult.topLocation.tcpa.toFixed(2)} s</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Match Likelihood:</span>
                <span className="text-emerald-400 font-bold">{(searchResult.topLocation.score * 100).toFixed(1)}%</span>
              </div>
              <div className="pt-1 border-t border-slate-800/80 text-[10px] text-slate-400 flex justify-between">
                <span>Evaluated: {searchResult.evaluationsCount.toLocaleString()} pts</span>
                <span className="text-cyan-300">{searchResult.executionTimeMs.toFixed(1)} ms</span>
              </div>
            </div>
          )}

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-20 bg-slate-900/85 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg text-[10px] font-mono text-slate-300 flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
              <span>Flight Trajectory</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
              <span>CPA Trajectory Point</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-2 rounded bg-gradient-to-r from-blue-900 via-rose-500 to-white inline-block"></div>
              <span>Likelihood Heatmap</span>
            </div>
          </div>
        </div>

        {/* Right: Controls & Parameters Sidebar */}
        <aside className="w-96 bg-panelbg border-l border-slate-800 p-4 flex flex-col space-y-4 overflow-y-auto shrink-0 text-xs select-none">
          {/* Section 1: Target Doppler Curve Parameters */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" /> Doppler Target Parameters
              </h3>
              <button
                onClick={handleSyncFromAeroDoppler}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 underline font-mono cursor-pointer"
              >
                Sync from AeroDoppler
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                <span className="text-[10px] text-slate-400 block">Ground Speed (v)</span>
                <span className="text-cyan-400 font-bold">
                  {Math.round(targetParams.v * 3.6)} km/h
                </span>
                <span className="text-[10px] text-slate-500 block">({Math.round(targetParams.v)} m/s)</span>
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                <span className="text-[10px] text-slate-400 block">Closest Dist (d_min)</span>
                <span className="text-amber-400 font-bold">{Math.round(targetParams.dmin)} m</span>
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                <span className="text-[10px] text-slate-400 block">CPA Time (t₀)</span>
                <span className="text-slate-200 font-bold">{targetParams.t0.toFixed(2)} s</span>
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800/80">
                <span className="text-[10px] text-slate-400 block">Base Freq (f₀)</span>
                <span className="text-emerald-400 font-bold">{Math.round(targetParams.f0)} Hz</span>
              </div>
            </div>

            {/* Slider to adjust distance if desired */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Target Distance (d_min)</span>
                <span className="font-mono text-cyan-400">{Math.round(targetParams.dmin)} m</span>
              </div>
              <input
                type="range"
                min={50}
                max={5000}
                step={25}
                value={targetParams.dmin}
                onChange={(e) =>
                  setTargetParams((prev) => ({ ...prev, dmin: parseFloat(e.target.value) }))
                }
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Section 2: Flight Data Source (adsb.lol vs Custom Upload vs Benchmarks) */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-emerald-400" /> Aircraft Trajectory Source
            </h3>

            {/* Source Type Selector */}
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
              <button
                onClick={() => setSourceType('benchmark')}
                className={`py-1.5 rounded transition ${
                  sourceType === 'benchmark' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Preset Flight
              </button>
              <button
                onClick={() => setSourceType('adsblol')}
                className={`py-1.5 rounded transition ${
                  sourceType === 'adsblol' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                adsb.lol API
              </button>
              <button
                onClick={() => setSourceType('upload')}
                className={`py-1.5 rounded transition ${
                  sourceType === 'upload' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Upload File
              </button>
            </div>

            {/* Sub-panels for selected source */}
            {sourceType === 'benchmark' && (
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 block">Select Benchmark Corridor:</label>
                <select
                  value={selectedBenchmarkId}
                  onChange={(e) => handleSelectBenchmark(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-2 focus:ring-1 focus:ring-cyan-500 font-mono"
                >
                  <option value="typhoon_salisbury">Typhoon Fast Jet (Salisbury Plain, UK)</option>
                  <option value="b738_heathrow">Boeing 737-800 Approach (Heathrow, UK)</option>
                  <option value="c172_cambridge">Cessna 172 Skyhawk (Cambridge, UK)</option>
                </select>
                <p className="text-[10px] text-slate-500 leading-relaxed font-mono">
                  Ground truth: Salisbury Station lat 51.1245°N, lon -1.8250°W (matches Typhoon profile).
                </p>
              </div>
            )}

            {sourceType === 'adsblol' && (
              <div className="space-y-2">
                <button
                  onClick={handleFetchAdsbLol}
                  disabled={isLoadingAdsb}
                  className="w-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{isLoadingAdsb ? 'Querying adsb.lol...' : 'Query adsb.lol for Area Flights'}</span>
                </button>
                {adsbStatusMsg && (
                  <p className="text-[10px] text-cyan-400 font-mono leading-relaxed">{adsbStatusMsg}</p>
                )}
              </div>
            )}

            {sourceType === 'upload' && (
              <div className="space-y-2">
                <label className="border border-dashed border-slate-700 hover:border-cyan-400 bg-slate-950/70 p-3 rounded-xl flex flex-col items-center justify-center cursor-pointer transition">
                  <Upload className="w-5 h-5 text-cyan-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-200">Upload ADS-B Trajectory</span>
                  <span className="text-[10px] text-slate-500 font-mono">JSON (dump1090) or CSV</span>
                  <input
                    type="file"
                    accept=".json,.csv,.txt,.sbs1"
                    onChange={handleCustomFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {/* Selected Trajectory Summary */}
            <div className="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 text-[11px] font-mono space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-400">Callsign:</span>
                <span className="text-cyan-400 font-bold">{selectedTrajectory.callsign}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">ICAO Hex:</span>
                <span className="text-slate-200">{selectedTrajectory.hex}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Waypoints:</span>
                <span className="text-slate-200">{selectedTrajectory.waypoints.length} points</span>
              </div>
            </div>
          </div>

          {/* Section 3: Date & Time Window */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-amber-400" /> Date &amp; Time Window
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Recording Date</label>
                <input
                  type="date"
                  value={recordingDate}
                  onChange={(e) => setRecordingDate(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-1.5 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Time (UTC)</label>
                <input
                  type="time"
                  step="1"
                  value={recordingTime}
                  onChange={(e) => setRecordingTime(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-1.5 font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Time Window Tolerance</span>
                <span className="font-mono text-cyan-400">±{timeWindowMin} min</span>
              </div>
              <input
                type="range"
                min={2}
                max={60}
                step={1}
                value={timeWindowMin}
                onChange={(e) => setTimeWindowMin(parseInt(e.target.value))}
                className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>

          {/* Section 4: Grid Density & Performance Optimizer */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-rose-400" /> Colsto Optimizer &amp; Grid Resolution
            </h3>

            {/* Resolution Selector */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Grid Resolution</span>
                <span className="font-mono text-cyan-400">
                  {settings.gridResolution}×{settings.gridResolution} ({settings.gridResolution * settings.gridResolution} pts)
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[10px] font-mono">
                {[40, 80, 160, 300].map((res) => (
                  <button
                    key={res}
                    onClick={() => setSettings((prev) => ({ ...prev, gridResolution: res }))}
                    className={`py-1 rounded border transition ${
                      settings.gridResolution === res
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {res}×{res}
                  </button>
                ))}
              </div>
            </div>

            {/* WebAssembly Acceleration Toggle */}
            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer pt-2 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.useWasm}
                  onChange={(e) => setSettings((prev) => ({ ...prev, useWasm: e.target.checked }))}
                  className="accent-rose-400 rounded cursor-pointer"
                />
                <span className="font-semibold text-rose-300">WebAssembly (WASM) Engine</span>
              </div>
              <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/30 px-1.5 py-0.5 rounded font-mono">
                ~10M pts/s
              </span>
            </label>

            {/* Colsto Cylindrical Envelope Pruning */}
            <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.spatialPruning}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, spatialPruning: e.target.checked }))
                  }
                  className="accent-cyan-400 rounded cursor-pointer"
                />
                <span>Colsto Cylinder Pruning</span>
              </div>
              <span className="text-[10px] text-cyan-400 font-mono">15x speedup</span>
            </label>
          </div>

          {/* Section 5: Run Calculation Button */}
          <button
            onClick={handleRunSearch}
            disabled={isCalculating}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 transition duration-150 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50 mt-auto"
          >
            <Zap className={`w-4 h-4 fill-current ${isCalculating ? 'animate-spin' : ''}`} />
            <span>{isCalculating ? 'Calculating Spatial Inversion...' : 'Calculate Geolocation Heatmap'}</span>
          </button>
        </aside>
      </div>
    </div>
  );
};
