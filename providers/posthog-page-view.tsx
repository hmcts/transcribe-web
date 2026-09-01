"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/analytics";

export default function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    track("$pageview", { $current_url: window.location.origin + pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "") + window.location.hash });
  }, [pathname, searchParams]);

  return null;
}
