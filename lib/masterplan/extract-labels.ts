// Browser-only: parses an uploaded master plan PDF into a page image plus
// candidate site-number labels with their pixel position on that image.
// Extraction is deliberately over-inclusive (matches any short numeric
// token) since the admin tool's next step is a manual review where staff
// remove false positives (dates, scale bars, project numbers) and fix any
// the parser missed - this is meant to save re-typing ~200 numbers, not to
// be perfectly accurate on its own.

import * as pdfjsLib from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

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
}

const SITE_NUMBER_PATTERN = /^\d{1,4}[A-Za-z]?$/;
const RENDER_SCALE = 2; // higher scale = sharper text/easier to click precisely

export async function extractMasterplan(file: File): Promise<ExtractedPlan> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a canvas context to render the PDF.");

  await page.render({ canvas, canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const rawItems = textContent.items
    .filter((item): item is TextItem => "str" in item)
    .map((item) => {
      const [px, py] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      return { str: item.str, x: px, y: py, width: item.width * RENDER_SCALE };
    })
    .filter((item) => item.str.trim().length > 0);

  const labels = groupIntoLabels(rawItems).filter((label) =>
    SITE_NUMBER_PATTERN.test(label.text)
  );

  return {
    imageDataUrl: canvas.toDataURL("image/png"),
    imageWidth: viewport.width,
    imageHeight: viewport.height,
    labels: labels.map((label, i) => ({ id: `label-${i}`, ...label })),
  };
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
