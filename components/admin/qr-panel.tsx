"use client";

import { QRCodeSVG } from "qrcode.react";

export function QrPanel({
  resortId,
  url,
  slug,
}: {
  resortId: string;
  url: string;
  slug: string;
}) {
  // A QR code is printed once and lives on a wall for years, so a base
  // URL left at its development default is worth catching before the
  // sign-writer gets it, not after.
  const pointsAtLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(url);

  // The address must end up as exactly /r/<slug>. A site URL with a path
  // on it - or a stray character - produces a link that looks plausible
  // and lands nowhere, which a phone's address bar hides because it shows
  // only the domain.
  let wrongPath: string | null = null;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== `/r/${slug}`) wrongPath = parsed.pathname;
  } catch {
    wrongPath = url;
  }

  return (
    <div className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">QR code</h2>

      {wrongPath && !pointsAtLocalhost && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>This link won&apos;t work.</strong> It resolves to{" "}
          <code className="break-all">{wrongPath}</code>, but this resort lives
          at <code>/r/{slug}</code>. Check{" "}
          <code>NEXT_PUBLIC_SITE_URL</code> in Vercel — it should be just the
          site address, with no path after it — then redeploy.
        </p>
      )}

      {pointsAtLocalhost && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Don&apos;t print this yet.</strong> It points at{" "}
          <code>localhost</code>, which only works on a developer&apos;s own
          machine. Set <code>NEXT_PUBLIC_SITE_URL</code> to the real site
          address in Vercel and redeploy, then take the code again.
        </p>
      )}
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
      <p className="text-xs text-neutral-700">
        Open the link above on a phone before sending anything to print — it
        should show the resort&apos;s search page, not an error.
      </p>
      <p className="text-xs text-neutral-500">
        Use SVG for large prints (e.g. entrance signage above ~20cm); PNG is
        fine for smaller printed cards. Print at least ~5cm wide for
        reliable scanning at arm&apos;s length.
      </p>
    </div>
  );
}
