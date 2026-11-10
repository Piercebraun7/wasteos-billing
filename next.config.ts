import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is private and per-user, so nothing is prerendered or cached.
  serverExternalPackages: ["@react-pdf/renderer"],
  // Signed contracts are uploaded as PDFs, which are larger than the 1 MB default.
  experimental: { serverActions: { bodySizeLimit: "15mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
