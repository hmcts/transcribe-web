"use client";

import { useEffect, useRef, useState } from "react";

interface AudioWaveformProps {
  stream: MediaStream | null;
  className?: string;
}

export function AudioWaveform({ stream, className = "" }: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 200 });

  // Handle responsive sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.offsetWidth;
        const height = 100;
        setDimensions({ width, height });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  useEffect(() => {
    if (!stream || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Create audio context and analyser (matching recording-control.tsx)
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 512; // Increased for better frequency resolution
    analyser.smoothingTimeConstant = 0.7; // Smooth out the bars
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    // Calculate frequency bins for human vocal range (80Hz - 4000Hz)
    const { sampleRate } = audioContext;
    const frequencyPerBin = sampleRate / analyser.fftSize;
    const minVocalFreq = 80; // Lower end of human voice
    const maxVocalFreq = 4000; // Upper end of human voice
    const minBin = Math.floor(minVocalFreq / frequencyPerBin);
    const maxBin = Math.floor(maxVocalFreq / frequencyPerBin);
    const vocalBinCount = maxBin - minBin;

    // Drawing function with frequency bars (matching recording-control.tsx style)
    const draw = () => {
      if (!analyser || !ctx) return;

      animationFrameRef.current = requestAnimationFrame(draw);

      analyser.getByteFrequencyData(dataArray);

      // Clear canvas completely
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Calculate average frequency only from vocal range to detect if there's actual audio
      // Focus on core speech frequencies (250Hz-3000Hz) which are most prominent in nearby conversation
      const coreSpeechMinFreq = 250;
      const coreSpeechMaxFreq = 3000;
      const coreSpeechMinBin = Math.floor(coreSpeechMinFreq / frequencyPerBin);
      const coreSpeechMaxBin = Math.floor(coreSpeechMaxFreq / frequencyPerBin);

      let vocalSum = 0;
      let coreSpeechSum = 0;
      let peakCount = 0;

      for (let i = minBin; i < maxBin; i++) {
        vocalSum += dataArray[i];

        // Track core speech frequencies separately
        if (i >= coreSpeechMinBin && i <= coreSpeechMaxBin) {
          coreSpeechSum += dataArray[i];
          // Count peaks (strong signals) in speech range
          if (dataArray[i] > 40) {
            peakCount++;
          }
        }
      }

      const average = vocalSum / vocalBinCount;
      const coreSpeechAverage =
        coreSpeechSum / (coreSpeechMaxBin - coreSpeechMinBin);

      // Require strong core speech frequencies AND some peak activity
      // This filters out distant/muffled voices and sustained background noise
      const hasAudioData =
        coreSpeechAverage > 25 && peakCount >= 3 && average > 20;

      if (!hasAudioData) {
        // Draw a pulsing placeholder when no audio detected
        const time = Date.now() / 1000;
        const pulseSize = Math.sin(time * 2) * 0.1 + 0.9;

        ctx.fillStyle = "#3b82f6";
        ctx.beginPath();
        ctx.arc(
          canvas.width / 2,
          canvas.height / 2,
          (Math.min(canvas.width, canvas.height) / 10) * pulseSize,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        // Draw frequency bars when audio is detected - only from vocal range
        const barCount = Math.min(vocalBinCount, 48); // Show up to 48 bars
        const barWidth = (canvas.width / barCount) * 0.8;
        const barSpacing = 2;
        const totalBarWidth = barCount * (barWidth + barSpacing);
        const startX = (canvas.width - totalBarWidth) / 2;

        for (let i = 0; i < barCount; i++) {
          // Map bar index to frequency bin within vocal range
          const binIndex = minBin + Math.floor((i / barCount) * vocalBinCount);
          const value = dataArray[binIndex];

          // Skip bars with very low values (background noise threshold)
          // Higher threshold for nearby conversation - filters out distant/faint sounds
          if (value < 35) continue;

          const multiplier = 1.5; // Increased multiplier since we're focusing on vocal range
          const barHeight = Math.min(
            (value / 255) * canvas.height * multiplier * 0.8,
            canvas.height * 0.8
          );

          const x = startX + i * (barWidth + barSpacing);
          const y = (canvas.height - barHeight) / 2;

          // Create gradient for bars (matching recording page colors)
          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          const hue = 210 + (i / barCount) * 30;
          gradient.addColorStop(0, `hsla(${hue}, 100%, 70%, 0.9)`);
          gradient.addColorStop(1, `hsla(${hue}, 100%, 50%, 0.7)`);

          ctx.fillStyle = gradient;

          // Draw rounded rectangle
          const radius = Math.min(barWidth / 2, 4);
          ctx.beginPath();
          ctx.moveTo(x + radius, y);
          ctx.lineTo(x + barWidth - radius, y);
          ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
          ctx.lineTo(x + barWidth, y + barHeight - radius);
          ctx.quadraticCurveTo(
            x + barWidth,
            y + barHeight,
            x + barWidth - radius,
            y + barHeight
          );
          ctx.lineTo(x + radius, y + barHeight);
          ctx.quadraticCurveTo(x, y + barHeight, x, y + barHeight - radius);
          ctx.lineTo(x, y + radius);
          ctx.quadraticCurveTo(x, y, x + radius, y);
          ctx.fill();
        }

        // Add center pulse for strong signals
        if (average > 20) {
          const centerX = canvas.width / 2;
          const centerY = canvas.height / 2;
          const maxRadius = Math.min(canvas.width, canvas.height) / 6;
          const radius = (average / 255) * maxRadius;

          const circleGradient = ctx.createRadialGradient(
            centerX,
            centerY,
            0,
            centerX,
            centerY,
            radius
          );
          circleGradient.addColorStop(0, "rgba(255, 255, 255, 0.4)");
          circleGradient.addColorStop(0.7, "rgba(59, 130, 246, 0.2)");
          circleGradient.addColorStop(1, "rgba(0, 0, 0, 0)");

          ctx.fillStyle = circleGradient;
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    draw();

    // Cleanup function
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current?.state !== "closed") {
        audioContextRef.current?.close();
      }
    };
  }, [stream]);

  return (
    <div
      ref={containerRef}
      className={`flex w-full flex-col items-center justify-center ${className}`}
    >
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        className="rounded-md border-2 border-blue-200 bg-transparent dark:border-blue-800"
        style={{ maxWidth: "100%" }}
      />
      <p className="mt-2 text-sm text-slate-400">
        {stream
          ? "🎤 Microphone active - Speak to see audio levels"
          : "⏳ Waiting for microphone..."}
      </p>
    </div>
  );
}
