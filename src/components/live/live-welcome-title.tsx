"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui";

const TITLE = "What are you looking for?";
const HINTS = [
  "Home-based shops nearby",
  "A business to look up",
  "A natural call opener",
  "What’s around a ZIP",
] as const;

export function LiveWelcomeTitle({ reduceMotion }: { reduceMotion: boolean }) {
  const words = TITLE.split(" ");
  const [hint, setHint] = useState(0);
  const [instant, setInstant] = useState(false);
  const track = [...HINTS, HINTS[0]];

  useEffect(() => {
    if (reduceMotion) return;
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        setInstant(false);
        setHint((current) => current + 1);
      }, 2800);
    }, 1600);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (hint !== HINTS.length) return;
    const reset = window.setTimeout(() => {
      setInstant(true);
      setHint(0);
    }, 560);
    return () => window.clearTimeout(reset);
  }, [hint]);

  return (
    <h1 className="live-welcome-title">
      <span className="sr-only">{TITLE}</span>
      <span aria-hidden="true" className="live-welcome-words">
        {words.map((word, index) => (
          <span
            key={`${word}-${index}`}
            className={cn("live-welcome-word", reduceMotion && "is-static")}
            style={{ ["--i" as string]: index }}
          >
            {word}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className={cn("live-welcome-cycle", reduceMotion && "is-static")}>
        <span
          className={cn("live-welcome-cycle-track", instant && "is-instant")}
          style={{ transform: `translateY(${-(reduceMotion ? 0 : hint) * 1.35}em)` }}
        >
          {track.map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </span>
      </span>
    </h1>
  );
}
