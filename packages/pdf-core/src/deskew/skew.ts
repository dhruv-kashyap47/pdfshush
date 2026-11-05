/**
 * Skew estimation for scanned pages.
 *
 * A printed page has horizontal text lines. When the scan is crooked those lines
 * are rotated by a small angle, so their dark pixels spread across many image
 * rows. Rotating the pixel grid by the *right* angle collapses every line back
 * onto a single row, which makes the horizontal projection profile sharpest.
 *
 * This module scores that sharpness (the variance of a binned row profile) over
 * a bounded angle range and returns the winner. It is deliberately
 * dependency-free and canvas-free: the browser worker reduces a rendered page
 * to an ink matrix and calls this, and the same function is unit-tested in Node
 * with synthetic rulers.
 *
 * Sign convention: a positive result means the content is rotated clockwise in
 * image space, and the caller should rotate the page by `-angle` to straighten
 * it (canvas rotation is clockwise because its y axis points down).
 */

export interface SkewEstimateOptions {
  /** Smallest angle to test, degrees. Defaults to -10. */
  minDeg?: number;
  /** Largest angle to test, degrees. Defaults to +10. */
  maxDeg?: number;
  /** Search step, degrees. Defaults to 0.5. */
  step?: number;
  /** Ink threshold on the supplied array (higher = darker). Defaults to 32. */
  threshold?: number;
}

/** The product-level bounds shared by the engine, the job and the UI. */
export const SKEW_LIMITS = {
  /** Automatic detection is deliberately conservative. */
  minDeg: -10,
  maxDeg: 10,
  step: 0.5,
  /** A grayscale value at or below this is paper, not ink. */
  threshold: 32,
  /** The longest side of the matrix the estimator runs over. */
  maxDimension: 700,
  /** Manual override ceiling. */
  maxOverrideDeg: 45,
} as const;

/**
 * Estimates the skew of one page from an ink matrix.
 *
 * `gray` holds one byte per pixel where `255` is fully dark and `0` is paper
 * (the inverse of luminance). Returns `0` for a blank or malformed matrix.
 * Cost is `(angles × ink pixels)`; callers must downscale first.
 */
export function estimateSkewAngle(
  gray: Uint8Array,
  width: number,
  height: number,
  options: SkewEstimateOptions = {},
): number {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (!gray || w <= 0 || h <= 0 || gray.length < w * h) return 0;

  const minDeg = finiteOr(options.minDeg, SKEW_LIMITS.minDeg);
  const maxDeg = finiteOr(options.maxDeg, SKEW_LIMITS.maxDeg);
  const step = Math.abs(finiteOr(options.step, SKEW_LIMITS.step));
  const threshold = finiteOr(options.threshold, SKEW_LIMITS.threshold);
  if (!(maxDeg > minDeg) || !(step > 0)) return 0;

  // Collect the ink once. Most page pixels are paper, so a sparse pass keeps the
  // angle loop proportional to the actual text rather than the page area.
  const xs: number[] = [];
  const ys: number[] = [];
  const weights: number[] = [];
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const value = gray[row + x]!;
      if (value > threshold) {
        xs.push(x);
        ys.push(y);
        weights.push(value);
      }
    }
  }
  if (xs.length === 0) return 0;

  // Fixed bin geometry, valid for |sin θ| ≤ ~0.18 (±10°): x·sinθ stays within
  // ±w, so the profile never wraps.
  const offset = w + 2;
  const bins = h + 2 * w + 4;
  const profile = new Float64Array(bins);
  const radians = Math.PI / 180;
  const steps = Math.max(1, Math.round((maxDeg - minDeg) / step));

  let bestAngle = 0;
  let bestScore = -1;

  for (let index = 0; index <= steps; index += 1) {
    const deg = minDeg + index * step;
    const theta = deg * radians;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    profile.fill(0);

    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < xs.length; i += 1) {
      // bin = y·cosθ − x·sinθ. The minus makes a +θ content skew read as +θ.
      const bin = ((ys[i]! * cos - xs[i]! * sin) | 0) + offset;
      profile[bin]! += weights[i]!;
    }
    for (let b = 0; b < bins; b += 1) {
      const value = profile[b]!;
      sum += value;
      sumSq += value * value;
    }
    const mean = sum / bins;
    const variance = sumSq / bins - mean * mean;

    // Prefer higher variance; on a near-tie keep the angle closest to zero,
    // because a straight page should not be rotated by a rounding artefact.
    if (
      variance > bestScore * (1 + 1e-6) ||
      (variance > bestScore * (1 - 1e-6) && Math.abs(deg) < Math.abs(bestAngle))
    ) {
      bestScore = variance;
      bestAngle = deg;
    }
  }

  return Math.round(bestAngle * 100) / 100;
}

/** True when a manual override is a finite angle inside the product ceiling. */
export function isValidOverrideAngle(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= SKEW_LIMITS.maxOverrideDeg
  );
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
