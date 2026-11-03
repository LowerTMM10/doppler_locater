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
      { timestamp: 12, lat: 51.1290, lon: -1.8460, alt: 460, groundSpeed: 242, track: 124, callsign: 'TYPHN21', hex: '43C12B' }, // Closest approach to Salisbury station (51.1245, -1.8250) ~520m
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
      { timestamp: 18, lat: 51.4725, lon: -0.4850, alt: 740, groundSpeed: 130, track: 88, callsign: 'BAW482', hex: '4007EB' }, // CPA near Staines / Heathrow West
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
];

/**
 * Fetch real-time or historical ADS-B aircraft positions from adsb.lol
 */
export async function fetchAdsbLol(
  lat: number,
  lon: number,
  radiusNm = 25
): Promise<FlightTrajectory[]> {
  const url = `https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(radiusNm)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`adsb.lol API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const acList = data.ac || data.aircraft || [];

    const trajectories: FlightTrajectory[] = [];

    acList.forEach((ac: Record<string, unknown>, idx: number) => {
      const lat = parseFloat(String(ac.lat || ac.latitude || 0));
      const lon = parseFloat(String(ac.lon || ac.longitude || 0));
      const altFeet = parseFloat(String(ac.alt_baro || ac.altitude || 1000));
      const altMeters = altFeet * 0.3048;
      const gsKnots = parseFloat(String(ac.gs || ac.speed || 150));
      const gsMs = gsKnots * 0.514444;
      const track = parseFloat(String(ac.track || ac.heading || 0));
      const callsign = String(ac.flight || ac.callsign || `AC-${idx + 1}`).trim();
      const hex = String(ac.hex || ac.icao || 'UNKNOWN').toUpperCase();

      if (lat !== 0 && lon !== 0) {
        // Construct flight trajectory segment using track and speed
        const t0 = 0;
        const waypoints: FlightWaypoint[] = [];
        const trackRad = (track * Math.PI) / 180;
        const vx = gsMs * Math.sin(trackRad);
        const vy = gsMs * Math.cos(trackRad);

        // Synthesize 20-second segment around reported position
        for (let dt = -10; dt <= 10; dt += 2) {
          const dEast = vx * dt;
          const dNorth = vy * dt;
          const wpLat = lat + (dNorth / 6371000) * (180 / Math.PI);
          const wpLon = lon + (dEast / (6371000 * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);

          waypoints.push({
            timestamp: dt + 10,
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
          type: String(ac.t || ac.desc || 'Aircraft'),
          waypoints,
          startTime: 0,
          endTime: 20,
        });
      }
    });

    return trajectories;
  } catch (err) {
    console.warn('adsb.lol API request failed:', err);
    throw err;
  }
}

/**
 * Parses user custom ADS-B files: JSON, CSV, SBS-1
 */
export function parseCustomAdsbFile(fileContent: string, fileName: string): FlightTrajectory {
  const trimmed = fileContent.trim();

  // 1. JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed.ac || parsed.aircraft || parsed.waypoints || parsed.trace || [];

      const waypoints: FlightWaypoint[] = [];
      let callsign = 'CUSTOM-FLIGHT';
      let hex = 'CUST01';

      list.forEach((item: Record<string, unknown>, idx: number) => {
        // Handle dump1090/readsb trace arrays: [time, lat, lon, alt, gs, track, ...]
        if (Array.isArray(item)) {
          const t = parseFloat(String(item[0] || idx));
          const lat = parseFloat(String(item[1] || 0));
          const lon = parseFloat(String(item[2] || 0));
          const altFt = parseFloat(String(item[3] || 1000));
          const gsKt = parseFloat(String(item[4] || 150));
          const trk = parseFloat(String(item[5] || 0));

          if (lat !== 0 && lon !== 0) {
            waypoints.push({
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
          const gs = parseFloat(String(item.groundSpeed || item.speed || item.gs || 100)) * (item.speed_ms ? 1 : 0.514444);
          const t = parseFloat(String(item.timestamp || item.time || item.t || idx));

          if (item.callsign || item.flight) callsign = String(item.callsign || item.flight);
          if (item.hex || item.icao) hex = String(item.hex || item.icao);

          if (lat !== 0 && lon !== 0) {
            waypoints.push({
              timestamp: t,
              lat,
              lon,
              alt,
              groundSpeed: gs,
              track: parseFloat(String(item.track || 0)),
              callsign,
              hex,
            });
          }
        }
      });

      waypoints.sort((a, b) => a.timestamp - b.timestamp);
      // Normalize timestamp relative to start
      const t0 = waypoints[0]?.timestamp || 0;
      waypoints.forEach((wp) => (wp.timestamp -= t0));

      return {
        id: hex,
        callsign,
        hex,
        waypoints,
        startTime: 0,
        endTime: waypoints[waypoints.length - 1]?.timestamp || 1,
      };
    } catch (err) {
      throw new Error(`Invalid JSON ADS-B format: ${(err as Error).message}`);
    }
  }

  // 2. CSV
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 1) {
    const header = lines[0].toLowerCase();
    const isCsv = header.includes('lat') || header.includes('time') || header.includes('alt');

    if (isCsv || lines[0].includes(',')) {
      const waypoints: FlightWaypoint[] = [];
      let callsign = fileName.replace(/\.[^/.]+$/, '');
      let hex = 'CSV01';

      // Determine column indices
      const cols = lines[0].toLowerCase().split(',').map((c) => c.trim());
      const latIdx = cols.findIndex((c) => c.includes('lat'));
      const lonIdx = cols.findIndex((c) => c.includes('lon'));
      const altIdx = cols.findIndex((c) => c.includes('alt'));
      const timeIdx = cols.findIndex((c) => c.includes('time') || c.includes('sec'));
      const gsIdx = cols.findIndex((c) => c.includes('speed') || c.includes('gs') || c.includes('vel'));

      const startLine = isCsv ? 1 : 0;
      for (let i = startLine; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim());
        if (parts.length >= 3) {
          const lat = parseFloat(parts[latIdx !== -1 ? latIdx : 1] || '0');
          const lon = parseFloat(parts[lonIdx !== -1 ? lonIdx : 2] || '0');
          const alt = parseFloat(parts[altIdx !== -1 ? altIdx : 3] || '500');
          const t = parseFloat(parts[timeIdx !== -1 ? timeIdx : 0] || String(i));
          const gs = parseFloat(parts[gsIdx !== -1 ? gsIdx : 4] || '120');

          if (!isNaN(lat) && !isNaN(lon) && lat !== 0) {
            waypoints.push({
              timestamp: t,
              lat,
              lon,
              alt: alt < 3000 ? alt : alt * 0.3048,
              groundSpeed: gs < 350 ? gs : gs * 0.514444,
            });
          }
        }
      }

      if (waypoints.length >= 2) {
        waypoints.sort((a, b) => a.timestamp - b.timestamp);
        const t0 = waypoints[0].timestamp;
        waypoints.forEach((wp) => (wp.timestamp -= t0));

        return {
          id: hex,
          callsign,
          hex,
          waypoints,
          startTime: 0,
          endTime: waypoints[waypoints.length - 1].timestamp,
        };
      }
    }
  }

  throw new Error('Unsupported ADS-B file format. Please upload valid JSON or CSV flight coordinates.');
}
