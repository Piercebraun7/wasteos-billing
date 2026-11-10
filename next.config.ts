import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is private and per-user, so nothing is prerendered or cached.
  serverExternalPackages: ["@react-pdf/renderer"],
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
