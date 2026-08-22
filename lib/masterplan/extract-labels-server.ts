// Server-only: parses an uploaded master plan PDF into a page image plus
// candidate site-number labels with their pixel position on that image.
//
// This runs entirely in the Node runtime (a Route Handler), not the
// browser - PDF rendering across mobile browsers turned out to have real
// compatibility gaps (Promise.withResolvers support, getTextContent
// internals, even basic canvas output) that varied by device in ways
// that weren't practical to chase one at a time. Doing it server-side
// means it behaves identically regardless of what device staff use.
//
// Extraction is deliberately over-inclusive (matches any short numeric
// token) since the admin tool's next step is a manual review where staff
// remove false positives (dates, scale bars, project numbers) and fix any
// the parser missed - this is meant to save re-typing ~200 numbers, not to
// be perfectly accurate on its own.

import { createCanvas } from "@napi-rs/canvas";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

// pdfjs-dist's Node build auto-detects it's running server-side and uses
// @napi-rs/canvas internally (require("@napi-rs/canvas")) for its own
// intermediate rendering needs - as long as the package is installed, no
// CanvasFactory needs to be configured explicitly. We only need to create
// the top-level canvas ourselves, below, to read the final image back out.

export interface ExtractedLabel {
  id: string;
  text: string;
  x: number; // pixel position on the rendered page image
  y: number;
}

export interface ExtractedPlan {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  labels: ExtractedLabel[];
  extractionError?: string;
}

const SITE_NUMBER_PATTERN = /^\d{1,4}[A-Za-z]?$/;
// Large-format architectural sheets (A0/A1) can be huge at native scale;
// cap the longest side so the resulting PNG stays a reasonable size to
// send back over the network and display.
const MAX_OUTPUT_DIMENSION = 2200;

async function stage<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    throw new Error(`[${name}] ${detail}`);
  }
}

export async function extractMasterplan(fileBuffer: Buffer): Promise<ExtractedPlan> {
  const pdf = await stage("loading PDF", () =>
    pdfjsLib.getDocument({ data: new Uint8Array(fileBuffer) }).promise
  );
  const page = await stage("opening page 1", () => pdf.getPage(1));

  const unscaledViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(
    2,
    MAX_OUTPUT_DIMENSION / Math.max(unscaledViewport.width, unscaledViewport.height)
  );
  const viewport = page.getViewport({ scale });

  // A viewport is the page size times a scale factor, so its dimensions
  // are fractional. Round once, here, and use the same numbers for the
  // canvas and for what's reported: everything downstream - the overlay
  // corners, the stored draft, the integer columns in the database -
  // wants whole pixels, and it should be the bitmap's real size.
  const imageWidth = Math.round(viewport.width);
  const imageHeight = Math.round(viewport.height);

  const canvas = await stage("creating canvas", () =>
    createCanvas(imageWidth, imageHeight)
  );
  const context = canvas.getContext("2d");

  await stage("rendering page", () =>
    // @napi-rs/canvas's canvas/context are a structural (not nominal)
    // match for what pdf.js's render() actually calls at runtime -
    // verified against a real PDF - but don't implement every rarely-used
    // DOM method (e.g. drawFocusIfNeeded), so TS needs a nudge here.
    page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise
  );

  const imageDataUrl = await stage(
    "encoding image",
    () => `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`
  );
  const base = { imageDataUrl, imageWidth, imageHeight };

  try {
    const textContent = await page.getTextContent();

    const rawItems = textContent.items
      .filter((item): item is TextItem => "str" in item)
      .map((item) => {
        const [px, py] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return { str: item.str, x: px, y: py, width: item.width * scale };
      })
      .filter((item) => item.str.trim().length > 0);

    const labels = groupIntoLabels(rawItems).filter((label) =>
      SITE_NUMBER_PATTERN.test(label.text)
    );

    return { ...base, labels: labels.map((label, i) => ({ id: `label-${i}`, ...label })) };
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { ...base, labels: [], extractionError: detail };
  }
}

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
}

// CAD-exported PDFs usually place each label as one text-showing run, but
// some exports split digits into separate glyph runs - merge runs on the
// same baseline that are close enough horizontally to plausibly be one
// label before filtering.
function groupIntoLabels(items: RawTextItem[]): { text: string; x: number; y: number }[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: RawTextItem[][] = [];

  for (const item of sorted) {
    const lastGroup = groups[groups.length - 1];
    const lastItem = lastGroup?.[lastGroup.length - 1];
    const sameLine = lastItem && Math.abs(lastItem.y - item.y) < 3;
    const closeEnough =
      lastItem && item.x - (lastItem.x + lastItem.width) < Math.max(6, lastItem.width);

    if (sameLine && closeEnough) {
      lastGroup.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => ({
    text: group.map((i) => i.str).join("").trim(),
    x: group[0].x + (group[group.length - 1].x - group[0].x) / 2,
    y: group[0].y,
  }));
}
