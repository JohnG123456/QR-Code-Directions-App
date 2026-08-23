// Shrinks the master plan sheet down to something a phone will actually
// load.
//
// The digitizer's copy is rendered big on purpose - staff zoom right in
// to read printed site numbers off it - and comes out as a PNG of
// several megabytes. That is the wrong file to hand a guest standing at
// a gate on mobile data, where it is the difference between directions
// appearing and a spinner.
//
// Two things do the work: fewer pixels, and WebP instead of PNG. The
// visitor never zooms past the whole resort on one screen, so resolution
// beyond a couple of thousand pixels across is invisible to them; WebP
// then holds line art far better than JPEG at the same size (JPEG rings
// around every hard black line on a white sheet, which is most of a
// plan drawing).

import { createCanvas, loadImage } from "@napi-rs/canvas";

/** Long edge, in pixels, of the copy visitors get. Roughly three times a
 *  phone's screen width, so it stays sharp when they pinch in on their
 *  corner of the resort, without carrying detail nobody can see. */
export const VISITOR_PLAN_MAX_EDGE = 2200;

export interface DownscaledPlan {
  dataUrl: string;
  contentType: string;
  width: number;
  height: number;
  /** Decoded byte size, for reporting back to staff. */
  bytes: number;
}

export async function downscalePlanForVisitors(
  sourceDataUrl: string,
  maxEdge: number = VISITOR_PLAN_MAX_EDGE
): Promise<DownscaledPlan> {
  const image = await loadImage(sourceDataUrl);

  const longEdge = Math.max(image.width, image.height);
  // Never scale up: a small source stays exactly as it is.
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // The plan is drawn on white in the source render. Painting white
  // first keeps it that way through a format that has no alpha to fall
  // back on, rather than letting transparent margins come out black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const buffer = canvas.toBuffer("image/webp", 88);

  return {
    dataUrl: `data:image/webp;base64,${buffer.toString("base64")}`,
    contentType: "image/webp",
    width,
    height,
    bytes: buffer.byteLength,
  };
}
