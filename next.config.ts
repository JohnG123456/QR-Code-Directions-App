import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native binary; bundling it (the default)
  // breaks its own runtime platform-detection logic. Leaving it external
  // means it's require()'d directly from node_modules at request time
  // instead, which is the documented fix for native addons under
  // Next.js's server bundling.
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
