import QRCode from "qrcode";

// Where a printed code should send people.
//
// NEXT_PUBLIC_SITE_URL is inlined at build time - the compiled bundle
// holds the string, not a lookup - so changing it in Vercel does nothing
// until the next deploy. That is a quiet trap: the setting looks right in
// the dashboard while the site keeps handing out the old address, and the
// evidence only turns up as a blank screen on somebody's phone.
//
// So it isn't the only source. Vercel names the project's production
// domain in VERCEL_PROJECT_PRODUCTION_URL, and that one is read at
// runtime. It is the right default for a code going on a sign: it points
// at production even when the code is generated from a preview
// deployment, and it stays correct with no variable set at all.
export function siteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production.replace(/\/$/, "")}`;

  return "http://localhost:3000";
}

// The domain this project serves in production, when we can know it.
// Used to tell staff when a QR code is about to be printed pointing
// somewhere other than the real site.
export function productionHost(): string | null {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null;
}

export function resortUrl(slug: string): string {
  return `${siteBaseUrl()}/r/${slug}`;
}

// Error-correction level H: outdoor signage gets dirty/weathered/scratched,
// so we trade a denser code for the ability to still scan when ~30% of
// modules are obscured.
const QR_OPTIONS = { errorCorrectionLevel: "H" as const, margin: 2 };

export async function generateQrPngBuffer(url: string, size = 1000): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width: size });
}

export async function generateQrSvgString(url: string): Promise<string> {
  return QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
}
