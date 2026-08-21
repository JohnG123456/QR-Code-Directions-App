// Fits a 2D similarity transform (uniform scale + rotation + translation,
// no shear) mapping "plan" points (pixel coordinates on the master plan
// image) to "world" points (local metres, from lib/geo/local-projection).
//
// This is the correct model for a to-scale architectural drawing: every
// lot on the plan is metrically accurate relative to every other lot, so
// a single scale/rotation/offset converts the whole drawing at once. It's
// solved as ordinary least squares, which works for exactly 2 reference
// points (minimum needed) or more (extra points average out any small
// clicking/measurement error - report the residual so staff can judge fit
// quality).

export interface Point2D {
  x: number;
  y: number;
}

export interface PointPair {
  plan: Point2D;
  world: Point2D;
}

export interface SimilarityTransform {
  a: number; // scale * cos(rotation)
  b: number; // scale * sin(rotation)
  tx: number;
  ty: number;
  scale: number;
  rotationRadians: number;
  apply: (p: Point2D) => Point2D;
}

export interface FitResult {
  transform: SimilarityTransform;
  residualsMeters: number[]; // one per input pair, in the same units as `world`
  rmsErrorMeters: number;
  maxErrorMeters: number;
}

function solve4x4(A: number[][], b: number[]): number[] {
  // Gaussian elimination with partial pivoting on a 4x4 system.
  const n = 4;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivotRow][col])) pivotRow = row;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];

    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error(
        "Reference points are degenerate (collinear or duplicated) - pick points that aren't in a straight line."
      );
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / pivot;
      for (let c = col; c <= n; c++) {
        M[row][c] -= factor * M[col][c];
      }
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

export function fitSimilarityTransform(pairs: PointPair[]): FitResult {
  if (pairs.length < 2) {
    throw new Error("Need at least 2 reference point pairs to calibrate.");
  }

  // Normal equations for unknowns [a, b, tx, ty] from rows:
  //   mx = a*px - b*py + tx
  //   my = b*px + a*py + ty
  const AtA = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const Atb = [0, 0, 0, 0];

  for (const { plan, world } of pairs) {
    const rowMx = [plan.x, -plan.y, 1, 0];
    const rowMy = [plan.y, plan.x, 0, 1];

    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        AtA[i][j] += rowMx[i] * rowMx[j] + rowMy[i] * rowMy[j];
      }
      Atb[i] += rowMx[i] * world.x + rowMy[i] * world.y;
    }
  }

  const [a, b, tx, ty] = solve4x4(AtA, Atb);

  const apply = (p: Point2D): Point2D => ({
    x: a * p.x - b * p.y + tx,
    y: b * p.x + a * p.y + ty,
  });

  const transform: SimilarityTransform = {
    a,
    b,
    tx,
    ty,
    scale: Math.sqrt(a * a + b * b),
    rotationRadians: Math.atan2(b, a),
    apply,
  };

  const residualsMeters = pairs.map(({ plan, world }) => {
    const predicted = apply(plan);
    return Math.hypot(predicted.x - world.x, predicted.y - world.y);
  });

  const rmsErrorMeters = Math.sqrt(
    residualsMeters.reduce((sum, r) => sum + r * r, 0) / residualsMeters.length
  );
  const maxErrorMeters = Math.max(...residualsMeters);

  return { transform, residualsMeters, rmsErrorMeters, maxErrorMeters };
}
