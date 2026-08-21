import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas ships a native binary; bundling it (the default)
  // breaks its own runtime platform-detection logic. pdfjs-dist internally
  // loads its worker script (pdf.worker.mjs) as a sibling file at
  // runtime, which Next.js's server bundling doesn't trace/include -
  // leaving both external means they're require()'d/imported directly
  // from node_modules at request time instead, which is the documented
  // fix for this class of native-addon / runtime-file-loading package.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
