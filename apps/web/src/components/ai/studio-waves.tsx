import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import GradientWaves from '@/components/GradientWaves';
import { useMotionScope } from '@/hooks/use-motion';
import { animateUI, dur, EASE, prefersReducedMotion } from '@/lib/motion';

/**
 * The studio's sea.
 *
 * A single lit horizon under the two plates that bookend the tool: the
 * frontispiece and the export receipt. It is deliberately large enough to read
 * as water rather than as a texture, and dark enough that the ivory type above it
 * stays quiet. The shader carries the waves and the light; anime.js carries the
 * entrance and a slow cursor-driven drift, so the sea has depth without ever
 * competing with the document.
 */

function useResolvedDark() {
  const [dark, setDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

/** Phones get fewer ray-march steps and a lower pixel ratio. */
function useCompact() {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return compact;
}

interface StudioWavesProps {
  className?: string;
}

export function StudioWaves({ className }: StudioWavesProps) {
  const dark = useResolvedDark();
  const compact = useCompact();
  const still = prefersReducedMotion();
  const motion = useMotionScope();
  const rootRef = useRef<HTMLDivElement>(null);
  const driftRef = useRef<HTMLDivElement>(null);

  /* Entrance: the sea rises into place, once. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (prefersReducedMotion()) {
      root.style.opacity = '1';
      return;
    }
    root.style.opacity = '0';
    motion.animate(root, {
      opacity: [0, 1],
      translateY: [36, 0],
      scale: [1.035, 1],
      duration: dur(1500),
      ease: EASE.out,
    });
  }, [motion]);

  /* Depth: the whole surface leans with the cursor, under the shader's light. */
  useEffect(() => {
    const node = driftRef.current;
    if (!node || prefersReducedMotion()) return;
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

    let frame = 0;
    let x = 0;
    let y = 0;
    let animation: ReturnType<typeof animateUI> | null = null;

    const apply = () => {
      frame = 0;
      animation?.pause();
      animation = animateUI(node, {
        translateX: x,
        translateY: y,
        duration: 1200,
        ease: 'outCubic',
      });
    };

    const onMove = (event: PointerEvent) => {
      x = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 18;
      y = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 10;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const settle = () => {
      x = 0;
      y = 0;
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      animation?.pause();
      animation = animateUI(node, {
        translateX: 0,
        translateY: 0,
        duration: 1400,
        ease: 'outExpo',
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', settle);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      animation?.pause();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', settle);
    };
  }, []);

  return (
    <div ref={rootRef} aria-hidden className={['studio-waves', className].filter(Boolean).join(' ')}>
      <div ref={driftRef} className="studio-waves-drift">
        <GradientWaves
          lightMode={false}
          horizonColor={dark ? '#07241a' : '#08271c'}
          waveColor={dark ? '#0e5540' : '#12533d'}
          crestColor={dark ? '#b6efd4' : '#f0d3a0'}
          backgroundColor="transparent"
          speed={0.34}
          amplitude={3.2}
          waveScale={1.05}
          waveRatio={1.2}
          swell={38}
          turbulence={22}
          tilt={60}
          zoom={0.85}
          height={6}
          fogDepth={30}
          relief={0.95}
          lightAngle={116}
          sheen={0.6}
          brightness={1.08}
          opacity={1}
          grain={0.15}
          quality={compact ? 'low' : 'medium'}
          dpr={compact ? 1.25 : 1.5}
          intro={!still}
          mouseInteraction={!still}
          parallaxStrength={0.45}
          mouseStrength={0.68}
          swellOnClick={!still}
          paused={still}
        />
      </div>
    </div>
  );
}
