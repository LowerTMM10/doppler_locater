import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface HistPoint {
  t: number; // unix seconds
  lat: number;
  lon: number;
  altFt: number;
  gsKt: number;
}
export interface HistFlight {
  hex: string;
  callsign: string;
  points: HistPoint[];
}

const Input = z.object({
  startUnix: z.number(),
  endUnix: z.number(),
  minLat: z.number().min(-90).max(90),
  maxLat: z.number().min(-90).max(90),
  minLon: z.number().min(-180).max(180),
  maxLon: z.number().min(-180).max(180),
});

const UA = { "user-agent": "Mozilla/5.0 (AeroDoppler)", accept: "*/*" };
const TIME_MARK = 0xe7f7c9d;

async function readMaybeGzip(res: Response): Promise<ArrayBuffer> {
  const buf = await res.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip")));
    return ds.arrayBuffer();
  }
  return buf;
}

/** Parse a readsb heatmap slot (30 min, 10 s resolution, every aircraft worldwide). */
function parseHeatmap(
  buf: ArrayBuffer,
  q: z.infer<typeof Input>,
  out: Map<string, HistFlight>,
) {
  const a = new Int32Array(buf, 0, Math.floor(buf.byteLength / 16) * 4);
  let now = 0;
  const minLat = q.minLat * 1e6, maxLat = q.maxLat * 1e6, minLon = q.minLon * 1e6, maxLon = q.maxLon * 1e6;
  for (let i = 0; i < a.length; i += 4) {
    const h = a[i];
    if (h === TIME_MARK) {
      now = (a[i + 1] >>> 0) * 4294967.296 + (a[i + 2] >>> 0) / 1000;
      continue;
    }
    if (now < q.startUnix || now > q.endUnix) continue;
    const lat = a[i + 1], lon = a[i + 2];
    if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
    const hex = (h & 0xffffff).toString(16).padStart(6, "0");
    const x = a[i + 3];
    let alt = (x << 16) >> 16; // signed low 16 bits, units of 25 ft
    alt = alt <= -100 ? 0 : alt * 25;
    const gs = ((x >>> 16) & 0xffff) / 10;
    let f = out.get(hex);
    if (!f) out.set(hex, (f = { hex, callsign: hex.toUpperCase(), points: [] }));
    f.points.push({ t: now, lat: lat / 1e6, lon: lon / 1e6, altFt: Math.max(0, alt), gsKt: gs });
  }
}

async function fromHeatmaps(q: z.infer<typeof Input>) {
  const out = new Map<string, HistFlight>();
  let slots = 0;
  const first = Math.floor(q.startUnix / 1800) * 1800;
  for (let s = first; s <= q.endUnix && slots < 4; s += 1800) {
    const d = new Date(s * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    const slot = String(d.getUTCHours() * 2 + (d.getUTCMinutes() >= 30 ? 1 : 0)).padStart(2, "0");
    const url = `https://adsb.lol/globe_history/${y}/${m}/${day}/heatmap/${slot}.bin.ttf`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      await res.body?.cancel();
      continue;
    }
    parseHeatmap(await readMaybeGzip(res), q, out);
    slots++;
  }
  return { flights: out, slots };
}

/** Fallback for very recent recordings: aircraft live now + their full trace for today. */
async function fromLiveTraces(q: z.infer<typeof Input>) {
  const out = new Map<string, HistFlight>();
  const lat = (q.minLat + q.maxLat) / 2, lon = (q.minLon + q.maxLon) / 2;
  const radNm = Math.min(250, Math.max(10, (Math.hypot(q.maxLat - q.minLat, (q.maxLon - q.minLon) * Math.cos((lat * Math.PI) / 180)) * 60) / 2 + 20));
  const live = await fetch(`https://api.adsb.lol/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${Math.round(radNm)}`, { headers: { accept: "application/json" } });
  if (!live.ok) throw new Error(`adsb.lol live query failed [${live.status}]`);
  const lj = (await live.json()) as { ac?: { hex: string; flight?: string }[] };
  const list = (lj.ac ?? []).slice(0, 40);
  await Promise.all(
    list.map(async (ac) => {
      const hex = ac.hex.replace("~", "").toLowerCase();
      try {
        const r = await fetch(`https://adsb.lol/data/traces/${hex.slice(-2)}/trace_full_${hex}.json`, { headers: UA });
        if (!r.ok) return;
        const j = JSON.parse(new TextDecoder().decode(await readMaybeGzip(r))) as { timestamp: number; trace: unknown[][] };
        const pts: HistPoint[] = [];
        for (const e of j.trace) {
          const t = j.timestamp + Number(e[0]);
          if (t < q.startUnix || t > q.endUnix) continue;
          const la = Number(e[1]), lo = Number(e[2]);
          if (la < q.minLat || la > q.maxLat || lo < q.minLon || lo > q.maxLon) continue;
          pts.push({ t, lat: la, lon: lo, altFt: e[3] === "ground" ? 0 : Number(e[3]) || 0, gsKt: Number(e[4]) || 0 });
        }
        if (pts.length >= 2) out.set(hex, { hex, callsign: (ac.flight ?? hex).trim().toUpperCase(), points: pts });
      } catch {
        /* skip this aircraft */
      }
    }),
  );
  return out;
}

export const fetchHistoricalFlights = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    if (data.endUnix - data.startUnix > 2 * 3600) throw new Error("Time window too long (max 2 hours).");
    if ((data.maxLat - data.minLat) * (data.maxLon - data.minLon) > 4) throw new Error("Search area too large. Zoom in a bit.");

    let source = "adsb.lol history archive";
    let { flights, slots } = await fromHeatmaps(data);
    if (slots === 0) {
      flights = await fromLiveTraces(data);
      source = "adsb.lol live traces (archive for this time isn't published yet)";
    }
    const list = [...flights.values()]
      .filter((f) => f.points.length >= 2)
      .map((f) => ({ ...f, points: f.points.sort((a, b) => a.t - b.t) }))
      .slice(0, 400);
    return { flights: list, source };
  });
