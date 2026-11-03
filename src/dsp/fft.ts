// Fast In-Place Cooley-Tukey Radix-2 FFT
export function fftInPlace(real: Float32Array, imag: Float32Array, N: number): void {
  let j = 0;
  for (let i = 0; i < N - 1; i++) {
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;
      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
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
    const angle = (-2 * Math.PI) / len;
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

export interface STFTResult {
  spectrogramData: Float32Array[];
  spectrogramTimes: number[];
  sampleRate: number;
  duration: number;
}

export function computeOfflineSTFT(
  pcmData: Float32Array,
  sampleRate: number,
  duration: number,
  fftSize: number
): STFTResult {
  const numSamples = pcmData.length;
  // 75% overlap normally; for long recordings cap frames so memory stays under ~160 MB
  const maxFrames = Math.floor(40e6 / (fftSize / 2));
  const hopSize = Math.max(Math.floor(fftSize / 4), Math.ceil((numSamples - fftSize) / maxFrames));
  const numFrames = Math.floor((numSamples - fftSize) / hopSize);

  const spectrogramData: Float32Array[] = [];
  const spectrogramTimes: number[] = [];

  // Hanning Window
  const windowFunc = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    windowFunc[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const real = new Float32Array(fftSize);
  const imag = new Float32Array(fftSize);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * hopSize;

    // Windowed frame
    for (let i = 0; i < fftSize; i++) {
      real[i] = (pcmData[offset + i] || 0) * windowFunc[i];
      imag[i] = 0;
    }

    fftInPlace(real, imag, fftSize);

    // Magnitude spectrum (positive half up to Nyquist)
    const numBins = fftSize / 2;
    const mag = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      const r = real[i];
      const im = imag[i];
      mag[i] = Math.sqrt(r * r + im * im);
    }

    spectrogramData.push(mag);
    spectrogramTimes.push((offset + fftSize / 2) / sampleRate);
  }

  return {
    spectrogramData,
    spectrogramTimes,
    sampleRate,
    duration,
  };
}

/**
 * Generates synthetic acoustic flyover audio for demonstration/testing
 * v = 95 m/s (~342 km/h), dmin = 220 m, f0 = 980 Hz + harmonics + wind noise
 */
export function generateSyntheticFlybyAudio(audioCtx: AudioContext): AudioBuffer {
  const duration = 16;
  const sampleRate = audioCtx.sampleRate || 44100;
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, numSamples, sampleRate);
  const channelData = buffer.getChannelData(0);

  const v = 90; // m/s (~324 km/h)
  const dmin = 200; // meters
  const t0 = 8.0; // CPA at 8 seconds
  const f0 = 820; // Hz base engine harmonic
  const SPEED_OF_SOUND = 343;

  let phase1 = 0;
  let phase2 = 0;
  let phase3 = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const dt = t - t0;
    const dist = Math.sqrt(dmin * dmin + v * v * dt * dt);
    const distRatio = (v * dt) / dist;
    
    // Doppler shifted frequencies
    const curF1 = f0 * (1 - (v / SPEED_OF_SOUND) * distRatio);
    const curF2 = f0 * 2 * (1 - (v / SPEED_OF_SOUND) * distRatio);
    const curF3 = f0 * 0.5 * (1 - (v / SPEED_OF_SOUND) * distRatio);

    phase1 += (2 * Math.PI * curF1) / sampleRate;
    phase2 += (2 * Math.PI * curF2) / sampleRate;
    phase3 += (2 * Math.PI * curF3) / sampleRate;

    // Amplitude drops with inverse distance squared + atmospheric attenuation
    const amp = Math.min(1.0, 180 / Math.max(150, dist));
    
    // Engine sound (base + harmonics)
    const engine =
      Math.sin(phase1) * 0.45 +
      Math.sin(phase2) * 0.25 +
      Math.sin(phase3) * 0.15;

    // Background turbulent broadband pink-ish noise
    const noise = (Math.random() * 2 - 1) * 0.08 * (1 + 0.5 * amp);

    channelData[i] = (engine * amp + noise) * 0.5;
  }

  return buffer;
}
