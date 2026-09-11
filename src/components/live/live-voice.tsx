"use client";
import { useVoiceKey } from "@/components/settings-button";
import { voiceKeyLabel } from "@/lib/voice-shortcut";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

export type LiveVoiceStage = "listening" | "speaking" | "sending";

// Translucent ribbons rise from the floor, leaving status and controls readable.
const RIBBONS = [
  { phase: 0, speed: 1.1, reach: 0.9 },
  { phase: 1.3, speed: -0.85, reach: 0.72 },
  { phase: 2.8, speed: 0.7, reach: 0.82 },
  { phase: 4.3, speed: -1.2, reach: 0.62 },
  { phase: 5.5, speed: 0.95, reach: 0.52 },
];

function LiveLiquidVoiceCanvas({ analyserRef, reduceMotion, stage }: {
  analyserRef: { current: AnalyserNode | null };
  reduceMotion: boolean;
  stage: LiveVoiceStage;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef(stage);
  const redrawRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stageRef.current = stage;
    redrawRef.current?.();
  }, [stage]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let width = 1;
    let height = 1;
    let frame = 0;
    let previous = 0;
    let time = 0;
    let level = 0;
    let settle = stageRef.current === "sending" ? 1 : 0;
    let samples = new Uint8Array(1024);

    const draw = (now: number) => {
      const delta = previous ? Math.min(0.05, (now - previous) / 1000) : 1 / 60;
      previous = now;
      if (!reduceMotion) time += delta;
      let target = 0;
      const analyser = analyserRef.current;
      if (analyser && stageRef.current !== "sending" && !reduceMotion) {
        if (samples.length !== analyser.fftSize) samples = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        target = Math.min(1, Math.sqrt(sum / samples.length) * 6);
      }
      // Time-based easing keeps response consistent across display refresh rates.
      level += (target - level) * (1 - Math.exp(-delta * (target > level ? 16 : 4)));
      const settleTarget = stageRef.current === "sending" ? 1 : 0;
      settle = reduceMotion ? settleTarget : settle + (settleTarget - settle) * (1 - Math.exp(-delta * 5));
      context.clearRect(0, 0, width, height);
      const color = context.createLinearGradient(0, 0, width, 0);
      color.addColorStop(0, "#709e40");
      color.addColorStop(0.3, "#a6bd47");
      color.addColorStop(0.55, "#eacd49");
      color.addColorStop(0.8, "#edb744");
      color.addColorStop(1, "#d88d4e");
      for (const ribbon of RIBBONS) {
        const phase = time * ribbon.speed + ribbon.phase;
        const rise = (0.22 + level * 0.42) * (1 - settle * 0.65) * ribbon.reach;
        const points: [number, number][] = [];
        for (let index = 0; index <= 100; index++) {
          const x = index / 100;
          const envelope = 0.35 + Math.sin(x * Math.PI) * 0.65;
          const swell = 0.75 + Math.sin(x * Math.PI * 2 + phase) * 0.26
            + Math.sin(x * Math.PI * 4 - phase * 0.55) * (0.08 + level * 0.12);
          points.push([x * width, height * (1 - 0.02 - rise * envelope * swell)]);
        }
        context.beginPath();
        context.moveTo(0, height);
        for (const [x, y] of points) context.lineTo(x, y);
        context.lineTo(width, height);
        context.closePath();
        context.globalAlpha = 0.14;
        context.fillStyle = color;
        context.fill();
        context.beginPath();
        for (const [index, [x, y]] of points.entries()) {
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.globalAlpha = 0.6;
        context.strokeStyle = color;
        context.lineWidth = 1.4;
        context.stroke();
      }
      // A light bloom at the floor binds the separate ribbons into one field.
      context.globalAlpha = 1;
      const bloom = context.createLinearGradient(0, height - 36, 0, height);
      bloom.addColorStop(0, "rgba(238, 207, 91, 0)");
      bloom.addColorStop(1, "rgba(238, 207, 91, 0.24)");
      context.fillStyle = bloom;
      context.fillRect(0, height - 36, width, 36);
      if (!reduceMotion && !document.hidden) frame = requestAnimationFrame(draw);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden) draw(performance.now());
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      restart();
    };
    const observer = new ResizeObserver(resize);
    redrawRef.current = restart;
    observer.observe(canvas);
    resize();
    document.addEventListener("visibilitychange", restart);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", restart);
      redrawRef.current = null;
    };
  }, [analyserRef, reduceMotion]);

  return <canvas ref={canvasRef} className="live-voice-canvas" aria-hidden="true" />;
}

const STAGE_COPY: Record<LiveVoiceStage, { label: string; hint: string }> = {
  listening: { label: "Listening", hint: "Start talking. A short pause sends your message." },
  speaking: { label: "I'm with you", hint: "A short pause sends your message." },
  sending: { label: "Sending", hint: "Turning your words into a message…" },
};

function stageCopy(stage: LiveVoiceStage, pushToTalk: boolean, voiceKey: string) {
  if (pushToTalk && stage !== "sending") {
    return {
      label: STAGE_COPY[stage].label,
      hint: `Release ${voiceKey} to send.`,
    };
  }
  return STAGE_COPY[stage];
}

export function LiveVoiceEdge({ analyserRef, onCancel, onFinish, pushToTalk = false, reduceMotion, stage }: {
  analyserRef: { current: AnalyserNode | null };
  onCancel: () => void;
  onFinish: () => void;
  pushToTalk?: boolean;
  reduceMotion: boolean;
  stage: LiveVoiceStage;
}) {
  const keyLabel = voiceKeyLabel(useVoiceKey());
  const copy = stageCopy(stage, pushToTalk, keyLabel);
  return (
    <div className="live-voice-edge" data-stage={stage} data-hold={pushToTalk || undefined} aria-label="Live voice mode">
      <LiveLiquidVoiceCanvas analyserRef={analyserRef} reduceMotion={reduceMotion} stage={stage} />
      <div className="live-voice-status">
        <span className="live-voice-status-pill">
          <i className="live-voice-pulse" aria-hidden="true" />
          <span role="status" aria-live="polite">{copy.label}</span>
        </span>
        <small className="live-voice-hint">{copy.hint}</small>
        {pushToTalk && stage !== "sending" && (
          <kbd className="live-voice-key">{keyLabel}</kbd>
        )}
      </div>
      <div className="live-voice-controls">
        <button type="button" onClick={onCancel} aria-label="Cancel voice recording">
          <X size={15} strokeWidth={2} aria-hidden="true" /> Cancel
        </button>
        <button type="button" className="live-voice-finish" onClick={onFinish}
          disabled={stage === "sending"} aria-label="Send voice recording now">
          <Check size={15} strokeWidth={2} aria-hidden="true" /> Send now
        </button>
      </div>
    </div>
  );
}
