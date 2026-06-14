import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The importer reads the canonical CSV from disk in the seed script only;
  // the web app receives the CSV as an upload, so no special server config needed.
  reactStrictMode: true,
};

export default nextConfig;
