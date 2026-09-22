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

  // pdfjs-dist loads its worker via a runtime dynamic import, which the
  // deployment's static file tracing can't follow - so pdf.mjs shipped but
  // pdf.worker.mjs didn't, and the deployed function crashed with
  // "Setting up fake worker failed: Cannot find module ...pdf.worker.mjs".
  // Naming it here forces it into the function bundle. Verified by
  // inspecting the emitted route.js.nft.json (the same manifest the
  // deployment uses to decide which files to ship).
  outputFileTracingIncludes: {
    // NB: the `[resortId]` segment must be written as a `*` wildcard here -
    // these keys are globs, so literal square brackets would be parsed as a
    // character class and silently fail to match the route.
    "/api/resorts/*/masterplan/extract": [
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    ],
  },

  // @napi-rs/canvas publishes one prebuilt binary per platform as optional
  // dependencies, and npm installs every one the build machine satisfies -
  // here both the glibc and the musl Linux builds, ~33 MB and ~29 MB. At
  // runtime the package picks exactly one, by reading process.report's
  // glibcVersionRuntime, and on Vercel (Amazon Linux, glibc) that is always
  // the gnu build. The musl copy has only ever been ballast.
  //
  // It is not ballast in one function but two: the extract route reaches
  // canvas through extract-labels-server, and the resort detail page
  // reaches it through publishPlanOverlay -> downscale-plan, so every
  // deployment has been storing the unusable binary twice.
  //
  // Measured on this commit by summing each route's .nft.json (the same
  // manifest the deployment ships from): 75.6 MB of unique traced files
  // becomes 46.7 MB. The extract route goes 71.8 -> 42.8 MB and the resort
  // detail page 64.1 -> 35.2 MB, with pdf.worker.mjs, pdf.mjs and the gnu
  // binary all still present.
  //
  // NB: these keys are globs, so "*" here means every route.
  outputFileTracingExcludes: {
    "*": ["node_modules/@napi-rs/canvas-linux-x64-musl/**"],
  },
};

export default nextConfig;
