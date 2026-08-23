// Where a click lands, in screen pixels.
//
// Snapping is judged on screen rather than in metres so it feels the
// same whether you're zoomed out over the whole resort or in on one
// corner of it: the target is always "about a fingertip", not "about
// four metres", which at low zoom is a target too small to hit and at
// high zoom is one that grabs things you didn't mean.
//
// Pure and free of Leaflet so it can be tested without a browser.

export interface Pt {
  x: number;
  y: number;
}

/** The point on segment a-b nearest p, and how far along it that is. */
export function closestPointOnSegment(
  p: Pt,
  a: Pt,
  b: Pt
): { point: Pt; t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;

  // A zero-length segment has no direction to project onto; both ends
  // are the same point, so that point is the answer.
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));

  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, t, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

export interface PolylineHit {
  point: Pt;
  distance: number;
  /** Which segment of the line it fell on: the one from pts[index] to
   *  pts[index + 1]. Needed to split the line at the right place. */
  index: number;
  t: number;
}

/** The point anywhere along a multi-segment line nearest p. */
export function closestPointOnPolyline(p: Pt, pts: Pt[]): PolylineHit | null {
  if (pts.length < 2) return null;

  let best: PolylineHit | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const hit = closestPointOnSegment(p, pts[i], pts[i + 1]);
    if (!best || hit.distance < best.distance) {
      best = { point: hit.point, distance: hit.distance, index: i, t: hit.t };
    }
  }
  return best;
}

/** Divides a drawn road in two at a point on it, for showing the split
 *  immediately. The database recomputes the real geometry; this only has
 *  to look right until it answers. */
export function splitShapeAt(
  shape: [number, number][],
  index: number,
  point: [number, number]
): [[number, number][], [number, number][]] {
  const first = [...shape.slice(0, index + 1), point];
  const second = [point, ...shape.slice(index + 1)];
  return [first, second];
}
