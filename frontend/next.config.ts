import type { NextConfig } from "next";

const config: NextConfig = {
  // The shared package is TypeScript source in the workspace; Next compiles it with the app.
  transpilePackages: ["@veritas/shared"],
  poweredByHeader: false,
};

export default config;
