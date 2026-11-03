import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import {
  DopplerPoint,
  FittedParams,
  FlightMatchResult,
  FlightTrajectory,
  GeoCandidate,
  GeoSearchResult,
  GeoSettings,
  MultiFlightSearchResult,
  SearchArea,
} from '../types';
import {
  BENCHMARK_FLIGHTS,
  fetchAdsbLol,
  parseCustomAdsbFiles,
} from '../services/adsbService';
import { runDopplerGeolocationSearch, runMultiFlightGeolocationSearch } from '../wasm/wasmEngine';
import {
  Zap,
  MapPin,
  Upload,
  Globe,
  Radio,
  Sliders,
  CheckCircle2,
  Copy,
  Calendar,
  Layers,
  ArrowLeft,
  Plane,
  ChevronRight,
  TrendingUp,
  Activity,
  Wrench,
  Crop,
  Maximize2,
  Crosshair,
} from 'lucide-react';

interface DopplerLocatorProps {
  onBackToDirectory?: () => void;
  onBackToSpectrogram: () => void;
  fittedParams: FittedParams | null;
  recordedPoints: DopplerPoint[];
}

export const DopplerLocator: React.FC<DopplerLocatorProps> = ({
  onBackToDirectory,
  onBackToSpectrogram,
  fittedParams,
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

  // Flight Data Source & Pool
  const [sourceType, setSourceType] = useState<'benchmark' | 'adsblol' | 'upload'>('benchmark');
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>('all_benchmarks');
  const [trajectories, setTrajectories] = useState<FlightTrajectory[]>(BENCHMARK_FLIGHTS);
  const [selectedTrajectory, setSelectedTrajectory] = useState<FlightTrajectory>(BENCHMARK_FLIGHTS[0]);
  const [isLoadingAdsb, setIsLoadingAdsb] = useState(false);
  const [adsbStatusMsg, setAdsbStatusMsg] = useState('');

  // Date and Time window
  const [recordingDate, setRecordingDate] = useState('2026-11-03');
  const [recordingTime, setRecordingTime] = useState('14:32:00');
  const [timeWindowMin, setTimeWindowMin] = useState(15);

  // Search Area (lat/lon bounds)
  const [searchArea, setSearchArea] = useState<SearchArea>(() => ({
    minLat: 51.0500,
    maxLat: 51.2800,
    minLon: -2.0500,
    maxLon: -1.6500,
  }));

  // Region Selection Mode
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);
  const drawStartRef = useRef<L.LatLng | null>(null);
  const tempDrawRectRef = useRef<L.Rectangle | null>(null);

  // Settings & Optimization
  const [settings, setSettings] = useState<GeoSettings>({
    useWasm: true,
    gridResolution: 80, // 80x80 = 6,400 points
    searchRadiusKm: 25,
    spatialPruning: true,
    elevationModel: false,
    soundSpeed: 343.0,
    sigmaDist: 45.0,
    sigmaTime: 0.8,
  });

  // Calculation Results (Multi-Flight Correlation)
  const [isCalculating, setIsCalculating] = useState(false);
  const [multiResult, setMultiResult] = useState<MultiFlightSearchResult | null>(null);
  const [activeFlightMatch, setActiveFlightMatch] = useState<FlightMatchResult | null>(null);
  const [heatmapMode, setHeatmapMode] = useState<'best' | 'composite'>('best');
  const [copiedCoords, setCopiedCoords] = useState(false);

  // Map Tile Style (OpenStreetMap & Satellite)
  const [mapStyle, setMapStyle] = useState<'osm_dark' | 'osm_standard' | 'satellite'>('osm_dark');

  // Leaflet Map Refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const heatmapLayerRef = useRef<L.ImageOverlay | null>(null);
  const flightPathLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const searchBoundsLayerRef = useRef<L.Rectangle | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [51.1500, -1.8500],
      zoom: 11,
      zoomControl: true,
    });

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

  // Update Base Tile Layer when mapStyle changes (OpenStreetMap / Satellite)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
      baseTileLayerRef.current = null;
    }

    let layer: L.TileLayer;

    if (mapStyle === 'satellite') {
      layer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          maxZoom: 19,
          attribution: 'Tiles &copy; Esri &mdash; World Imagery',
        }
      );
    } else if (mapStyle === 'osm_standard') {
      layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      });
    } else {
      // OpenStreetMap with Dark Filter (Zero third-party limit)
      layer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        className: 'map-tiles-dark',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      });
    }

    layer.addTo(map);
    baseTileLayerRef.current = layer;
  }, [mapStyle]);

  // Interactive Region Selection on Map (Drag to Draw Box)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (isDrawingRegion) {
      map.dragging.disable();
      const container = map.getContainer();
      container.style.cursor = 'crosshair';

      const handleMouseDown = (e: L.LeafletMouseEvent) => {
        drawStartRef.current = e.latlng;
        if (tempDrawRectRef.current) {
          map.removeLayer(tempDrawRectRef.current);
        }
        tempDrawRectRef.current = L.rectangle(L.latLngBounds(e.latlng, e.latlng), {
          color: '#00f2fe',
          weight: 2,
          dashArray: '4, 4',
          fillColor: '#00f2fe',
          fillOpacity: 0.15,
        }).addTo(map);
      };

      const handleMouseMove = (e: L.LeafletMouseEvent) => {
        if (!drawStartRef.current || !tempDrawRectRef.current) return;
        tempDrawRectRef.current.setBounds(L.latLngBounds(drawStartRef.current, e.latlng));
      };

      const handleMouseUp = (e: L.LeafletMouseEvent) => {
        if (!drawStartRef.current) return;
        const start = drawStartRef.current;
        const end = e.latlng;
        drawStartRef.current = null;

        if (tempDrawRectRef.current) {
          map.removeLayer(tempDrawRectRef.current);
          tempDrawRectRef.current = null;
        }

        const minLat = Math.min(start.lat, end.lat);
        const maxLat = Math.max(start.lat, end.lat);
        const minLon = Math.min(start.lng, end.lng);
        const maxLon = Math.max(start.lng, end.lng);

        // If dragged more than a tiny click, set region
        if (Math.abs(maxLat - minLat) > 0.005 && Math.abs(maxLon - minLon) > 0.005) {
          setSearchArea({ minLat, maxLat, minLon, maxLon });
          setIsDrawingRegion(false);
          map.dragging.enable();
          container.style.cursor = '';
        }
      };

      map.on('mousedown', handleMouseDown);
      map.on('mousemove', handleMouseMove);
      map.on('mouseup', handleMouseUp);

      return () => {
        map.dragging.enable();
        container.style.cursor = '';
        map.off('mousedown', handleMouseDown);
        map.off('mousemove', handleMouseMove);
        map.off('mouseup', handleMouseUp);
        if (tempDrawRectRef.current) {
          map.removeLayer(tempDrawRectRef.current);
          tempDrawRectRef.current = null;
        }
      };
    } else {
      map.dragging.enable();
      map.getContainer().style.cursor = '';
    }
  }, [isDrawingRegion]);

  // Render ALL Flight Paths on the Map (Selected in Cyan, Others in subtle lines)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const flightGroup = flightPathLayerRef.current;
    if (!map || !flightGroup || trajectories.length === 0) return;

    flightGroup.clearLayers();

    trajectories.forEach((traj) => {
      const isSelected = selectedTrajectory && traj.id === selectedTrajectory.id;
      const latlngs: [number, number][] = traj.waypoints.map((wp) => [wp.lat, wp.lon]);
      if (latlngs.length < 2) return;

      // Draw flight line
      const polyline = L.polyline(latlngs, {
        color: isSelected ? '#00f2fe' : '#64748b',
        weight: isSelected ? 3.5 : 2,
        opacity: isSelected ? 0.95 : 0.45,
        dashArray: isSelected ? undefined : '4, 4',
      }).addTo(flightGroup);

      polyline.bindTooltip(
        `<b>${traj.callsign}</b> (${traj.type || 'Aircraft'}) · ${Math.round(
          traj.waypoints[0].groundSpeed * 3.6
        )} km/h`,
        { permanent: false, sticky: true }
      );

      // If selected flight, draw waypoints
      if (isSelected) {
        traj.waypoints.forEach((wp, idx) => {
          const isMid = idx === Math.floor(traj.waypoints.length / 2);
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
              <strong>${traj.callsign} — WP #${idx + 1}</strong><br/>
              Time: ${wp.timestamp.toFixed(1)}s<br/>
              Altitude: ${Math.round(wp.alt)} m (${Math.round(wp.alt * 3.28084)} ft)<br/>
              Speed: ${Math.round(wp.groundSpeed * 3.6)} km/h (${Math.round(wp.groundSpeed)} m/s)<br/>
              Track: ${Math.round(wp.track || 0)}°
            </div>
          `);
        });
      }
    });
  }, [trajectories, selectedTrajectory]);

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
      fillOpacity: 0.04,
    }).addTo(map);

    searchBoundsLayerRef.current = rect;
  }, [searchArea]);

  // Fit Region to Currently Visible Viewport
  const handleFitRegionToViewport = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const b = map.getBounds();
    setSearchArea({
      minLat: b.getSouth(),
      maxLat: b.getNorth(),
      minLon: b.getWest(),
      maxLon: b.getEast(),
    });
  };

  // Fit Region Around Loaded Flights
  const handleFitRegionToFlights = () => {
    const bounds = L.latLngBounds([]);
    trajectories.forEach((t) => {
      t.waypoints.forEach((wp) => bounds.extend([wp.lat, wp.lon]));
    });

    if (bounds.isValid()) {
      const latSpan = Math.max(0.08, bounds.getNorth() - bounds.getSouth());
      const lonSpan = Math.max(0.08, bounds.getEast() - bounds.getWest());

      setSearchArea({
        minLat: bounds.getSouth() - latSpan * 0.35,
        maxLat: bounds.getNorth() + latSpan * 0.35,
        minLon: bounds.getWest() - lonSpan * 0.35,
        maxLon: bounds.getEast() + lonSpan * 0.35,
      });

      mapInstanceRef.current?.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  // Render Heatmap overlay onto Leaflet map (Selected flight or Composite)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markerGroup = markerLayerRef.current;
    if (!map || !markerGroup) return;

    if (heatmapLayerRef.current) {
      map.removeLayer(heatmapLayerRef.current);
      heatmapLayerRef.current = null;
    }
    markerGroup.clearLayers();

    if (!multiResult) return;

    const scoresToRender =
      heatmapMode === 'composite'
        ? multiResult.compositeScores
        : activeFlightMatch?.searchResult.gridScores || multiResult.bestMatch?.searchResult.gridScores;

    if (!scoresToRender) return;

    const { cols, rows, searchArea: area } = multiResult;

    const canvas = document.createElement('canvas');
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let r = 0; r < rows; r++) {
      const srcRow = rows - 1 - r;
      for (let c = 0; c < cols; c++) {
        const val = scoresToRender[srcRow * cols + c];
        const pixelIdx = (r * cols + c) * 4;

        if (val < 0.02) {
          pixels[pixelIdx + 3] = 0;
          continue;
        }

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

    // Pin Location Marker for active flight
    const topLoc = activeFlightMatch?.topLocation || multiResult.bestMatch?.topLocation;
    const topFlight = activeFlightMatch?.trajectory || multiResult.bestMatch?.trajectory;

    if (topLoc && topLoc.score > 0.05) {
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

      const topMarker = L.marker([topLoc.lat, topLoc.lon], { icon: topIcon }).addTo(markerGroup);

      topMarker
        .bindPopup(
          `
          <div style="font-family: monospace; font-size: 12px; color: #0f172a; min-width: 200px;">
            <div style="font-weight: bold; color: #059669; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px;">
              📍 MOST LIKELY RECORDING LOCATION
            </div>
            <div><strong>Matched Flight:</strong> ${topFlight?.callsign} (${topFlight?.type || 'Plane'})</div>
            <div><strong>Coordinates:</strong> ${topLoc.lat.toFixed(5)}°, ${topLoc.lon.toFixed(5)}°</div>
            <div><strong>Est. CPA Distance:</strong> ${Math.round(topLoc.dmin)} m</div>
            <div><strong>Est. CPA Time:</strong> ${topLoc.tcpa.toFixed(2)} s</div>
            <div><strong>Match Score:</strong> ${(activeFlightMatch?.matchScore || 0).toFixed(1)}%</div>
          </div>
        `
        )
        .openPopup();
    }
  }, [multiResult, activeFlightMatch, heatmapMode]);

  // Execute Search Across ALL Flights in the Region
  const handleRunSearch = async () => {
    setIsCalculating(true);
    setCopiedCoords(false);

    try {
      await new Promise((r) => setTimeout(r, 40));

      const res = await runMultiFlightGeolocationSearch(
        trajectories,
        targetParams,
        searchArea,
        settings
      );

      setMultiResult(res);
      if (res.bestMatch) {
        setActiveFlightMatch(res.bestMatch);
        setSelectedTrajectory(res.bestMatch.trajectory);
      }
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

  // Fetch from adsb.lol API for the Selected Region
  const handleFetchAdsbLolForRegion = async () => {
    setIsLoadingAdsb(true);
    setAdsbStatusMsg('Scanning selected region airspace via adsb.lol...');

    try {
      const centerLat = (searchArea.minLat + searchArea.maxLat) / 2;
      const centerLon = (searchArea.minLon + searchArea.maxLon) / 2;

      // Calculate approximate radius covering the search box in NM
      const latDiffKm = Math.abs(searchArea.maxLat - searchArea.minLat) * 111;
      const lonDiffKm = Math.abs(searchArea.maxLon - searchArea.minLon) * 111 * Math.cos((centerLat * Math.PI) / 180);
      const radiusKm = Math.max(10, Math.hypot(latDiffKm, lonDiffKm) / 2);
      const radiusNm = radiusKm * 0.539957;

      const { trajectories: list, sourceNotice } = await fetchAdsbLol(centerLat, centerLon, radiusNm);

      if (list.length > 0) {
        setTrajectories(list);
        setSelectedTrajectory(list[0]);
        setAdsbStatusMsg(sourceNotice);
      }
    } catch (err) {
      setAdsbStatusMsg(`adsb.lol query failed: ${(err as Error).message}`);
    } finally {
      setIsLoadingAdsb(false);
    }
  };

  // Custom File Upload (supports multiple flights in one file)
  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const list = parseCustomAdsbFiles(text, file.name);
        setTrajectories(list);
        setSelectedTrajectory(list[0]);
        alert(`Successfully imported ${list.length} flight trajectories from ${file.name}!`);
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
    if (id === 'all_benchmarks') {
      setTrajectories(BENCHMARK_FLIGHTS);
      setSelectedTrajectory(BENCHMARK_FLIGHTS[0]);
    } else {
      const f = BENCHMARK_FLIGHTS.find((b) => b.id === id);
      if (f) {
        setTrajectories([f]);
        setSelectedTrajectory(f);
      }
    }
  };

  // Copy coordinates
  const handleCopyCoords = () => {
    const topLoc = activeFlightMatch?.topLocation || multiResult?.bestMatch?.topLocation;
    if (!topLoc) return;
    const text = `${topLoc.lat.toFixed(6)}, ${topLoc.lon.toFixed(6)}`;
    navigator.clipboard.writeText(text);
    setCopiedCoords(true);
    setTimeout(() => setCopiedCoords(false), 2000);
  };

  // Search Area Dimension Stats
  const areaWidthKm = Math.abs(searchArea.maxLon - searchArea.minLon) * 111 * Math.cos((((searchArea.minLat + searchArea.maxLat) / 2) * Math.PI) / 180);
  const areaHeightKm = Math.abs(searchArea.maxLat - searchArea.minLat) * 111;

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden bg-darkbg text-slate-200">
      {/* Top Header */}
      <header className="bg-panelbg border-b border-slate-800 px-4 sm:px-6 py-2.5 flex items-center justify-between shadow-lg z-30 shrink-0">
        <div className="flex items-center space-x-3">
          {onBackToDirectory && (
            <button
              onClick={onBackToDirectory}
              title="Back to All Tools"
              className="p-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 transition flex items-center justify-center cursor-pointer gap-1.5 text-xs font-mono"
            >
              <Wrench className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Tools</span>
            </button>
          )}

          <button
            onClick={onBackToSpectrogram}
            title="Open AeroDoppler Spectrogram Analyzer"
            className="p-2 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400 hover:bg-cyan-500/20 transition flex items-center justify-center cursor-pointer gap-1.5 text-xs font-mono"
          >
            <Activity className="w-4 h-4" />
            <span className="hidden md:inline">Spectrogram</span>
          </button>

          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-wide text-slate-100 flex items-center gap-2">
              Doppler Flight Locator{' '}
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono border border-rose-500/30">
                WASM ACCELERATED
              </span>
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Regional Airspace Acoustic Inversion &amp; Ground Observer Heatmap Finder
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {multiResult && (
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
            <span>
              {isCalculating
                ? `Searching ${trajectories.length} Flights...`
                : `Correlate All ${trajectories.length} Region Flights`}
            </span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Map Visualization Area */}
        <div className="flex-1 relative flex flex-col overflow-hidden bg-slate-950">
          <div ref={mapContainerRef} className="flex-1 w-full h-full relative z-10" />

          {/* Interactive Region Selection Floating Toolbar */}
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 pointer-events-auto flex-wrap">
            <button
              onClick={() => setIsDrawingRegion((prev) => !prev)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 border shadow-xl transition cursor-pointer ${
                isDrawingRegion
                  ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                  : 'bg-slate-900/90 hover:bg-slate-800 border-cyan-500/40 text-cyan-300 backdrop-blur-md'
              }`}
              title="Click and drag on map to draw a new region bounding box"
            >
              <Crop className="w-3.5 h-3.5" />
              <span>{isDrawingRegion ? 'Drawing... Drag on Map' : 'Select Region Box'}</span>
            </button>

            <button
              onClick={handleFitRegionToFlights}
              className="bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition shadow-xl backdrop-blur-md cursor-pointer"
              title="Fit search area around all loaded flights"
            >
              <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Fit Flights</span>
            </button>

            <button
              onClick={handleFitRegionToViewport}
              className="bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center gap-1.5 transition shadow-xl backdrop-blur-md cursor-pointer"
              title="Fit search area to currently visible map screen"
            >
              <Crosshair className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Current View</span>
            </button>

            {/* Region Dimensions Badge */}
            <div className="bg-slate-900/90 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-lg text-[11px] font-mono text-slate-300 shadow-xl hidden md:flex items-center gap-2">
              <span className="text-slate-500">REGION:</span>
              <span className="text-cyan-400 font-bold">
                {areaWidthKm.toFixed(1)} km × {areaHeightKm.toFixed(1)} km
              </span>
            </div>
          </div>

          {/* Map Layer Switcher (OpenStreetMap & Satellite) */}
          <div className="absolute top-4 right-4 z-20 bg-slate-900/90 backdrop-blur-md border border-slate-800 p-1 rounded-lg flex items-center gap-1 text-[11px] font-mono shadow-xl pointer-events-auto">
            <button
              onClick={() => setMapStyle('osm_dark')}
              className={`px-2.5 py-1 rounded transition ${
                mapStyle === 'osm_dark'
                  ? 'bg-cyan-500/25 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="OpenStreetMap with Dark UI styling (100% free, zero limits)"
            >
              OSM Dark
            </button>
            <button
              onClick={() => setMapStyle('osm_standard')}
              className={`px-2.5 py-1 rounded transition ${
                mapStyle === 'osm_standard'
                  ? 'bg-cyan-500/25 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Standard OpenStreetMap tiles (100% free, zero limits)"
            >
              OSM Standard
            </button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={`px-2.5 py-1 rounded transition ${
                mapStyle === 'satellite'
                  ? 'bg-cyan-500/25 text-cyan-300 font-semibold border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="World Satellite Imagery"
            >
              Satellite
            </button>
          </div>

          {/* Floating Regional Flight Correlation Leaderboard */}
          {multiResult && (
            <div className="absolute top-16 left-4 z-20 bg-slate-900/95 backdrop-blur-md border border-slate-800 rounded-xl p-3.5 shadow-2xl w-80 text-xs font-mono space-y-2 pointer-events-auto max-h-[75vh] flex flex-col">
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 shrink-0">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <TrendingUp className="w-3.5 h-3.5" /> Regional Flight Matches ({multiResult.matches.length})
                </span>
                <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  {multiResult.engineUsed === 'wasm' ? 'WASM' : 'VECTOR JS'} · {multiResult.executionTimeMs.toFixed(0)}ms
                </span>
              </div>

              {/* Heatmap Mode Toggle */}
              <div className="grid grid-cols-2 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] shrink-0">
                <button
                  onClick={() => setHeatmapMode('best')}
                  className={`py-1 rounded transition ${
                    heatmapMode === 'best'
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Selected Flight Heatmap
                </button>
                <button
                  onClick={() => setHeatmapMode('composite')}
                  className={`py-1 rounded transition ${
                    heatmapMode === 'composite'
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All-Flight Composite
                </button>
              </div>

              {/* Ranked Matches List */}
              <div className="overflow-y-auto space-y-1.5 pr-1 flex-1">
                {multiResult.matches.map((m) => {
                  const isCur = selectedTrajectory && m.trajectory.id === selectedTrajectory.id;
                  return (
                    <div
                      key={m.trajectory.id}
                      onClick={() => {
                        setSelectedTrajectory(m.trajectory);
                        setActiveFlightMatch(m);
                      }}
                      className={`p-2 rounded-lg border transition cursor-pointer flex items-center justify-between gap-2 ${
                        isCur
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-200 shadow-md'
                          : 'bg-slate-950/80 border-slate-800/80 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span
                          className={`w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] shrink-0 ${
                            m.rank === 1
                              ? 'bg-emerald-500 text-slate-950'
                              : m.rank === 2
                              ? 'bg-cyan-500 text-slate-950'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          #{m.rank}
                        </span>
                        <div className="truncate">
                          <div className="font-bold flex items-center gap-1.5">
                            <span>{m.trajectory.callsign}</span>
                            <span className="text-[10px] text-slate-500">({m.trajectory.hex})</span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {m.trajectory.type || 'Plane'} · Δv {Math.round(m.speedDiff * 3.6)} km/h
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`font-bold block ${
                            m.matchScore > 75
                              ? 'text-emerald-400'
                              : m.matchScore > 40
                              ? 'text-cyan-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {m.matchScore.toFixed(0)}%
                        </span>
                        <span className="text-[9px] text-slate-500">d:{Math.round(m.dmin)}m</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Best Location Summary Footer */}
              {activeFlightMatch && (
                <div className="pt-2 border-t border-slate-800 text-[11px] space-y-1 shrink-0">
                  <div className="flex justify-between text-slate-400">
                    <span>Observer Coordinates:</span>
                    <span className="text-cyan-400 font-bold">
                      {activeFlightMatch.topLocation.lat.toFixed(5)}°, {activeFlightMatch.topLocation.lon.toFixed(5)}°
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Closest Distance (d_min):</span>
                    <span className="text-amber-400 font-bold">{Math.round(activeFlightMatch.dmin)} m</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>CPA Time (t_cpa):</span>
                    <span className="text-slate-200">{activeFlightMatch.tcpa.toFixed(2)} s</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Map Legend */}
          <div className="absolute bottom-4 left-4 z-20 bg-slate-900/85 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg text-[10px] font-mono text-slate-300 flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
              <span>Selected Flight</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 border-b border-dashed border-slate-500 inline-block"></span>
              <span>Other Flights in Region</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-16 h-2 rounded bg-gradient-to-r from-blue-900 via-rose-500 to-white inline-block"></div>
              <span>Likelihood Heatmap</span>
            </div>
          </div>
        </div>

        {/* Right: Controls & Parameters Sidebar */}
        <aside className="w-96 bg-panelbg border-l border-slate-800 p-4 flex flex-col space-y-4 overflow-y-auto shrink-0 text-xs select-none">
          {/* Section 1: Selected Search Region Controls */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Crop className="w-3.5 h-3.5 text-cyan-400" /> Selected Search Region
              </h3>
              <span className="text-[10px] text-cyan-400 font-mono">
                {areaWidthKm.toFixed(0)}×{areaHeightKm.toFixed(0)} km
              </span>
            </div>

            {/* Quick action buttons for region selection */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
              <button
                onClick={() => setIsDrawingRegion((prev) => !prev)}
                className={`py-1.5 px-2 rounded-lg border flex items-center justify-center gap-1 transition ${
                  isDrawingRegion
                    ? 'bg-rose-500/25 border-rose-500 text-rose-300 font-bold'
                    : 'bg-slate-950 border-slate-800 text-cyan-300 hover:border-cyan-500/50'
                }`}
              >
                <Crop className="w-3 h-3" />
                <span>{isDrawingRegion ? 'Stop Drawing' : 'Draw Box on Map'}</span>
              </button>
              <button
                onClick={handleFitRegionToFlights}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition"
              >
                <Maximize2 className="w-3 h-3 text-emerald-400" />
                <span>Fit to Flights</span>
              </button>
            </div>

            {/* Manual Lat/Lon Bounds Editor */}
            <div className="space-y-1.5 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800 text-[11px] font-mono">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">North Lat:</span>
                <input
                  type="number"
                  step="0.01"
                  value={searchArea.maxLat.toFixed(4)}
                  onChange={(e) =>
                    setSearchArea((prev) => ({ ...prev, maxLat: parseFloat(e.target.value) || prev.maxLat }))
                  }
                  className="w-24 bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-right text-slate-200"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">South Lat:</span>
                <input
                  type="number"
                  step="0.01"
                  value={searchArea.minLat.toFixed(4)}
                  onChange={(e) =>
                    setSearchArea((prev) => ({ ...prev, minLat: parseFloat(e.target.value) || prev.minLat }))
                  }
                  className="w-24 bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-right text-slate-200"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">West Lon:</span>
                <input
                  type="number"
                  step="0.01"
                  value={searchArea.minLon.toFixed(4)}
                  onChange={(e) =>
                    setSearchArea((prev) => ({ ...prev, minLon: parseFloat(e.target.value) || prev.minLon }))
                  }
                  className="w-24 bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-right text-slate-200"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">East Lon:</span>
                <input
                  type="number"
                  step="0.01"
                  value={searchArea.maxLon.toFixed(4)}
                  onChange={(e) =>
                    setSearchArea((prev) => ({ ...prev, maxLon: parseFloat(e.target.value) || prev.maxLon }))
                  }
                  className="w-24 bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-right text-slate-200"
                />
              </div>
            </div>

            {/* Fetch Flights in this Selected Region */}
            <button
              onClick={handleFetchAdsbLolForRegion}
              disabled={isLoadingAdsb}
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isLoadingAdsb ? 'Scanning Airspace...' : 'Scan Flights in Selected Region'}</span>
            </button>
          </div>

          {/* Section 2: Target Doppler Curve Parameters */}
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

          {/* Section 3: Regional Flight Data Ingestion */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-emerald-400" /> Regional Airspace ({trajectories.length} Flights)
              </span>
              <span className="text-[10px] text-cyan-400 font-mono">Multi-Flight Search</span>
            </h3>

            {/* Source Type Selector */}
            <div className="grid grid-cols-3 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-mono">
              <button
                onClick={() => setSourceType('benchmark')}
                className={`py-1.5 rounded transition ${
                  sourceType === 'benchmark' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Presets ({BENCHMARK_FLIGHTS.length})
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

            {/* Presets */}
            {sourceType === 'benchmark' && (
              <div className="space-y-2">
                <label className="text-[11px] text-slate-400 block">Flight Corridor Set:</label>
                <select
                  value={selectedBenchmarkId}
                  onChange={(e) => handleSelectBenchmark(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 text-xs rounded-lg p-2 focus:ring-1 focus:ring-cyan-500 font-mono"
                >
                  <option value="all_benchmarks">All Benchmark Flights ({BENCHMARK_FLIGHTS.length} Flights)</option>
                  <option value="typhoon_salisbury">Typhoon Fast Jet (Salisbury Plain)</option>
                  <option value="b738_heathrow">Boeing 737-800 (Heathrow Approach)</option>
                  <option value="c172_cambridge">Cessna 172 Skyhawk (Cambridge)</option>
                  <option value="viper_fighter">F-16 Falcon (High-Speed Ingress)</option>
                </select>
              </div>
            )}

            {/* Custom File Upload */}
            {sourceType === 'upload' && (
              <div className="space-y-2">
                <label className="border border-dashed border-slate-700 hover:border-cyan-400 bg-slate-950/70 p-3 rounded-xl flex flex-col items-center justify-center cursor-pointer transition">
                  <Upload className="w-5 h-5 text-cyan-400 mb-1" />
                  <span className="text-xs font-semibold text-slate-200">Upload Regional ADS-B Data</span>
                  <span className="text-[10px] text-slate-500 font-mono">JSON (dump1090) or CSV (multiple flights)</span>
                  <input
                    type="file"
                    accept=".json,.csv,.txt,.sbs1"
                    onChange={handleCustomFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            )}

            {adsbStatusMsg && (
              <p className="text-[10px] text-cyan-400 font-mono leading-relaxed bg-slate-950/80 p-2 rounded border border-slate-800">
                {adsbStatusMsg}
              </p>
            )}
          </div>

          {/* Section 4: Date & Time Window */}
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

          {/* Section 5: Grid Density & Performance Optimizer */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <h3 className="font-semibold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-rose-400" /> Spatial Resolution &amp; Acceleration
            </h3>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Grid Density</span>
                <span className="font-mono text-cyan-400">
                  {settings.gridResolution}×{settings.gridResolution} ({settings.gridResolution * settings.gridResolution} pts/plane)
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

            {/* Cylindrical Envelope Pruning */}
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
                <span>Cylindrical Distance Pruning</span>
              </div>
              <span className="text-[10px] text-cyan-400 font-mono">15x speedup</span>
            </label>
          </div>

          {/* Section 6: Run Calculation Button */}
          <button
            onClick={handleRunSearch}
            disabled={isCalculating}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl text-xs flex items-center justify-center gap-2 transition duration-150 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50 mt-auto"
          >
            <Zap className={`w-4 h-4 fill-current ${isCalculating ? 'animate-spin' : ''}`} />
            <span>
              {isCalculating
                ? `Evaluating ${trajectories.length} Flights in Region...`
                : `Correlate All ${trajectories.length} Region Flights`}
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
};
