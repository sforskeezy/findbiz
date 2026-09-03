"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const PLACEHOLDERS = [
  "Ask Live for anything. Name an area to build a list.",
  "Find home-based businesses in 29607…",
  "Find businesses in Lugoff and check what's new",
  "Who is worth calling first?",
  "Genuine-check this list — are they real local shops?",
] as const;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function LiveTypewriter({ active }: { active: boolean }) {
  const reduceMotion = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    prefersReducedMotion,
    () => false,
  );
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!active) {
      setTyped("");
      return;
    }
    if (reduceMotion) {
      setTyped(PLACEHOLDERS[0]);
      return;
    }

    let phraseIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer = 0;

    const tick = () => {
      const phrase = PLACEHOLDERS[phraseIndex]!;
      if (!deleting) {
        charIndex += 1;
        setTyped(phrase.slice(0, charIndex));
        if (charIndex >= phrase.length) {
          deleting = true;
          timer = window.setTimeout(tick, 1600);
          return;
        }
        timer = window.setTimeout(tick, 38 + Math.random() * 28);
        return;
      }

      charIndex -= 1;
      setTyped(phrase.slice(0, Math.max(0, charIndex)));
      if (charIndex <= 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % PLACEHOLDERS.length;
        timer = window.setTimeout(tick, 320);
        return;
      }
      timer = window.setTimeout(tick, 22);
    };

    timer = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timer);
  }, [active, reduceMotion]);

  if (!active) return null;

  return (
    <span className="live-typewriter" aria-hidden="true">
      {typed}
      {!reduceMotion && <i className="live-typewriter-caret" />}
    </span>
  );
}
