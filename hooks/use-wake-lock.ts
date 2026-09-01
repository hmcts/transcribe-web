import { useCallback, useEffect, useState } from "react";

export function useWakeLock() {
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        const lock = await navigator.wakeLock.request("screen");
        setWakeLock(lock);

        // Handle visibility change
        const handleVisibilityChange = async () => {
          if (document.visibilityState === "visible" && !lock.released) {
            try {
              const newLock = await navigator.wakeLock.request("screen");
              setWakeLock(newLock);
            } catch (_err) {
              // Ignore error
            }
          }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        // Clean up listener when lock is released
        lock.addEventListener("release", () => {
          document.removeEventListener(
            "visibilitychange",
            handleVisibilityChange
          );
        });
      }
    } catch (_err) {
      // Ignore error
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (wakeLock && !wakeLock.released) {
      try {
        await wakeLock.release();
        setWakeLock(null);
      } catch (_err) {
        // Ignore error
      }
    }
  }, [wakeLock]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  return { requestWakeLock, releaseWakeLock };
}
