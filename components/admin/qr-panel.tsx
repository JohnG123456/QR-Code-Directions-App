"use client";

import { QRCodeSVG } from "qrcode.react";

export function QrPanel({
  resortId,
  url,
}: {
  resortId: string;
  url: string;
}) {
  return (
    <div className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">QR code</h2>
      <div className="flex items-center gap-4">
        <div className="rounded-md border border-neutral-200 p-2">
          <QRCodeSVG value={url} size={128} level="H" />
        </div>
        <div className="flex flex-col gap-1 text-sm">
          <a href={url} target="_blank" rel="noreferrer" className="break-all text-neutral-600 underline">
            {url}
          </a>
          <div className="mt-2 flex gap-3">
            <a
              href={`/api/resorts/${resortId}/qr?format=png`}
              className="text-sm font-medium text-neutral-900 underline"
            >
              Download PNG
            </a>
            <a
              href={`/api/resorts/${resortId}/qr?format=svg`}
              className="text-sm font-medium text-neutral-900 underline"
            >
              Download SVG
            </a>
          </div>
        </div>
      </div>
      <p className="text-xs text-neutral-500">
        Use SVG for large prints (e.g. entrance signage above ~20cm); PNG is
        fine for smaller printed cards. Print at least ~5cm wide for
        reliable scanning at arm&apos;s length.
      </p>
    </div>
  );
}
