"use client";

import { useEffect, useRef } from "react";

const FRAMES = ["◐", "◓", "◑", "◒"];
const FRAME_MS = 220;

/**
 * Spins a glyph in the browser tab title while a turn is in flight, so the tab
 * reads as busy when it is in the background. Restores the original title after.
 */
export function useWorkingTitle(active: boolean, label: string) {
  const idle = useRef<string | null>(null);

  useEffect(() => {
    if (!active) {
      if (idle.current != null) {
        document.title = idle.current;
        idle.current = null;
      }
      return;
    }

    idle.current ??= document.title;
    let frame = 0;
    const paint = () => {
      const text = label.trim() || "Working";
      document.title = `${FRAMES[frame % FRAMES.length]} ${text}`;
      frame += 1;
    };
    paint();
    const timer = window.setInterval(paint, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [active, label]);

  useEffect(() => () => {
    if (idle.current != null) document.title = idle.current;
  }, []);
}
