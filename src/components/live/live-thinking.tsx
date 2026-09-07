"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import type { LiveThinkingStep } from "@/lib/live/types";

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [active]);

  return seconds;
}

function visibleSteps(steps: LiveThinkingStep[]) {
  return steps.filter((step) => step.label && !/^reading your message$/i.test(step.label));
}

function thoughtSignature(steps: LiveThinkingStep[], status?: string) {
  return `${status ?? ""}|${steps.map((step) => `${step.id}:${step.label}:${step.detail ?? ""}:${step.thought ?? ""}`).join("¦")}`;
}

function ThoughtStream({
  steps,
  live,
  status,
}: {
  steps: LiveThinkingStep[];
  live?: boolean;
  status?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pinToBottom = useRef(true);
  const items = visibleSteps(steps);
  const [overflow, setOverflow] = useState(false);
  const signature = thoughtSignature(items, status);

  useEffect(() => {
    const node = scrollerRef.current;
    const inner = innerRef.current;
    if (!node) return;

    const sync = () => {
      const canScroll = node.scrollHeight > node.clientHeight + 4;
      setOverflow(canScroll);
      if (pinToBottom.current) node.scrollTop = node.scrollHeight;
    };

    sync();
    const frame = window.requestAnimationFrame(sync);
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    if (inner) observer.observe(inner);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [signature]);

  return (
    <div className="live-thought-panel" data-overflow={overflow || undefined}>
      <div
        ref={scrollerRef}
        className="live-thought-stream"
        onScroll={(event) => {
          const node = event.currentTarget;
          pinToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 32;
        }}
        onWheel={(event) => {
          const node = event.currentTarget;
          if (node.scrollHeight <= node.clientHeight + 4) return;
          const atTop = node.scrollTop <= 0;
          const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 1;
          if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) return;
          event.stopPropagation();
        }}
      >
        <div ref={innerRef} className="live-thought-inner">
          {items.map((step) => {
            const thought = step.thought?.trim();
            const showThought = Boolean(thought && thought !== step.label);
            const generic = /^thinking$/i.test(step.label);
            const showLabel = !showThought || (Boolean(live) && !generic);
            return (
              <div key={step.id} className="live-thought-item">
                {showLabel && <p className="live-thought-label">{step.label}</p>}
                {step.detail && <p className="live-thought-detail">{step.detail}</p>}
                {showThought && <p className="live-thought-copy">{thought}</p>}
              </div>
            );
          })}
          {live && status && (!items.length || items[items.length - 1]?.label !== status) && (
            <p className="live-thought-status">{status}</p>
          )}
        </div>
      </div>
      {overflow ? (
        <>
          <div className="live-thought-fade live-thought-fade-top" aria-hidden />
          <div className="live-thought-fade live-thought-fade-bottom" aria-hidden />
        </>
      ) : null}
    </div>
  );
}

/** In-flight: expanded, scrollable reasoning trail. */
export function LiveThinking({ steps, status }: { steps: LiveThinkingStep[]; status: string }) {
  return <LiveThoughtTrace steps={steps} live status={status} />;
}

/** ChatGPT-style thinking: muted toggle, independent scroll when open. */
export function LiveThoughtTrace({
  steps,
  seconds,
  live = false,
  status,
}: {
  steps: LiveThinkingStep[];
  seconds?: number;
  live?: boolean;
  status?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(live);
  const tick = useElapsedSeconds(live);
  const items = visibleSteps(steps);
  if (!items.length && !live) return null;

  const elapsed = live ? tick : seconds;
  const label = live
    ? status || items[items.length - 1]?.label || "Thinking"
    : elapsed && elapsed >= 1
      ? `Thought for ${elapsed}s`
      : `Thought · ${items.length} ${items.length === 1 ? "step" : "steps"}`;

  return (
    <div className="live-thought">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="live-thought-toggle"
      >
        <ChevronRight size={14} className={cn("live-thought-caret", open && "rotate-90")} />
        {live && <WorkingDots size={13} className="text-[#5f5f59]" />}
        <span className={cn("min-w-0 flex-1 truncate text-left", live && "text-shimmer-loop")}>{label}</span>
        {live && elapsed && elapsed >= 1 ? <span className="live-thought-clock">{elapsed}s</span> : null}
      </button>
      {open && (
        <div id={panelId}>
          <ThoughtStream steps={items} live={live} status={status} />
        </div>
      )}
    </div>
  );
}
