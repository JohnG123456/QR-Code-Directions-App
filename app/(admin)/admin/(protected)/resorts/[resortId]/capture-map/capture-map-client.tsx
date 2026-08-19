"use client";

import dynamic from "next/dynamic";
import type { SatelliteCaptureTool as SatelliteCaptureToolType } from "@/components/admin/site-capture/satellite-capture-tool";

// react-leaflet touches `window` at import time, so this must be excluded
// from server rendering - dynamic(ssr:false) is only allowed from within a
// Client Component boundary, hence this thin wrapper.
const SatelliteCaptureTool = dynamic(
  () =>
    import("@/components/admin/site-capture/satellite-capture-tool").then(
      (m) => m.SatelliteCaptureTool
    ),
  { ssr: false, loading: () => <div className="h-96 w-full animate-pulse bg-neutral-100" /> }
);

export function CaptureMapClient(
  props: React.ComponentProps<typeof SatelliteCaptureToolType>
) {
  return <SatelliteCaptureTool {...props} />;
}
