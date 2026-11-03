# AeroDoppler OSINT DSP

Aircraft Audio Doppler Spectrum Extractor, Flight Path Analyzer & Signal DSP Toolkit.

Rewritten from the original LowerTMM10 Doppler detector into a high-performance **React + TypeScript + Vite + Tailwind CSS** application.

## Core Features Ported

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

5. **Tool Directory & Data Export**:
   - Integrated tools catalog with real-time search.
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