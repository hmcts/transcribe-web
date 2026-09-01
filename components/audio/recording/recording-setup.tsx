"use client";

import { Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AudioWaveform } from "@/components/audio/recording/audio-waveform";
import type { AudioDevice } from "@/components/audio/recording/microphone-permission";
import SilenceNotificationsBanner from "@/components/audio/recording/silence-notifications-banner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RecordingSetupProps {
  audioDevices: AudioDevice[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onStartRecording: () => void;
  disabled: boolean;
}

export default function RecordingSetup({
  audioDevices,
  selectedDeviceId,
  onDeviceChange,
  onStartRecording,
  disabled,
}: RecordingSetupProps) {
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Create preview stream for waveform visualization
  useEffect(() => {
    let isMounted = true;

    const startPreview = async () => {
      if (!selectedDeviceId) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedDeviceId,
            noiseSuppression: true, // Enable to match actual recording settings
            echoCancellation: true,
            autoGainControl: true,
          },
        });

        // Only update state if component is still mounted and this is the latest request
        if (isMounted) {
          streamRef.current = stream;
          setPreviewStream(stream);
        } else {
          // If component unmounted during async operation, clean up the stream
          stream.getTracks().forEach((track) => track.stop());
        }
      } catch (err) {
        console.error("Failed to start audio preview:", err);
      }
    };

    startPreview();

    // Cleanup: stop preview stream when component unmounts or device changes
    return () => {
      isMounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setPreviewStream(null);
    };
  }, [selectedDeviceId]);

  return (
    <div className="flex flex-col space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">In-Person Meeting Recorder</h1>
      </div>
      <SilenceNotificationsBanner />
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col space-y-2">
          <label htmlFor="microphone-select" className="text-sm font-medium">
            Choose microphone
          </label>
          <Select
            onValueChange={onDeviceChange}
            value={selectedDeviceId}
            disabled={disabled}
          >
            <SelectTrigger id="microphone-select" className="w-full">
              <SelectValue placeholder="Select microphone" />
            </SelectTrigger>
            <SelectContent>
              {audioDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedDeviceId && (
          <div className="flex min-h-[100px] items-center justify-center">
            <AudioWaveform stream={previewStream} />
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            size="lg"
            disabled={disabled}
          >
            Close
          </Button>
          <Button
            onClick={onStartRecording}
            size="lg"
            disabled={disabled || !selectedDeviceId}
          >
            <Mic className="mr-2 size-4" />
            Start recording
          </Button>
        </div>
      </div>
    </div>
  );
}
