"use client";
import { useVoiceKey } from "@/components/settings-button";
import { isModifierVoiceKey, matchesVoiceShortcut } from "@/lib/voice-shortcut";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LiveVoiceStage } from "@/components/live/live-voice";

/** listening: mic is open but nobody has spoken · speaking: mid-utterance · sending: silence detected, transcribing. */
export type { LiveVoiceStage };

/**
 * Quiet time after speech that counts as "they're done", which triggers the
 * auto-send. Long enough to ride out a mid-sentence beat, short enough that
 * finishing a thought still feels like it sends immediately.
 */
const VOICE_SILENCE_HOLD_MS = 1500;
/** Ignore clicks, chair creaks and door bumps — real speech sustains past this. */
const VOICE_SPEECH_ONSET_MS = 200;
/** Guards against sending a half-word if the very first syllable is followed by a gap. */
const VOICE_MIN_UTTERANCE_MS = 550;
/** Room tone never legitimately reaches this, so the gate can't drift above speech. */
const VOICE_NOISE_FLOOR_CEILING = 0.05;
/** Close the mic if the session opens and nothing is ever said. */
const VOICE_NO_SPEECH_TIMEOUT_MS = 9000;
const VOICE_MAX_SESSION_MS = 60_000;
/**
 * A modifier bound as push-to-talk waits this long before opening the mic, so
 * the Ctrl in a quick Ctrl+C never blips the recorder on.
 */
const VOICE_MODIFIER_HOLD_MS = 250;
const VOICE_MONITOR_INTERVAL_MS = 55;

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

/**
 * Soft two-note listen chime. Synthesized so it can fire on the same gesture
 * that opens the mic — no asset fetch, no extra latency.
 */
function playLiveVoiceCue(audioContext: AudioContext | null, cue: "open" | "send") {
  if (!audioContext || audioContext.state === "closed") return;
  if (typeof document !== "undefined" && document.hidden) return;

  const run = () => {
    if (audioContext.state !== "running") return;
    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.72;
    filter.frequency.setValueAtTime(cue === "open" ? 2600 : 1900, now);
    master.connect(filter);
    filter.connect(audioContext.destination);

    const notes =
      cue === "open"
        ? [
            { freq: 523.25, at: 0, dur: 0.22, peak: 0.1, type: "sine" as const },
            { freq: 783.99, at: 0.048, dur: 0.2, peak: 0.085, type: "sine" as const },
            { freq: 1174.66, at: 0.048, dur: 0.15, peak: 0.022, type: "triangle" as const },
          ]
        : [
            { freq: 659.25, at: 0, dur: 0.13, peak: 0.065, type: "sine" as const },
            { freq: 987.77, at: 0.036, dur: 0.15, peak: 0.05, type: "sine" as const },
          ];

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(1, now + 0.012);
    master.gain.exponentialRampToValueAtTime(0.0001, now + (cue === "open" ? 0.3 : 0.2));

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = note.type;
      oscillator.frequency.setValueAtTime(note.freq, now + note.at);
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(note.peak, now + note.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.dur);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + note.at);
      oscillator.stop(now + note.at + note.dur + 0.02);
    }
  };

  if (audioContext.state === "suspended") {
    void audioContext.resume().then(run);
    return;
  }
  run();
}

function stopVoiceMonitor(monitorRef: { current: number | null }) {
  if (monitorRef.current === null) return;
  window.clearInterval(monitorRef.current);
  monitorRef.current = null;
}

export function useLiveVoice({
  disabled,
  getDraft,
  getVocabulary,
  onNotice,
  onSubmit,
}: {
  disabled: boolean;
  getDraft: () => string;
  getVocabulary: () => string;
  onNotice: (message: string) => void;
  onSubmit: (text: string) => void;
}) {
  const voiceKey = useVoiceKey();
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [stage, setStage] = useState<LiveVoiceStage>("listening");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioNode | null>(null);
  const shouldSubmitRef = useRef(false);
  const sessionRef = useRef(false);
  const monitorRef = useRef<number | null>(null);
  /** Set when the stop came from silence detection or "Send now", so the transcript skips the composer. */
  const autoSendRef = useRef(false);
  /** Bumped on every open/cancel so a late getUserMedia can't attach to a closed session. */
  const openIdRef = useRef(0);
  const transcriptionRef = useRef<AbortController | null>(null);
  /** pointerdown already started the session — the following click must not toggle it off. */
  const pointerArmedRef = useRef(false);
  /** The voice key is being held as push-to-talk, so silence should not auto-send. */
  const holdToTalkRef = useRef(false);
  /** The voice key is still physically down for this PTT press. */
  const holdLiveRef = useRef(false);
  const controlsDownRef = useRef(new Set<string>());
  const controlIsShortcutRef = useRef(false);
  /** Pending grace timer for a modifier binding, before the mic actually opens. */
  const modifierHoldRef = useRef<number | null>(null);
  const onNoticeRef = useRef(onNotice);
  const onSubmitRef = useRef(onSubmit);
  const getDraftRef = useRef(getDraft);
  const getVocabularyRef = useRef(getVocabulary);
  const startRef = useRef<() => Promise<void>>(async () => {});
  const finishRef = useRef<() => void>(() => {});
  const cancelRef = useRef<() => void>(() => {});

  const [holding, setHolding] = useState(false);

  useEffect(() => {
    onNoticeRef.current = onNotice;
    onSubmitRef.current = onSubmit;
    getDraftRef.current = getDraft;
    getVocabularyRef.current = getVocabulary;
  }, [onNotice, onSubmit, getDraft, getVocabulary]);

  const ensureAudioContext = () => {
    const existing = audioContextRef.current;
    if (existing && existing.state !== "closed") return existing;
    const next = new AudioContext();
    audioContextRef.current = next;
    return next;
  };

  const finishSession = useCallback(() => {
    openIdRef.current += 1;
    transcriptionRef.current?.abort();
    transcriptionRef.current = null;
    sessionRef.current = false;
    shouldSubmitRef.current = false;
    autoSendRef.current = false;
    holdToTalkRef.current = false;
    holdLiveRef.current = false;
    setHolding(false);
    stopVoiceMonitor(monitorRef);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
    }
    recorderRef.current = null;
    chunksRef.current = [];
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    setListening(false);
    setTranscribing(false);
  }, []);

  useEffect(() => () => {
    finishSession();
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, [finishSession]);

  const start = useCallback(async () => {
    if (disabled || sessionRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onNoticeRef.current("Voice input is not available in this browser.");
      return;
    }

    const openId = openIdRef.current + 1;
    openIdRef.current = openId;
    sessionRef.current = true;
    const fromHold = holdToTalkRef.current;
    if (!fromHold) {
      setStage("listening");
      setListening(true);
    }
    onNoticeRef.current("");

    try {
      if (!fromHold) playLiveVoiceCue(ensureAudioContext(), "open");
      const stream = isLiveAudioStream(mediaStreamRef.current)
        ? mediaStreamRef.current!
        : await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);
      if (openId !== openIdRef.current) {
        if (stream !== mediaStreamRef.current) stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (holdToTalkRef.current && !holdLiveRef.current) {
        if (stream !== mediaStreamRef.current) stream.getTracks().forEach((track) => track.stop());
        finishSession();
        return;
      }
      if (fromHold) {
        playLiveVoiceCue(ensureAudioContext(), "open");
        setStage("listening");
        setListening(true);
      }
      mediaStreamRef.current = stream;

      const mimeType = preferredVoiceMime();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
      const audioContext = ensureAudioContext();
      if (audioContext.state === "suspended") void audioContext.resume();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      chunksRef.current = [];
      mediaStreamRef.current = stream;
      recorderRef.current = recorder;
      sourceRef.current = source;
      analyserRef.current = analyser;
      sessionRef.current = true;
    shouldSubmitRef.current = false;
    autoSendRef.current = false;

      recorder.ondataavailable = (event) => {
        if (openId === openIdRef.current && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        if (openId !== openIdRef.current) return;
        setListening(false);
        setTranscribing(false);
        stream.getTracks().forEach((track) => track.stop());
        onNoticeRef.current("The microphone stopped unexpectedly. Try again.");
        finishSession();
      };
      recorder.onstop = async () => {
        if (openId !== openIdRef.current) return;
        stopVoiceMonitor(monitorRef);
        if (timerRef.current) {
          window.clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        recorderRef.current = null;
        sourceRef.current?.disconnect();
        sourceRef.current = null;
        analyserRef.current?.disconnect();
        analyserRef.current = null;
        setListening(false);

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];
        if (!shouldSubmitRef.current || !sessionRef.current) {
          finishSession();
          return;
        }
        shouldSubmitRef.current = false;
        const autoSend = autoSendRef.current;
        autoSendRef.current = false;
        if (blob.size < 800) {
          onNoticeRef.current("I didn’t hear anything. Try the mic again.");
          finishSession();
          return;
        }

        setTranscribing(true);
        const controller = new AbortController();
        transcriptionRef.current = controller;
        try {
          const audio = await audioBlobToDataUrl(blob);
          if (openId !== openIdRef.current) return;
          const response = await fetch("/api/live/transcribe", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio, context: getVocabularyRef.current() }),
          });
          const payload = (await response.json()) as { transcript?: string; error?: string };
          if (!response.ok || !payload.transcript?.trim()) {
            throw new Error(payload.error || "I could not transcribe that recording.");
          }
          if (openId !== openIdRef.current || !sessionRef.current) return;

          const transcript = payload.transcript.trim();
          const pending = getDraftRef.current().trim();
          const merged = [pending, transcript].filter(Boolean).join(" ");

          if (autoSend) {
            sessionRef.current = false;
            setTranscribing(false);
            onSubmitRef.current(merged);
            return;
          }
        } catch (error) {
          if (openId !== openIdRef.current || controller.signal.aborted) return;
          onNoticeRef.current(
            error instanceof Error ? error.message : "I could not transcribe that recording.",
          );
        } finally {
          if (openId === openIdRef.current) {
            transcriptionRef.current = null;
            sessionRef.current = false;
            setTranscribing(false);
          }
        }
      };

      recorder.start(250);
      if (holdToTalkRef.current && !holdLiveRef.current) {
        shouldSubmitRef.current = true;
        autoSendRef.current = true;
        setStage("sending");
        playLiveVoiceCue(audioContext, "send");
        recorder.stop();
        return;
      }
      timerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          shouldSubmitRef.current = true;
          autoSendRef.current = true;
          setStage("sending");
          playLiveVoiceCue(audioContext, "send");
          recorder.stop();
        }
      }, VOICE_MAX_SESSION_MS);

      const monitorSamples = new Uint8Array(analyser.fftSize);
      let openedAt = 0;
      let noiseFloor = 0.012;
      let hasSpeech = false;
      let loudSince = 0;
      let lastLoudAt = 0;
      let speechStartedAt = 0;

      const stopWithAutoSend = () => {
        stopVoiceMonitor(monitorRef);
        shouldSubmitRef.current = true;
        autoSendRef.current = true;
        setStage("sending");
        playLiveVoiceCue(audioContext, "send");
        if (recorder.state === "recording") recorder.stop();
      };

      monitorRef.current = window.setInterval(() => {
        if (!sessionRef.current || recorder.state !== "recording") return;

        analyser.getByteTimeDomainData(monitorSamples);
        let sum = 0;
        for (let index = 0; index < monitorSamples.length; index += 1) {
          const value = (monitorSamples[index]! - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / monitorSamples.length);
        const now = performance.now();
        if (!openedAt) openedAt = now;

        noiseFloor += (rms - noiseFloor) * (rms < noiseFloor ? 0.25 : 0.0015);
        noiseFloor = Math.min(noiseFloor, VOICE_NOISE_FLOOR_CEILING);
        const openGate = Math.min(0.13, Math.max(0.02, noiseFloor * 2.6 + 0.012));
        const closeGate = openGate * 0.6;

        if (rms >= openGate) {
          if (!loudSince) loudSince = now;
          lastLoudAt = now;
          if (!hasSpeech && now - loudSince >= VOICE_SPEECH_ONSET_MS) {
            hasSpeech = true;
            speechStartedAt = loudSince;
            setStage("speaking");
          }
        } else if (rms < closeGate) {
          loudSince = 0;
        }

        if (holdToTalkRef.current) return;

        if (hasSpeech) {
          if (
            now - lastLoudAt >= VOICE_SILENCE_HOLD_MS &&
            now - speechStartedAt >= VOICE_MIN_UTTERANCE_MS
          ) {
            stopWithAutoSend();
          }
          return;
        }

        if (now - openedAt >= VOICE_NO_SPEECH_TIMEOUT_MS) {
          stopVoiceMonitor(monitorRef);
          onNoticeRef.current("I didn’t catch anything. Tap the mic when you’re ready.");
          sessionRef.current = false;
          shouldSubmitRef.current = false;
          if (recorder.state === "recording") recorder.stop();
        }
      }, VOICE_MONITOR_INTERVAL_MS);
    } catch (error) {
      if (openId !== openIdRef.current) return;
      finishSession();
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
      onNoticeRef.current(
        denied ? "Allow microphone access to use voice input." : "The microphone could not start.",
      );
    }
  }, [disabled, finishSession]);

  const cancel = useCallback(() => {
    finishSession();
  }, [finishSession]);

  const finish = useCallback(() => {
    if (recorderRef.current?.state !== "recording") return;
    stopVoiceMonitor(monitorRef);
    shouldSubmitRef.current = true;
    autoSendRef.current = true;
    setStage("sending");
    playLiveVoiceCue(audioContextRef.current, "send");
    recorderRef.current.stop();
  }, []);

  const handlePointerDown = useCallback(
    (event: { button: number }) => {
      if (event.button !== 0 || listening || transcribing || disabled) return;
      pointerArmedRef.current = true;
      void start();
    },
    [disabled, listening, start, transcribing],
  );

  const handleClick = useCallback(() => {
    if (pointerArmedRef.current) {
      pointerArmedRef.current = false;
      return;
    }
    if (listening) {
      finish();
      return;
    }
    void start();
  }, [finish, listening, start]);

  useEffect(() => {
    startRef.current = start;
    finishRef.current = finish;
    cancelRef.current = cancel;
  }, [cancel, finish, start]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && (sessionRef.current || transcriptionRef.current)) {
        cancelRef.current();
        return;
      }
      if (!matchesVoiceShortcut(event, voiceKey)) {
        // A second key pressed while the voice key is held means the rep is
        // running a real shortcut such as copy or paste. Leave it to the
        // browser and drop the recording on release instead of sending it.
        if (holdLiveRef.current) controlIsShortcutRef.current = true;
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Keep normal keyboard navigation in dialogs, links, and other controls.
      if (target?.closest("dialog, button, a, select, input, [contenteditable=true]")) return;
      if (target?.tagName === "TEXTAREA" && target.getAttribute("aria-label") !== "Message Live") return;
      if (disabled || event.repeat) return;
      // A held modifier has no default action worth blocking, and swallowing it
      // can strand a shortcut the rep is part-way through pressing.
      if (!isModifierVoiceKey(voiceKey)) event.preventDefault();
      if (sessionRef.current || recorderRef.current || transcriptionRef.current) return;
      controlsDownRef.current.add(event.code || event.key);
      controlIsShortcutRef.current = false;
      holdToTalkRef.current = true;
      holdLiveRef.current = true;
      setHolding(true);
      void startRef.current();
    }

    function onKeyUp(event: KeyboardEvent) {
      if (!controlsDownRef.current.has(event.code || event.key)) return;
      controlsDownRef.current.delete(event.code || event.key);
      if (controlsDownRef.current.size > 0) return;

      const wasHold = holdToTalkRef.current;
      const usedAsShortcut = controlIsShortcutRef.current;
      holdLiveRef.current = false;
      controlIsShortcutRef.current = false;
      setHolding(false);
      if (!wasHold) return;
      if (usedAsShortcut) {
        holdToTalkRef.current = false;
        cancelRef.current();
        return;
      }
      if (recorderRef.current?.state === "recording") {
        finishRef.current();
        return;
      }
      if (sessionRef.current && !recorderRef.current) return;
      holdToTalkRef.current = false;
    }

    function onLostFocus() {
      controlsDownRef.current.clear();
      controlIsShortcutRef.current = false;
      holdLiveRef.current = false;
      setHolding(false);
      if (!holdToTalkRef.current) return;
      holdToTalkRef.current = false;
      cancelRef.current();
    }

    function onVisibility() {
      if (document.hidden) onLostFocus();
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onLostFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onLostFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      onLostFocus();
    };
  }, [disabled, voiceKey]);

  return {
    analyserRef,
    cancel,
    finish,
    handleClick,
    handlePointerDown,
    holding,
    listening,
    stage,
    transcribing,
  };
}
