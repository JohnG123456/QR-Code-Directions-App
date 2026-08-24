// Throws out the numbers on a plan sheet that aren't site numbers.
//
// The format rule does most of the work, but a sheet still carries
// plenty of one-to-three-digit numbers that pass it: dimensions, lot
// references, stage numbers, revision numbers, the north point, the
// scale bar. What separates them from site numbers is that every site
// number on a drawing is set in the same size of type, because they are
// one layer of the drawing produced by one tool. Anything appreciably
// bigger or smaller is a different kind of annotation.
//
// So: take the height that most candidates share and keep those near
// it. The median rather than the mean, because a handful of enormous
// title-block numbers would drag a mean up and take half the real
// labels out with it.
//
// Pure, so it can be tested without a PDF.

export interface HeightedLabel {
  text: string;
  x: number;
  y: number;
  height: number;
}

export interface HeightFilterResult<T extends HeightedLabel> {
  kept: T[];
  /** How many were set in a different size, for telling staff what the
   *  scan decided rather than silently dropping them. */
  droppedForSize: number;
  /** The size site numbers appear to be set in, in pixels. */
  typicalHeight: number | null;
}

/**
 * Keeps labels whose type is about the same size as most of the others.
 *
 * The band is deliberately generous. Being left with a stray dimension
 * to delete is a small annoyance; losing a real site and not noticing
 * is a home a guest can't find, so the filter errs towards keeping.
 */
export function keepTypicalHeights<T extends HeightedLabel>(
  labels: T[],
  { minRatio = 0.65, maxRatio = 1.55, minSample = 8 } = {}
): HeightFilterResult<T> {
  const heights = labels.map((l) => l.height).filter((h) => Number.isFinite(h) && h > 0);

  // Too few to say what "typical" means - a plan with a dozen homes
  // would have its own numbers voted out by chance.
  if (heights.length < minSample) {
    return { kept: labels, droppedForSize: 0, typicalHeight: null };
  }

  const sorted = [...heights].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const typical =
    sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

  if (typical <= 0) return { kept: labels, droppedForSize: 0, typicalHeight: null };

  const kept = labels.filter(
    (l) =>
      !Number.isFinite(l.height) ||
      l.height <= 0 ||
      (l.height >= typical * minRatio && l.height <= typical * maxRatio)
  );

  return { kept, droppedForSize: labels.length - kept.length, typicalHeight: typical };
}
