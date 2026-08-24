// What a site number is, in one place.
//
// Across these resorts a site number is up to three digits, sometimes
// with a single letter after it where one block has been split into a
// duplex - 087 and 087A. Written down it always carries its leading
// zeros: 1 is 001, 13 is 013. That is how it appears on the plan, on
// the signage and on the paperwork, so it is how it should appear here.
//
// Two things follow from having one definition rather than several.
//
// A number typed as "13" and a number read off a plan as "013" are the
// same site, so both are stored the same way and a guest searching for
// either finds it.
//
// And a plan sheet is covered in numbers that are not site numbers -
// dimensions, areas, lot references, scale bars, revision numbers. A
// rule this specific throws most of them out before anyone has to look
// at them, which is the difference between a scan that saves time and
// one that makes work.

/** Up to three digits, optionally one letter. */
export const SITE_NUMBER_PATTERN = /^(\d{1,3})([A-Za-z])?$/;

/**
 * The canonical form of a site number, or null if it isn't one.
 *
 * Three digits, zero-padded, with any letter upper-cased. Whitespace
 * around it is ignored, as are the odd characters a PDF sometimes puts
 * in a text run.
 */
export function normaliseSiteNumber(raw: string): string | null {
  // Non-breaking spaces and zero-width joiners turn up in CAD exports
  // and would otherwise stop an ordinary-looking number matching.
  const cleaned = raw.replace(/[\s ​-‍]/g, "");
  const match = SITE_NUMBER_PATTERN.exec(cleaned);
  if (!match) return null;

  const digits = match[1];
  const letter = match[2];
  // "000" isn't a site anywhere, and it's what a stray "0" becomes.
  if (Number(digits) === 0) return null;

  return digits.padStart(3, "0") + (letter ? letter.toUpperCase() : "");
}

export function isSiteNumber(raw: string): boolean {
  return normaliseSiteNumber(raw) !== null;
}

/**
 * Sorts the way people read them: by the number, then by the letter, so
 * 009 comes before 010 and 087 before 087A. Plain string ordering gets
 * this right only because everything is padded - this is here so it
 * stays right even when something isn't.
 */
export function compareSiteNumbers(a: string, b: string): number {
  const pa = SITE_NUMBER_PATTERN.exec(a.trim());
  const pb = SITE_NUMBER_PATTERN.exec(b.trim());
  if (!pa || !pb) return a.localeCompare(b);
  const byDigits = Number(pa[1]) - Number(pb[1]);
  if (byDigits !== 0) return byDigits;
  return (pa[2] ?? "").localeCompare(pb[2] ?? "");
}

/**
 * The same rule, tightened for what a scan may accept on its own.
 *
 * A plan sheet writes distances as "450m" and levels as "060m", and
 * those pass the ordinary rule as site 450 in a duplex M. A person
 * typing a number can be trusted with any letter; a scanner reading
 * thousands of text runs off a drawing cannot, so it only accepts the
 * letters a split block actually uses.
 *
 * Anything outside that is still addable by hand afterwards, which is
 * the right way round: a stray number costs a moment to delete, and a
 * missing one is a home a guest can't find.
 */
const SCANNABLE_SUFFIXES = /^[A-F]$/;

export function normaliseScannedSiteNumber(raw: string): string | null {
  const normalised = normaliseSiteNumber(raw);
  if (!normalised) return null;
  const letter = normalised.slice(3);
  if (letter && !SCANNABLE_SUFFIXES.test(letter)) return null;
  return normalised;
}
