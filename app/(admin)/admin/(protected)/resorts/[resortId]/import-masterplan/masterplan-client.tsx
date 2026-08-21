"use client";

import dynamic from "next/dynamic";
import type { MasterplanImportTool as MasterplanImportToolType } from "@/components/admin/masterplan/masterplan-import-tool";

// react-leaflet touches `window` at import time, so this must be excluded
// from server rendering - dynamic(ssr:false) is only allowed from within a
// Client Component boundary, hence this thin wrapper.
const MasterplanImportTool = dynamic(
  () =>
    import("@/components/admin/masterplan/masterplan-import-tool").then(
      (m) => m.MasterplanImportTool
    ),
  { ssr: false, loading: () => <div className="h-96 w-full animate-pulse bg-neutral-100" /> }
);

export function MasterplanClient(
  props: React.ComponentProps<typeof MasterplanImportToolType>
) {
  return <MasterplanImportTool {...props} />;
}
