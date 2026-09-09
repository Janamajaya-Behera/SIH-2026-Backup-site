/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Runs src/instrumentation.ts register() once on server boot, which
    // starts the geofence sweeper (countdown fail-safe + stale-state guard).
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
