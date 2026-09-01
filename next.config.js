/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Turbopack is the default in Next.js 16+
  turbopack: {
    // Set root to this directory to avoid lockfile detection issues
    root: __dirname,
  },
  async rewrites() {
    // Proxy PostHog analytics through /ingest so the browser request stays
    // same-origin. This means connect-src 'self' covers PostHog without
    // needing to whitelist external PostHog domains in the CSP.
    const posthogHost =
      process.env.NEXT_PUBLIC_POSTHOG_HOST || "/ingest";

    // If NEXT_PUBLIC_POSTHOG_HOST is a relative path (recommended: /ingest),
    // use the default PostHog cloud ingest host as the rewrite destination.
    const destinationHost = posthogHost.startsWith("/")
      ? "https://eu.i.posthog.com"
      : posthogHost;

    return [
      {
        source: "/ingest/static/:path*",
        destination: `${destinationHost}/static/:path*`,
      },
      {
        source: "/ingest/:path*",
        destination: `${destinationHost}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

// Injected content via Sentry wizard below

const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://github.com/getsentry/sentry-webpack-plugin#options

  org: "incubator-for-ai",
  project: "justice-transcribe",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  tunnelRoute: "/monitoring",

  // Hides source maps from generated client bundles
  hideSourceMaps: true,

});
