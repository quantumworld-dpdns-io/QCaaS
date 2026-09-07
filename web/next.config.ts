import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for infra/Dockerfile.web (.next/standalone + .next/static + public).
  // Vercel does its own output tracing and the standalone mode breaks its build
  // (ENOENT .next/next-server.js.nft.json), so only use it outside Vercel.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
