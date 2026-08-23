"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { BoundaryEditor } from "@/components/admin/boundary/boundary-editor";

// react-leaflet touches window/document at import time, so the editor
// can't be part of the server render.
const BoundaryEditorNoSsr = dynamic(
  () => import("@/components/admin/boundary/boundary-editor").then((m) => m.BoundaryEditor),
  {
    ssr: false,
    loading: () => <div className="h-[70vh] w-full animate-pulse rounded-md bg-neutral-100" />,
  }
);

export function BoundaryEditorClient(props: ComponentProps<typeof BoundaryEditor>) {
  return <BoundaryEditorNoSsr {...props} />;
}
