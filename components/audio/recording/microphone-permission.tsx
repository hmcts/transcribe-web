// frontend/components/audio/microphone-permission.tsx
import { useCallback, useEffect } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface MicrophonePermissionProps {
  onPermissionGranted: (devices: AudioDevice[]) => void;
  onError: (error: string) => void;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export function MicrophonePermission({
  onPermissionGranted,
  onError,
}: MicrophonePermissionProps) {
  const getAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 5)}`,
        }));

      if (audioInputDevices.length > 0) {
        onPermissionGranted(audioInputDevices);
      }
    } catch (_err) {
      onError("Error getting audio devices");
    }
  }, [onPermissionGranted, onError]);

  const requestMicrophonePermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await getAudioDevices();
    } catch (err) {
      console.error("error getting user media", err);
      onError(
        "Microphone permission denied. Please enable it in your browser settings."
      );
    }
  }, [getAudioDevices, onError]);

  useEffect(() => {
    requestMicrophonePermission();
  }, [requestMicrophonePermission]);

  return (
    <div>
      <Alert variant="destructive">
        <AlertDescription>
          Microphone permission is required to use this feature.
        </AlertDescription>
      </Alert>
      <Button onClick={requestMicrophonePermission} className="mt-2">
        Request Microphone Permission
      </Button>
    </div>
  );
}
