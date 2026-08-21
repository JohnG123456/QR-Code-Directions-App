// Works out which site numbers haven't been captured yet.
//
// Capturing a few hundred homes happens over multiple sittings, and once
// there are 150 pins on the map there's no way to eyeball which numbers
// are still owed. Resort numbering runs in a continuous sequence, so the
// gaps in that sequence are exactly the outstanding work.
//
// Pure and dependency-free so it can be unit tested.

export interface MissingSiteNumbers {
  missing: string[];
  /** Highest number considered, so the UI can explain what it searched. */
  upTo: number;
  /** Captured numbers that aren't plain integers, e.g. "42A" - reported so
   *  staff know they were left out of the gap analysis rather than missed. */
  ignored: string[];
}

const PLAIN_INTEGER = /^\d+$/;

export function findMissingSiteNumbers(
  captured: string[],
  totalHomes: number | null
): MissingSiteNumbers {
  const numeric: number[] = [];
  const ignored: string[] = [];
  const widths: number[] = [];

  for (const raw of captured) {
    const value = raw.trim();
    if (PLAIN_INTEGER.test(value)) {
      numeric.push(parseInt(value, 10));
      widths.push(value.length);
    } else if (value.length > 0) {
      ignored.push(value);
    }
  }

  if (numeric.length === 0) {
    return { missing: [], upTo: 0, ignored };
  }

  // Match the padding staff are actually using ("042" not "42"), taking the
  // most common width so one stray unpadded entry doesn't change the format.
  const widthCounts = new Map<number, number>();
  for (const w of widths) widthCounts.set(w, (widthCounts.get(w) ?? 0) + 1);
  const padWidth = [...widthCounts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0]
  )[0][0];

  // Prefer the resort's stated total; otherwise only report gaps *within*
  // the range already captured, since we can't know where the numbering
  // ends and would otherwise invent a pile of non-existent sites.
  const highestCaptured = Math.max(...numeric);
  const upTo = totalHomes && totalHomes > 0 ? Math.max(totalHomes, highestCaptured) : highestCaptured;
  const lowest = totalHomes && totalHomes > 0 ? 1 : Math.min(...numeric);

  const present = new Set(numeric);
  const missing: string[] = [];
  for (let n = lowest; n <= upTo; n++) {
    if (!present.has(n)) missing.push(String(n).padStart(padWidth, "0"));
  }

  return { missing, upTo, ignored };
}

// Collapses a run of consecutive numbers into "004-009" so a long gap list
// stays readable.
export function summariseRanges(numbers: string[]): string[] {
  if (numbers.length === 0) return [];

  const ranges: string[] = [];
  let runStart = numbers[0];
  let runEnd = numbers[0];

  const asInt = (s: string) => parseInt(s, 10);

  for (let i = 1; i <= numbers.length; i++) {
    const current = numbers[i];
    if (current !== undefined && asInt(current) === asInt(runEnd) + 1) {
      runEnd = current;
      continue;
    }
    ranges.push(runStart === runEnd ? runStart : `${runStart}-${runEnd}`);
    if (current !== undefined) {
      runStart = current;
      runEnd = current;
    }
  }

  return ranges;
}
