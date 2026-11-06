import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * The light-mode twin of the tree loop: a live ASCII torus drawn one
 * monospace glyph per cell. It is the same subject (a field of fragments
 * resolving into one solid, rooted form) rendered in the page's own ink, so
 * light mode reads as a sheet of paper with a drawing on it instead of a
 * video screen dropped into the page.
 *
 * Craft notes:
 * - Geometry is a parametric torus projected with a painter's z-buffer. Both
 *   radii breathe, so the ring never looks like a static emblem.
 * - Every cell samples one glyph from a density ramp and one ink mixed from
 *   the brand's emerald into slate, which is what makes the object read as
 *   volume rather than a flat pattern.
 * - The drawing is frame-rate independent (all motion is dt-scaled) and stops
 *   completely when offscreen or when the tab is hidden. Reduced motion keeps
 *   a single composed frame.
 * - The canvas is transparent; the paper, hairline and shadow live in CSS so
 *   the card inherits the page's material tokens.
 */

/** Sparse → dense. The leading space keeps the field readable as air. */
const RAMP = ' ·-~+:;=!*#$@';

/** Torus sampling. ~21k points per frame is dense enough to close the tube
 *  at 75 columns without spending the frame on overdraw. */
const PHI_STEP = 0.058;
const THETA_STEP = 0.027;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type Glyph = { char: string; color: string } | null;

export function AsciiLoop() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      zBuffer.fill(0);
      screen.fill(null);

      const t = elapsed;
      const R1 = 1.15;
      const R2 = 2.15;
      const K2 = 6;
      // 1.16 overfills the width slightly: the silhouette runs into the frame
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

          // Surface normal, rotated with the body, then lit from the
          // upper-left so the form has one consistent light direction.
          const nx = cosTheta * cosPhi;
          const ny = cosTheta * sinPhi;
          const nz = sinTheta;
          const nxy1 = ny * cosA - nz * sinA;
          const nz1 = ny * sinA + nz * cosA;
          const fnx = nx * cosB - nxy1 * sinB;
          const fny = nx * sinB + nxy1 * cosB;
          const fnz = nz1;

          const light = fnx * -0.1 + fny * 0.12 + fnz * -0.98;
          // Clamped before the power: a unit light vector can land a hair past
          // ±1, and a negative base would make luminance NaN — one cell then
          // painted the literal text "undefined".
          let luminance = clamp((light + 1) / 2, 0, 1);
          luminance = Math.pow(luminance, 1.25);

          const charIndex = clamp(Math.floor(luminance * RAMP.length), 0, RAMP.length - 1);

          // Ink: one continuous spectrum across the body, carried by position
          // and a slow global turn — the same trick as the reference loop, but
          // mixed as pigment on paper instead of neon on black (mid lightness,
          // high saturation), so the card still belongs to the light theme.
          const hue = 220 + finalX * 35 + finalY * 25 + t * 45;
          const sat = 70 + luminance * 20;
          const lightness = 28 + (1 - luminance) * 34;
          const depth = 0.42 + 0.58 * clamp((ooz - farDepth) / depthSpan, 0, 1);
          const alpha = (0.6 + luminance * 0.4) * depth;

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
  }, []);

  return (
    <div ref={hostRef} className="relative aspect-[3/4] w-full">
      {/* A breath of brand green behind the drawing — no panel, no edge, so
          the field sits directly on the section's own paper. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(58% 48% at 50% 46%, rgb(16 185 129 / 0.075) 0%, rgb(16 185 129 / 0) 70%)',
        }}
      />
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="A slowly turning form drawn in monospace characters, its fragments resolving into one solid shape on paper"
        className="absolute inset-0 block h-full w-full"
        style={{
          // Dissolve the glyph field into the page instead of ending it on an
          // invisible frame line.
          maskImage:
            'radial-gradient(118% 118% at 50% 50%, #000 58%, rgb(0 0 0 / 0.55) 84%, transparent 100%)',
          WebkitMaskImage:
            'radial-gradient(118% 118% at 50% 50%, #000 58%, rgb(0 0 0 / 0.55) 84%, transparent 100%)',
        }}
      />
    </div>
  );
}


