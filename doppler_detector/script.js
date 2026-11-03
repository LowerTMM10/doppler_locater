        // Speed of Sound in Air (m/s)
        const SPEED_OF_SOUND = 343.0;

        // Color Palettes Generator Maps (0 to 255 -> RGB)
        const PALETTES = {
            inferno: (val) => {
                // val normalized 0..1
                const r = Math.min(255, Math.max(0, val * 3.0 * 255));
                const g = Math.min(255, Math.max(0, (val - 0.35) * 3.0 * 255));
                const b = Math.min(255, Math.max(0, (val - 0.7) * 3.5 * 255));
                return [r, g, b];
            },
            viridis: (val) => {
                const r = Math.min(255, Math.max(0, (0.5 * Math.sin(val * Math.PI * 2 - 1.5) + 0.5) * 255));
                const g = Math.min(255, Math.max(0, val * 255));
                const b = Math.min(255, Math.max(0, Math.cos(val * Math.PI * 0.5) * 255));
                return [r, g, b];
            },
            plasma: (val) => {
                const r = Math.min(255, Math.max(0, (Math.sin(val * Math.PI) * 0.9 + 0.1) * 255));
                const g = Math.min(255, Math.max(0, (val * val) * 255));
                const b = Math.min(255, Math.max(0, (Math.cos(val * Math.PI * 0.5)) * 255));
                return [r, g, b];
            },
            radar: (val) => {
                return [0, val * 255, val * 120];
            },
            grayscale: (val) => {
                const v = val * 255;
                return [v, v, v];
            }
        };

        // Application State
        const state = {
            audioCtx: null,
            audioBuffer: null,
            audioSourceNode: null,
            micStream: null,
            analyserNode: null,
            isPlaying: false,
            isMicActive: false,
            startTime: 0,
            pauseOffset: 0,
            duration: 0,
            
            // DSP Parameters
            fftSize: 2048,
            maxHz: 3000,
            palette: 'inferno',
            gain: 1.5,
            
            // Computed Spectrogram Data Matrix
            spectrogramData: [], // Array of Float32Array frequency columns
            spectrogramTimes: [],
            sampleRate: 44100,

            // Doppler Curve Fitting Points [{t, f, x, y}]
            plottedPoints: [],
            fittedParams: null // { f0, v, dmin, t0 }
        };

        // --- Zoomable view window (time & frequency shown on screen) ---
        const view = { t0: 0, t1: 1, f0: 0, f1: 3000 };
        const MIN_VIEW_SECONDS = 0.5, MIN_VIEW_HZ = 100;
        function viewMaxHz() { return Math.min(state.sampleRate / 2, 12000); }
        function tToX(t, w) { return ((t - view.t0) / (view.t1 - view.t0)) * w; }
        function xToT(x, w) { return view.t0 + (x / w) * (view.t1 - view.t0); }
        function fToY(f, h) { return h * (1 - (f - view.f0) / (view.f1 - view.f0)); }
        function yToF(y, h) { return view.f0 + (1 - y / h) * (view.f1 - view.f0); }
        function timeToFrame(t) {
            const n = state.spectrogramData.length;
            const times = state.spectrogramTimes;
            if (!state.isMicActive && times && times.length === n && n > 1) {
                const hop = times[1] - times[0];
                return Math.round((t - times[0]) / hop);
            }
            return Math.floor((t / (state.duration || 1)) * n);
        }
        function clampView() {
            const dur = state.duration || 1;
            let span = Math.min(dur, Math.max(MIN_VIEW_SECONDS, view.t1 - view.t0));
            view.t0 = Math.max(0, Math.min(dur - span, view.t0));
            view.t1 = view.t0 + span;
            const top = viewMaxHz();
            let fspan = Math.min(top, Math.max(MIN_VIEW_HZ, view.f1 - view.f0));
            view.f0 = Math.max(0, Math.min(top - fspan, view.f0));
            view.f1 = view.f0 + fspan;
            state.maxHz = view.f1;
            if (typeof updateViewUI === 'function') updateViewUI();
        }
        function resetView() {
            view.t0 = 0; view.t1 = state.duration || 1;
            view.f0 = 0; view.f1 = Math.min(3000, viewMaxHz());
            clampView();
        }

        // DOM Elements
        const spectrogramCanvas = document.getElementById('spectrogramCanvas');
        const overlayCanvas = document.getElementById('overlayCanvas');
        const specCtx = spectrogramCanvas.getContext('2d');
        const overCtx = overlayCanvas.getContext('2d');
        const canvasWrapper = document.getElementById('canvasWrapper');

        const audioFileInput = document.getElementById('audioFileInput');
        const uploadBtn = document.getElementById('uploadBtn');
        const micBtn = document.getElementById('micBtn');
        const playPauseBtn = document.getElementById('playPauseBtn');
        const playIcon = document.getElementById('playIcon');
        const seekSlider = document.getElementById('seekSlider');
        const audioStatus = document.getElementById('audioStatus');
        const currentTimeDisplay = document.getElementById('currentTimeDisplay');
        const totalTimeDisplay = document.getElementById('totalTimeDisplay');

        const fftSelect = document.getElementById('fftSelect');
        const paletteSelect = document.getElementById('paletteSelect');
        const gainSlider = document.getElementById('gainSlider');
        const gainVal = document.getElementById('gainVal');

        const hoverTime = document.getElementById('hoverTime');
        const hoverFreq = document.getElementById('hoverFreq');
        const hoverAmp = document.getElementById('hoverAmp');

        const pointCountDisplay = document.getElementById('pointCountDisplay');
        const f0Display = document.getElementById('f0Display');
        const speedDisplay = document.getElementById('speedDisplay');
        const dminDisplay = document.getElementById('dminDisplay');
        const t0Display = document.getElementById('t0Display');
        const clearPointsBtn = document.getElementById('clearPointsBtn');
        const exportCsvBtn = document.getElementById('exportCsvBtn');

        // Initialize Canvas Sizing
        function resizeCanvases() {
            const rect = canvasWrapper.getBoundingClientRect();
            spectrogramCanvas.width = rect.width;
            spectrogramCanvas.height = rect.height;
            overlayCanvas.width = rect.width;
            overlayCanvas.height = rect.height;
            renderSpectrogram();
            renderOverlay();
        }
        window.addEventListener('resize', resizeCanvases);

        // Audio Context Initialization
        function getAudioContext() {
            if (!state.audioCtx) {
                state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (state.audioCtx.state === 'suspended') {
                state.audioCtx.resume();
            }
            return state.audioCtx;
        }

        // --- File Upload & Decode ---
        uploadBtn.addEventListener('click', () => audioFileInput.click());
        audioFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            stopAudio();
            stopMic();
            audioStatus.textContent = "Decoding...";
            audioStatus.className = "text-xs text-cyan-400 font-mono animate-pulse";

            const ctx = getAudioContext();
            const arrayBuffer = await file.arrayBuffer();

            try {
                state.audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                state.duration = state.audioBuffer.duration;
                state.sampleRate = state.audioBuffer.sampleRate;
                
                audioStatus.textContent = file.name.substring(0, 15) + '...';
                audioStatus.className = "text-xs text-emerald-400 font-mono";
                totalTimeDisplay.textContent = formatTime(state.duration);
                playPauseBtn.disabled = false;
                seekSlider.disabled = false;

                // Perform Offline STFT Analysis
                computeOfflineSpectrogram();
            } catch (err) {
                alert("Failed to decode audio file. Make sure it's a valid audio format.");
                audioStatus.textContent = "Error";
                audioStatus.className = "text-xs text-rose-400 font-mono";
            }
        });

        // --- Offline High-Speed STFT Computation ---
        function computeOfflineSpectrogram() {
            if (!state.audioBuffer) return;

            const pcmData = state.audioBuffer.getChannelData(0);
            const numSamples = pcmData.length;
            const fftSize = parseInt(state.fftSize);
            // 75% overlap normally; for long recordings (e.g. 1 hour) use a bigger hop
            // so memory stays around 160 MB of spectrum data.
            const maxFrames = Math.floor(40e6 / (fftSize / 2));
            const hopSize = Math.max(Math.floor(fftSize / 4), Math.ceil((numSamples - fftSize) / maxFrames));
            const numFrames = Math.floor((numSamples - fftSize) / hopSize);

            state.spectrogramData = [];
            state.spectrogramTimes = [];

            // Window Function (Hanning Window)
            const windowFunc = new Float32Array(fftSize);
            for (let i = 0; i < fftSize; i++) {
                windowFunc[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
            }

            // Radix-2 Cooley-Tukey FFT implementation for fast offline computing
            const real = new Float32Array(fftSize);
            const imag = new Float32Array(fftSize);

            for (let f = 0; f < numFrames; f++) {
                const offset = f * hopSize;
                
                // Copy windowed frame
                for (let i = 0; i < fftSize; i++) {
                    real[i] = pcmData[offset + i] * windowFunc[i];
                    imag[i] = 0;
                }

                // In-place FFT
                fftInPlace(real, imag, fftSize);

                // Magnitude spectrum (only positive frequencies up to Nyquist)
                const numBins = fftSize / 2;
                const mag = new Float32Array(numBins);
                for (let i = 0; i < numBins; i++) {
                    const r = real[i];
                    const im = imag[i];
                    mag[i] = Math.sqrt(r * r + im * im);
                }

                state.spectrogramData.push(mag);
                state.spectrogramTimes.push((offset + fftSize / 2) / state.sampleRate);
            }

            resetView();
            renderSpectrogram();
            renderOverlay();
        }

        // Fast In-Place FFT (Cooley-Tukey)
        function fftInPlace(real, imag, N) {
            let j = 0;
            for (let i = 0; i < N - 1; i++) {
                if (i < j) {
                    let tempR = real[i]; real[i] = real[j]; real[j] = tempR;
                    let tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
                }
                let k = N >> 1;
                while (k <= j) {
                    j -= k;
                    k >>= 1;
                }
                j += k;
            }

            for (let len = 2; len <= N; len <<= 1) {
                const halfLen = len >> 1;
                const angle = -2 * Math.PI / len;
                const wStepR = Math.cos(angle);
                const wStepI = Math.sin(angle);

                for (let i = 0; i < N; i += len) {
                    let wR = 1;
                    let wI = 0;
                    for (let k = 0; k < halfLen; k++) {
                        const pos = i + k;
                        const matchPos = pos + halfLen;

                        const uR = real[pos];
                        const uI = imag[pos];
                        const vR = real[matchPos] * wR - imag[matchPos] * wI;
                        const vI = real[matchPos] * wI + imag[matchPos] * wR;

                        real[pos] = uR + vR;
                        imag[pos] = uI + vI;
                        real[matchPos] = uR - vR;
                        imag[matchPos] = uI - vI;

                        const nextWR = wR * wStepR - wI * wStepI;
                        const nextWI = wR * wStepI + wI * wStepR;
                        wR = nextWR;
                        wI = nextWI;
                    }
                }
            }
        }

        // --- Render Spectrogram to Canvas ---
        function renderSpectrogram() {
            if (!state.spectrogramData.length) return;

            const width = spectrogramCanvas.width;
            const height = spectrogramCanvas.height;
            const imgData = specCtx.createImageData(width, height);
            const pixels = imgData.data;

            const numFrames = state.spectrogramData.length;
            const fftBins = state.spectrogramData[0].length;
            const nyquist = state.sampleRate / 2;
            const maxHz = Math.min(nyquist, state.maxHz);
            const paletteFunc = PALETTES[state.palette] || PALETTES.inferno;
            const gain = parseFloat(state.gain);

            for (let x = 0; x < width; x++) {
                // Map screen X to frame index
                const frameIdx = Math.floor((x / width) * numFrames);
                const spectrum = state.spectrogramData[frameIdx];

                if (!spectrum) continue;

                for (let y = 0; y < height; y++) {
                    // Map screen Y (0 at top) to Frequency (0 at bottom)
                    const freqHz = (1 - y / height) * maxHz;
                    const binIdx = Math.floor((freqHz / nyquist) * fftBins);

                    let mag = 0;
                    if (binIdx >= 0 && binIdx < fftBins) {
                        mag = spectrum[binIdx] * gain;
                    }

                    // Convert to Logarithmic dB scale for optimal signal contrast
                    let norm = Math.min(1.0, Math.max(0.0, Math.log10(1 + mag * 50) / 1.5));

                    const [r, g, b] = paletteFunc(norm);
                    const pixelIdx = (y * width + x) * 4;

                    pixels[pixelIdx] = r;
                    pixels[pixelIdx + 1] = g;
                    pixels[pixelIdx + 2] = b;
                    pixels[pixelIdx + 3] = 255;
                }
            }

            specCtx.putImageData(imgData, 0, 0);
        }

        // --- Overlay Layer (Grid, Doppler Curve, Plotted Points) ---
        function renderOverlay() {
            const width = overlayCanvas.width;
            const height = overlayCanvas.height;
            overCtx.clearRect(0, 0, width, height);

            // Draw Frequency Grid & Time Axes
            overCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
            overCtx.lineWidth = 1;
            overCtx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            overCtx.font = '10px monospace';

            // Frequency horizontal gridlines
            const fSpan = view.f1 - view.f0;
            const stepHz = niceStep(fSpan / 6, [10, 20, 50, 100, 200, 250, 500, 1000, 2000]);
            for (let hz = Math.ceil(view.f0 / stepHz) * stepHz; hz < view.f1; hz += stepHz) {
                if (hz <= view.f0) continue;
                const y = fToY(hz, height);
                overCtx.beginPath();
                overCtx.moveTo(0, y);
                overCtx.lineTo(width, y);
                overCtx.stroke();
                overCtx.fillText(`${hz} Hz`, 8, y - 4);
            }

            // Time vertical gridlines
            if (state.duration > 0) {
                const timeStep = niceStep((view.t1 - view.t0) / 8, [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]);
                for (let t = Math.ceil(view.t0 / timeStep) * timeStep; t < view.t1; t += timeStep) {
                    if (t <= view.t0) continue;
                    const x = tToX(t, width);
                    overCtx.beginPath();
                    overCtx.moveTo(x, 0);
                    overCtx.lineTo(x, height);
                    overCtx.stroke();
                    overCtx.fillText(t >= 60 ? formatTime(t) : `${t.toFixed(1)}s`, x + 4, height - 8);
                }
            }

            // Draw Playback Head Line
            if (state.duration > 0) {
                const currentT = state.isPlaying ? 
                    (state.audioCtx.currentTime - state.startTime) : state.pauseOffset;
                const playX = tToX(currentT, width);

                overCtx.strokeStyle = '#00f2fe';
                overCtx.lineWidth = 2;
                overCtx.beginPath();
                overCtx.moveTo(playX, 0);
                overCtx.lineTo(playX, height);
                overCtx.stroke();
            }

            // Draw Fitted Doppler Curve (if calculated)
            if (state.fittedParams && state.duration > 0) {
                const { f0, v, dmin, t0 } = state.fittedParams;
                overCtx.strokeStyle = '#10b981'; // Neon Emerald
                overCtx.lineWidth = 3;
                overCtx.beginPath();

                let first = true;
                for (let x = 0; x < width; x += 2) {
                    const t = xToT(x, width);
                    const deltaT = t - t0;
                    
                    // Doppler Equation: f(t) = f0 * (1 - (v/c) * (v * deltaT / sqrt(dmin^2 + v^2 * deltaT^2)))
                    const distRatio = (v * deltaT) / Math.sqrt(dmin * dmin + v * v * deltaT * deltaT);
                    const freq = f0 * (1.0 - (v / SPEED_OF_SOUND) * distRatio);

                    const y = fToY(freq, height);

                    if (y >= 0 && y <= height) {
                        if (first) {
                            overCtx.moveTo(x, y);
                            first = false;
                        } else {
                            overCtx.lineTo(x, y);
                        }
                    }
                }
                overCtx.stroke();
            }

            // Draw Plotted Landmark Points
            state.plottedPoints.forEach((pt, idx) => {
                const x = tToX(pt.t, width);
                const y = fToY(pt.f, height);

                // Point Marker Outer Ring
                overCtx.fillStyle = '#7c3aed';
                overCtx.beginPath();
                overCtx.arc(x, y, 7, 0, Math.PI * 2);
                overCtx.fill();

                // Point Inner Core
                overCtx.fillStyle = '#00f2fe';
                overCtx.beginPath();
                overCtx.arc(x, y, 3, 0, Math.PI * 2);
                overCtx.fill();

                // Number Label
                overCtx.fillStyle = '#ffffff';
                overCtx.font = 'bold 10px monospace';
                overCtx.fillText(`${idx + 1}`, x + 10, y + 3);
            });
        }

        // --- User Interaction & Point Plotting ---
        overlayCanvas.addEventListener('mousemove', (e) => {
            const rect = overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const width = overlayCanvas.width;
            const height = overlayCanvas.height;

            const hoverT = xToT(mouseX, width);
            const hoverF = yToF(mouseY, height);

            hoverTime.textContent = `${hoverT.toFixed(2)} s`;
            hoverFreq.textContent = `${Math.round(hoverF)} Hz`;

            // Sample magnitude under cursor if data ready
            if (state.spectrogramData.length > 0) {
                const frameIdx = timeToFrame(hoverT);
                const spectrum = state.spectrogramData[frameIdx];
                if (spectrum) {
                    const binIdx = Math.floor((hoverF / (state.sampleRate / 2)) * spectrum.length);
                    const mag = spectrum[binIdx] || 0;
                    hoverAmp.textContent = `${(20 * Math.log10(mag + 1e-6)).toFixed(1)} dB`;
                }
            }
        });

        overlayCanvas.addEventListener('click', (e) => {
            if (!state.duration || viewDragMoved) return;

            const rect = overlayCanvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const width = overlayCanvas.width;
            const height = overlayCanvas.height;

            const pointTime = xToT(mouseX, width);
            const pointFreq = yToF(mouseY, height);

            // Add point
            state.plottedPoints.push({ t: pointTime, f: pointFreq });
            state.plottedPoints.sort((a, b) => a.t - b.t);

            pointCountDisplay.textContent = state.plottedPoints.length;

            // Calculate Fit if >= 3 points available
            if (state.plottedPoints.length >= 3) {
                fitDopplerCurve();
            }

            renderOverlay();
        });

        // --- Non-Linear Least Squares Doppler Fitting ---
        function fitDopplerCurve() {
            const pts = state.plottedPoints;
            if (pts.length < 3) return;

            // Heuristic Initial Estimates
            const fApproach = pts[0].f;
            const fRecede = pts[pts.length - 1].f;
            const initialF0 = (fApproach + fRecede) / 2;

            // Estimate CPA Time (t0) as inflection midpoint
            let initialT0 = pts[Math.floor(pts.length / 2)].t;

            // Estimate Velocity (m/s) from total delta f
            // Delta F_max ≈ 2 * f0 * (v / c)
            const deltaF = Math.abs(fApproach - fRecede);
            let initialV = Math.min(250, (deltaF * SPEED_OF_SOUND) / (2 * initialF0 || 1));
            let initialDmin = 300; // default 300 meters distance

            // Gradient Descent Optimization to find best-fit (f0, v, dmin, t0)
            let bestParams = { f0: initialF0, v: initialV, dmin: initialDmin, t0: initialT0 };
            let minError = Infinity;

            for (let vTrial = 40; vTrial <= 300; vTrial += 10) { // Speed in m/s (144 to 1080 km/h)
                for (let dTrial = 50; dTrial <= 1500; dTrial += 50) { // Distance in meters
                    for (let f0Trial = initialF0 * 0.8; f0Trial <= initialF0 * 1.2; f0Trial += 5) {
                        for (let t0Trial = pts[0].t; t0Trial <= pts[pts.length - 1].t; t0Trial += 0.2) {
                            
                            let sqError = 0;
                            for (let p of pts) {
                                const dt = p.t - t0Trial;
                                const distRatio = (vTrial * dt) / Math.sqrt(dTrial * dTrial + vTrial * vTrial * dt * dt);
                                const modelF = f0Trial * (1.0 - (vTrial / SPEED_OF_SOUND) * distRatio);
                                const err = modelF - p.f;
                                sqError += err * err;
                            }

                            if (sqError < minError) {
                                minError = sqError;
                                bestParams = { f0: f0Trial, v: vTrial, dmin: dTrial, t0: t0Trial };
                            }
                        }
                    }
                }
            }

            state.fittedParams = bestParams;

            // Update UI Display
            f0Display.textContent = `${Math.round(bestParams.f0)} Hz`;
            speedDisplay.textContent = `${Math.round(bestParams.v * 3.6)} km/h (${Math.round(bestParams.v)} m/s)`;
            dminDisplay.textContent = `${Math.round(bestParams.dmin)} m`;
            t0Display.textContent = `${bestParams.t0.toFixed(2)} s`;
        }

        // --- Controls Event Handlers ---
        clearPointsBtn.addEventListener('click', () => {
            state.plottedPoints = [];
            state.fittedParams = null;
            pointCountDisplay.textContent = "0";
            f0Display.textContent = "-- Hz";
            speedDisplay.textContent = "-- km/h";
            dminDisplay.textContent = "-- m";
            t0Display.textContent = "-- s";
            renderOverlay();
        });

        fftSelect.addEventListener('change', (e) => {
            state.fftSize = parseInt(e.target.value);
            document.getElementById('fftValue').textContent = state.fftSize;
            if (state.audioBuffer) computeOfflineSpectrogram();
        });


        paletteSelect.addEventListener('change', (e) => {
            state.palette = e.target.value;
            renderSpectrogram();
        });

        gainSlider.addEventListener('input', (e) => {
            state.gain = parseFloat(e.target.value);
            gainVal.textContent = `${state.gain.toFixed(1)}x`;
            renderSpectrogram();
        });

        // --- Playback Controls ---
        playPauseBtn.addEventListener('click', togglePlayPause);
        seekSlider.addEventListener('input', (e) => {
            const seekTime = (e.target.value / 100) * state.duration;
            state.pauseOffset = seekTime;
            currentTimeDisplay.textContent = formatTime(seekTime);
            if (state.isPlaying) {
                stopAudio();
                playAudio();
            } else {
                renderOverlay();
            }
        });

        function togglePlayPause() {
            if (state.isPlaying) {
                pauseAudio();
            } else {
                playAudio();
            }
        }

        function playAudio() {
            if (!state.audioBuffer) return;
            const ctx = getAudioContext();

            state.audioSourceNode = ctx.createBufferSource();
            state.audioSourceNode.buffer = state.audioBuffer;
            state.audioSourceNode.connect(ctx.destination);

            state.startTime = ctx.currentTime - state.pauseOffset;
            state.audioSourceNode.start(0, state.pauseOffset);
            state.isPlaying = true;

            playIcon.className = "fa-solid fa-pause";
            requestAnimationFrame(updatePlaybackProgress);
        }

        function pauseAudio() {
            if (!state.isPlaying) return;
            state.pauseOffset = state.audioCtx.currentTime - state.startTime;
            stopAudio();
        }

        function stopAudio() {
            if (state.audioSourceNode) {
                try { state.audioSourceNode.stop(); } catch (e) {}
                state.audioSourceNode.disconnect();
                state.audioSourceNode = null;
            }
            state.isPlaying = false;
            playIcon.className = "fa-solid fa-play";
        }

        function updatePlaybackProgress() {
            if (!state.isPlaying) return;
            const currentT = state.audioCtx.currentTime - state.startTime;
            
            if (currentT >= state.duration) {
                stopAudio();
                state.pauseOffset = 0;
                seekSlider.value = 0;
                currentTimeDisplay.textContent = formatTime(0);
                renderOverlay();
                return;
            }

            state.pauseOffset = currentT;
            if (currentT > view.t1 || currentT < view.t0) {
                const span = view.t1 - view.t0;
                view.t0 = currentT - span * 0.1; view.t1 = view.t0 + span;
                clampView(); renderSpectrogram();
            }
            seekSlider.value = (currentT / state.duration) * 100;
            currentTimeDisplay.textContent = formatTime(currentT);
            renderOverlay();

            requestAnimationFrame(updatePlaybackProgress);
        }

        // --- Live Microphone Audio Input ---
        micBtn.addEventListener('click', async () => {
            if (state.isMicActive) {
                stopMic();
                return;
            }

            try {
                // Request raw stream without noise suppression or silence gating
                const stream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false
                    }, 
                    video: false 
                });
                state.micStream = stream;
                state.isMicActive = true;

                document.getElementById('micBtnText').textContent = "Stop Mic";
                micBtn.className = "bg-rose-600 hover:bg-rose-500 text-white font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-2 transition duration-150";

                const ctx = getAudioContext();
                const source = ctx.createMediaStreamSource(stream);
                state.analyserNode = ctx.createAnalyser();
                state.analyserNode.fftSize = parseInt(state.fftSize);
                source.connect(state.analyserNode);

                state.spectrogramData = [];
                state.duration = 20; // 20s sliding window for live mic
                view.t0 = 0; view.t1 = 20; clampView();
                totalTimeDisplay.textContent = "Live Stream";
                audioStatus.textContent = "Microphone Active";
                audioStatus.className = "text-xs text-rose-400 font-mono animate-pulse";

                renderLiveMicSpectrogram();
            } catch (err) {
                alert("Microphone access denied or unavailble.");
            }
        });

        function stopMic() {
            if (state.micStream) {
                state.micStream.getTracks().forEach(track => track.stop());
                state.micStream = null;
            }
            state.isMicActive = false;
            document.getElementById('micBtnText').textContent = "Live Mic";
            micBtn.className = "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold px-4 py-2 rounded-lg text-xs flex items-center gap-2 transition duration-150";
        }

        function renderLiveMicSpectrogram() {
            if (!state.isMicActive) return;

            const bufferLength = state.analyserNode.frequencyBinCount;
            const dataArray = new Float32Array(bufferLength);
            state.analyserNode.getFloatFrequencyData(dataArray);

            // Convert dB to linear magnitude scale
            const magArray = new Float32Array(bufferLength);
            for (let i = 0; i < bufferLength; i++) {
                magArray[i] = Math.pow(10, dataArray[i] / 20);
            }

            state.spectrogramData.push(magArray);
            if (state.spectrogramData.length > 300) { // Limit live history buffer
                state.spectrogramData.shift();
            }

            renderSpectrogram();
            renderOverlay();
            requestAnimationFrame(renderLiveMicSpectrogram);
        }

        // --- Export CSV for ADS-B Matching ---
        exportCsvBtn.addEventListener('click', () => {
            if (state.plottedPoints.length === 0) {
                alert("No plotted points available to export. Click on the spectrogram to drop Doppler points first.");
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,point_index,timestamp_seconds,frequency_hz\n";
            state.plottedPoints.forEach((pt, idx) => {
                csvContent += `${idx + 1},${pt.t.toFixed(4)},${pt.f.toFixed(2)}\n`;
            });

            if (state.fittedParams) {
                const { f0, v, dmin, t0 } = state.fittedParams;
                csvContent += `\n# FITTED DOPPLER PARAMETERS\n`;
                csvContent += `# Base Frequency (Hz),${f0.toFixed(2)}\n`;
                csvContent += `# Velocity (m/s),${v.toFixed(2)}\n`;
                csvContent += `# Velocity (km/h),${(v * 3.6).toFixed(2)}\n`;
                csvContent += `# Closest Distance dmin (m),${dmin.toFixed(2)}\n`;
                csvContent += `# Time of CPA (s),${t0.toFixed(4)}\n`;
            }

            const encodedUri = encodeURI(csvContent);
            const link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", "doppler_curve_points.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });

        // Helper: Time Format mm:ss.s
        function formatTime(seconds) {
            const m = Math.floor(seconds / 60);
            const s = (seconds % 60).toFixed(1);
            return `${m.toString().padStart(2, '0')}:${s.padStart(4, '0')}`;
        }

        // Initial setup on window load
        window.onload = () => {
            resizeCanvases();
        };

        function niceStep(raw, steps) {
            for (const st of steps) if (st >= raw) return st;
            return steps[steps.length - 1];
        }

        // --- Zoom & scroll interaction ---
        const viewScroll = document.getElementById('viewScroll');
        const viewInfo = document.getElementById('viewInfo');
        let viewDragMoved = false;

        function updateViewUI() {
            const dur = state.duration || 1;
            const span = view.t1 - view.t0;
            const free = Math.max(0, dur - span);
            viewScroll.disabled = free <= 0;
            viewScroll.value = free > 0 ? Math.round((view.t0 / free) * 1000) : 0;
            viewInfo.textContent = `${span >= 60 ? formatTime(span) : span.toFixed(1) + 's'} · ${Math.round(view.f0)}–${Math.round(view.f1)} Hz`;
        }
        function redrawView() { clampView(); renderSpectrogram(); renderOverlay(); }

        function zoomTime(factor, anchorT) {
            const span = view.t1 - view.t0;
            const next = span * factor;
            const r = (anchorT - view.t0) / span;
            view.t0 = anchorT - r * next; view.t1 = view.t0 + next;
            redrawView();
        }
        function zoomFreq(factor, anchorF) {
            const span = view.f1 - view.f0;
            const next = span * factor;
            const r = (anchorF - view.f0) / span;
            view.f0 = anchorF - r * next; view.f1 = view.f0 + next;
            redrawView();
        }

        overlayCanvas.addEventListener('wheel', (e) => {
            if (!state.duration) return;
            e.preventDefault();
            const rect = overlayCanvas.getBoundingClientRect();
            const w = overlayCanvas.width, h = overlayCanvas.height;
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
            const dx = e.deltaX * unit, dy = e.deltaY * unit;
            // Trackpad sideways swipe = scroll through time
            if (Math.abs(dx) > Math.abs(dy) && !e.shiftKey) {
                const shift = (dx / w) * (view.t1 - view.t0);
                view.t0 += shift; view.t1 += shift;
                redrawView();
                return;
            }
            const factor = Math.exp(dy * 0.0015);
            if (e.shiftKey) zoomFreq(Math.exp((dy || dx) * 0.0015), yToF(e.clientY - rect.top, h));
            else zoomTime(factor, xToT(e.clientX - rect.left, w));
        }, { passive: false });

        // Drag to pan (a click without moving still plots a point)
        overlayCanvas.addEventListener('mousedown', (e) => {
            if (!state.duration || e.button !== 0) return;
            const startX = e.clientX, startY = e.clientY;
            const v0 = { ...view };
            const w = overlayCanvas.width, h = overlayCanvas.height;
            viewDragMoved = false;
            const move = (ev) => {
                const ddx = ev.clientX - startX, ddy = ev.clientY - startY;
                if (!viewDragMoved && Math.hypot(ddx, ddy) < 4) return;
                viewDragMoved = true;
                overlayCanvas.style.cursor = 'grabbing';
                const dt = (ddx / w) * (v0.t1 - v0.t0);
                const df = (ddy / h) * (v0.f1 - v0.f0);
                view.t0 = v0.t0 - dt; view.t1 = v0.t1 - dt;
                view.f0 = v0.f0 + df; view.f1 = v0.f1 + df;
                redrawView();
            };
            const up = () => {
                window.removeEventListener('mousemove', move);
                window.removeEventListener('mouseup', up);
                overlayCanvas.style.cursor = '';
                setTimeout(() => { viewDragMoved = false; }, 0);
            };
            window.addEventListener('mousemove', move);
            window.addEventListener('mouseup', up);
        });

        viewScroll.addEventListener('input', () => {
            const span = view.t1 - view.t0;
            const free = Math.max(0, (state.duration || 1) - span);
            view.t0 = (viewScroll.value / 1000) * free; view.t1 = view.t0 + span;
            redrawView();
        });

        const centerT = () => (view.t0 + view.t1) / 2;
        document.getElementById('zoomInBtn').addEventListener('click', () => zoomTime(0.5, centerT()));
        document.getElementById('zoomOutBtn').addEventListener('click', () => zoomTime(2, centerT()));
        document.getElementById('fZoomInBtn').addEventListener('click', () => zoomFreq(0.5, (view.f0 + view.f1) / 2));
        document.getElementById('resetViewBtn').addEventListener('click', () => { resetView(); renderSpectrogram(); renderOverlay(); });
        updateViewUI();
