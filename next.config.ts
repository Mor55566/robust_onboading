import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The ported super-admin import actions accept multi-file CSV/Excel + image
  // uploads; keep this in sync with with_robust_app's server action limit.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
