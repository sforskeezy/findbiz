"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  ArrowUp,
  ArrowDown,
  Check,
  Copy,
  ListFilter,
  Square,
  Brain,
  Building2,
  ChevronRight,
  Clock3,
  Footprints,
  Home,
  MapPin,
  Mic,
  Newspaper,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  SkipForward,
  Sparkles,
  SquarePen,
} from "lucide-react";

import { ModeSwitch } from "@/components/prospect-header";
import {
  ADDRESS_DROP_EVENT,
  AddressText,
  acceptsAddressDrag,
  addressFromDrop,
  dropHeldAddress,
  endAddressDrag,
  heldAddress,
  type AddressDropTarget,
} from "@/components/live/address-chip";
import { LiveMarkdown } from "@/components/live/live-markdown";
import { LiveSidebar, type SessionGroup } from "@/components/live/live-sidebar";
import { LiveSources } from "@/components/live/live-sources";
import { LiveThoughtTrace } from "@/components/live/live-thinking";
import { LiveTypewriter } from "@/components/live/live-typewriter";
import { LiveVoiceEdge } from "@/components/live/live-voice";
import { useLiveVoice } from "@/components/live/use-live-voice";
import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import { readEventStream } from "@/lib/live/stream";
import type {
  LiveChatEvent,
  LiveChatMessage,
  LiveMemoryFact,
  LiveProspectCard,
  LivePublicState,
  LiveSessionSummary,
  LiveThinkingStep,
} from "@/lib/live/types";

const QUICK_ACTIONS: Array<{ label: string; icon: typeof MapPin; prompt?: string; prefill?: string }> = [
  { label: "Find businesses in an area", icon: MapPin, prefill: "Find businesses in " },
  { label: "Home-based nearby", icon: Home, prefill: "Find home-based businesses in " },
  { label: "What is at this address?", icon: Building2, prefill: "What is at " },
  { label: "Put these in walking order", icon: Footprints, prompt: "Put this list in walking order from where I am." },
  { label: "What's new on this list", icon: Newspaper, prompt: "Scan local news on the current list for recent expansions or new locations. Flag anything you can actually source next to the phone." },
  { label: "Are these real local shops?", icon: ShieldCheck, prompt: "Genuine-check the current list. Drop national chains and convenience. Tell me which ones look like real local shops." },
  { label: "Prioritize my list", icon: Sparkles, prompt: "Who is worth calling first, and why?" },
  { label: "Brief the current business", icon: Search, prompt: "Brief me on the business we are on" },
  { label: "Skip to the next one", icon: SkipForward, prompt: "Skip to the next one" },
  { label: "What do you remember?", icon: Brain, prompt: "What do you remember about my territory?" },
];


function groupSessions(sessions: LiveSessionSummary[]): SessionGroup[] {
  const now = Date.now();
  const groups: SessionGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const session of sessions) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const date = new Date(session.updatedAt).getTime();
    if (date >= today.getTime()) groups[0].items.push(session);
    else if (date >= yesterday.getTime()) groups[1].items.push(session);
    else groups[2].items.push(session);
  }
  return groups.filter((group) => group.items.length);
}

/** Neutral rank dot — strongest fit reads darkest, no status-pill candy. */
function rankTone(score: number) {
  if (score >= 75) return "bg-[#171715]";
  if (score >= 55) return "bg-[#8a8a84]";
  return "bg-[#cfcfc7]";
}

function LeadFlags({
  signals,
  compact = false,
}: {
  signals?: LiveProspectCard["signals"];
  compact?: boolean;
}) {
  if (!signals?.length) return null;
  const visible = compact
    ? signals.filter((item) => item.kind === "expansion" || item.kind === "home" || item.kind === "rival")
    : signals;
  if (!visible.length) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
      {visible.map((signal) => (
        <span
          key={signal.kind}
          title={signal.detail || signal.label}
          className={cn(
            "live-lead-flag",
            signal.kind === "expansion" && "live-lead-flag-hot",
            signal.kind === "home" && "live-lead-flag-home",
          )}
        >
          {signal.label}
        </span>
      ))}
    </span>
  );
}

function ProspectRow({
  card,
  index,
  current,
  onOpen,
}: {
  card: LiveProspectCard;
  index: number;
  current: boolean;
  onOpen: () => void;
}) {
  const expansion = card.signals?.find((item) => item.kind === "expansion");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-[11px] px-2 py-[7px] text-left transition hover:bg-[#f7f7f4]"
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", rankTone(card.score))} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[#26261f]">{card.name}</span>
      {current && (
        <span className="shrink-0 rounded-full border border-[#e2e2db] px-2 py-[2px] text-[10.5px] font-medium text-[#5f5f59]">
          On now
        </span>
      )}
      <LeadFlags signals={card.signals} compact />
      <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#f2f2ee] px-2 py-[2px] text-[10.5px] text-[#6f6f69] sm:inline-flex">
        <MapPin size={9} /> {card.distanceMiles.toFixed(1)} mi
      </span>
      <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#f2f2ee] px-2 py-[2px] text-[10.5px] text-[#6f6f69] md:inline-flex">
        {card.phone ? (
          <>
            <Phone size={9} /> {expansion ? card.phone : "Phone on file"}
          </>
        ) : (
          <>
            <Clock3 size={9} /> No phone yet
          </>
        )}
      </span>
      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-[#c2c2ba]">{index + 1}</span>
    </button>
  );
}

export function LivePage() {
  const [sessions, setSessions] = useState<LiveSessionSummary[]>([]);
  const [memory, setMemory] = useState<LiveMemoryFact[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [queue, setQueue] = useState<LivePublicState["queue"]>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [steps, setSteps] = useState<LiveThinkingStep[]>([]);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Session titles come from disk, so hold them back until hydration matches.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [listFilter, setListFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState("");
  const [composerArmed, setComposerArmed] = useState(false);
  const [holdingAddress, setHoldingAddress] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const [notice, setNotice] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const activeSession = useRef<string | null>(null);
  const followAnswer = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef("");
  const sendRef = useRef<(text?: string) => Promise<void>>(async () => {});
  const cancelVoiceRef = useRef(() => {});
  const reduceMotion = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );

  const atHome = messages.length === 0 && !busy;
  useEffect(() => { draftRef.current = draft; }, [draft]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/live/sessions");
        const payload = (await response.json()) as { sessions?: LiveSessionSummary[]; memory?: LiveMemoryFact[] };
        if (cancelled) return;
        setSessions(payload.sessions ?? []);
        setMemory(payload.memory ?? []);
      } catch {
        // First visit has no Live history.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onAddressDrop(event: Event) {
      const detail = (event as CustomEvent<{ target: AddressDropTarget; address: string }>).detail;
      if (detail.target !== "live" || !detail.address.trim()) return;
      endAddressDrag();
      void sendRef.current(`What is at ${detail.address.trim()}?`);
    }
    window.addEventListener(ADDRESS_DROP_EVENT, onAddressDrop);
    return () => window.removeEventListener(ADDRESS_DROP_EVENT, onAddressDrop);
  }, []);

  useEffect(() => {
    if (!followAnswer.current) return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "instant" });
  }, [messages, steps.length, busy, reduceMotion]);

  useEffect(() => () => {
    activeRequest.current?.abort();
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // Following the answer as it streams should not fight a rep who scrolled up.
  useEffect(() => {
    const node = scroller.current;
    if (!node || !answer) return;
    if (followAnswer.current) node.scrollTop = node.scrollHeight;
  }, [answer]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    function onDrag(event: Event) {
      const phase = (event as CustomEvent<{ phase: string }>).detail.phase;
      setHoldingAddress(phase === "start");
      if (phase === "end") setComposerArmed(false);
    }
    window.addEventListener("pai-address-drag", onDrag);
    return () => window.removeEventListener("pai-address-drag", onDrag);
  }, []);

  function identifyDroppedAddress(address: string) {
    const place = address.trim();
    if (!place) return;
    endAddressDrag();
    void send(`What is at ${place}?`);
  }

  function applyState(state: LivePublicState) {
    activeSession.current = state.session.id;
    setSessionId(state.session.id);
    setMessages(state.session.messages);
    setQueue(state.queue);
    setMemory(state.memory);
    setSessions((current) => {
      const summary = {
        id: state.session.id,
        title: state.session.title,
        updatedAt: state.session.updatedAt,
        preview: state.session.preview,
      };
      return [summary, ...current.filter((item) => item.id !== state.session.id)].slice(0, 40);
    });
  }

  function stopReply(showNotice = true) {
    requestVersion.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
    setStatus("");
    setSteps([]);
    setAnswer("");
    if (showNotice) setNotice("Stopped. Send a new direction whenever you’re ready.");
  }

  async function openSession(id: string) {
    stopReply(false);
    cancelVoiceRef.current();
    setError("");
    setNotice("");
    const version = requestVersion.current;
    try {
      const response = await fetch(`/api/live/sessions?sessionId=${encodeURIComponent(id)}`);
      const payload = (await response.json()) as { state?: LivePublicState; error?: string };
      if (version !== requestVersion.current) return;
      if (!response.ok || !payload.state) throw new Error(payload.error || "Couldn’t open that chat.");
      applyState(payload.state);
      setDraft("");
      setListOpen(false);
      followAnswer.current = true;
    } catch (error) {
      if (version === requestVersion.current) setError(error instanceof Error ? error.message : "Couldn’t open that chat.");
    }
  }

  function newChat() {
    stopReply(false);
    cancelVoiceRef.current();
    activeSession.current = null;
    setSessionId(null);
    setMessages([]);
    setQueue(null);
    setDraft("");
    setError("");
    setNotice("");
    setVoiceNotice("");
    setListOpen(false);
    setListFilter("");
    setAwayFromBottom(false);
    followAnswer.current = true;
    inputRef.current?.focus();
  }

  async function copyReply(message: LiveChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1800);
    } catch {
      setNotice("Couldn’t copy automatically. Select the reply to copy it.");
    }
  }

  async function send(text = draft) {
    const message = text.trim();
    if (!message) return;
    if (message.length > 2000) {
      setError("Keep your message under 2,000 characters.");
      return;
    }
    stopReply(false);
    const version = requestVersion.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    const localId = `local_${crypto.randomUUID()}`;
    let accepted = false;
    setDraft("");
    setError("");
    setNotice("");
    setBusy(true);
    setStatus("Thinking");
    followAnswer.current = true;
    setAwayFromBottom(false);
    setMessages((current) => [
      ...current,
      { id: localId, role: "user", content: message, createdAt: new Date().toISOString() },
    ]);
    try {
      const response = await fetch("/api/live/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSession.current, message }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = response.headers.get("content-type")?.includes("application/json")
          ? await response.json() as { error?: string } : null;
        throw new Error(payload?.error || "Live could not reply. Try again.");
      }
      let completed: LivePublicState | null = null;
      let streamedAnswer = "";
      let streamedSteps: LiveThinkingStep[] = [];
      await readEventStream<LiveChatEvent>(response, (event) => {
        if (version !== requestVersion.current) return;
        if (event.type === "session") {
          accepted = true;
          applyState(event.state);
        }
        if (event.type === "status") setStatus(event.message);
        if (event.type === "step") {
          const index = streamedSteps.findIndex((item) => item.id === event.step.id);
          streamedSteps = index >= 0
            ? streamedSteps.map((item, itemIndex) => (itemIndex === index ? event.step : item))
            : [...streamedSteps, event.step];
          setSteps(streamedSteps);
        }
        if (event.type === "delta") {
          streamedAnswer += event.text;
          setAnswer(streamedAnswer);
        }
        if (event.type === "delta_reset") {
          streamedAnswer = "";
          setAnswer("");
        }
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "complete") completed = event.state;
      });
      if (version !== requestVersion.current) return;
      if (completed) applyState(completed);
      else throw new Error("The connection ended before the reply was saved. Try your message again.");
    } catch (sendError) {
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setError(sendError instanceof Error ? sendError.message : "Live could not reply.");
      setDraft((current) => current || message);
      if (!accepted) setMessages((current) => current.filter((item) => item.id !== localId));
    } finally {
      if (version === requestVersion.current) {
        activeRequest.current = null;
        setBusy(false);
        setStatus("");
        setSteps([]);
        setAnswer("");
      }
    }
  }

  useEffect(() => { sendRef.current = send; });

  const groups = useMemo(
    () => (mounted ? groupSessions(sessions.filter((item) => item.preview !== "New chat")) : []),
    [sessions, mounted],
  );
  const current = queue?.current ?? null;
  const filteredCards = useMemo(() => {
    const cards = queue?.cards ?? [];
    const needle = listFilter.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(needle));
  }, [queue, listFilter]);

  const voiceVocabulary = useMemo(() => {
    const terms = new Set([
      "PAI",
      "Live",
      "ProspectIQ",
      "find businesses",
      "territory",
      "prioritize",
      "skip",
      "brief",
      "call list",
      "radius",
      "zip code",
    ]);
    const add = (value?: string | null) => {
      const term = value?.trim();
      if (term) terms.add(term.slice(0, 80));
    };
    add(queue?.locationLabel);
    add(queue?.category);
    add(current?.name);
    for (const card of queue?.cards ?? []) {
      add(card.name);
      add(card.category);
    }
    for (const fact of memory.slice(0, 8)) add(fact.text);
    return Array.from(terms).join(", ");
  }, [current, memory, queue]);

  const voice = useLiveVoice({
    disabled: busy,
    getDraft: () => draftRef.current,
    getVocabulary: () => voiceVocabulary,
    onNotice: (notice) => {
      setVoiceNotice(notice);
      if (!notice) setMenuOpen(false);
    },
    onSubmit: (text) => {
      setDraft("");
      void sendRef.current(text);
    },
  });
  useEffect(() => { cancelVoiceRef.current = voice.cancel; }, [voice.cancel]);

  const composerIdle =
    !draft.trim() && !focused && !busy && !voice.listening && !voice.transcribing;
  const voiceOpen = voice.listening || voice.transcribing;

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft, atHome, voiceOpen]);

  const composer = (
        <div className={cn("shrink-0", !atHome && "px-4 pb-4 sm:px-8")}>
          <div className="mx-auto w-full max-w-[720px]">
            {awayFromBottom && !atHome && <div className="mb-3 flex justify-center">
              <button type="button" className="live-jump" onClick={() => {
                followAnswer.current = true;
                setAwayFromBottom(false);
                scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduceMotion ? "instant" : "smooth" });
              }}><ArrowDown size={14} /> Latest reply</button>
            </div>}
            {notice && <p role="status" className="mb-2 text-center text-[12px] text-[#73736b]">{notice}</p>}
            {(error || voiceNotice) && (
              <p role="alert" className="mb-2 text-[12.5px] font-medium text-[#a63a31]">
                {error || voiceNotice}
              </p>
            )}

            {current && !atHome && queue && (
              <section className="live-active-lead" aria-label="Current business">
                <div className="live-queue-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(queue.currentIndex + 1) / queue.total})` }} /></div>
                <div className="live-active-lead-row">
                  <button type="button" className="live-list-toggle" aria-expanded={listOpen} aria-controls="live-queue-list" onClick={() => setListOpen((value) => !value)}>
                    <ListFilter size={16} /><span><strong>{current.name}</strong><small>{queue.currentIndex + 1} of {queue.total} · {queue.locationLabel}</small></span>
                  </button>
                  <div className="live-lead-actions">
                    {current.phone && <a href={`tel:${current.phone}`} aria-label={`Call ${current.name}`}><Phone size={14} /><span>Call</span></a>}
                    <button type="button" onClick={() => void send(`Brief me on ${current.name}`)} disabled={busy}>Brief</button>
                    <button type="button" onClick={() => void send("Skip to the next one")} disabled={busy || queue.currentIndex >= queue.total - 1}>Next <ChevronRight size={14} /></button>
                  </div>
                </div>
                {listOpen && <div id="live-queue-list" className="live-queue-list">
                  <label className="live-queue-filter"><Search size={14} /><span className="sr-only">Filter your list</span><input value={listFilter} onChange={(event) => setListFilter(event.target.value)} placeholder="Find a business in this list…" /></label>
                  {filteredCards.map((card) => <ProspectRow key={card.id} card={card} index={queue.cards.findIndex((item) => item.id === card.id)} current={card.id === current.id} onOpen={() => void send(`Tell me about ${card.name}`)} />)}
                  {!filteredCards.length && <p className="p-3 text-[13px] text-[#73736b]">No businesses match that filter.</p>}
                </div>}
              </section>
            )}

            <div className="live-composer-shell" data-voice={voiceOpen || undefined}>
              {voiceOpen ? (
                <div className="overflow-hidden rounded-[22px] bg-white">
                  <LiveVoiceEdge
                    analyserRef={voice.analyserRef}
                    onCancel={voice.cancel}
                    onFinish={voice.finish}
                    pushToTalk={voice.holding}
                    reduceMotion={reduceMotion}
                    stage={voice.stage}
                  />
                </div>
              ) : (
              <form
                data-pai-address-drop="live"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
                onDragOver={(event) => {
                  if (!acceptsAddressDrag(event) && !heldAddress()) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setComposerArmed(true);
                }}
                onDragLeave={(event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                  setComposerArmed(false);
                }}
                onDrop={(event) => {
                  if (!acceptsAddressDrag(event) && !heldAddress()) return;
                  event.preventDefault();
                  setComposerArmed(false);
                  identifyDroppedAddress(addressFromDrop(event));
                }}
                onPointerUp={() => {
                  if (!heldAddress() || document.body.dataset.paiAddressNative === "on") return;
                  dropHeldAddress("live");
                }}
                className={cn(
                  "live-composer rounded-[22px] bg-white p-2.5 transition",
                  composerArmed || holdingAddress ? "bg-[#fffaf3]" : "",
                )}
              >
                <div className="flex flex-wrap items-end gap-1.5">
                <div ref={menuRef} className="relative mb-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((value) => !value)}
                    aria-label="Quick actions"
                    aria-expanded={menuOpen}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-full transition",
                      menuOpen ? "bg-[#f2f2ee] text-[#3a3a35]" : "text-[#a4a49c] hover:bg-[#f2f2ee] hover:text-[#3a3a35]",
                    )}
                  >
                    <Plus size={17} strokeWidth={1.9} className={cn("transition-transform duration-200", menuOpen && "rotate-45")} />
                  </button>
                  {menuOpen && (
                    <div className="animate-enter absolute bottom-11 left-0 z-20 w-[248px] rounded-[16px] border border-[#eaeae4] bg-white p-1 shadow-[0_12px_40px_rgba(20,20,16,0.12)]">
                      {QUICK_ACTIONS.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            if (action.prompt) void send(action.prompt);
                            else {
                              setDraft(action.prefill ?? "");
                              inputRef.current?.focus();
                            }
                          }}
                          className="flex w-full items-center gap-2.5 rounded-[11px] px-2.5 py-2 text-left transition hover:bg-[#f7f7f4]"
                        >
                          <action.icon size={14} strokeWidth={1.8} className="shrink-0 text-[#a4a49c]" />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[#26261f]">{action.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label
                  className="relative order-first w-full min-w-0 basis-full px-2"
                >
                  <span className="sr-only">Message Live</span>
                  {holdingAddress || composerArmed ? (
                    <span className="pointer-events-none absolute inset-0 flex items-center text-[13.5px] text-[#b08958]">
                      Drop here to identify in Live
                    </span>
                  ) : (
                    !atHome && <LiveTypewriter active={mounted && composerIdle} />
                  )}
                  <textarea
                    ref={inputRef}
                    value={draft}
                    rows={atHome ? 2 : 1}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && busy) stopReply();
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    maxLength={2000}
                    placeholder={busy ? "Change direction or ask something else…" : atHome ? "Ask anything, or drop in an address…" : focused ? "Ask a question or name an area…" : ""}
                    className="max-h-[168px] min-h-[38px] w-full resize-none bg-transparent py-2 text-[14px] leading-6 text-[#1c1c19] outline-none placeholder:text-[#b0b0a8]"
                  />
                </label>
                <button
                  type="button"
                  className={cn(
                    "ml-auto mb-0.5 inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-3 transition disabled:opacity-30",
                    voice.holding
                      ? "bg-[#171715] text-white"
                      : "text-[#66685e] hover:bg-[#f2f2ee] hover:text-[#3a3a35]",
                  )}
                  aria-label="Talk to Live"
                  aria-keyshortcuts="Control"
                  aria-pressed={voice.holding || voiceOpen}
                  title="Talk to Live · hold Control"
                  onPointerDown={(event) => {
                    setMenuOpen(false);
                    voice.handlePointerDown(event);
                  }}
                  onClick={voice.handleClick}
                  disabled={busy}
                >
                  <Mic size={16} strokeWidth={1.9} /><span className="text-[12px] font-medium">Talk to Live</span>
                </button>
                {busy && <button type="button" onClick={() => stopReply()} className="live-stop" aria-label="Stop response" title="Stop response (Esc)"><Square size={13} fill="currentColor" /></button>}
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label={busy ? "Send new direction" : "Send"}
                  className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171715] text-white transition hover:bg-black disabled:bg-[#e6e6e0] disabled:text-[#b0b0a8]"
                >
                  <ArrowUp size={16} strokeWidth={2.2} />
                </button>
                </div>
              </form>
              )}
            </div>

            <p className={cn("mt-3 text-[10px] text-[#92938c]", atHome ? "flex flex-wrap justify-between gap-2 px-1" : "text-center")}>
              {busy ? "You can stop or send a new direction at any time." : "Research with public sources."}
              <span className="ml-3 hidden sm:inline text-[#8a8a84]">Hold Control to talk · Enter to send · Shift + Enter for a new line</span>
            </p>
          </div>
        </div>
  );

  return (
    <main className="live-workspace flex h-[100dvh] overflow-hidden bg-[#fbfbf9]">
      <LiveSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        groups={groups}
        sessionId={sessionId}
        onOpenSession={(id) => void openSession(id)}
        onNewChat={newChat}
        onHome={newChat}
        atHome={atHome}
        busy={busy}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex h-[72px] shrink-0 items-center gap-2 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Image
              src="/pai-logo-lockup.png"
              alt="PAI"
              width={960}
              height={321}
              className="ml-12 h-[18px] w-auto hidden sm:block lg:hidden"
              priority
            />
            {busy && <WorkingDots size={11} className="text-[#26261f] lg:hidden" />}
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto">
              <ModeSwitch small />
            </div>
          </div>
          <button
            type="button"
            onClick={newChat}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#e4e4de] bg-white px-3 text-[12px] font-semibold text-[#171715] transition hover:border-[#d4d4cc]"
          >
            <SquarePen size={13} /> New
          </button>
        </div>

        <div ref={scroller} onScroll={() => {
          const node = scroller.current;
          if (!node) return;
          const away = node.scrollHeight - node.scrollTop - node.clientHeight > 160;
          followAnswer.current = !away;
          setAwayFromBottom(away);
        }} className={cn("min-h-0 flex-1 overflow-y-auto px-4 sm:px-8", atHome && "flex flex-col")}>
          {atHome ? (
            <div className="live-welcome mx-auto my-auto w-full max-w-[720px] py-12">
              <div className="live-welcome-heading">
                <h1>What are you looking for?</h1>
              </div>
              <div className="live-home-composer">{composer}</div>
              <div className="live-starters" aria-label="Start a conversation">
                {[
                  { title: "Home-based businesses", icon: Home, prefill: "Find home-based businesses in " },
                  { title: "Look up a business", icon: Search, prefill: "Find information about " },
                  { title: "Call opener", icon: Phone, prefill: "Help me write a natural call opener for " },
                ].map((starter) => (
                  <button key={starter.title} type="button" className="live-starter" onClick={() => {
                    setDraft(starter.prefill);
                    inputRef.current?.focus();
                  }}>
                    <starter.icon size={14} strokeWidth={1.6} />
                    <span>{starter.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[720px] space-y-6 pb-8 pt-6">
              {messages.map((message, index) => {
                if (message.role === "user") {
                  return (
                    <article key={message.id} className="live-message-in flex justify-end">
                      <div className="max-w-[86%] rounded-[20px] rounded-br-[8px] bg-[#171715] px-4 py-2.5">
                        <p className="whitespace-pre-wrap text-[14.5px] leading-6 text-white">
                          <AddressText text={message.content} tone="dark" />
                        </p>
                      </div>
                    </article>
                  );
                }
                const previous = messages[index - 1];
                const elapsed = previous
                  ? Math.round((new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) / 1000)
                  : 0;
                return (
                  <article key={message.id} className="live-message-in group/reply">
                    {message.thinking?.length ? <LiveThoughtTrace steps={message.thinking} seconds={elapsed} /> : null}
                    <LiveMarkdown content={message.content} />
                    {message.sources?.length ? <LiveSources sources={message.sources} /> : null}
                    <button type="button" className="live-copy-reply" onClick={() => void copyReply(message)} aria-label={copiedId === message.id ? "Reply copied" : "Copy reply"}>
                      {copiedId === message.id ? <Check size={13} /> : <Copy size={13} />}
                      {copiedId === message.id ? "Copied" : "Copy"}
                    </button>
                  </article>
                );
              })}

              {busy && (
                <article className="animate-enter">
                  <LiveThoughtTrace steps={steps} live status={status || "Thinking"} />
                  {answer ? <LiveMarkdown content={answer} streaming /> : null}
                </article>
              )}
            </div>
          )}
        </div>

        {!atHome && composer}
      </section>
    </main>
  );
}
