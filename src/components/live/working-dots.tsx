"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/components/ui";

type Pt = [number, number];

const cell = (n: number): Pt => [n % 3, Math.floor(n / 3)];

/**
 * Four dots on a 3×3. The 2×2 square walks the corners, then the same four
 * dots pull into a diamond, a T, an L — the Cursor composer spinner.
 */
const FRAMES: Pt[][] = [
  [0, 1, 3, 4].map(cell),
  [1, 2, 4, 5].map(cell),
  [4, 5, 7, 8].map(cell),
  [3, 4, 6, 7].map(cell),
  [1, 3, 5, 7].map(cell),
  [1, 6, 7, 8].map(cell),
  [0, 3, 6, 7].map(cell),
  [0, 1, 4, 7].map(cell),
];

const HOLD_MS = 80;
const MOVE_MS = 220;
const BEAT = HOLD_MS + MOVE_MS;

function ease(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
}

function nearestAssign(from: Pt[], to: Pt[]): Pt[] {
  const used = new Set<number>();
  return from.map((point) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < to.length; i += 1) {
      if (used.has(i)) continue;
      const dx = point[0] - to[i][0];
      const dy = point[1] - to[i][1];
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    used.add(best);
    return to[best];
  });
}

export function WorkingDots({
  size = 12,
  className,
  paused = false,
}: {
  size?: number;
  className?: string;
  paused?: boolean;
}) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const dot = Math.max(1.7, size * 0.22);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || paused) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const nodes = [...root.children] as HTMLElement[];
    const step = (size - dot) / 2;
    let from = FRAMES[0];
    let to = nearestAssign(from, FRAMES[1]);
    let frame = 0;
    let raf = 0;
    const origin = performance.now();

    const paint = (now: number) => {
      const elapsed = (now - origin) % (FRAMES.length * BEAT);
      const index = Math.floor(elapsed / BEAT);
      if (index !== frame) {
        from = to;
        to = nearestAssign(from, FRAMES[(index + 1) % FRAMES.length]);
        frame = index;
      }
      const local = elapsed - index * BEAT;
      const t = local <= HOLD_MS ? 0 : ease(Math.min(1, (local - HOLD_MS) / MOVE_MS));
      for (let i = 0; i < 4; i += 1) {
        const x = from[i][0] + (to[i][0] - from[i][0]) * t;
        const y = from[i][1] + (to[i][1] - from[i][1]) * t;
        nodes[i].style.transform = `translate(${x * step}px, ${y * step}px)`;
      }
      raf = requestAnimationFrame(paint);
    };

    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [paused, size, dot]);

  const step = (size - dot) / 2;

  return (
    <span
      ref={rootRef}
      role="img"
      aria-label="Working"
      className={cn("relative inline-block shrink-0 align-middle", className)}
      style={{ width: size, height: size }}
    >
      {FRAMES[0].map((point, index) => (
        <span
          key={index}
          className="absolute left-0 top-0 rounded-full bg-current"
          style={{
            width: dot,
            height: dot,
            willChange: "transform",
            transform: `translate(${point[0] * step}px, ${point[1] * step}px)`,
          }}
        />
      ))}
    </span>
  );
}
