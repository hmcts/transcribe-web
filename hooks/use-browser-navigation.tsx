"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/**
 * A custom hook that enables the use of browser back/forward buttons
 * with Next.js app router for transcription navigation.
 */
export function useBrowserNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Handle popstate events (browser back/forward buttons)
    const handlePopState = () => {
      // The URL has already been updated by the browser
      // We don't need to push a new URL, just ensure the app state matches it
      router.refresh();
    };

    // Add popstate event listener
    window.addEventListener("popstate", handlePopState);

    // Clean up the event listener
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router]);

  return {
    navigateTo: (newSearchParams: URLSearchParams) => {
      router.push(`${pathname}?${newSearchParams.toString()}`);
    },
    currentParams: searchParams,
  };
}

export default useBrowserNavigation;
