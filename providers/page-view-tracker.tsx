"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { track } from "@/lib/analytics";

/** Page views for product analytics (OBS-3). The route is normalised (IDs
 * replaced, no query string) and sent only with analytics consent. */
export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) track("$pageview", { $current_url: pathname });
  }, [pathname]);

  return null;
}
