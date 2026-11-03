# AeroDoppler OSINT DSP

Aircraft Audio Doppler Spectrum Extractor, Flight Path Analyzer & Signal DSP Toolkit.

Rewritten from the original LowerTMM10 Doppler detector into a high-performance **React + TypeScript + Vite + Tailwind CSS** application.

## Core Features

1. **High-Speed STFT Spectrogram & Audio DSP**:
   - Configurable FFT window sizes from 512 up to 32,768 bins.
   - Hanning windowing and Radix-2 Cooley-Tukey in-place FFT implementation.
   - Dual-canvas architecture: high-efficiency pixel rendering base layer and responsive 2D vector overlay.
   - Real-time live microphone stream analysis with raw input processing.
   - Built-in synthetic flyby audio generator for instant testing.

2. **Multi-Scale Zoom, Pan & Navigation**:
   - Time zoom (mouse wheel / zoom buttons).
   - Frequency zoom (Shift + wheel / zoom buttons).
   - Click-and-drag pan across time and frequency.
   - Horizontal time scrub bar and cursor telemetry (Time, Frequency, Magnitude in dB).

3. **Signal Cleanup & Filtering**:
   - Band-pass filtering with adjustable low-cut (20–1000 Hz) and high-cut (500–8000 Hz).
   - Spectral noise subtraction with customizable baseline learning sample and subtraction strength.
   - Dynamic noise floor gate and histogram equalization.

4. **Doppler Physics Curve Fitting**:
   - Interactive landmark point plotting along engine acoustic harmonics.
   - Exact numerical solution and Nelder-Mead simplex optimization solving for:
     - Base engine harmonic frequency ($f_0$ in Hz)
     - Aircraft ground speed ($v$ in km/h and m/s)
     - Closest approach distance ($d_{\text{min}}$ in meters)
     - Time of Closest Point of Approach ($t_0$ in seconds)
   - Automatic ridge detection and curve fitting with confidence scoring.

5. **Doppler Geolocation Heatmap Finder (WASM Accelerated)**:
   - **Multi-Flight Airspace Correlation**: Searches and correlates *all* aircraft trajectories in the selected region during the specified time frame, ranks them on a leaderboard by acoustic fit score and speed consistency, and identifies the best-match aircraft and observer location.
   - **Interactive Region Selector**:
     - Draw/drag rectangular search bounding box directly on the Leaflet map with real-time km dimensions.
     - "Fit to Flights" and "Fit to View" one-click bounds buttons.
     - Precision manual North/South/East/West coordinate bounds inputs.
   - **Inverse Doppler Acoustic Geolocation**: Inverts candidate ground observer locations against 3D aircraft trajectories using acoustic propagation delay ($t_{\text{obs}} = t_{\text{emit}} + d/c$) and line-of-sight Doppler projection.
   - **High-Performance Optimization**:
     - **Cylindrical Distance Bound (Spatial Pruning)**: Skips non-physical candidate points outside the $d_{\text{min}}$ cylinder envelope for up to 15x speedup.
     - **Local Cartesian Tangent Plane Projection**: Fast equirectangular metric projection eliminating trigonometric overhead in the inner loop.
     - **Rust + WebAssembly (WASM) Engine**: High-throughput inner loop evaluating up to 10M grid candidate points per second (`src/wasm/doppler_engine.rs` and `src/wasm/wasmEngine.ts`).
   - **Flexible Flight Data Ingestion**:
     - **adsb.lol API**: Live transponder query for flights within area radius (proxied via Vite dev server and Netlify to prevent CORS issues).
     - **Custom Uploads**: Supports dump1090 JSON, readsb traces, and CSV formats.
     - **Benchmark Corridor Test Flights**: Instant verification test cases (Typhoon Fast Jet, B738 Heathrow approach, C172 Skyhawk).
   - **Configurable Grid Densities**: 40×40 (1,600 pts), 80×80 (6,400 pts), 160×160 (25,600 pts), and 300×300 (90,000 pts).
   - **Zero-Limit OpenStreetMap**: Official OpenStreetMap tiles (OSM Dark Night mode, OSM Standard, and World Satellite Imagery), glowing 3D flight trajectory waypoints, thermal likelihood heatmap, and top candidate reticle pin with one-click coordinate copy.

6. **Tool Directory & Data Export**:
   - Integrated tools catalog default landing page with real-time search.
   - CSV export of mapped points and fitted parameters for ADS-B correlation.

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```