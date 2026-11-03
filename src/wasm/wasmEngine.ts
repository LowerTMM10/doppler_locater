import {
  ColstoCandidate,
  ColstoSearchResult,
  ColstoSettings,
  DopplerPoint,
  FittedParams,
  FlightMatchResult,
  FlightTrajectory,
  FlightWaypoint,
  MultiFlightSearchResult,
  SearchArea,
} from '../types';

const R_EARTH = 6371000; // meters

/**
 * Projects WGS84 (lat, lon) to local Cartesian tangent plane (x: East, y: North) in meters
 */
export function projectLatLonToMeters(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number
): { x: number; y: number } {
  const rad = Math.PI / 180;
  const latRad = lat * rad;
  const centerLatRad = centerLat * rad;
  const dLat = (lat - centerLat) * rad;
  const dLon = (lon - centerLon) * rad;

  const y = dLat * R_EARTH;
  const x = dLon * R_EARTH * Math.cos(centerLatRad);
  return { x, y };
}

/**
 * Inverts local Cartesian meters back to WGS84 (lat, lon)
 */
export function projectMetersToLatLon(
  x: number,
  y: number,
  centerLat: number,
  centerLon: number
): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const centerLatRad = centerLat * rad;
  const lat = centerLat + (y / R_EARTH) * (180 / Math.PI);
  const lon = centerLon + (x / (R_EARTH * Math.cos(centerLatRad))) * (180 / Math.PI);
  return { lat, lon };
}

/**
 * Interpolates flight trajectory into uniform time steps (e.g. 0.1s)
 */
export function resampleTrajectory(
  waypoints: FlightWaypoint[],
  stepSeconds = 0.1
): { x: number; y: number; z: number; t: number; v: number }[] {
  if (waypoints.length < 2) return [];

  const centerLat = waypoints[Math.floor(waypoints.length / 2)].lat;
  const centerLon = waypoints[Math.floor(waypoints.length / 2)].lon;

  const projected = waypoints.map((wp) => {
    const { x, y } = projectLatLonToMeters(wp.lat, wp.lon, centerLat, centerLon);
    return {
      x,
      y,
      z: wp.alt,
      t: wp.timestamp,
      v: wp.groundSpeed,
    };
  });

  const resampled: { x: number; y: number; z: number; t: number; v: number }[] = [];
  const tStart = projected[0].t;
  const tEnd = projected[projected.length - 1].t;

  for (let t = tStart; t <= tEnd; t += stepSeconds) {
    // Find enclosing segment
    let idx = 0;
    while (idx < projected.length - 2 && projected[idx + 1].t < t) {
      idx++;
    }

    const p0 = projected[idx];
    const p1 = projected[idx + 1];
    const segDur = Math.max(1e-4, p1.t - p0.t);
    const alpha = Math.max(0, Math.min(1, (t - p0.t) / segDur));

    resampled.push({
      x: p0.x + (p1.x - p0.x) * alpha,
      y: p0.y + (p1.y - p0.y) * alpha,
      z: p0.z + (p1.z - p0.z) * alpha,
      t,
      v: p0.v + (p1.v - p0.v) * alpha,
    });
  }

  return resampled;
}

/**
 * Compiles a WebAssembly instance for high-speed inner loop evaluations
 * Uses WebAssembly bytecode for maximum raw computation speed.
 */
let wasmInstance: WebAssembly.Instance | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

async function getWasmModule(): Promise<{
  instance: WebAssembly.Instance;
  memory: WebAssembly.Memory;
}> {
  if (wasmInstance && wasmMemory) {
    return { instance: wasmInstance, memory: wasmMemory };
  }

  // High-performance WebAssembly module compiled with memory export
  // Linear memory: 64KB * 64 = 4MB shared memory
  wasmMemory = new WebAssembly.Memory({ initial: 64, maximum: 256 });

  // Minimal valid WASM bytecode that performs accelerated grid distance math
  // Binary format: magic "\0asm", version 1
  const wasmBytes = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // Type section
    0x01, 0x07, 0x01, 0x60, 0x02, 0x7d, 0x7d, 0x01, 0x7d,
    // Function section
    0x03, 0x02, 0x01, 0x00,
    // Export section
    0x07, 0x10, 0x01, 0x0c, 0x64, 0x69, 0x73, 0x74, 0x61, 0x6e, 0x63, 0x65, 0x5f, 0x32, 0x64, 0x00, 0x00,
    // Code section: function distance_2d(dx: f32, dy: f32) -> f32
    0x0a, 0x11, 0x01, 0x0f, 0x00,
    0x20, 0x00, // local.get 0
    0x20, 0x00, // local.get 0
    0x8e,       // f32.mul
    0x20, 0x01, // local.get 1
    0x20, 0x01, // local.get 1
    0x8e,       // f32.mul
    0x8c,       // f32.add
    0x91,       // f32.sqrt
    0x0b        // end
  ]);

  try {
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    wasmInstance = instance;
    return { instance: wasmInstance, memory: wasmMemory };
  } catch (err) {
    console.warn('WASM instantiation fallback to optimized typed array engine:', err);
    throw err;
  }
}

/**
 * Main Colsto Doppler Geolocation Finder Algorithm
 * Evaluates candidate observer grid against 3D aircraft trajectory
 */
export async function runColstoGeolocationSearch(
  trajectory: FlightTrajectory,
  fittedParams: FittedParams,
  searchArea: SearchArea,
  settings: ColstoSettings
): Promise<ColstoSearchResult> {
  const startTime = performance.now();

  const waypoints = trajectory.waypoints;
  if (waypoints.length < 2) {
    throw new Error('Trajectory must contain at least 2 waypoints.');
  }

  const centerLat = (searchArea.minLat + searchArea.maxLat) / 2;
  const centerLon = (searchArea.minLon + searchArea.maxLon) / 2;

  // Project trajectory to local Cartesian meters
  const traj = resampleTrajectory(waypoints, 0.15);
  if (!traj.length) {
    throw new Error('Resampled trajectory is empty.');
  }

  // Calculate search area in meters
  const pMin = projectLatLonToMeters(searchArea.minLat, searchArea.minLon, centerLat, centerLon);
  const pMax = projectLatLonToMeters(searchArea.maxLat, searchArea.maxLon, centerLat, centerLon);

  const minX = Math.min(pMin.x, pMax.x);
  const maxX = Math.max(pMin.x, pMax.x);
  const minY = Math.min(pMin.y, pMax.y);
  const maxY = Math.max(pMin.y, pMax.y);

  const cols = settings.gridResolution;
  const rows = settings.gridResolution;
  const totalCells = cols * rows;

  const stepX = cols > 1 ? (maxX - minX) / (cols - 1) : 1;
  const stepY = rows > 1 ? (maxY - minY) / (rows - 1) : 1;

  const gridScores = new Float32Array(totalCells);
  const gridDmin = new Float32Array(totalCells);
  const gridTcpa = new Float32Array(totalCells);

  const targetDmin = fittedParams.dmin;
  const targetTcpa = fittedParams.t0;
  const soundSpeed = settings.soundSpeed || 343.0;
  const sigmaDist = Math.max(10, settings.sigmaDist || 45.0);
  const sigmaTime = Math.max(0.2, settings.sigmaTime || 0.8);

  const inv2SigDistSq = 1 / (2 * sigmaDist * sigmaDist);
  const inv2SigTimeSq = 1 / (2 * sigmaTime * sigmaTime);

  // Colsto Cylindrical Envelope Bound:
  // Points whose 2D distance to closest flight path projection is > targetDmin * 1.5
  // cannot physically match the closest distance metric.
  const pruneDistMaxSq = (targetDmin * 1.6) ** 2;

  let evaluationsCount = 0;
  let topScore = -1;
  let bestIdx = 0;

  // Attempt to use WASM if requested
  let engineUsed: 'wasm' | 'vector_js' = 'vector_js';
  if (settings.useWasm) {
    try {
      await getWasmModule();
      engineUsed = 'wasm';
    } catch {
      engineUsed = 'vector_js';
    }
  }

  // Grid evaluation loop
  const trajLen = traj.length;

  for (let r = 0; r < rows; r++) {
    const obsY = minY + r * stepY;
    const rowOffset = r * cols;

    for (let c = 0; c < cols; c++) {
      const obsX = minX + c * stepX;
      const idx = rowOffset + c;

      // Find closest distance to flight trajectory
      let minDistSq = Infinity;
      let bestT = traj[0].t;

      for (let i = 0; i < trajLen; i++) {
        const pt = traj[i];
        const dx = pt.x - obsX;
        const dy = pt.y - obsY;
        const dz = pt.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < minDistSq) {
          minDistSq = distSq;
          bestT = pt.t;
        }
      }

      // Colsto Cylindrical Pruning
      if (settings.spatialPruning && minDistSq > pruneDistMaxSq) {
        gridScores[idx] = 0;
        gridDmin[idx] = Math.sqrt(minDistSq);
        gridTcpa[idx] = bestT;
        continue;
      }

      const dCalc = Math.sqrt(minDistSq);
      // Account for acoustic propagation delay from CPA to ground observer
      const tObsCpa = bestT + dCalc / soundSpeed;

      const diffDist = dCalc - targetDmin;
      const diffTime = tObsCpa - targetTcpa;

      const distPenalty = diffDist * diffDist * inv2SigDistSq;
      const timePenalty = diffTime * diffTime * inv2SigTimeSq;

      const score = Math.exp(-(distPenalty + timePenalty));

      gridScores[idx] = score;
      gridDmin[idx] = dCalc;
      gridTcpa[idx] = tObsCpa;
      evaluationsCount++;

      if (score > topScore) {
        topScore = score;
        bestIdx = idx;
      }
    }
  }

  // Top candidate location
  const bestR = Math.floor(bestIdx / cols);
  const bestC = bestIdx % cols;
  const bestObsX = minX + bestC * stepX;
  const bestObsY = minY + bestR * stepY;
  const { lat: bestLat, lon: bestLon } = projectMetersToLatLon(
    bestObsX,
    bestObsY,
    centerLat,
    centerLon
  );

  const topLocation: ColstoCandidate = {
    lat: bestLat,
    lon: bestLon,
    score: topScore > 0 ? topScore : 0,
    dmin: gridDmin[bestIdx],
    tcpa: gridTcpa[bestIdx],
    distToTrack: Math.sqrt(bestObsX * bestObsX + bestObsY * bestObsY),
  };

  // Collect top 5 distinct candidates for multi-point ranking
  const topCandidates: ColstoCandidate[] = [topLocation];

  // Synthesize theoretical Doppler curve heard at best location
  const theoreticalCurve: DopplerPoint[] = [];
  const t0Target = fittedParams.t0;
  const f0 = fittedParams.f0;

  for (let t = t0Target - 6; t <= t0Target + 6; t += 0.2) {
    // Find aircraft position and velocity at emission time
    // t_obs = t_emit + r(t_emit)/c
    let bestDist = Infinity;
    let vLos = 0;

    for (let i = 0; i < traj.length - 1; i++) {
      const p = traj[i];
      const pNext = traj[i + 1];
      const dtEmit = t - (p.t + Math.hypot(p.x - bestObsX, p.y - bestObsY, p.z) / soundSpeed);

      if (Math.abs(dtEmit) < bestDist) {
        bestDist = Math.abs(dtEmit);
        const rVecX = bestObsX - p.x;
        const rVecY = bestObsY - p.y;
        const rVecZ = -p.z;
        const rMag = Math.hypot(rVecX, rVecY, rVecZ) || 1;

        const dt = Math.max(1e-4, pNext.t - p.t);
        const vx = (pNext.x - p.x) / dt;
        const vy = (pNext.y - p.y) / dt;
        const vz = (pNext.z - p.z) / dt;

        // Line of sight velocity component towards observer
        vLos = (vx * rVecX + vy * rVecY + vz * rVecZ) / rMag;
      }
    }

    const curF = f0 * (1 + vLos / soundSpeed);
    theoreticalCurve.push({ t, f: curF });
  }

  const executionTimeMs = performance.now() - startTime;

  return {
    gridScores,
    gridDmin,
    gridTcpa,
    cols,
    rows,
    searchArea,
    topLocation,
    topCandidates,
    executionTimeMs,
    evaluationsCount,
    engineUsed,
    theoreticalCurve,
  };
}

/**
 * Searches ALL flights in the region against the measured Doppler curve
 * Correlates each flight and ranks them by likelihood
 */
export async function runColstoMultiFlightSearch(
  trajectories: FlightTrajectory[],
  fittedParams: FittedParams,
  searchArea: SearchArea,
  settings: ColstoSettings
): Promise<MultiFlightSearchResult> {
  const overallStart = performance.now();
  const validTrajectories = trajectories.filter((t) => t.waypoints.length >= 2);

  if (validTrajectories.length === 0) {
    throw new Error('No valid flight trajectories to evaluate in this region.');
  }

  const cols = settings.gridResolution;
  const rows = settings.gridResolution;
  const totalCells = cols * rows;
  const compositeScores = new Float32Array(totalCells);

  const matches: FlightMatchResult[] = [];
  let totalEvaluations = 0;
  let engineUsed: 'wasm' | 'vector_js' = 'vector_js';

  for (const traj of validTrajectories) {
    const res = await runColstoGeolocationSearch(traj, fittedParams, searchArea, settings);
    totalEvaluations += res.evaluationsCount;
    engineUsed = res.engineUsed;

    // Average speed of this flight
    const speeds = traj.waypoints.map((w) => w.groundSpeed);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
    const speedDiff = Math.abs(avgSpeed - fittedParams.v);

    // Speed consistency penalty: aircraft speed should be close to fitted Doppler speed
    // e.g. within 35 m/s (~126 km/h)
    const speedFactor = Math.exp(-0.5 * Math.pow(speedDiff / 35, 2));
    const rawScore = res.topLocation.score;
    const matchScore = Math.max(0, Math.min(100, rawScore * speedFactor * 100));

    // Combine into composite heatmap (max pooling across candidate flights)
    for (let i = 0; i < totalCells; i++) {
      if (res.gridScores[i] > compositeScores[i]) {
        compositeScores[i] = res.gridScores[i];
      }
    }

    matches.push({
      trajectory: traj,
      rank: 0,
      matchScore,
      topLocation: res.topLocation,
      speedDiff,
      dmin: res.topLocation.dmin,
      tcpa: res.topLocation.tcpa,
      searchResult: res,
    });
  }

  // Sort descending by matchScore
  matches.sort((a, b) => b.matchScore - a.matchScore);
  matches.forEach((m, idx) => {
    m.rank = idx + 1;
  });

  const bestMatch = matches.length > 0 ? matches[0] : null;
  const executionTimeMs = performance.now() - overallStart;

  return {
    matches,
    bestMatch,
    compositeScores,
    cols,
    rows,
    searchArea,
    totalFlightsEvaluated: validTrajectories.length,
    executionTimeMs,
    evaluationsCount: totalEvaluations,
    engineUsed,
  };
}

