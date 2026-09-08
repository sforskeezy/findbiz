"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Rep-microphone capture for Live Coach.
 *
 * Same gate and thresholds as Talk-to-Live, and the same hard limit:
 * getUserMedia only. The remote party on the call, a browser tab, and the
 * device output are never recorded. Nothing is ever played back either — the
 * rep is on a live phone call, so this hook stays silent.
 */
const AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const VOICE_SILENCE_HOLD_MS = 1500;
const VOICE_SPEECH_ONSET_MS = 200;
const VOICE_MIN_UTTERANCE_MS = 550;
const VOICE_NOISE_FLOOR_CEILING = 0.05;
const VOICE_MONITOR_INTERVAL_MS = 55;
/** Flush a long monologue mid-stream so one segment can't outgrow the upload limit. */
const SEGMENT_MAX_MS = 20_000;
/** Recycle a segment holding only room tone, so a quiet stretch can't pile up in memory. */
const SEGMENT_IDLE_MS = 10_000;
/** Below this a segment is silence or a click, not speech. */
const SEGMENT_MIN_BYTES = 800;
/** Backlog ceiling. Past this the oldest audio is dropped, never the newest. */
const MAX_PENDING_SEGMENTS = 6;
/** Busy states hold for at least this long, so the status line can't strobe. */
const STAGE_SETTLE_MS = 420;
/** Reopens allowed if the device disappears mid-call, before giving up loudly. */
const MIC_RECOVERY_ATTEMPTS = 3;

export type LiveCoachMicStage = "listening" | "speaking" | "transcribing" | "paused";

type Segment = {
  chunks: Blob[];
  startedAt: number;
  /** Set at rotation time: true means send this to ASR, false means throw it away. */
  transcribe: boolean;
};

type PendingSegment = {
  sessionId: number;
  blob: Blob;
};

let cachedVoiceMime: string | null | undefined;

function preferredVoiceMime() {
  if (cachedVoiceMime !== undefined) return cachedVoiceMime;
  if (typeof MediaRecorder === "undefined") {
    cachedVoiceMime = null;
    return null;
  }
  cachedVoiceMime = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
  return cachedVoiceMime;
}

function isLiveAudioStream(stream: MediaStream | null) {
  return !!stream?.getAudioTracks().some((track) => track.readyState === "live");
}

function audioBlobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The recording could not be encoded."));
    reader.onerror = () => reject(new Error("The recording could not be encoded."));
    reader.readAsDataURL(blob);
  });
}

export function useLiveCoachMic({
  active,
  muted,
  getVocabulary,
  onUtterance,
  onError,
}: {
  active: boolean;
  muted: boolean;
  getVocabulary: () => string;
  onUtterance: (text: string) => void;
  onError: (message: string) => void;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const samplesRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const segmentRef = useRef<Segment | null>(null);
  const monitorRef = useRef<number | null>(null);

  /** Bumped by every open and every teardown. Late callbacks compare against it. */
  const sessionRef = useRef(0);
  const activeRef = useRef(false);
  const mutedRef = useRef(muted);
  /** Reopen counter. State only so the open effect re-runs; the ref is the truth. */
  const [reopen, setReopen] = useState(0);
  const reopenRef = useRef(0);

  /** FIFO so utterances reach the coach in the order the rep said them. */
  const queueRef = useRef<PendingSegment[]>([]);
  const pendingRef = useRef(0);
  const drainingRef = useRef(false);
  const inflightRef = useRef<AbortController | null>(null);
  /** One notice per rough patch. Cleared by the next answer from the endpoint. */
  const errorLatchRef = useRef(false);

  const stageRef = useRef<LiveCoachMicStage>(muted ? "paused" : "listening");
  const levelRef = useRef(0);
  const calmSinceRef = useRef(0);
  const listenersRef = useRef(new Set<() => void>());

  const speechRef = useRef({
    noiseFloor: 0.012,
    hasSpeech: false,
    loudSince: 0,
    lastLoudAt: 0,
    speechStartedAt: 0,
  });

  const onUtteranceRef = useRef(onUtterance);
  const onErrorRef = useRef(onError);
  const getVocabularyRef = useRef(getVocabulary);

  useEffect(() => {
    mutedRef.current = muted;
    onUtteranceRef.current = onUtterance;
    onErrorRef.current = onError;
    getVocabularyRef.current = getVocabulary;
  }, [getVocabulary, muted, onError, onUtterance]);

  /**
   * The mic is an external system ticking at ~18Hz, so stage and level live in
   * refs and the component subscribes. No setState is fired from an effect.
   */
  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const notify = useCallback(() => {
    for (const listener of listenersRef.current) listener();
  }, []);

  const stage = useSyncExternalStore(
    subscribe,
    () => stageRef.current,
    () => stageRef.current,
  );
  const level = useSyncExternalStore(
    subscribe,
    () => levelRef.current,
    () => levelRef.current,
  );

  const publishLevel = useCallback(
    (next: number) => {
      const value = Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
      if (value === levelRef.current) return;
      levelRef.current = value;
      notify();
    },
    [notify],
  );

  const stopMonitor = useCallback(() => {
    if (monitorRef.current == null) return;
    window.clearInterval(monitorRef.current);
    monitorRef.current = null;
  }, []);

  const resetSpeech = useCallback(() => {
    const speech = speechRef.current;
    speech.hasSpeech = false;
    speech.loudSince = 0;
    speech.lastLoudAt = 0;
    speech.speechStartedAt = 0;
  }, []);

  const applyStage = useCallback(
    (next: LiveCoachMicStage, immediate: boolean) => {
      if (!immediate && next === "listening" && stageRef.current !== "listening") {
        const now = performance.now();
        if (!calmSinceRef.current) calmSinceRef.current = now;
        if (now - calmSinceRef.current < STAGE_SETTLE_MS) return;
      }
      calmSinceRef.current = 0;
      if (stageRef.current === next) return;
      stageRef.current = next;
      notify();
    },
    [notify],
  );

  /** One honest source of truth for the status line, recomputed on every tick. */
  const syncStage = useCallback(() => {
    if (!activeRef.current) {
      applyStage(mutedRef.current ? "paused" : "listening", true);
      return;
    }
    if (mutedRef.current) {
      applyStage("paused", true);
      return;
    }
    if (speechRef.current.hasSpeech) {
      applyStage("speaking", true);
      return;
    }
    if (pendingRef.current > 0) {
      applyStage("transcribing", true);
      return;
    }
    applyStage("listening", false);
  }, [applyStage]);

  const transcribeSegment = useCallback(async (blob: Blob, sessionId: number) => {
    const controller = new AbortController();
    inflightRef.current = controller;
    try {
      const audio = await audioBlobToDataUrl(blob);
      if (sessionId !== sessionRef.current) return;
      const response = await fetch("/api/live/transcribe", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, context: getVocabularyRef.current() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        transcript?: string;
        error?: string;
      };
      if (sessionId !== sessionRef.current) return;
      // 422 is the endpoint saying that segment was silence. Normal. Stay quiet.
      if (response.status === 422) {
        errorLatchRef.current = false;
        return;
      }
      if (!response.ok || !payload.transcript?.trim()) {
        throw new Error(payload.error || "I could not transcribe that.");
      }
      errorLatchRef.current = false;
      onUtteranceRef.current(payload.transcript.trim());
    } catch (error) {
      if (sessionId !== sessionRef.current || controller.signal.aborted) return;
      if (errorLatchRef.current) return;
      errorLatchRef.current = true;
      onErrorRef.current(error instanceof Error ? error.message : "I could not transcribe that.");
    } finally {
      if (inflightRef.current === controller) inflightRef.current = null;
    }
  }, []);

  const drainQueue = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length) {
        const next = queueRef.current.shift()!;
        try {
          if (next.sessionId === sessionRef.current) {
            await transcribeSegment(next.blob, next.sessionId);
          }
        } finally {
          pendingRef.current = Math.max(0, pendingRef.current - 1);
          syncStage();
        }
      }
    } finally {
      drainingRef.current = false;
      syncStage();
    }
  }, [syncStage, transcribeSegment]);

  const enqueueSegment = useCallback(
    (blob: Blob, sessionId: number) => {
      if (sessionId !== sessionRef.current) return;
      if (blob.size < SEGMENT_MIN_BYTES) return;
      queueRef.current.push({ blob, sessionId });
      pendingRef.current += 1;
      while (queueRef.current.length > MAX_PENDING_SEGMENTS) {
        queueRef.current.shift();
        pendingRef.current = Math.max(0, pendingRef.current - 1);
      }
      syncStage();
      void drainQueue();
    },
    [drainQueue, syncStage],
  );

  /** Opens a fresh segment on the live stream. Never awaits anything. */
  const startRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") return false;
    const sessionId = sessionRef.current;
    const mimeType = preferredVoiceMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
    } catch {
      return false;
    }
    const segment: Segment = { chunks: [], startedAt: performance.now(), transcribe: false };
    recorderRef.current = recorder;
    segmentRef.current = segment;

    recorder.ondataavailable = (event) => {
      if (sessionId !== sessionRef.current) return;
      if (event.data.size > 0) segment.chunks.push(event.data);
    };
    // A dead recorder is not a dead session: drop it and let the monitor reopen one.
    recorder.onerror = () => {
      segment.chunks = [];
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (segmentRef.current === segment) segmentRef.current = null;
    };
    recorder.onstop = () => {
      const chunks = segment.chunks;
      segment.chunks = [];
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (segmentRef.current === segment) segmentRef.current = null;
      if (sessionId !== sessionRef.current || !segment.transcribe) return;
      enqueueSegment(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), sessionId);
    };

    try {
      recorder.start(250);
    } catch {
      recorderRef.current = null;
      segmentRef.current = null;
      return false;
    }
    return true;
  }, [enqueueSegment]);

  /**
   * Closes the current segment and opens the next one. The new recorder starts
   * before the old one stops, so nothing said at the boundary is lost and the
   * network round trip happens off to the side.
   */
  const rotateSegment = useCallback(
    (transcribe: boolean) => {
      const previous = recorderRef.current;
      const segment = segmentRef.current;
      if (segment) segment.transcribe = transcribe;
      const started = startRecorder();
      resetSpeech();
      if (previous && previous.state === "recording") {
        previous.stop();
        return started;
      }
      if (segment) {
        // No stop event is coming, so flush by hand.
        const chunks = segment.chunks;
        segment.chunks = [];
        if (transcribe) {
          enqueueSegment(
            new Blob(chunks, { type: previous?.mimeType || "audio/webm" }),
            sessionRef.current,
          );
        }
      }
      return started;
    },
    [enqueueSegment, resetSpeech, startRecorder],
  );

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    const samples = samplesRef.current;
    if (!analyser || !samples) return;
    if (!activeRef.current || mutedRef.current) return;

    // The device can vanish mid-call (unplugged headset, input switched).
    if (!isLiveAudioStream(streamRef.current)) {
      stopMonitor();
      if (reopenRef.current < MIC_RECOVERY_ATTEMPTS) {
        reopenRef.current += 1;
        setReopen(reopenRef.current);
        return;
      }
      if (!errorLatchRef.current) {
        errorLatchRef.current = true;
        onErrorRef.current("The microphone stopped. Check your mic, then reopen Live Coach.");
      }
      applyStage("paused", true);
      return;
    }

    const context = audioContextRef.current;
    if (context?.state === "suspended") void context.resume().catch(() => {});

    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      // Self-heal after a device hiccup rather than ending the session.
      if (startRecorder()) resetSpeech();
      return;
    }

    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const value = (samples[index]! - 128) / 128;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / samples.length);
    const target = Math.min(1, rms * 8);
    const eased = levelRef.current + (target - levelRef.current) * 0.35;
    // Skip the render entirely when the bar would not visibly move.
    if (Math.abs(eased - levelRef.current) >= 0.004) publishLevel(eased);

    const speech = speechRef.current;
    const now = performance.now();
    speech.noiseFloor += (rms - speech.noiseFloor) * (rms < speech.noiseFloor ? 0.25 : 0.0015);
    speech.noiseFloor = Math.min(speech.noiseFloor, VOICE_NOISE_FLOOR_CEILING);
    const openGate = Math.min(0.13, Math.max(0.02, speech.noiseFloor * 2.6 + 0.012));
    const closeGate = openGate * 0.6;

    if (rms >= openGate) {
      if (!speech.loudSince) speech.loudSince = now;
      speech.lastLoudAt = now;
      if (!speech.hasSpeech && now - speech.loudSince >= VOICE_SPEECH_ONSET_MS) {
        speech.hasSpeech = true;
        speech.speechStartedAt = speech.loudSince;
      }
    } else if (rms < closeGate) {
      speech.loudSince = 0;
    }

    const segmentAge = segmentRef.current ? now - segmentRef.current.startedAt : 0;
    if (speech.hasSpeech) {
      const settled =
        now - speech.lastLoudAt >= VOICE_SILENCE_HOLD_MS &&
        now - speech.speechStartedAt >= VOICE_MIN_UTTERANCE_MS;
      if (settled || segmentAge >= SEGMENT_MAX_MS) rotateSegment(true);
    } else if (segmentAge >= SEGMENT_IDLE_MS) {
      rotateSegment(false);
    }

    syncStage();
  }, [applyStage, publishLevel, resetSpeech, rotateSegment, startRecorder, stopMonitor, syncStage]);

  const startMonitor = useCallback(() => {
    stopMonitor();
    monitorRef.current = window.setInterval(tick, VOICE_MONITOR_INTERVAL_MS);
  }, [stopMonitor, tick]);

  /** Idempotent: safe to call from open, from unmute, and from both at once. */
  const startCapture = useCallback(() => {
    if (!activeRef.current || mutedRef.current) return;
    const stream = streamRef.current;
    if (!stream || !isLiveAudioStream(stream) || !analyserRef.current) return;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = true;
    });
    const context = audioContextRef.current;
    if (context?.state === "suspended") void context.resume().catch(() => {});
    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      resetSpeech();
      startRecorder();
    }
    if (monitorRef.current == null) startMonitor();
    syncStage();
  }, [resetSpeech, startMonitor, startRecorder, syncStage]);

  /** Stops the monitor and the recorder. Keeps the stream so unmute is instant. */
  const stopCapture = useCallback(
    (flushTail: boolean) => {
      stopMonitor();
      const recorder = recorderRef.current;
      const segment = segmentRef.current;
      // Words already spoken are not thrown away just because the rep hit mute.
      const keep = flushTail && speechRef.current.hasSpeech;
      if (segment) segment.transcribe = keep;
      if (recorder && recorder.state === "recording") {
        recorder.stop();
      } else if (segment) {
        const chunks = segment.chunks;
        segment.chunks = [];
        recorderRef.current = null;
        segmentRef.current = null;
        if (keep) {
          enqueueSegment(new Blob(chunks, { type: "audio/webm" }), sessionRef.current);
        }
      }
      resetSpeech();
      publishLevel(0);
    },
    [enqueueSegment, publishLevel, resetSpeech, stopMonitor],
  );

  const teardown = useCallback(() => {
    // Invalidates every pending callback, queued blob, and in-flight request.
    sessionRef.current += 1;
    activeRef.current = false;
    stopMonitor();
    inflightRef.current?.abort();
    inflightRef.current = null;
    queueRef.current = [];
    pendingRef.current = 0;
    errorLatchRef.current = false;
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    recorderRef.current = null;
    segmentRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    samplesRef.current = null;
    resetSpeech();
    speechRef.current.noiseFloor = 0.012;
    publishLevel(0);
  }, [publishLevel, resetSpeech, stopMonitor]);

  useEffect(() => {
    if (!active) {
      teardown();
      applyStage(mutedRef.current ? "paused" : "listening", true);
      return;
    }

    const sessionId = sessionRef.current + 1;
    sessionRef.current = sessionId;
    activeRef.current = true;
    let cancelled = false;

    const open = async () => {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        onErrorRef.current("Voice input is not available in this browser.");
        return;
      }
      try {
        const existing = streamRef.current;
        const stream = isLiveAudioStream(existing)
          ? existing!
          : await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
        if (cancelled || sessionId !== sessionRef.current) {
          if (stream !== streamRef.current) stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const carried = audioContextRef.current;
        const context = carried && carried.state !== "closed" ? carried : new AudioContext();
        audioContextRef.current = context;
        if (context.state === "suspended") void context.resume().catch(() => {});
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.7;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        // The analyser is a dead end on purpose: nothing reaches the speakers.
        sourceRef.current = source;
        analyserRef.current = analyser;
        samplesRef.current = new Uint8Array(analyser.fftSize);

        // Whatever the mute toggle did while the permission prompt was open wins.
        if (mutedRef.current) {
          stream.getAudioTracks().forEach((track) => {
            track.enabled = false;
          });
          applyStage("paused", true);
          return;
        }
        startCapture();
      } catch {
        if (cancelled || sessionId !== sessionRef.current) return;
        onErrorRef.current("Microphone access is needed to listen to you only.");
      }
    };

    void open();
    return () => {
      cancelled = true;
      teardown();
    };
    // `reopen` is the recovery trigger: bumping it reopens a dead device.
  }, [active, applyStage, reopen, startCapture, teardown]);

  // Mute is applied here and only here, so open and mute can land in either order.
  useEffect(() => {
    mutedRef.current = muted;
    if (muted) {
      streamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
      stopCapture(true);
      applyStage("paused", true);
      return;
    }
    // If the stream is not open yet, open() reads mutedRef and starts capture.
    startCapture();
    syncStage();
  }, [applyStage, muted, startCapture, stopCapture, syncStage]);

  useEffect(
    () => () => {
      teardown();
      void audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
    },
    [teardown],
  );

  return { stage, level };
}
