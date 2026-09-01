"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const MIC_BODY_PATH =
  "M512 128a128 128 0 00-128 128v256a128 128 0 10256 0V256a128 128 0 00-128-128z";
const MIC_OUTLINE_PATH =
  "M512 128a128 128 0 00-128 128v256a128 128 0 10256 0V256a128 128 0 00-128-128zm0-64a192 192 0 01192 192v256a192 192 0 11-384 0V256A192 192 0 01512 64zm-32 832v-64a288 288 0 01-288-288v-32a32 32 0 0164 0v32a224 224 0 00224 224h64a224 224 0 00224-224v-32a32 32 0 1164 0v32a288 288 0 01-288 288v64h64a32 32 0 110 64H416a32 32 0 110-64h64z";

const MIC_BODY_TOP = 128;
const MIC_BODY_HEIGHT = 384;
const MIC_BODY_WIDTH = 256;
const MIC_BODY_LEFT = 512 - MIC_BODY_WIDTH / 2;

const VOLUME_MIN = 0.03;
const VOLUME_MAX = 0.08;
const RISE_SMOOTHING = 0.55;
const FALL_SMOOTHING = 0.01;

type AnimatedMicrophoneProps = {
  size?: number;
  className?: string;
  isActive?: boolean;
};

type AnalyserBuffer = Parameters<AnalyserNode["getFloatTimeDomainData"]>[0];

export default function AnimatedMicrophone({
  size = 120,
  className,
  isActive = true,
}: AnimatedMicrophoneProps) {
  const clipPathId = useId();
  const [fillAmount, setFillAmount] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const dataArrayRef = useRef<AnalyserBuffer | null>(null);

  useEffect(() => {
    // Don't run animation when not active
    if (!isActive) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = undefined;
      }
      setFillAmount(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let mediaStream: MediaStream | null = null;

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return;
      }

      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const Context =
          window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new Context();
        const source = audioContext.createMediaStreamSource(mediaStream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        analyserRef.current = analyser;
        dataArrayRef.current = new Float32Array(
          analyser.fftSize
        ) as AnalyserBuffer;

        const tick = () => {
          const analyser = analyserRef.current;
          const dataArray = dataArrayRef.current;
          if (!analyser || !dataArray) {
            return;
          }
          analyser.getFloatTimeDomainData(dataArray as any);
          let sumSquares = 0;
          for (let i = 0; i < dataArray.length; i += 1) {
            const sample = dataArray[i];
            sumSquares += sample * sample;
          }
          const rms = Math.sqrt(sumSquares / dataArray.length);
          const normalized = Math.min(
            1,
            Math.max(0, (rms - VOLUME_MIN) / (VOLUME_MAX - VOLUME_MIN))
          );
          setFillAmount((prev) => {
            const delta = normalized - prev;
            const next =
              delta >= 0
                ? prev + delta * RISE_SMOOTHING
                : prev + delta * FALL_SMOOTHING;
            return Math.max(0, Math.min(1, next));
          });

          rafRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (error) {
        console.error("Unable to access microphone", error);
      }
    };

    void start();

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      if (audioContext) {
        audioContext.close().catch(() => undefined);
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [isActive]);

  const activeFill = isActive
    ? Math.max(0, Math.min(1, fillAmount * 0.9 + 0.1))
    : 0;
  const fillHeight = MIC_BODY_HEIGHT * activeFill;
  const fillY = MIC_BODY_TOP + MIC_BODY_HEIGHT - fillHeight;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={cn("h-full w-full", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={clipPathId}>
          <path d={MIC_BODY_PATH} className={!isActive ? "opacity-50" : ""} />
        </clipPath>
      </defs>
      <rect
        x={MIC_BODY_LEFT}
        y={MIC_BODY_TOP}
        width={MIC_BODY_WIDTH}
        height={MIC_BODY_HEIGHT}
        className={cn(
          "fill-neutral-200 dark:fill-neutral-700",
          !isActive ? "opacity-50" : ""
        )}
        clipPath={`url(#${clipPathId})`}
      />
      <rect
        x={MIC_BODY_LEFT}
        y={fillY}
        width={MIC_BODY_WIDTH}
        height={fillHeight}
        className="fill-blue-500"
        clipPath={`url(#${clipPathId})`}
      />
      <path
        className={cn(
          "fill-neutral-900 dark:fill-neutral-100",
          !isActive ? "opacity-50" : ""
        )}
        d={MIC_OUTLINE_PATH}
      />
      {/* Diagonal strike-through when paused */}
      {!isActive && (
        <>
          {/* Border/outline for the strike */}
          <line
            x1="200"
            y1="200"
            x2="824"
            y2="824"
            className="stroke-white dark:stroke-neutral-900"
            strokeWidth="160"
            strokeLinecap="round"
          />
          {/* Strike line */}
          <line
            x1="200"
            y1="200"
            x2="824"
            y2="824"
            className="stroke-black dark:stroke-white"
            strokeWidth="48"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
