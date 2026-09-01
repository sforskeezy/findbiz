"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import type { LiveThinkingStep } from "@/lib/live/types";

function useElapsedSeconds() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, []);

  return seconds;
}

/** One line while a turn is in flight: the four-dot spinner and the current step. */
export function LiveThinking({ steps, status }: { steps: LiveThinkingStep[]; status: string }) {
  const current = status || steps[steps.length - 1]?.label || "Thinking";
  const seconds = useElapsedSeconds();

  return (
    <div className="flex items-center gap-2.5" aria-live="polite">
      <WorkingDots size={14} className="text-[#3a3a35]" />
      <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium leading-5">
        <span className="text-shimmer-loop">{current}</span>
      </p>
      {seconds >= 1 && (
        <span className="shrink-0 text-[12px] tabular-nums text-[#c2c2ba]">{seconds}s</span>
      )}
    </div>
  );
}

/** Post-turn recap. Cursor-style: a quiet "Thought for Ns" that opens the trail. */
export function LiveThoughtTrace({ steps, seconds }: { steps: LiveThinkingStep[]; seconds?: number }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    setHeight(bodyRef.current?.scrollHeight ?? 0);
  }, [open, steps.length]);

  if (!steps.length) return null;

  const visible = steps.filter((step) => step.label && !/^reading your message$/i.test(step.label));
  if (!visible.length) return null;

  const label =
    seconds && seconds >= 1 ? `Thought for ${seconds}s` : `Thought · ${visible.length} ${visible.length === 1 ? "step" : "steps"}`;

  return (
    <div className="mb-2.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#9a9a92] transition hover:text-[#5f5f59]"
      >
        <ChevronRight size={13} className={cn("transition-transform duration-200", open && "rotate-90")} />
        {label}
      </button>
      <div
        className="overflow-hidden transition-[height,opacity] duration-300 ease-out"
        style={{ height: open ? height : 0, opacity: open ? 1 : 0 }}
      >
        <div ref={bodyRef} className="mt-2 space-y-2 border-l border-[#e7e7e1] pl-3.5">
          {visible.map((step) => (
            <div key={step.id} className="relative">
              <span className="absolute -left-[16px] top-[7px] h-1.5 w-1.5 rounded-full bg-[#d4d4cc]" />
              <p className="text-[12.5px] leading-5 text-[#3a3a35]">{step.label}</p>
              {step.detail && <p className="text-[11.5px] leading-5 text-[#a4a49c]">{step.detail}</p>}
              {step.thought && step.thought !== step.label && (
                <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-5 text-[#8a8a84]">{step.thought}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
