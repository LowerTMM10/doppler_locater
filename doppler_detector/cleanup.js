// =====================================================================
// Signal cleanup & automatic Doppler curve detection
//  1. Band-pass filter (keep only the aircraft engine band)
//  2. Spectral subtraction (remove the background noise profile)
//  3. Noise-floor gate + histogram equalization (contrast)
//  4. Ridge detection + Doppler curve fitting (auto-detect, red line)
// Loaded after script.js; it extends renderSpectrogram / renderOverlay.
// =====================================================================

const cleanup = {
    bandpass: true,
    lowHz: 100,
    highHz: 2500,
    noiseSub: true,
    noiseSeconds: 2,
    noiseStrength: 1.5,
    gate: 0.35,          // 0..1 of normalized intensity
    histEq: false,
    liveAuto: false,

    // runtime
    profile: null,       // Float32Array mean noise magnitude per bin
    profileFor: null,    // spectrogramData array the profile belongs to
    ridge: [],           // [{t, f, s}]
    autoFit: null,       // { f0, v, dmin, t0, score }
    lastLiveDetect: 0
};

// ---------- helpers ----------
function frameTime(idx) {
    const n = state.spectrogramData.length;
    if (!state.isMicActive && state.spectrogramTimes && state.spectrogramTimes.length === n) {
        return state.spectrogramTimes[idx];
    }
    return (idx / Math.max(1, n)) * state.duration;
}

function ensureNoiseProfile() {
    const data = state.spectrogramData;
    if (!data.length) return null;
    if (cleanup.profileFor === data && cleanup.profile) return cleanup.profile;

    // How many frames make up the first N seconds?
    let nFrames;
    if (state.isMicActive) {
        nFrames = Math.round(cleanup.noiseSeconds * 60); // ~60 frames/s live
        if (data.length < nFrames) return null;         // still learning
    } else {
        nFrames = 0;
        while (nFrames < data.length && frameTime(nFrames) < cleanup.noiseSeconds) nFrames++;
        nFrames = Math.max(1, nFrames);
    }

    const bins = data[0].length;
    const prof = new Float32Array(bins);
    for (let f = 0; f < nFrames; f++) {
        const s = data[f];
        for (let i = 0; i < bins; i++) prof[i] += s[i];
    }
    for (let i = 0; i < bins; i++) prof[i] /= nFrames;

    cleanup.profile = prof;
    cleanup.profileFor = data;
    return prof;
}

// Returns the cleaned magnitude for one bin of one frame
function cleanMag(spectrum, binIdx, binHz, prof) {
    const hz = binIdx * binHz;
    if (cleanup.bandpass && (hz < cleanup.lowHz || hz > cleanup.highHz)) return 0;
    let m = spectrum[binIdx];
    if (cleanup.noiseSub && prof) m = Math.max(0, m - prof[binIdx] * cleanup.noiseStrength);
    return m;
}

// ---------- 1-3: cleaned spectrogram rendering ----------
renderSpectrogram = function () {
    if (!state.spectrogramData.length) return;

    const width = spectrogramCanvas.width;
    const height = spectrogramCanvas.height;
    const imgData = specCtx.createImageData(width, height);
    const pixels = imgData.data;

    const numFrames = state.spectrogramData.length;
    const fftBins = state.spectrogramData[0].length;
    const nyquist = state.sampleRate / 2;
    const binHz = nyquist / fftBins;
    const maxHz = Math.min(nyquist, state.maxHz);
    const paletteFunc = PALETTES[state.palette] || PALETTES.inferno;
    const gain = parseFloat(state.gain);
    const prof = cleanup.noiseSub ? ensureNoiseProfile() : null;
    const gate = cleanup.gate;

    const norms = new Float32Array(width * height);
    const hist = new Uint32Array(256);
    let counted = 0;

    for (let x = 0; x < width; x++) {
        const spectrum = state.spectrogramData[timeToFrame(xToT(x, width))];
        if (!spectrum) continue;
        for (let y = 0; y < height; y++) {
            const freqHz = yToF(y, height);
            const binIdx = Math.floor((freqHz / nyquist) * fftBins);
            let mag = 0;
            if (binIdx >= 0 && binIdx < fftBins) mag = cleanMag(spectrum, binIdx, binHz, prof) * gain;

            let norm = Math.min(1, Math.max(0, Math.log10(1 + mag * 50) / 1.5));
            // Noise-floor gate: everything under the threshold becomes 0
            norm = norm <= gate ? 0 : (norm - gate) / (1 - gate);

            norms[y * width + x] = norm;
            if (norm > 0) { hist[Math.min(255, Math.floor(norm * 255))]++; counted++; }
        }
    }

    // Histogram equalization over the visible (non-gated) pixels
    let cdf = null;
    if (cleanup.histEq && counted > 0) {
        cdf = new Float32Array(256);
        let acc = 0;
        for (let i = 0; i < 256; i++) { acc += hist[i]; cdf[i] = acc / counted; }
    }

    for (let p = 0; p < norms.length; p++) {
        let v = norms[p];
        if (cdf && v > 0) v = cdf[Math.min(255, Math.floor(v * 255))];
        const [r, g, b] = paletteFunc(v);
        const i = p * 4;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
    }

    specCtx.putImageData(imgData, 0, 0);

    if (state.isMicActive && cleanup.liveAuto) {
        const now = performance.now();
        if (now - cleanup.lastLiveDetect > 1000) {
            cleanup.lastLiveDetect = now;
            autoDetectDoppler(true);
        }
    }
};

// ---------- 4a: ridge detection ----------
function detectRidge() {
    const data = state.spectrogramData;
    if (!data.length) return [];
    const bins = data[0].length;
    const nyquist = state.sampleRate / 2;
    const binHz = nyquist / bins;
    const prof = cleanup.noiseSub ? ensureNoiseProfile() : null;
    // Only search what is visible on screen (time and frequency)
    const lo = Math.max(1, Math.floor(Math.max(view.f0, cleanup.bandpass ? cleanup.lowHz : 50) / binHz));
    const hi = Math.min(bins - 2, Math.ceil(Math.min(view.f1, cleanup.bandpass ? cleanup.highHz : nyquist) / binHz));
    const fStart = Math.max(0, timeToFrame(view.t0));
    const fEnd = Math.min(data.length, timeToFrame(view.t1) + 1);
    if (hi <= lo + 2) return [];

    const raw = [];
    const step = Math.max(1, Math.floor((fEnd - fStart) / 600)); // cap work
    const band = new Float32Array(hi - lo + 1);
    for (let f = fStart; f < fEnd; f += step) {
        const s = data[f];
        let best = -1, bestV = 0;
        for (let i = lo; i <= hi; i++) {
            const v = cleanMag(s, i, binHz, prof);
            band[i - lo] = v;
            if (v > bestV) { bestV = v; best = i; }
        }
        if (best < 0 || bestV <= 0) continue;
        // Prominence: peak must stand well above the band median
        const sorted = Array.from(band).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)] + 1e-9;
        if (bestV / median < 4) continue;
        // Parabolic interpolation for sub-bin frequency
        const a = cleanMag(s, best - 1, binHz, prof), c = cleanMag(s, best + 1, binHz, prof);
        const denom = a - 2 * bestV + c;
        const off = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        raw.push({ t: frameTime(f), f: (best + off) * binHz, s: bestV / median });
    }

    // Continuity: keep points that agree with their neighbours (a connected ridge)
    const ridge = [];
    const K = 4;
    for (let i = 0; i < raw.length; i++) {
        const neigh = [];
        for (let j = Math.max(0, i - K); j <= Math.min(raw.length - 1, i + K); j++) if (j !== i) neigh.push(raw[j].f);
        if (neigh.length < 2) continue;
        neigh.sort((a, b) => a - b);
        const med = neigh[Math.floor(neigh.length / 2)];
        if (Math.abs(raw[i].f - med) < Math.max(25, med * 0.03)) ridge.push(raw[i]);
    }

    // Link points into tracks (connected ridges) and keep the longest one
    const tracks = [];
    for (const p of ridge) {
        let bestTrack = null, bestD = Infinity;
        for (const tr of tracks) {
            const last = tr[tr.length - 1];
            const gap = p.t - last.t;
            const df = Math.abs(p.f - last.f);
            if (gap <= 1.0 && df < Math.max(40, last.f * 0.05) && df < bestD) { bestD = df; bestTrack = tr; }
        }
        if (bestTrack) bestTrack.push(p); else tracks.push([p]);
    }
    let longest = [];
    for (const tr of tracks) {
        const dur = tr[tr.length - 1].t - tr[0].t;
        if (tr.length > longest.length && dur > 0.5) longest = tr;
    }
    return longest;
}

// ---------- 4b: Doppler curve fit (f0 solved analytically) ----------
function dopplerShape(t, v, d, t0) {
    const dt = t - t0;
    return 1 - (v / SPEED_OF_SOUND) * ((v * dt) / Math.sqrt(d * d + v * v * dt * dt));
}

function evalFit(pts, v, d, t0) {
    let num = 0, den = 0;
    for (const p of pts) { const g = dopplerShape(p.t, v, d, t0); num += p.f * g; den += g * g; }
    const f0 = num / den;
    let sse = 0;
    for (const p of pts) { const e = f0 * dopplerShape(p.t, v, d, t0) - p.f; sse += e * e; }
    return { f0, v, dmin: d, t0, sse };
}


// Precise Doppler fit for any set of {t, f} points.
// Wide coarse search (speed, closest distance on a log scale, time of closest
// approach — also slightly outside the points), then Nelder-Mead polishing.
// The base frequency f0 is solved exactly for each guess.
function fitDopplerPoints(pts) {
    if (pts.length < 3) return null;
    const tStart = pts[0].t, tEnd = pts[pts.length - 1].t;
    const span = Math.max(0.5, tEnd - tStart);
    let best = null;
    for (let v = 15; v <= 350; v += 10)
        for (let k = 0; k < 30; k++) {
            const d = 20 * Math.pow(8000 / 20, k / 29);
            for (let j = 0; j <= 40; j++) {
                const t0 = tStart - span * 0.3 + (span * 1.6 * j) / 40;
                const r = evalFit(pts, v, d, t0);
                if (!best || r.sse < best.sse) best = r;
            }
        }

    // Nelder-Mead on (v, log d, t0)
    const cost = (x) => {
        const v = x[0], d = Math.exp(x[1]);
        if (v < 3 || v > 400 || d < 5 || d > 20000) return Infinity;
        return evalFit(pts, v, d, x[2]).sse;
    };
    let simplex = [[best.v, Math.log(best.dmin), best.t0]];
    const steps = [5, 0.2, span * 0.03];
    for (let i = 0; i < 3; i++) { const x = simplex[0].slice(); x[i] += steps[i]; simplex.push(x); }
    let vals = simplex.map(cost);
    for (let it = 0; it < 400; it++) {
        const order = [0, 1, 2, 3].sort((a, b) => vals[a] - vals[b]);
        simplex = order.map(i => simplex[i]); vals = order.map(i => vals[i]);
        const c = [0, 1, 2].map(i => (simplex[0][i] + simplex[1][i] + simplex[2][i]) / 3);
        const pt = (t) => c.map((ci, i) => ci + t * (simplex[3][i] - ci));
        const xr = pt(-1), fr = cost(xr);
        if (fr < vals[0]) {
            const xe = pt(-2), fe = cost(xe);
            if (fe < fr) { simplex[3] = xe; vals[3] = fe; } else { simplex[3] = xr; vals[3] = fr; }
        } else if (fr < vals[2]) { simplex[3] = xr; vals[3] = fr; }
        else {
            const xc = pt(0.5), fc = cost(xc);
            if (fc < vals[3]) { simplex[3] = xc; vals[3] = fc; }
            else for (let i = 1; i < 4; i++) { simplex[i] = simplex[i].map((x, k) => simplex[0][k] + 0.5 * (x - simplex[0][k])); vals[i] = cost(simplex[i]); }
        }
    }
    const x = simplex[0];
    const r = evalFit(pts, x[0], Math.exp(x[1]), x[2]);
    return r.sse <= best.sse ? r : best;
}

// Manual clicked points use the same precise fitter
fitDopplerCurve = function () {
    const fit = fitDopplerPoints(state.plottedPoints);
    if (!fit) return;
    state.fittedParams = { f0: fit.f0, v: fit.v, dmin: fit.dmin, t0: fit.t0 };
    f0Display.textContent = `${Math.round(fit.f0)} Hz`;
    speedDisplay.textContent = `${Math.round(fit.v * 3.6)} km/h (${Math.round(fit.v)} m/s)`;
    dminDisplay.textContent = `${Math.round(fit.dmin)} m`;
    t0Display.textContent = `${fit.t0.toFixed(2)} s`;
};

function fitRidge(points) {
    if (points.length < 8) return null;
    let pts = points;
    if (pts.length > 120) { const k = pts.length / 120; pts = Array.from({ length: 120 }, (_, i) => points[Math.floor(i * k)]); }

    let tStart = pts[0].t, tEnd = pts[pts.length - 1].t;
    const tStep = Math.max(0.05, (tEnd - tStart) / 60);
    let best = fitDopplerPoints(pts);

    // Robust step: drop outliers (> 3x median residual) and refine once more
    const res = pts.map(p => Math.abs(best.f0 * dopplerShape(p.t, best.v, best.dmin, best.t0) - p.f));
    const mad = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] || 1;
    const kept = pts.filter((_, i) => res[i] <= Math.max(5, 3 * mad));
    if (kept.length >= 8 && kept.length < pts.length) {
        pts = kept;
        best = fitDopplerPoints(pts);
    }
    cleanup.ridge = pts;

    // Fit score: R² against a flat line, and the curve must actually bend
    const mean = pts.reduce((a, p) => a + p.f, 0) / pts.length;
    const sst = pts.reduce((a, p) => a + (p.f - mean) ** 2, 0) || 1;
    const r2 = Math.max(0, 1 - best.sse / sst);
    const spread = best.f0 * 2 * best.v / SPEED_OF_SOUND;
    const cpaInside = best.t0 > tStart && best.t0 < tEnd;
    best.score = (spread > 10 && cpaInside) ? r2 : r2 * 0.5;
    best.points = pts.length;
    return best;
}

// ---------- 4c: run detection ----------
const autoDetectBtn = document.getElementById('autoDetectBtn');
const autoDetectStatus = document.getElementById('autoDetectStatus');

function autoDetectDoppler(silent) {
    if (!state.spectrogramData.length) {
        if (!silent) autoDetectStatus.textContent = 'Load audio or start the mic first.';
        return;
    }
    cleanup.ridge = detectRidge();
    const fit = fitRidge(cleanup.ridge);
    cleanup.autoFit = fit && fit.score >= 0.8 ? fit : null;

    if (cleanup.autoFit) {
        const f = cleanup.autoFit;
        autoDetectStatus.innerHTML = `<span class="text-rose-400 font-semibold">Doppler curve found</span> · fit ${(f.score * 100).toFixed(0)}%`;
        state.fittedParams = { f0: f.f0, v: f.v, dmin: f.dmin, t0: f.t0 };
        f0Display.textContent = `${Math.round(f.f0)} Hz`;
        speedDisplay.textContent = `${Math.round(f.v * 3.6)} km/h (${Math.round(f.v)} m/s)`;
        dminDisplay.textContent = `${Math.round(f.dmin)} m`;
        t0Display.textContent = `${f.t0.toFixed(2)} s`;
    } else {
        autoDetectStatus.textContent = fit
            ? `No clear curve (best fit ${(fit.score * 100).toFixed(0)}%). Try adjusting the filters.`
            : 'No ridge found. Try a lower noise gate.';
    }
    renderOverlay();
}

// ---------- overlay: ridge points + red auto curve ----------
const _baseOverlay = renderOverlay;
renderOverlay = function () {
    _baseOverlay();
    const width = overlayCanvas.width, height = overlayCanvas.height;
    const maxHz = state.maxHz, dur = state.duration;
    if (!dur) return;

    overCtx.fillStyle = 'rgba(251, 113, 133, 0.55)';
    for (const p of cleanup.ridge) {
        overCtx.fillRect(tToX(p.t, width) - 1, fToY(p.f, height) - 1, 2, 2);
    }

    const fit = cleanup.autoFit;
    if (!fit) return;
    overCtx.strokeStyle = '#ef4444';
    overCtx.lineWidth = 2.5;
    overCtx.setLineDash([8, 4]);
    overCtx.beginPath();
    let first = true;
    for (let x = 0; x < width; x += 2) {
        const y = fToY(fit.f0 * dopplerShape(xToT(x, width), fit.v, fit.dmin, fit.t0), height);
        if (y < 0 || y > height) { first = true; continue; }
        if (first) { overCtx.moveTo(x, y); first = false; } else overCtx.lineTo(x, y);
    }
    overCtx.stroke();
    overCtx.setLineDash([]);
    const cx = tToX(fit.t0, width);
    overCtx.fillStyle = '#ef4444';
    overCtx.font = 'bold 11px monospace';
    overCtx.fillText(`AUTO ${Math.round(fit.v * 3.6)} km/h · ${(fit.score * 100).toFixed(0)}%`, cx + 8, 16);
};

// ---------- controls ----------
function bindCleanup(id, key, parse, labelId, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, () => {
        cleanup[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
        if (labelId) document.getElementById(labelId).textContent = fmt(cleanup[key]);
        if (key === 'noiseSeconds') cleanup.profileFor = null;
        cleanup.ridge = []; cleanup.autoFit = null;
        renderSpectrogram();
        renderOverlay();
    });
}
bindCleanup('bandpassToggle', 'bandpass');
bindCleanup('lowHzSlider', 'lowHz', parseFloat, 'lowHzVal', v => `${v} Hz`);
bindCleanup('highHzSlider', 'highHz', parseFloat, 'highHzVal', v => `${v} Hz`);
bindCleanup('noiseSubToggle', 'noiseSub');
bindCleanup('noiseSecSlider', 'noiseSeconds', parseFloat, 'noiseSecVal', v => `${v} s`);
bindCleanup('noiseStrSlider', 'noiseStrength', parseFloat, 'noiseStrVal', v => `${v.toFixed(1)}x`);
bindCleanup('gateSlider', 'gate', parseFloat, 'gateVal', v => `${Math.round(v * 100)}%`);
bindCleanup('histEqToggle', 'histEq');
bindCleanup('liveAutoToggle', 'liveAuto');

autoDetectBtn.addEventListener('click', () => autoDetectDoppler(false));

// Clear also removes the auto result
clearPointsBtn.addEventListener('click', () => {
    cleanup.ridge = []; cleanup.autoFit = null;
    autoDetectStatus.textContent = '';
    renderOverlay();
});

// Re-render with cleanup active (in case audio is already loaded)
renderSpectrogram();
renderOverlay();
