"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { NetworkEditor } from "@/components/admin/network/network-editor";

// react-leaflet touches window/document at import time, so the editor
// can't be part of the server render.
const NetworkEditorNoSsr = dynamic(
  () => import("@/components/admin/network/network-editor").then((m) => m.NetworkEditor),
  {
    ssr: false,
    loading: () => <div className="h-[70vh] w-full animate-pulse rounded-md bg-neutral-100" />,
  }
);

export function NetworkEditorClient(props: ComponentProps<typeof NetworkEditor>) {
  return <NetworkEditorNoSsr {...props} />;
}
