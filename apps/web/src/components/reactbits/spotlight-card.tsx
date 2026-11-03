/**
 * SpotlightCard — React Bits (TS + Tailwind), vendored and customised.
 *
 * Source: https://reactbits.dev/components/spotlight-card
 * The pointer/edge/focus logic is kept; the palette is bound to PDFShush's
 * theme tokens instead of a fixed dark palette, ambient drift is off by
 * default, and the radius/size are tuned for a dense editor rail.
 *
 * It renders only decorative spans behind/around content, so it can never
 * intercept a document gesture, selection or drop target.
 */

import { useEffect, useRef, type CSSProperties, type HTMLAttributes } from 'react';

export type SpotlightShape = 'circle' | 'beam';

export interface SpotlightCardProps extends HTMLAttributes<HTMLDivElement> {
  spotlightColor?: string;
  intensity?: number;
  spotlightSize?: number;
  softness?: number;
  shape?: SpotlightShape;
  borderGlow?: number;
  proximity?: number;
  smoothing?: number;
  flare?: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const falloff = (color: string, softness: number) => {
  const soft = clamp(softness, 0, 1);
  const core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha: number, at: number) =>
    `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  const stops = [stop(1, 0)];
  for (let index = 0; index <= 12; index += 1) {
    const t = core + ((1 - core) * index) / 12;
    const g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g);
    const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    stops.push(stop(smooth + (glow - smooth) * soft, t));
  }
  return stops.join(', ');
};

export function SpotlightCard({
  children,
  className = '',
  style,
  spotlightColor,
  intensity = 0.08,
  spotlightSize = 210,
  softness = 0.78,
  shape = 'circle',
  borderGlow = 0.42,
  proximity = 70,
  smoothing = 0.36,
  flare = true,
  ...rest
}: SpotlightCardProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const light = lightRef.current;
    const edge = edgeRef.current;
    if (!root || !light || !edge) return undefined;

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const state = { x: 0, y: 0, presence: 0, flare: 0, pressed: false };
    const pointer = { x: 0, y: 0, active: false };
    const drawn = { light: '', edge: '' };
    let focus: Element | null = null;
    let raf = 0;
    let last = 0;
    let alive = true;

    const gradient = (size: number, x: number, y: number, stops: string) =>
      shape === 'beam'
        ? `radial-gradient(${(size * 0.55).toFixed(1)}px ${Math.max(size * 0.6, y + size * 0.55).toFixed(1)}px at ${x.toFixed(1)}px 0px, ${stops})`
        : `radial-gradient(circle ${size.toFixed(1)}px at ${x.toFixed(1)}px ${y.toFixed(1)}px, ${stops})`;

    const paint = () => {
      const size = Math.max(20, spotlightSize) * (1 + 0.16 * state.flare);
      const boost = 1 + 0.65 * state.flare;
      const fill = gradient(size, state.x, state.y, falloff(spotlightColor ?? 'var(--primary)', softness));
      const rim = gradient(size * 0.62, state.x, shape === 'beam' ? 0 : state.y, falloff(spotlightColor ?? 'var(--primary)', 1));
      if (fill !== drawn.light) {
        drawn.light = fill;
        light.style.background = fill;
      }
      if (rim !== drawn.edge) {
        drawn.edge = rim;
        edge.style.background = rim;
      }
      light.style.opacity = String(Math.min(1, state.presence * intensity * boost));
      edge.style.opacity = String(Math.min(1, state.presence * borderGlow * boost));
    };

    const tick = (now: number) => {
      raf = 0;
      if (!alive) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const rect = root.getBoundingClientRect();
      let targetX = state.x;
      let targetY = state.y;
      let presence = 0;
      if (focus && root.contains(focus)) {
        const box = focus.getBoundingClientRect();
        targetX = box.left + box.width / 2 - rect.left;
        targetY = box.top + box.height / 2 - rect.top;
        presence = 1;
      } else if (pointer.active) {
        targetX = pointer.x - rect.left;
        targetY = pointer.y - rect.top;
        const gap = Math.hypot(
          Math.max(0, -targetX, targetX - rect.width),
          Math.max(0, -targetY, targetY - rect.height),
        );
        presence = gap === 0 ? 1 : proximity > 0 ? Math.max(0, 1 - gap / proximity) ** 2 : 0;
      }
      const follow = reduce ? 1 : 1 - Math.exp(-dt / (0.015 + smoothing * 0.2));
      state.x += (targetX - state.x) * follow;
      state.y += (targetY - state.y) * follow;
      const fade = reduce ? 1 : 1 - Math.exp(-dt / (presence > state.presence ? 0.09 : 0.26));
      state.presence += (presence - state.presence) * fade;
      if (Math.abs(presence - state.presence) < 0.002) state.presence = presence;
      const press = state.pressed && flare && !reduce ? 1 : 0;
      state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.04 : 0.24)));
      paint();
      const settled =
        Math.abs(targetX - state.x) <= 0.1 &&
        Math.abs(targetY - state.y) <= 0.1 &&
        state.presence === presence &&
        state.flare === press;
      if (!settled) raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (raf || !alive) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      wake();
    };
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget) return;
      pointer.active = false;
      wake();
    };
    const onDown = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.active = true;
      state.pressed = true;
      wake();
    };
    const onUp = () => {
      if (!state.pressed) return;
      state.pressed = false;
      wake();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
      focus = event.target;
      wake();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (root.contains(event.relatedTarget as Node | null)) return;
      focus = null;
      wake();
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onOut);
    root.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onOut);
      root.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
    };
  }, [borderGlow, flare, intensity, proximity, shape, smoothing, softness, spotlightColor, spotlightSize]);

  return (
    <div
      ref={rootRef}
      className={`relative isolate overflow-hidden rounded-lg ${className}`}
      style={style as CSSProperties}
      {...rest}
    >
      <span
        ref={lightRef}
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] opacity-0"
        aria-hidden="true"
      />
      <span
        ref={edgeRef}
        className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] p-px opacity-0 [-webkit-mask:linear-gradient(#000_0_0)_content-box,linear-gradient(#000_0_0)] [-webkit-mask-composite:xor] [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]"
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

export default SpotlightCard;
