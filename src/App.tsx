import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { SpectrogramViewer } from './components/SpectrogramViewer';
import { HomeDirectory } from './components/HomeDirectory';
import {
  CleanupSettings,
  DopplerPoint,
  FittedParams,
  PaletteName,
  RidgePoint,
  SpectrogramView,
} from './types';
import {
  computeOfflineSTFT,
  generateSyntheticFlybyAudio,
} from './dsp/fft';
import {
  computeNoiseProfile,
  detectRidge,
  fitDopplerPoints,
  fitRidge,
} from './dsp/fitting';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'aerodoppler' | 'home'>('aerodoppler');

  // Audio Context & Buffer
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const liveAnimFrameRef = useRef<number | null>(null);
  const playbackAnimFrameRef = useRef<number | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sampleRate, setSampleRate] = useState(44100);
  const startTimeRef = useRef(0);
  const pauseOffsetRef = useRef(0);

  // Status
  const [audioStatus, setAudioStatus] = useState<{
    text: string;
    type: 'idle' | 'loading' | 'success' | 'error' | 'mic';
  }>({ text: 'No File', type: 'idle' });

  // DSP & Display
  const [fftSize, setFftSize] = useState<number>(2048);
  const [palette, setPalette] = useState<PaletteName>('inferno');
  const [gain, setGain] = useState<number>(1.5);

  // Spectrogram matrix
  const [spectrogramData, setSpectrogramData] = useState<Float32Array[]>([]);
  const [spectrogramTimes, setSpectrogramTimes] = useState<number[]>([]);

  // Zoomable viewport
  const [view, setView] = useState<SpectrogramView>({
    t0: 0,
    t1: 1,
    f0: 0,
    f1: 3000,
  });

  // Signal Cleanup
  const [cleanup, setCleanup] = useState<CleanupSettings>({
    bandpass: true,
    lowHz: 100,
    highHz: 2500,
    noiseSub: true,
    noiseSeconds: 2,
    noiseStrength: 1.5,
    gate: 0.35,
    histEq: false,
    liveAuto: false,
  });

  const [noiseProfile, setNoiseProfile] = useState<Float32Array | null>(null);
  const [ridgePoints, setRidgePoints] = useState<RidgePoint[]>([]);
  const [autoFit, setAutoFit] = useState<FittedParams | null>(null);
  const [autoDetectStatus, setAutoDetectStatus] = useState<string>('');

  // Landmark Points & Physics Fit
  const [plottedPoints, setPlottedPoints] = useState<DopplerPoint[]>([]);
  const [fittedParams, setFittedParams] = useState<FittedParams | null>(null);

  // Helper: Get Audio Context
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtxClass();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  // Clamp view utility
  const clampView = useCallback(
    (v: SpectrogramView, dur: number, sr: number): SpectrogramView => {
      const d = Math.max(0.5, dur);
      const span = Math.min(d, Math.max(0.5, v.t1 - v.t0));
      const t0 = Math.max(0, Math.min(d - span, v.t0));
      const t1 = t0 + span;

      const top = Math.min(sr / 2, 12000);
      const fspan = Math.min(top, Math.max(100, v.f1 - v.f0));
      const f0 = Math.max(0, Math.min(top - fspan, v.f0));
      const f1 = f0 + fspan;

      return { t0, t1, f0, f1 };
    },
    []
  );

  // Recalculate Offline Spectrogram
  const runOfflineSpectrogram = useCallback(
    (buffer: AudioBuffer, currentFft: number) => {
      const pcmData = buffer.getChannelData(0);
      const res = computeOfflineSTFT(pcmData, buffer.sampleRate, buffer.duration, currentFft);

      setSpectrogramData(res.spectrogramData);
      setSpectrogramTimes(res.spectrogramTimes);
      setDuration(res.duration);
      setSampleRate(res.sampleRate);

      // Reset view to fit file
      const initialView: SpectrogramView = {
        t0: 0,
        t1: res.duration,
        f0: 0,
        f1: Math.min(3000, res.sampleRate / 2),
      };
      setView(initialView);

      // Pre-compute noise profile if noise subtraction is enabled
      const prof = computeNoiseProfile(
        res.spectrogramData,
        res.spectrogramTimes,
        res.duration,
        false,
        cleanup.noiseSeconds
      );
      setNoiseProfile(prof);
    },
    [cleanup.noiseSeconds]
  );

  // Stop Audio playback
  const stopAudio = useCallback(() => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch {
        // ignore
      }
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (playbackAnimFrameRef.current) {
      cancelAnimationFrame(playbackAnimFrameRef.current);
      playbackAnimFrameRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Stop Mic
  const stopMic = useCallback(() => {
    if (liveAnimFrameRef.current) {
      cancelAnimationFrame(liveAnimFrameRef.current);
      liveAnimFrameRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    setIsMicActive(false);
  }, []);

  // File Upload
  const handleFileUpload = async (file: File) => {
    stopAudio();
    stopMic();

    setAudioStatus({ text: 'Decoding...', type: 'loading' });
    const ctx = getAudioContext();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      audioBufferRef.current = decoded;

      setAudioStatus({
        text: file.name.length > 15 ? `${file.name.substring(0, 15)}...` : file.name,
        type: 'success',
      });
      setCurrentTime(0);
      pauseOffsetRef.current = 0;
      setPlottedPoints([]);
      setFittedParams(null);
      setAutoFit(null);
      setRidgePoints([]);
      setAutoDetectStatus('');

      runOfflineSpectrogram(decoded, fftSize);
    } catch {
      alert("Failed to decode audio file. Make sure it's a valid audio format.");
      setAudioStatus({ text: 'Error', type: 'error' });
    }
  };

  // Generate Demo Flyby Audio
  const handleGenerateDemo = () => {
    stopAudio();
    stopMic();

    const ctx = getAudioContext();
    setAudioStatus({ text: 'Synthesizing...', type: 'loading' });

    setTimeout(() => {
      const buffer = generateSyntheticFlybyAudio(ctx);
      audioBufferRef.current = buffer;

      setAudioStatus({ text: 'Demo Flyby (Synth)', type: 'success' });
      setCurrentTime(0);
      pauseOffsetRef.current = 0;
      setPlottedPoints([]);
      setFittedParams(null);
      setAutoFit(null);
      setRidgePoints([]);
      setAutoDetectStatus('');

      runOfflineSpectrogram(buffer, fftSize);
    }, 100);
  };

  // Toggle Play / Pause
  const handleTogglePlayPause = () => {
    if (!audioBufferRef.current) return;
    const ctx = getAudioContext();

    if (isPlaying) {
      // Pause
      pauseOffsetRef.current = ctx.currentTime - startTimeRef.current;
      stopAudio();
    } else {
      // Play
      const buffer = audioBufferRef.current;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      let offset = pauseOffsetRef.current;
      if (offset >= buffer.duration) {
        offset = 0;
        pauseOffsetRef.current = 0;
      }

      startTimeRef.current = ctx.currentTime - offset;
      source.start(0, offset);
      sourceNodeRef.current = source;
      setIsPlaying(true);

      const loop = () => {
        const cur = ctx.currentTime - startTimeRef.current;
        if (cur >= buffer.duration) {
          stopAudio();
          pauseOffsetRef.current = 0;
          setCurrentTime(0);
          return;
        }

        setCurrentTime(cur);
        pauseOffsetRef.current = cur;

        // Auto pan viewport if playhead moves outside current visible span
        setView((prev) => {
          if (cur > prev.t1 || cur < prev.t0) {
            const span = prev.t1 - prev.t0;
            const t0 = Math.max(0, cur - span * 0.1);
            return { ...prev, t0, t1: t0 + span };
          }
          return prev;
        });

        playbackAnimFrameRef.current = requestAnimationFrame(loop);
      };

      playbackAnimFrameRef.current = requestAnimationFrame(loop);
    }
  };

  // Seek
  const handleSeek = (newTime: number) => {
    pauseOffsetRef.current = newTime;
    setCurrentTime(newTime);

    if (isPlaying) {
      stopAudio();
      handleTogglePlayPause();
    }
  };

  // Live Microphone Stream
  const handleToggleMic = async () => {
    if (isMicActive) {
      stopMic();
      setAudioStatus({ text: 'Mic stopped', type: 'idle' });
      return;
    }

    stopAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      micStreamRef.current = stream;
      setIsMicActive(true);

      const ctx = getAudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = fftSize;
      source.connect(analyser);
      analyserRef.current = analyser;

      setSpectrogramData([]);
      setSpectrogramTimes([]);
      setDuration(20); // 20s sliding window
      setSampleRate(ctx.sampleRate);
      setCurrentTime(0);

      setView({
        t0: 0,
        t1: 20,
        f0: 0,
        f1: Math.min(3000, ctx.sampleRate / 2),
      });

      setAudioStatus({ text: 'Microphone Active', type: 'mic' });

      let lastLiveDetect = 0;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);

      const micLoop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatFrequencyData(dataArray);

        // Convert dB to magnitude
        const magArray = new Float32Array(bufferLength);
        for (let i = 0; i < bufferLength; i++) {
          magArray[i] = Math.pow(10, dataArray[i] / 20);
        }

        setSpectrogramData((prev) => {
          const next = [...prev, magArray];
          if (next.length > 300) next.shift();
          return next;
        });

        // Periodic live auto-detect if enabled
        const now = performance.now();
        if (cleanup.liveAuto && now - lastLiveDetect > 1000) {
          lastLiveDetect = now;
          runAutoDetect(true);
        }

        liveAnimFrameRef.current = requestAnimationFrame(micLoop);
      };

      liveAnimFrameRef.current = requestAnimationFrame(micLoop);
    } catch {
      alert('Microphone access was denied or is unavailable.');
    }
  };

  // FFT Size Change
  const handleChangeFftSize = (newFft: number) => {
    setFftSize(newFft);
    if (audioBufferRef.current) {
      runOfflineSpectrogram(audioBufferRef.current, newFft);
    } else if (analyserRef.current) {
      analyserRef.current.fftSize = newFft;
    }
  };

  // Zoom Helpers
  const handleZoomTime = (factor: number) => {
    setView((prev) => {
      const center = (prev.t0 + prev.t1) / 2;
      const span = prev.t1 - prev.t0;
      const nextSpan = Math.max(0.5, Math.min(duration || 1, span * factor));
      const t0 = Math.max(0, center - nextSpan / 2);
      const t1 = Math.min(duration || 1, t0 + nextSpan);
      return { ...prev, t0, t1 };
    });
  };

  const handleZoomFreq = (factor: number) => {
    setView((prev) => {
      const center = (prev.f0 + prev.f1) / 2;
      const span = prev.f1 - prev.f0;
      const top = sampleRate / 2;
      const nextSpan = Math.max(100, Math.min(top, span * factor));
      const f0 = Math.max(0, center - nextSpan / 2);
      const f1 = Math.min(top, f0 + nextSpan);
      return { ...prev, f0, f1 };
    });
  };

  const handleResetView = () => {
    setView({
      t0: 0,
      t1: duration || 1,
      f0: 0,
      f1: Math.min(3000, sampleRate / 2),
    });
  };

  // Point Addition & Doppler Physics Solving
  const handleAddPoint = (pt: DopplerPoint) => {
    setPlottedPoints((prev) => {
      const next = [...prev, pt].sort((a, b) => a.t - b.t);
      if (next.length >= 3) {
        const fit = fitDopplerPoints(next);
        if (fit) {
          setFittedParams(fit);
        }
      }
      return next;
    });
  };

  const handleClearPoints = () => {
    setPlottedPoints([]);
    setFittedParams(null);
    setRidgePoints([]);
    setAutoFit(null);
    setAutoDetectStatus('');
  };

  // Auto Detect Doppler Curve
  const runAutoDetect = useCallback(
    (silent = false) => {
      if (!spectrogramData.length) {
        if (!silent) setAutoDetectStatus('Load audio or start the mic first.');
        return;
      }

      const ridge = detectRidge(
        spectrogramData,
        spectrogramTimes,
        duration,
        sampleRate,
        isMicActive,
        view,
        cleanup,
        noiseProfile
      );
      setRidgePoints(ridge);

      const fit = fitRidge(ridge);
      if (fit && (fit.score || 0) >= 0.75) {
        setAutoFit(fit);
        setFittedParams(fit);
        setAutoDetectStatus(
          `<span class="text-rose-400 font-semibold">Doppler curve found</span> · fit ${Math.round(
            (fit.score || 0) * 100
          )}%`
        );
      } else {
        setAutoFit(null);
        if (!silent) {
          setAutoDetectStatus(
            fit
              ? `No clear curve (best fit ${Math.round((fit.score || 0) * 100)}%). Try adjusting filters.`
              : 'No ridge found. Try lowering the noise gate.'
          );
        }
      }
    },
    [spectrogramData, spectrogramTimes, duration, sampleRate, isMicActive, view, cleanup, noiseProfile]
  );

  // Noise cleanup settings update
  const handleChangeCleanup = (partial: Partial<CleanupSettings>) => {
    setCleanup((prev) => {
      const next = { ...prev, ...partial };
      if (partial.noiseSeconds !== undefined || partial.noiseSub !== undefined) {
        const prof = computeNoiseProfile(
          spectrogramData,
          spectrogramTimes,
          duration,
          isMicActive,
          next.noiseSeconds
        );
        setNoiseProfile(prof);
      }
      return next;
    });
  };

  // Export CSV
  const handleExportCsv = () => {
    if (plottedPoints.length === 0) {
      alert('No plotted points available to export. Click on the spectrogram to drop Doppler points first.');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,point_index,timestamp_seconds,frequency_hz\n';
    plottedPoints.forEach((pt, idx) => {
      csvContent += `${idx + 1},${pt.t.toFixed(4)},${pt.f.toFixed(2)}\n`;
    });

    if (fittedParams) {
      const { f0, v, dmin, t0 } = fittedParams;
      csvContent += `\n# FITTED DOPPLER PARAMETERS\n`;
      csvContent += `# Base Frequency (Hz),${f0.toFixed(2)}\n`;
      csvContent += `# Velocity (m/s),${v.toFixed(2)}\n`;
      csvContent += `# Velocity (km/h),${(v * 3.6).toFixed(2)}\n`;
      csvContent += `# Closest Distance dmin (m),${dmin.toFixed(2)}\n`;
      csvContent += `# Time of CPA (s),${t0.toFixed(4)}\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'doppler_curve_points.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Clean up audio nodes on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      stopMic();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopAudio, stopMic]);

  if (currentView === 'home') {
    return (
      <HomeDirectory
        onSelectTool={(toolId) => {
          if (toolId === 'aerodoppler') {
            setCurrentView('aerodoppler');
          }
        }}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col font-sans overflow-hidden bg-darkbg text-slate-200">
      <Header
        onBackToDirectory={() => setCurrentView('home')}
        onFileUpload={handleFileUpload}
        onGenerateDemo={handleGenerateDemo}
        onToggleMic={handleToggleMic}
        isMicActive={isMicActive}
        onExportCsv={handleExportCsv}
        hasAudio={Boolean(audioBufferRef.current || isMicActive)}
        hasPoints={plottedPoints.length > 0}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          isPlaying={isPlaying}
          onTogglePlayPause={handleTogglePlayPause}
          currentTime={currentTime}
          totalTime={duration}
          onSeek={handleSeek}
          audioStatus={audioStatus}
          hasAudio={Boolean(audioBufferRef.current)}
          fftSize={fftSize}
          onChangeFftSize={handleChangeFftSize}
          palette={palette}
          onChangePalette={setPalette}
          gain={gain}
          onChangeGain={setGain}
          view={view}
          onZoomTime={handleZoomTime}
          onZoomFreq={handleZoomFreq}
          onResetView={handleResetView}
          cleanup={cleanup}
          onChangeCleanup={handleChangeCleanup}
          onAutoDetect={() => runAutoDetect(false)}
          autoDetectStatus={autoDetectStatus}
          plottedPointsCount={plottedPoints.length}
          fittedParams={fittedParams}
          onClearPoints={handleClearPoints}
        />

        <SpectrogramViewer
          spectrogramData={spectrogramData}
          spectrogramTimes={spectrogramTimes}
          sampleRate={sampleRate}
          duration={duration}
          isMicActive={isMicActive}
          isPlaying={isPlaying}
          currentTime={currentTime}
          view={view}
          onUpdateView={(updater) => setView((prev) => clampView(updater(prev), duration, sampleRate))}
          palette={palette}
          gain={gain}
          cleanup={cleanup}
          noiseProfile={noiseProfile}
          plottedPoints={plottedPoints}
          onAddPoint={handleAddPoint}
          fittedParams={fittedParams}
          autoFit={autoFit}
          ridgePoints={ridgePoints}
        />
      </div>
    </div>
  );
};

export default App;
