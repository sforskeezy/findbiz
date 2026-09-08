"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, RotateCcw, Mic, MicOff, X } from "lucide-react";

import { useLiveCoachMic } from "@/components/live/use-live-coach-mic";
import { cn } from "@/components/ui";
import {
  applyRepUtterance,
  formatCoachSummary,
  resetCallCoach,
  startCallCoach,
  type CallCoachView,
  type CoachBusiness,
} from "@/lib/live/call-coach";
import type { LivePublicState } from "@/lib/live/types";

/** Enough history to follow the call, few enough lines to read at a glance. */
const TRANSCRIPT_WINDOW = 8;

function Waveform({ level, active }: { level: number; active: boolean }) {
  const bars = [0.18, 0.42, 0.7, 1, 0.62, 0.34, 0.22, 0.5, 0.86, 0.4, 0.24, 0.16];
  return (
    <div className="live-coach-wave" aria-hidden="true">
      {bars.map((weight, index) => (
        <span
          key={index}
          style={{
            transform: `scaleY(${active ? Math.max(0.12, Math.min(1, 0.12 + level * weight * 1.8)) : 0.12})`,
          }}
        />
      ))}
    </div>
  );
}

export function LiveCoachModal({
  business,
  minimized,
  sessionId,
  onMinimize,
  onRestore,
  onEnded,
}: {
  business: CoachBusiness;
  minimized: boolean;
  sessionId: string | null;
  onMinimize: () => void;
  onRestore: () => void;
  onEnded: (state?: LivePublicState) => void;
}) {
  const businessKey = [business.name, business.location, business.website, business.publicTrigger]
    .map((part) => part ?? "")
    .join("|");

  const [view, setView] = useState<CallCoachView>(() => startCallCoach(business));
  const [openedFor, setOpenedFor] = useState(businessKey);
  const [muted, setMuted] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [micError, setMicError] = useState("");
  const [ending, setEnding] = useState(false);

  const panelRef = useRef<HTMLElement | null>(null);
  const pillRef = useRef<HTMLButtonElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  /** Read by callbacks that must not close over a stale render. */
  const viewRef = useRef(view);
  const endingRef = useRef(false);

  // A different business is a different call. Reset during render, keyed on the
  // identity of the business rather than the object, so a parent re-render can
  // never clear a call in progress and no frame shows the old call's state.
  if (openedFor !== businessKey) {
    setOpenedFor(businessKey);
    setView(startCallCoach(business));
    setMuted(false);
    setContextOpen(false);
    setMicError("");
    setEnding(false);
  }

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    endingRef.current = false;
  }, [openedFor]);

  const vocabulary = useMemo(() => {
    const terms = [
      "Spectrum Business",
      "Skylar",
      "AT&T",
      "Verizon",
      "Comcast",
      "Xfinity",
      "T-Mobile",
      business.name,
      business.location,
    ];
    return terms.filter(Boolean).join(", ");
  }, [business.location, business.name]);

  const onUtterance = useCallback((text: string) => {
    setMicError("");
    // Updater form, so a fast burst of utterances still applies in order.
    setView((current) => applyRepUtterance(current.state, text));
  }, []);

  const mic = useLiveCoachMic({
    active: true,
    muted,
    getVocabulary: () => vocabulary,
    onUtterance,
    onError: setMicError,
  });

  const speaking = mic.stage === "speaking";
  // Minimizing does not stop the call. Only mute and End do.
  const listening = !muted && mic.stage !== "paused";

  const endCoach = useCallback(async () => {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    setMuted(true);
    const summary = formatCoachSummary(viewRef.current.state);
    if (!sessionId) {
      onEnded();
      return;
    }
    try {
      const response = await fetch("/api/live/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, summary }),
      });
      const payload = (await response.json()) as { state?: LivePublicState; error?: string };
      if (!response.ok || !payload.state) throw new Error(payload.error || "Couldn’t save call notes.");
      onEnded(payload.state);
    } catch {
      onEnded();
    }
  }, [onEnded, sessionId]);

  // Escape minimizes and never ends the call — ending stays an explicit click.
  useEffect(() => {
    if (minimized) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("details[open]")) {
        setContextOpen(false);
        return;
      }
      onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [minimized, onMinimize]);

  // Focus follows the overlay so the keyboard always has a home.
  useEffect(() => {
    if (minimized) pillRef.current?.focus();
    else panelRef.current?.focus();
  }, [minimized]);

  const utterances = view.state.utterances;
  const shown = utterances.slice(-TRANSCRIPT_WINDOW);
  const offset = utterances.length - shown.length;

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
  }, [utterances, minimized]);

  const facts = view.state.facts;
  const status = muted
    ? "Paused — the mic is off"
    : mic.stage === "paused"
      ? "Paused — the mic is unavailable"
      : mic.stage === "transcribing"
        ? "Catching up — listening to you only"
        : speaking
          ? "Hearing you — listening to you only"
          : "Listening to you only";

  if (minimized) {
    return (
      <button
        ref={pillRef}
        type="button"
        className="live-coach-pill"
        onClick={onRestore}
        aria-label={`Restore Live Coach for ${business.name}. Still ${listening ? "listening to you only" : "paused"}.`}
      >
        <span className={cn("live-coach-dot", listening && "is-live")} />
        <strong>{business.name}</strong>
        <span>{view.suggestion.line}</span>
      </button>
    );
  }

  return (
    <div className="live-coach-overlay" role="dialog" aria-label="Live Coach">
      <button
        type="button"
        className="live-coach-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onMinimize}
      />
      <section className="live-coach-panel" ref={panelRef} tabIndex={-1}>
        <header className="live-coach-head">
          <div className="min-w-0">
            <div className="live-coach-title-row">
              <h2>{business.name}</h2>
              <span className="live-coach-live">
                <span className={cn("live-coach-dot", listening && "is-live")} />
                LIVE
              </span>
            </div>
            <p className="live-coach-status">{status}</p>
          </div>
          <div className="live-coach-controls">
            <button type="button" onClick={() => setMuted((value) => !value)} aria-pressed={muted}>
              {muted ? <MicOff size={15} /> : <Mic size={15} />}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" onClick={() => setView((current) => resetCallCoach(current.state))}>
              <RotateCcw size={15} />
              Reset
            </button>
            <button type="button" onClick={onMinimize}>
              <Minus size={15} />
              Minimize
            </button>
            <button
              type="button"
              onClick={() => void endCoach()}
              disabled={ending}
              title="End the call and save notes"
            >
              <X size={15} />
              End
            </button>
          </div>
        </header>

        <Waveform level={mic.level} active={listening} />

        {micError ? <p className="live-coach-error">{micError}</p> : null}

        <div className="live-coach-body">
          <p className="live-coach-kicker">Your transcript</p>
          <div className="live-coach-feed" ref={feedRef}>
            {shown.length ? (
              shown.map((line, index) => (
                <p
                  key={offset + index}
                  className={cn(
                    "live-coach-said",
                    index === shown.length - 2 && "is-recent",
                    index === shown.length - 1 && "is-latest",
                  )}
                >
                  {line}
                </p>
              ))
            ) : (
              <p className="live-coach-said is-latest is-waiting">
                {muted ? "Mic paused." : "Waiting for you to speak."}
              </p>
            )}
            {speaking && shown.length ? (
              <p className="live-coach-said is-interim" aria-hidden="true">
                …
              </p>
            ) : null}
          </div>

          <p className="live-coach-kicker live-coach-next-label">Next move</p>
          <blockquote className="live-coach-line" aria-live="assertive" aria-atomic="true">
            <span aria-hidden="true">&gt; </span>
            {view.suggestion.line}
          </blockquote>
          <p className="live-coach-goal">Goal: {view.suggestion.goal}</p>
          <p className="live-coach-why">{view.suggestion.why}</p>

          <details
            className="live-coach-context"
            open={contextOpen}
            onToggle={(event) => setContextOpen(event.currentTarget.open)}
          >
            <summary>Call context</summary>
            {facts.length ? (
              <ul>
                {facts.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}:</strong> {item.value}
                    <span>Inferred from how you responded</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nothing inferred yet. PAI cannot hear the customer.</p>
            )}
          </details>
        </div>
      </section>
    </div>
  );
}
