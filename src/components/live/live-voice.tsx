"use client";

import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

export type LiveVoiceStage = "listening" | "speaking" | "sending";

const TAU = Math.PI * 2;

type VoiceLayer = {
  color: [number, number, number];
  /** 0 = low, 1 = mid, 2 = high. Splitting the spectrum keeps the layers out of phase. */
  band: 0 | 1 | 2;
  reach: number;
  speed: number;
  phase: number;
  opacity: number;
  blur: number;
};

/** Warm ink wash — Live's paper, not Detail One's blue ground. */
const LIVE_VOICE_FIELDS: (VoiceLayer & { anchor: number })[] = [
  { color: [42, 40, 36], band: 1, anchor: 0.3, reach: 0.4, speed: 0.5, phase: 0, opacity: 0.88, blur: 14 },
  { color: [118, 108, 92], band: 2, anchor: 0.17, reach: 0.3, speed: 0.78, phase: 2.4, opacity: 0.5, blur: 18 },
];

/**
 * Sunset plumes to match Live's BorderBeam. Each accent keeps to its own
 * stretch of the dock so the ink ground still reads between them.
 */
const LIVE_VOICE_PLUMES: (VoiceLayer & { home: number; wander: number; spread: number })[] = [
  { color: [232, 148, 72], band: 0, home: 0.24, wander: 0.15, reach: 0.64, spread: 0.15, speed: 0.42, phase: 4.1, opacity: 0.96, blur: 12 },
  { color: [196, 92, 64], band: 2, home: 0.76, wander: 0.15, reach: 0.62, spread: 0.14, speed: 0.64, phase: 1.3, opacity: 0.94, blur: 12 },
  { color: [232, 196, 110], band: 1, home: 0.5, wander: 0.22, reach: 0.46, spread: 0.1, speed: 0.89, phase: 5.2, opacity: 0.84, blur: 14 },
];

function LiveLiquidVoiceCanvas({
  analyserRef,
  reduceMotion,
  stage,
}: {
  analyserRef: { current: AnalyserNode | null };
  reduceMotion: boolean;
  stage: LiveVoiceStage;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<LiveVoiceStage>(stage);

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let clock = 0;
    let previous = 0;
    let level = 0;
    // Eases the whole field inward once we have stopped listening.
    let settle = 0;
    const bands = [0, 0, 0];
    let frequencies = new Uint8Array(512);
    let samples = new Uint8Array(1024);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const rgba = (color: [number, number, number], alpha: number) =>
      `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

    const averageBand = (from: number, to: number) => {
      const start = Math.min(from, frequencies.length - 1);
      const end = Math.min(to, frequencies.length);
      let sum = 0;
      for (let index = start; index < end; index += 1) sum += frequencies[index]!;
      return sum / Math.max(1, end - start) / 255;
    };

    const driveFor = (layer: VoiceLayer) => Math.min(1, bands[layer.band]! * 1.25 + level * 0.45);

    /** Three incommensurate waves never line up, so the edge stays irregular. */
    const wobbleAt = (ratio: number, time: number, phase: number) =>
      Math.sin(ratio * TAU * 1.1 + time * 1.29 + phase) * 0.5 +
      Math.sin(ratio * TAU * 2.3 - time * 0.87 + phase * 1.7) * 0.31 +
      Math.sin(ratio * TAU * 3.7 + time * 1.91 + phase * 0.6) * 0.19;

    const fillShape = (layer: VoiceLayer, crest: number, midStop: number) => {
      context.lineTo(width + 48, height + 48);
      context.closePath();
      const fill = context.createLinearGradient(0, Math.max(0, crest - 10), 0, height);
      fill.addColorStop(0, rgba(layer.color, 0));
      fill.addColorStop(midStop, rgba(layer.color, layer.opacity * 0.55));
      fill.addColorStop(1, rgba(layer.color, layer.opacity));
      context.fillStyle = fill;
      context.fill();
      context.restore();
    };

    const drawField = (field: (typeof LIVE_VOICE_FIELDS)[number]) => {
      const drive = driveFor(field);
      const time = clock * field.speed;
      const breath = 0.5 + Math.sin(clock * 0.66 + field.phase) * 0.5;
      const center = 0.5 + Math.sin(time * 0.51 + field.phase * 1.3) * (0.38 - settle * 0.34);
      const spread = 0.36 + Math.sin(time * 0.33 + field.phase) * 0.09 + drive * 0.2;

      context.save();
      context.filter = `blur(${field.blur}px)`;
      context.beginPath();
      context.moveTo(-48, height + 48);

      const steps = 68;
      let crest = height;
      for (let index = 0; index <= steps; index += 1) {
        const ratio = index / steps;
        const x = ratio * (width + 96) - 48;
        const offset = (ratio - center) / spread;
        const hump = Math.exp(-offset * offset);
        const rise =
          field.anchor * (0.52 + breath * 0.48) * (1 + settle * 0.2) +
          hump * field.reach * (0.18 + drive * 1.05) +
          wobbleAt(ratio, time, field.phase) * (0.026 + drive * 0.075) * (0.3 + hump);
        const y = height - Math.max(0, rise) * height;
        if (y < crest) crest = y;
        context.lineTo(x, y);
      }

      fillShape(field, crest, 0.34);
    };

    const drawPlume = (plume: (typeof LIVE_VOICE_PLUMES)[number]) => {
      const drive = driveFor(plume);
      const time = clock * plume.speed;
      const breath = 0.5 + Math.sin(clock * 0.71 + plume.phase) * 0.5;
      const wander = plume.wander * (1 - settle * 0.8);
      const centerA = plume.home + Math.sin(time * 0.57 + plume.phase * 1.3) * wander;
      const centerB = plume.home + Math.sin(time * 0.83 + plume.phase * 2.1) * wander * 1.25;
      const spreadA = plume.spread * (0.82 + drive * 0.55) + settle * 0.07;
      const spreadB = spreadA * 0.6;

      context.save();
      context.filter = `blur(${plume.blur}px)`;
      context.beginPath();
      context.moveTo(-48, height + 48);

      const steps = 68;
      let crest = height;
      for (let index = 0; index <= steps; index += 1) {
        const ratio = index / steps;
        const x = ratio * (width + 96) - 48;
        const offsetA = (ratio - centerA) / spreadA;
        const offsetB = (ratio - centerB) / spreadB;
        const hump = Math.max(
          Math.exp(-offsetA * offsetA),
          Math.exp(-offsetB * offsetB) * (0.62 + breath * 0.24),
        );
        const rise =
          hump * plume.reach * (0.13 + drive * 1.02) * (0.78 + breath * 0.22) +
          wobbleAt(ratio, time, plume.phase) * 0.035 * hump;
        const y = height - Math.max(0, rise) * height;
        if (y < crest) crest = y;
        context.lineTo(x, y);
      }

      fillShape(plume, crest, 0.3);
    };

    const drawBloom = (plume: (typeof LIVE_VOICE_PLUMES)[number]) => {
      const drive = driveFor(plume);
      if (drive < 0.06) return;
      const time = clock * plume.speed;
      const wander = plume.wander * (1 - settle * 0.8);
      const x = width * (plume.home + Math.sin(time * 0.57 + plume.phase * 1.3) * wander);
      const y = height * (1 - plume.reach * drive * 0.75);
      const radius = Math.max(12, height * (0.2 + drive * 0.36));

      context.save();
      context.filter = `blur(${plume.blur}px)`;
      const glow = context.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, rgba(plume.color, 0.3 * drive));
      glow.addColorStop(0.55, rgba(plume.color, 0.11 * drive));
      glow.addColorStop(1, rgba(plume.color, 0));
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
      context.restore();
    };

    const render = (now: number) => {
      const delta = previous ? Math.min(0.05, (now - previous) / 1000) : 1 / 60;
      previous = now;
      clock += delta * (reduceMotion ? 0.22 : 1);

      const analyser = analyserRef.current;
      let measured = 0;
      if (analyser) {
        if (frequencies.length !== analyser.frequencyBinCount) {
          frequencies = new Uint8Array(analyser.frequencyBinCount);
        }
        if (samples.length !== analyser.fftSize) samples = new Uint8Array(analyser.fftSize);
        analyser.getByteFrequencyData(frequencies);
        analyser.getByteTimeDomainData(samples);

        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const value = (samples[index]! - 128) / 128;
          sum += value * value;
        }
        measured = Math.min(1, Math.sqrt(sum / samples.length) * 5.2);

        const targets = [averageBand(2, 9), averageBand(9, 42), averageBand(42, 120)];
        for (let index = 0; index < 3; index += 1) {
          const target = Math.min(1, targets[index]! * 1.9);
          const rate = target > bands[index]! ? 0.36 : 0.075;
          bands[index] += (target - bands[index]!) * rate;
        }
      }

      level += (measured - level) * (measured > level ? 0.4 : 0.09);
      settle += ((stageRef.current === "sending" ? 1 : 0) - settle) * 0.055;
      if (reduceMotion) {
        level = Math.min(level, 0.08);
        for (let index = 0; index < 3; index += 1) bands[index] = Math.min(bands[index]!, 0.1);
      }

      context.clearRect(0, 0, width, height);
      for (const field of LIVE_VOICE_FIELDS) drawField(field);
      for (const plume of LIVE_VOICE_PLUMES) drawPlume(plume);
      for (const plume of LIVE_VOICE_PLUMES) drawBloom(plume);

      frame = window.requestAnimationFrame(render);
    };

    render(typeof performance !== "undefined" ? performance.now() : 0);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [analyserRef, reduceMotion]);

  return <canvas ref={canvasRef} className="live-voice-canvas" aria-hidden="true" />;
}

const STAGE_COPY: Record<LiveVoiceStage, { label: string; hint: string }> = {
  listening: { label: "Listening", hint: "Just start talking — I'll send it when you stop." },
  speaking: { label: "I'm with you", hint: "Pause when you're done and this goes straight to chat." },
  sending: { label: "Sending", hint: "Writing that up now." },
};

export function LiveVoiceEdge({
  analyserRef,
  onCancel,
  onFinish,
  reduceMotion,
  stage,
}: {
  analyserRef: { current: AnalyserNode | null };
  onCancel: () => void;
  onFinish: () => void;
  reduceMotion: boolean;
  stage: LiveVoiceStage;
}) {
  const copy = STAGE_COPY[stage];
  return (
    <div className="live-voice-edge" data-stage={stage} aria-label="Live voice mode">
      <LiveLiquidVoiceCanvas analyserRef={analyserRef} reduceMotion={reduceMotion} stage={stage} />
      <i className="live-voice-grain" aria-hidden="true" />

      <div className="live-voice-status">
        <span className="live-voice-status-pill">
          <i className="live-voice-pulse" aria-hidden="true" />
          <span role="status" aria-live="polite">
            {copy.label}
          </span>
        </span>
        <small key={stage} className="live-voice-hint">
          {copy.hint}
        </small>
      </div>

      <div className="live-voice-controls">
        <button type="button" onClick={onCancel} aria-label="Cancel voice recording">
          <X size={13} strokeWidth={2} aria-hidden="true" />
          Cancel
        </button>
        <button
          type="button"
          className="live-voice-finish"
          onClick={onFinish}
          disabled={stage === "sending"}
          aria-label="Send voice recording now"
        >
          <Check size={13} strokeWidth={2} aria-hidden="true" />
          Send now
        </button>
      </div>
    </div>
  );
}
