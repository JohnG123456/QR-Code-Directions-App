// Works out what's still owed on a resort's site capture.
//
// The count and the numbering are two different things, and conflating
// them is what made this wrong. Piara Waters has 244 homes numbered 1 to
// 252: eight numbers in that range were never built, because lots got
// merged or dropped as the estate was laid out. That is completely
// normal, and under the old logic it read as a disaster - eight homes
// "still to capture" that don't exist, and eight numbers "above the
// total" that are perfectly real houses.
//
// So the total answers one question only: how many homes are there. The
// numbering answers a different one: which numbers are in use. Gaps in
// the sequence are a hint about what to look for while sites are still
// missing, never a verdict - and once the count is right, they're just
// the skipped numbers and worth saying so plainly.
//
// Pure and dependency-free so it can be unit tested.

export interface SiteNumberAnalysis {
  /** Sites captured, whatever they're numbered. */
  capturedCount: number;
  /** Still to find, from the count - the only reliable "am I finished". */
  outstanding: number;
  /** More sites than the resort has homes: something is wrong. */
  surplus: number;
  /** Numbers with no site, within the range the numbering covers. Only
   *  worth showing while sites are outstanding: otherwise these are the
   *  numbers that were never used. */
  gaps: string[];
  /** True when the gap list was cut short for readability. */
  gapsTruncated: boolean;
  /** Captured numbers above the resort's total. Ordinary when numbering
   *  runs past the home count; only suspicious alongside a surplus. */
  aboveTotal: string[];
  /** Highest number in use, which is the top of the numbering range. */
  highest: number;
  /** Captured numbers that aren't plain integers, e.g. "42A" - left out
   *  of the sequence checks, and reported so that's not a silent choice. */
  ignored: string[];
}

const PLAIN_INTEGER = /^\d+$/;

// Long enough to be useful, short enough to stay readable on a phone.
const MAX_GAPS_LISTED = 120;

export function analyseSiteNumbers(
  captured: string[],
  totalHomes: number | null
): SiteNumberAnalysis {
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

  const capturedCount = captured.filter((value) => value.trim().length > 0).length;
  const total = totalHomes && totalHomes > 0 ? totalHomes : null;
  const outstanding = total ? Math.max(0, total - capturedCount) : 0;
  const surplus = total ? Math.max(0, capturedCount - total) : 0;

  if (numeric.length === 0) {
    return {
      capturedCount,
      outstanding,
      surplus,
      gaps: [],
      gapsTruncated: false,
      aboveTotal: [],
      highest: 0,
      ignored,
    };
  }

  // Match the padding staff are actually using ("042" not "42"), taking
  // the most common width so one stray unpadded entry doesn't change it.
  const widthCounts = new Map<number, number>();
  for (const w of widths) widthCounts.set(w, (widthCounts.get(w) ?? 0) + 1);
  const padWidth = [...widthCounts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0]
  )[0][0];

  const highest = Math.max(...numeric);
  // The numbering can legitimately run past the home count, so the range
  // to look for gaps in is whichever reaches further.
  const upTo = Math.max(highest, total ?? 0);

  const present = new Set(numeric);
  const allGaps: string[] = [];
  for (let n = 1; n <= upTo; n++) {
    if (!present.has(n)) allGaps.push(String(n).padStart(padWidth, "0"));
  }

  const aboveTotal = total
    ? numeric
        .filter((n) => n > total)
        .sort((a, b) => a - b)
        .map((n) => String(n).padStart(padWidth, "0"))
    : [];

  return {
    capturedCount,
    outstanding,
    surplus,
    gaps: allGaps.slice(0, MAX_GAPS_LISTED),
    gapsTruncated: allGaps.length > MAX_GAPS_LISTED,
    aboveTotal,
    highest,
    ignored,
  };
}

// Collapses a run of consecutive numbers into "004-009" so a long gap
// list stays readable.
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
