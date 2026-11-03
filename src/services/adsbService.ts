import { FlightTrajectory, FlightWaypoint } from '../types';

/**
 * Benchmark Flights with known ground truth locations for testing Colsto Geolocation
 */
export const BENCHMARK_FLIGHTS: FlightTrajectory[] = [
  {
    id: 'typhoon_salisbury',
    callsign: 'TYPHN21',
    hex: '43C12B',
    type: 'Eurofighter Typhoon FGR4 (Military Fast Jet)',
    startTime: 0,
    endTime: 24,
    waypoints: [
      { timestamp: 0, lat: 51.1620, lon: -1.9450, alt: 520, groundSpeed: 235, track: 125, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 4, lat: 51.1510, lon: -1.9120, alt: 500, groundSpeed: 238, track: 124, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 8, lat: 51.1400, lon: -1.8790, alt: 480, groundSpeed: 240, track: 124, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 12, lat: 51.1290, lon: -1.8460, alt: 460, groundSpeed: 242, track: 124, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 16, lat: 51.1180, lon: -1.8130, alt: 450, groundSpeed: 244, track: 125, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 20, lat: 51.1070, lon: -1.7800, alt: 440, groundSpeed: 245, track: 125, callsign: 'TYPHN21', hex: '43C12B' },
      { timestamp: 24, lat: 51.0960, lon: -1.7470, alt: 440, groundSpeed: 245, track: 126, callsign: 'TYPHN21', hex: '43C12B' },
    ],
  },
  {
    id: 'b738_heathrow',
    callsign: 'BAW482',
    hex: '4007EB',
    type: 'Boeing 737-800 (Commercial Approach)',
    startTime: 0,
    endTime: 30,
    waypoints: [
      { timestamp: 0, lat: 51.4680, lon: -0.6200, alt: 1100, groundSpeed: 145, track: 88, callsign: 'BAW482', hex: '4007EB' },
      { timestamp: 6, lat: 51.4695, lon: -0.5750, alt: 980, groundSpeed: 140, track: 88, callsign: 'BAW482', hex: '4007EB' },
      { timestamp: 12, lat: 51.4710, lon: -0.5300, alt: 860, groundSpeed: 135, track: 88, callsign: 'BAW482', hex: '4007EB' },
      { timestamp: 18, lat: 51.4725, lon: -0.4850, alt: 740, groundSpeed: 130, track: 88, callsign: 'BAW482', hex: '4007EB' },
      { timestamp: 24, lat: 51.4740, lon: -0.4400, alt: 620, groundSpeed: 125, track: 88, callsign: 'BAW482', hex: '4007EB' },
      { timestamp: 30, lat: 51.4755, lon: -0.3950, alt: 500, groundSpeed: 120, track: 88, callsign: 'BAW482', hex: '4007EB' },
    ],
  },
  {
    id: 'c172_cambridge',
    callsign: 'G-BAPL',
    hex: '405F12',
    type: 'Cessna 172 Skyhawk (Light Aviation)',
    startTime: 0,
    endTime: 36,
    waypoints: [
      { timestamp: 0, lat: 52.1700, lon: 0.0800, alt: 350, groundSpeed: 55, track: 45, callsign: 'G-BAPL', hex: '405F12' },
      { timestamp: 9, lat: 52.1850, lon: 0.1050, alt: 350, groundSpeed: 56, track: 45, callsign: 'G-BAPL', hex: '405F12' },
      { timestamp: 18, lat: 52.2000, lon: 0.1300, alt: 340, groundSpeed: 55, track: 45, callsign: 'G-BAPL', hex: '405F12' },
      { timestamp: 27, lat: 52.2150, lon: 0.1550, alt: 340, groundSpeed: 55, track: 45, callsign: 'G-BAPL', hex: '405F12' },
      { timestamp: 36, lat: 52.2300, lon: 0.1800, alt: 330, groundSpeed: 54, track: 45, callsign: 'G-BAPL', hex: '405F12' },
    ],
  },
  {
    id: 'viper_fighter',
    callsign: 'VIPER11',
    hex: '43F982',
    type: 'F-16 Fighting Falcon (High-Speed Ingress)',
    startTime: 0,
    endTime: 24,
    waypoints: [
      { timestamp: 0, lat: 51.2400, lon: -1.9500, alt: 650, groundSpeed: 280, track: 105, callsign: 'VIPER11', hex: '43F982' },
      { timestamp: 6, lat: 51.2150, lon: -1.8700, alt: 600, groundSpeed: 282, track: 105, callsign: 'VIPER11', hex: '43F982' },
      { timestamp: 12, lat: 51.1900, lon: -1.7900, alt: 580, groundSpeed: 285, track: 106, callsign: 'VIPER11', hex: '43F982' },
      { timestamp: 18, lat: 51.1650, lon: -1.7100, alt: 560, groundSpeed: 285, track: 106, callsign: 'VIPER11', hex: '43F982' },
      { timestamp: 24, lat: 51.1400, lon: -1.6300, alt: 550, groundSpeed: 285, track: 106, callsign: 'VIPER11', hex: '43F982' },
    ],
  },
];

/**
 * Generate simulated area flights around a coordinate if network/API is offline or blocked
 */
export function generateAreaFlightCorridor(
  centerLat: number,
  centerLon: number,
  radiusKm = 25
): FlightTrajectory[] {
  const headings = [45, 125, 210, 315, 90, 270];
  const types = [
    { callsign: 'RAF-ASCOT', hex: '43C2A1', type: 'Airbus A400M Atlas', speed: 195, alt: 650 },
    { callsign: 'EZY428', hex: '407B12', type: 'Airbus A320-200', speed: 220, alt: 2400 },
    { callsign: 'VIPER22', hex: '43F108', type: 'Eurofighter Typhoon', speed: 242, alt: 480 },
    { callsign: 'G-BRTY', hex: '401C99', type: 'Piper PA-28 Cherokee', speed: 60, alt: 380 },
    { callsign: 'EXS91L', hex: '40058C', type: 'Boeing 737-800', speed: 210, alt: 1800 },
  ];

  return types.map((plane, idx) => {
    const heading = headings[idx % headings.length];
    const trackRad = (heading * Math.PI) / 180;
    const speed = plane.speed; // m/s
    const vx = speed * Math.sin(trackRad);
    const vy = speed * Math.cos(trackRad);

    // Scatter start offsets around center
    const offAngle = (idx * (2 * Math.PI)) / types.length;
    const offDist = (radiusKm * 1000 * 0.4) * (0.6 + 0.4 * (idx % 2));
    const startX = Math.cos(offAngle) * offDist;
    const startY = Math.sin(offAngle) * offDist;

    const waypoints: FlightWaypoint[] = [];
    const dur = 24;
    const steps = 6;
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * dur;
      const x = startX + vx * (t - dur / 2);
      const y = startY + vy * (t - dur / 2);

      const lat = centerLat + (y / 6371000) * (180 / Math.PI);
      const lon = centerLon + (x / (6371000 * Math.cos((centerLat * Math.PI) / 180))) * (180 / Math.PI);

      waypoints.push({
        timestamp: t,
        lat,
        lon,
        alt: plane.alt,
        groundSpeed: speed,
        track: heading,
        callsign: plane.callsign,
        hex: plane.hex,
      });
    }

    return {
      id: plane.hex,
      callsign: plane.callsign,
      hex: plane.hex,
      type: plane.type,
      waypoints,
      startTime: 0,
      endTime: dur,
    };
  });
}

/**
 * Fetch real-time ADS-B aircraft positions from adsb.lol
 * Tries local proxy -> CORS fallback -> synthetic area corridor if network blocks client
 */
export async function fetchAdsbLol(
  lat: number,
  lon: number,
  radiusNm = 25
): Promise<{ trajectories: FlightTrajectory[]; sourceNotice: string }> {
  const dist = Math.max(5, Math.min(250, Math.round(radiusNm)));
  const path = `/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${dist}`;
  const directUrl = `https://api.adsb.lol${path}`;

  // Candidate endpoints (Proxy first, direct second, CORS proxy third)
  const endpoints = [
    { url: `/api/adsb${path}`, type: 'proxy' },
    { url: directUrl, type: 'direct' },
    { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`, type: 'cors_proxy' },
  ];

  let rawJson: { ac?: Record<string, unknown>[]; aircraft?: Record<string, unknown>[] } | null = null;
  let usedEndpoint = '';

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(ep.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && (Array.isArray(data.ac) || Array.isArray(data.aircraft))) {
          rawJson = data;
          usedEndpoint = ep.type;
          break;
        }
      }
    } catch {
      // try next fallback
    }
  }

  // If live data retrieved:
  if (rawJson) {
    const acList = rawJson.ac || rawJson.aircraft || [];
    const trajectories: FlightTrajectory[] = [];

    acList.forEach((ac: Record<string, unknown>, idx: number) => {
      const latVal = parseFloat(String(ac.lat || ac.latitude || 0));
      const lonVal = parseFloat(String(ac.lon || ac.longitude || 0));
      const altFeet = parseFloat(String(ac.alt_baro || ac.alt_geom || ac.altitude || 1000));
      const altMeters = Math.max(100, altFeet * 0.3048);
      const gsKnots = parseFloat(String(ac.gs || ac.speed || 150));
      const gsMs = Math.max(25, gsKnots * 0.514444);
      const track = parseFloat(String(ac.track || ac.heading || 0));
      const callsign = String(ac.flight || ac.callsign || `FLIGHT-${idx + 1}`).trim();
      const hex = String(ac.hex || ac.icao || `AC${idx + 1}`).toUpperCase();
      const typeDesc = String(ac.t || ac.desc || 'Aircraft');

      if (!isNaN(latVal) && !isNaN(lonVal) && latVal !== 0 && lonVal !== 0) {
        // Construct flight trajectory vectors
        const waypoints: FlightWaypoint[] = [];
        const trackRad = (track * Math.PI) / 180;
        const vx = gsMs * Math.sin(trackRad);
        const vy = gsMs * Math.cos(trackRad);

        const duration = 24; // 24-second trajectory envelope
        const steps = 6;
        for (let s = 0; s <= steps; s++) {
          const dt = (s / steps) * duration - duration / 2;
          const dEast = vx * dt;
          const dNorth = vy * dt;
          const wpLat = latVal + (dNorth / 6371000) * (180 / Math.PI);
          const wpLon = lonVal + (dEast / (6371000 * Math.cos((latVal * Math.PI) / 180))) * (180 / Math.PI);

          waypoints.push({
            timestamp: dt + duration / 2,
            lat: wpLat,
            lon: wpLon,
            alt: altMeters,
            groundSpeed: gsMs,
            track,
            callsign,
            hex,
          });
        }

        trajectories.push({
          id: hex,
          callsign,
          hex,
          type: typeDesc,
          waypoints,
          startTime: 0,
          endTime: duration,
        });
      }
    });

    if (trajectories.length > 0) {
      return {
        trajectories,
        sourceNotice: `Loaded ${trajectories.length} live flights from adsb.lol (${usedEndpoint} connection).`,
      };
    }
  }

  // Network/CORS fallback: Generate realistic flight tracks for this exact region
  const simulated = generateAreaFlightCorridor(lat, lon, (radiusNm * 1.852));
  return {
    trajectories: simulated,
    sourceNotice: `adsb.lol was unreachable from your browser (CORS/offline); generated ${simulated.length} realistic radar flight tracks for this region so you can run the correlation.`,
  };
}

/**
 * Parses custom ADS-B files (JSON, CSV, SBS-1) into multiple flight trajectories
 */
export function parseCustomAdsbFiles(
  fileContent: string,
  fileName: string
): FlightTrajectory[] {
  const trimmed = fileContent.trim();

  // 1. JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.ac || parsed.aircraft || parsed.flights || parsed.trace || [];

      // Group waypoints by flight / hex
      const flightMap = new Map<string, { callsign: string; type: string; waypoints: FlightWaypoint[] }>();

      list.forEach((item: Record<string, unknown>, idx: number) => {
        if (Array.isArray(item)) {
          // dump1090/readsb trace [t, lat, lon, alt_ft, gs_kt, track, ...]
          const t = parseFloat(String(item[0] || idx));
          const lat = parseFloat(String(item[1] || 0));
          const lon = parseFloat(String(item[2] || 0));
          const altFt = parseFloat(String(item[3] || 1000));
          const gsKt = parseFloat(String(item[4] || 150));
          const trk = parseFloat(String(item[5] || 0));

          if (lat !== 0 && lon !== 0) {
            const hex = fileName.replace(/\.[^/.]+$/, '').toUpperCase();
            if (!flightMap.has(hex)) {
              flightMap.set(hex, { callsign: hex, type: 'Aircraft', waypoints: [] });
            }
            flightMap.get(hex)!.waypoints.push({
              timestamp: t,
              lat,
              lon,
              alt: altFt * 0.3048,
              groundSpeed: gsKt * 0.514444,
              track: trk,
            });
          }
        } else if (typeof item === 'object' && item !== null) {
          const lat = parseFloat(String(item.lat || item.latitude || 0));
          const lon = parseFloat(String(item.lon || item.longitude || 0));
          const alt = parseFloat(String(item.alt || item.altitude || item.alt_baro || 1000)) * (item.alt_meters ? 1 : 0.3048);
          const gs = parseFloat(String(item.groundSpeed || item.speed || item.gs || 120)) * (item.speed_ms ? 1 : 0.514444);
          const t = parseFloat(String(item.timestamp || item.time || item.t || idx));
          const callsign = String(item.callsign || item.flight || `FLIGHT-${(idx % 10) + 1}`).trim();
          const hex = String(item.hex || item.icao || callsign).toUpperCase();
          const type = String(item.type || item.t || 'Aircraft');

          if (lat !== 0 && lon !== 0) {
            if (!flightMap.has(hex)) {
              flightMap.set(hex, { callsign, type, waypoints: [] });
            }
            flightMap.get(hex)!.waypoints.push({
              timestamp: t,
              lat,
              lon,
              alt,
              groundSpeed: gs,
              track: parseFloat(String(item.track || item.heading || 0)),
              callsign,
              hex,
            });
          }
        }
      });

      const trajectories: FlightTrajectory[] = [];
      flightMap.forEach((entry, hex) => {
        if (entry.waypoints.length >= 2) {
          entry.waypoints.sort((a, b) => a.timestamp - b.timestamp);
          const t0 = entry.waypoints[0].timestamp;
          entry.waypoints.forEach((wp) => (wp.timestamp -= t0));

          trajectories.push({
            id: hex,
            callsign: entry.callsign,
            hex,
            type: entry.type,
            waypoints: entry.waypoints,
            startTime: 0,
            endTime: entry.waypoints[entry.waypoints.length - 1].timestamp,
          });
        }
      });

      if (trajectories.length > 0) return trajectories;
    } catch (err) {
      throw new Error(`Invalid JSON ADS-B format: ${(err as Error).message}`);
    }
  }

  // 2. CSV
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 1) {
    const flightMap = new Map<string, FlightWaypoint[]>();
    const cols = lines[0].toLowerCase().split(',').map((c) => c.trim());
    const isCsv = cols.some((c) => c.includes('lat') || c.includes('alt') || c.includes('time'));

    const latIdx = cols.findIndex((c) => c.includes('lat'));
    const lonIdx = cols.findIndex((c) => c.includes('lon'));
    const altIdx = cols.findIndex((c) => c.includes('alt'));
    const timeIdx = cols.findIndex((c) => c.includes('time') || c.includes('sec'));
    const gsIdx = cols.findIndex((c) => c.includes('speed') || c.includes('gs') || c.includes('vel'));
    const hexIdx = cols.findIndex((c) => c.includes('hex') || c.includes('icao') || c.includes('flight') || c.includes('callsign'));

    const startLine = isCsv ? 1 : 0;
    for (let i = startLine; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      if (parts.length >= 3) {
        const lat = parseFloat(parts[latIdx !== -1 ? latIdx : 1] || '0');
        const lon = parseFloat(parts[lonIdx !== -1 ? lonIdx : 2] || '0');
        const alt = parseFloat(parts[altIdx !== -1 ? altIdx : 3] || '500');
        const t = parseFloat(parts[timeIdx !== -1 ? timeIdx : 0] || String(i));
        const gs = parseFloat(parts[gsIdx !== -1 ? gsIdx : 4] || '120');
        const hex = (hexIdx !== -1 && parts[hexIdx]) ? parts[hexIdx].toUpperCase() : 'FLIGHT-1';

        if (!isNaN(lat) && !isNaN(lon) && lat !== 0) {
          if (!flightMap.has(hex)) flightMap.set(hex, []);
          flightMap.get(hex)!.push({
            timestamp: t,
            lat,
            lon,
            alt: alt < 3000 ? alt : alt * 0.3048,
            groundSpeed: gs < 350 ? gs : gs * 0.514444,
          });
        }
      }
    }

    const trajectories: FlightTrajectory[] = [];
    flightMap.forEach((pts, hex) => {
      if (pts.length >= 2) {
        pts.sort((a, b) => a.timestamp - b.timestamp);
        const t0 = pts[0].timestamp;
        pts.forEach((wp) => (wp.timestamp -= t0));

        trajectories.push({
          id: hex,
          callsign: hex,
          hex,
          waypoints: pts,
          startTime: 0,
          endTime: pts[pts.length - 1].timestamp,
        });
      }
    });

    if (trajectories.length > 0) return trajectories;
  }

  throw new Error('Unsupported ADS-B file format. Please upload valid JSON or CSV flight coordinates.');
}
