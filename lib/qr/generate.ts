import QRCode from "qrcode";

export function resortUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/r/${slug}`;
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
