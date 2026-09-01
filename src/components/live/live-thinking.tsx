"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";

import { cn } from "@/components/ui";
import type { LiveThinkingStep } from "@/lib/live/types";

function orbStateFor(label: string): OrbState {
  const text = label.toLowerCase();
  if (/search|find|listing|looking/.test(text)) return "searching";
  if (/broadband|fcc|provider|coverage/.test(text)) return "connecting";
  if (/read|source|research|look up/.test(text)) return "connecting";
  if (/rank|sort|priorit/.test(text)) return "solving";
  if (/writ|draft|answer/.test(text)) return "composing";
  if (/sav|remember/.test(text)) return "weaving";
  return "working";
}

/** Live narration while a turn is in flight: orb + shimmering current step. */
export function LiveThinking({ steps, status }: { steps: LiveThinkingStep[]; status: string }) {
  const current = status || steps[steps.length - 1]?.label || "Thinking";
  const done = steps.slice(0, -1).slice(-3);

  return (
    <div className="flex gap-3" aria-live="polite">
      <span className="mt-0.5 shrink-0">
        <ThinkingOrb state={orbStateFor(current)} size={20} theme="light" aria-label="Live is thinking" />
      </span>
      <div className="min-w-0 flex-1 pt-px">
        {done.map((step) => (
          <p key={step.id} className="step-enter text-[13px] leading-6 text-[#a4a49c] line-through decoration-[#dcdcd4]">
            {step.label}
          </p>
        ))}
        <p className="text-shimmer-loop text-[13.5px] font-medium leading-6">{current}</p>
      </div>
    </div>
  );
}

/** Post-turn recap, collapsed by default the way reasoning traces read after the fact. */
export function LiveThoughtTrace({ steps, seconds }: { steps: LiveThinkingStep[]; seconds?: number }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    setHeight(bodyRef.current?.scrollHeight ?? 0);
  }, [open, steps.length]);

  if (!steps.length) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full text-[12px] font-medium text-[#9a9a92] transition hover:text-[#5f5f59]"
      >
        <ChevronDown size={13} className={cn("transition-transform duration-200", open && "rotate-180")} />
        {seconds && seconds >= 1 ? `Worked for ${seconds}s` : `Worked through ${steps.length} steps`}
      </button>
      <div
        className="overflow-hidden transition-[height,opacity] duration-300 ease-out"
        style={{ height: open ? height : 0, opacity: open ? 1 : 0 }}
      >
        <div ref={bodyRef} className="mt-2 space-y-2.5 border-l border-[#e7e7e1] pl-4">
          {steps.map((step) => (
            <div key={step.id} className="relative">
              <span className="absolute -left-[19px] top-[7px] h-1.5 w-1.5 rounded-full bg-[#d4d4cc]" />
              <p className="text-[12.5px] font-medium leading-5 text-[#3a3a35]">{step.label}</p>
              {step.detail && <p className="text-[11.5px] leading-5 text-[#a4a49c]">{step.detail}</p>}
              {step.thought && step.thought !== step.label && (
                <p className="mt-1 whitespace-pre-wrap text-[12px] italic leading-5 text-[#8a8a84]">{step.thought}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
