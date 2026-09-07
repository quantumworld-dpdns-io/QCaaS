import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for infra/Dockerfile.web (.next/standalone + .next/static + public).
  output: "standalone",
};

export default nextConfig;
