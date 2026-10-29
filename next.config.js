/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Turbopack is the default in Next.js 16+
  turbopack: {
    // Set root to this directory to avoid lockfile detection issues
    root: __dirname,
  },
};

module.exports = nextConfig;

