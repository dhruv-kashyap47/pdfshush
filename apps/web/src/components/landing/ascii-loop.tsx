import { useEffect, useRef } from 'react';
import { useIsDark } from '@/hooks/use-is-dark';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * The section's second visual: a live ASCII torus drawn one monospace glyph
 * per cell. It is the same subject in both themes — a field of fragments
 * resolving into one solid, rooted form — but the medium follows the page.
 * On paper the glyphs are pigment; on black they are light, added together so
 * overlapping characters burn brighter, like a phosphor screen.
 *
 * Craft notes:
 * - Geometry is a parametric torus projected with a painter's z-buffer. Both
 *   radii breathe, so the silhouette keeps changing shape instead of merely
 *   rotating.
 * - Every cell samples one glyph from a density ramp and one ink from the
 *   spectrum; the light direction decides which faces are dense.
 * - The drawing is frame-rate independent (all motion is dt-scaled) and stops
 *   completely when offscreen or when the tab is hidden. Reduced motion keeps
 *   a single composed frame.
 * - The canvas is transparent in both themes. The ambient glow, scanlines and
 *   vignette live in CSS, so the field dissolves into the page with no panel
 *   edge and no theme-specific layout.
 */

/** Sparse → dense. The leading space keeps the field readable as air. */
const RAMP = ' ·-~+:;=!*#$@';

/** Torus sampling. ~21k points per frame is dense enough to close the tube
 *  at 75 columns without spending the frame on overdraw. */
const PHI_STEP = 0.058;
const THETA_STEP = 0.027;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Dissolves the glyph field into the page instead of ending it on an
 *  invisible frame line. Shared by the canvas and the phosphor texture so the
 *  screen has no rectangle of its own. */
const EDGE_MASK =
  'radial-gradient(118% 118% at 50% 50%, #000 58%, rgb(0 0 0 / 0.55) 84%, transparent 100%)';

type Glyph = { char: string; color: string } | null;

export function AsciiLoop() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dark = useIsDark();

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduced = prefersReducedMotion();

    let width = 1;
    let height = 1;
    let cols = 1;
    let rows = 1;
    let cellWidth = 1;
    let cellHeight = 1;
    let zBuffer = new Float32Array(1);
    let screen: Glyph[] = [];

    let raf = 0;
    let running = false;
    let visible = false;
    let last = 0;
    let elapsed = 0;
    // Opening pose: almost face-on, tilted just enough that the ring reads as
    // a volume and the tube's light side never sits on the frame edge.
    let angleX = 0.3;
    let angleY = -0.18;

    const setup = () => {
      const rect = host.getBoundingClientRect();
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // One column per ~6.4 CSS px keeps the glyphs crisp at this card size
      // and scales down gracefully on narrow layouts.
      cols = clamp(Math.round(width / 6.4), 36, 92);
      cellWidth = width / cols;
      cellHeight = cellWidth * 1.5;
      rows = Math.max(1, Math.floor(height / cellHeight));

      ctx.font = `700 ${cellWidth * 1.3}px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';

      zBuffer = new Float32Array(cols * rows);
      screen = new Array(cols * rows).fill(null);
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      zBuffer.fill(0);
      screen.fill(null);

      const t = elapsed;
      const R1 = 1.15;
      const R2 = 2.15;
      const K2 = 6;
      // 1.1 overfills the width slightly: the silhouette runs into the frame
      // edges instead of floating as a small emblem inside them.
      const K1 = ((cols * K2 * 3.4) / (8 * (R1 + R2))) * 1.1;

      const cosA = Math.cos(angleX);
      const sinA = Math.sin(angleX);
      const cosB = Math.cos(angleY);
      const sinB = Math.sin(angleY);

      const nearDepth = 1 / (K2 - (R1 + R2));
      const farDepth = 1 / (K2 + (R1 + R2));
      const depthSpan = nearDepth - farDepth;

      for (let phi = 0; phi < Math.PI * 2; phi += PHI_STEP) {
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        // Two slow waves on different axes so the silhouette keeps changing
        // shape instead of merely rotating.
        const wave = Math.sin(phi * 4 + t * 1.6) * 0.13 + Math.cos(phi * 2 - t) * 0.07;
        const tube = R1 + wave;

        for (let theta = 0; theta < Math.PI * 2; theta += THETA_STEP) {
          const cosTheta = Math.cos(theta);
          const sinTheta = Math.sin(theta);

          const circleX = R2 + tube * cosTheta;
          const circleY = tube * sinTheta;

          const x = circleX * cosPhi;
          const y = circleX * sinPhi;
          const z = circleY;

          // World → camera (X then Y rotation).
          const xy1 = y * cosA - z * sinA;
          const z1 = y * sinA + z * cosA;
          const finalX = x * cosB - xy1 * sinB;
          const finalY = x * sinB + xy1 * cosB;
          const finalZ = z1;

          const ooz = 1 / (K2 + finalZ);
          // 0.72 counteracts the 1.5 cell aspect; the fixed offsets seat the
          // form slightly above and right of dead centre, where it balances
          // the copy column instead of competing with it.
          const xp = Math.floor(cols / 2 + K1 * ooz * finalX + 1.6);
          const yp = Math.floor(rows / 2 - K1 * ooz * finalY * 0.72 - 3.6);
          if (xp < 0 || xp >= cols || yp < 0 || yp >= rows) continue;

          const idx = xp + yp * cols;
          if (ooz <= (zBuffer[idx] ?? 0)) continue;
          zBuffer[idx] = ooz;

          // Surface normal, rotated with the body, then lit once per theme:
          // paper gets a near-frontal light so the ink reads evenly; black
          // gets a raking light so shadowed faces genuinely sink into it.
          const nx = cosTheta * cosPhi;
          const ny = cosTheta * sinPhi;
          const nz = sinTheta;
          const nxy1 = ny * cosA - nz * sinA;
          const nz1 = ny * sinA + nz * cosA;
          const fnx = nx * cosB - nxy1 * sinB;
          const fny = nx * sinB + nxy1 * cosB;
          const fnz = nz1;

          const light = dark
            ? fnx * 0.6 - fny * 0.4 - fnz * 0.7
            : fnx * -0.1 + fny * 0.12 + fnz * -0.98;
          // Clamped before the power: the light vector can land a hair past
          // ±1, and a negative base would make luminance NaN — one cell then
          // painted the literal text "undefined".
          let luminance = clamp((light + 1) / 2, 0, 1);
          luminance = Math.pow(luminance, dark ? 1.2 : 1.25);

          const charIndex = clamp(Math.floor(luminance * RAMP.length), 0, RAMP.length - 1);

          // Ink: one continuous spectrum across the body, carried by position
          // and a slow global turn. Paper mixes it as pigment (mid lightness,
          // high saturation); black mixes it as emitted light (bright faces,
          // soft dark ones) and lets additive blending do the glow.
          const hue = 220 + finalX * 35 + finalY * 25 + t * 45;
          const sat = dark ? 90 : 70 + luminance * 20;
          const lightness = dark ? 38 + luminance * 38 : 28 + (1 - luminance) * 34;
          const depth = 0.42 + 0.58 * clamp((ooz - farDepth) / depthSpan, 0, 1);
          const alpha = dark
            ? 0.18 + luminance * 0.82
            : (0.6 + luminance * 0.4) * depth;

          screen[idx] = {
            char: RAMP[charIndex] ?? ' ',
            color: `hsla(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${lightness.toFixed(1)}%, ${alpha.toFixed(3)})`,
          };
        }
      }

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const glyph = screen[col + row * cols];
          if (!glyph) continue;
          ctx.fillStyle = glyph.color;
          ctx.fillText(glyph.char, col * cellWidth + cellWidth / 2, row * cellHeight);
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    const tick = (now: number) => {
      if (!running) return;
      const dt = last === 0 ? 0.016 : Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      angleX += dt * 0.3;
      angleY += dt * 0.17;
      draw();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduced || running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    setup();
    draw();

    if (reduced) {
      const onResize = () => {
        setup();
        draw();
      };
      const observer = new ResizeObserver(onResize);
      observer.observe(host);
      return () => observer.disconnect();
    }

    const intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible = entry.isIntersecting;
          if (visible && !document.hidden) start();
          else stop();
        }
      },
      { threshold: 0.05, rootMargin: '0px 0px 160px 0px' },
    );

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (visible) start();
    };

    const onResize = () => {
      setup();
      if (!running) draw();
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
    intersection.observe(host);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      intersection.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dark]);

  return (
    <div ref={hostRef} className="relative aspect-[3/4] w-full">
      {/* Ambient bloom behind the drawing — green on paper, indigo-violet on
          black. No panel, no edge: the field sits directly on the section. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: dark
            ? 'radial-gradient(58% 48% at 50% 46%, rgb(99 102 241 / 0.2) 0%, rgb(168 85 247 / 0.08) 40%, rgb(168 85 247 / 0) 72%)'
            : 'radial-gradient(58% 48% at 50% 46%, rgb(16 185 129 / 0.075) 0%, rgb(16 185 129 / 0) 70%)',
        }}
      />
      {dark && (
        // A phosphor screen needs its texture: faint scanlines plus a vignette
        // that pulls the corners back into the page.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(115% 115% at 50% 50%, transparent 42%, rgb(0 0 0 / 0.45) 100%), repeating-linear-gradient(0deg, rgb(255 255 255 / 0.016) 0px, rgb(255 255 255 / 0.016) 1px, transparent 1px, transparent 3px)',
            maskImage: EDGE_MASK,
            WebkitMaskImage: EDGE_MASK,
          }}
        />
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={
          dark
            ? 'A slowly turning form drawn in glowing monospace characters, its fragments resolving into one solid shape on black'
            : 'A slowly turning form drawn in monospace characters, its fragments resolving into one solid shape on paper'
        }
        className="absolute inset-0 block h-full w-full"
        style={{
          maskImage: EDGE_MASK,
          WebkitMaskImage: EDGE_MASK,
        }}
      />
    </div>
  );
}
