"use client";

import { useEffect, useRef } from "react";
import { MODE_DRAWS, resolvePreset, type OrbState } from "thinking-orbs";

/** Native large canvas for hero loading — ThinkingOrb only ships 64/20 presets. */
export function LargeThinkingOrb({
  state = "searching",
  size = 220,
  speed = 1,
  "aria-label": ariaLabel,
}: {
  state?: OrbState;
  size?: number;
  speed?: number;
  "aria-label"?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { mode, speed: presetSpeed, opts } = resolvePreset(state, 64);
    const draw = MODE_DRAWS[mode];
    // 64 preset thins density for avatar scale; restore full mode density for hero size.
    const density = 1 / Math.sqrt(0.42);
    const largeOpts = {
      ...opts,
      ...(typeof opts.latRings === "number" ? { latRings: Math.max(2, Math.round(opts.latRings * density)) } : {}),
      ...(typeof opts.lonDensity === "number" ? { lonDensity: Math.max(2, Math.round(opts.lonDensity * density)) } : {}),
      ...(typeof opts.rings === "number" ? { rings: Math.max(2, Math.round(opts.rings * density)) } : {}),
    };
    const rate = presetSpeed * speed;
    const dark = false;

    const paint = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      draw(ctx, size, t, dark, largeOpts);
    };

    const reduced =
      typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      paint(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    const tick = () => {
      paint((performance.now() / 1000) * rate);
      if (running) raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    paint((performance.now() / 1000) * rate);

    let visible = true;
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && document.visibilityState !== "hidden") start();
            else stop();
          })
        : null;
    io?.observe(canvas);

    const onVis = () => {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    };
    document.addEventListener("visibilitychange", onVis);
    if (!io) start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [state, size, speed]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel ?? "Searching"}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
