export interface DopplerPoint {
  t: number;
  f: number;
}

export interface RidgePoint {
  t: number;
  f: number;
  s: number;
}

export interface FittedParams {
  f0: number;
  v: number;
  dmin: number;
  t0: number;
  sse?: number;
  score?: number;
  points?: number;
}

export interface CleanupSettings {
  bandpass: boolean;
  lowHz: number;
  highHz: number;
  noiseSub: boolean;
  noiseSeconds: number;
  noiseStrength: number;
  gate: number;
  histEq: boolean;
  liveAuto: boolean;
}

export interface SpectrogramView {
  t0: number;
  t1: number;
  f0: number;
  f1: number;
}

export type PaletteName = 'inferno' | 'viridis' | 'plasma' | 'radar' | 'grayscale';

export interface ToolItem {
  id: string;
  name: string;
  tag: string;
  description: string;
  icon: string;
  color: 'cyan' | 'emerald' | 'violet' | 'rose';
  status: 'live' | 'soon';
}

export interface FlightWaypoint {
  timestamp: number; // UTC unix seconds or relative seconds
  lat: number;
  lon: number;
  alt: number; // meters AMSL
  groundSpeed: number; // m/s
  track?: number; // degrees
  callsign?: string;
  hex?: string;
}

export interface FlightTrajectory {
  id: string;
  callsign: string;
  hex: string;
  type?: string;
  waypoints: FlightWaypoint[];
  startTime: number;
  endTime: number;
}

export interface SearchArea {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface ColstoCandidate {
  lat: number;
  lon: number;
  score: number;
  dmin: number;
  tcpa: number;
  distToTrack: number;
}

export interface ColstoSearchResult {
  gridScores: Float32Array; // row-major flat array of scores [0..1]
  gridDmin: Float32Array;
  gridTcpa: Float32Array;
  cols: number;
  rows: number;
  searchArea: SearchArea;
  topLocation: ColstoCandidate;
  topCandidates: ColstoCandidate[];
  executionTimeMs: number;
  evaluationsCount: number;
  engineUsed: 'wasm' | 'vector_js';
  theoreticalCurve: DopplerPoint[];
}

export interface ColstoSettings {
  useWasm: boolean;
  gridResolution: number; // 40, 80, 160, 300
  searchRadiusKm: number; // 10, 25, 50, 100
  spatialPruning: boolean; // Colsto cylinder pruning
  elevationModel: boolean;
  soundSpeed: number; // 343 m/s
  sigmaDist: number; // distance tolerance in meters (e.g. 50m)
  sigmaTime: number; // time tolerance in seconds (e.g. 1.0s)
}

export interface FlightMatchResult {
  trajectory: FlightTrajectory;
  rank: number;
  matchScore: number; // 0..100%
  topLocation: ColstoCandidate;
  speedDiff: number; // |flight_v - target_v| in m/s
  dmin: number;
  tcpa: number;
  searchResult: ColstoSearchResult;
}

export interface MultiFlightSearchResult {
  matches: FlightMatchResult[];
  bestMatch: FlightMatchResult | null;
  compositeScores: Float32Array;
  cols: number;
  rows: number;
  searchArea: SearchArea;
  totalFlightsEvaluated: number;
  executionTimeMs: number;
  evaluationsCount: number;
  engineUsed: 'wasm' | 'vector_js';
}


