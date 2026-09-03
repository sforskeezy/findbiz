"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import {
  ArrowUp,
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

import { BorderBeam } from "border-beam";
import { ModeSwitch } from "@/components/prospect-header";
import { AddressText, acceptsAddressDrag, addressFromDrop, endAddressDrag, heldAddress } from "@/components/live/address-chip";
import { LiveMarkdown } from "@/components/live/live-markdown";
import { LiveSidebar, type SessionGroup } from "@/components/live/live-sidebar";
import { LiveSources } from "@/components/live/live-sources";
import { LiveThinking, LiveThoughtTrace } from "@/components/live/live-thinking";
import { LiveTypewriter } from "@/components/live/live-typewriter";
import { LiveVoiceEdge } from "@/components/live/live-voice";
import { useLiveVoice } from "@/components/live/use-live-voice";
import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import type {
  LiveChatMessage,
  LiveMemoryFact,
  LiveProspectCard,
  LivePublicState,
  LiveSessionSummary,
  LiveSource,
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

type StreamEvent =
  | { type: "status"; message: string }
  | { type: "step"; step: LiveThinkingStep }
  | { type: "sources"; sources: LiveSource[] }
  | { type: "delta"; text: string }
  | { type: "delta_reset" }
  | { type: "complete"; state: LivePublicState }
  | { type: "error"; error: string };

async function readStream(response: Response, onEvent: (event: StreamEvent) => void) {
  if (!response.body) throw new Error("Live did not return a stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (chunk: string) => {
    const line = chunk.split("\n").find((item) => item.startsWith("data: "));
    if (!line) return;
    try {
      onEvent(JSON.parse(line.slice(6)) as StreamEvent);
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      for (const chunk of buffer.split("\n\n")) {
        if (chunk.trim()) consume(chunk);
      }
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) consume(chunk);
  }
}

function groupSessions(sessions: LiveSessionSummary[]): SessionGroup[] {
  const now = Date.now();
  const groups: SessionGroup[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const session of sessions) {
    const age = now - new Date(session.updatedAt).getTime();
    if (age < 20 * 60 * 60 * 1000) groups[0].items.push(session);
    else if (age < 48 * 60 * 60 * 1000) groups[1].items.push(session);
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

function HomeCard({
  title,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  icon: typeof MapPin;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[16px] border border-[#eaeae4] bg-white p-3.5 shadow-[0_1px_2px_rgba(20,20,16,0.04)]",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 pb-2.5">
        <Icon size={13} strokeWidth={1.9} className="text-[#a4a49c]" />
        <h2 className="text-[12.5px] font-medium text-[#6f6f69]">{title}</h2>
      </div>
      {children}
    </section>
  );
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
  draftRef.current = draft;

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
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, status, steps.length, busy]);

  // Following the answer as it streams should not fight a rep who scrolled up.
  useEffect(() => {
    const node = scroller.current;
    if (!node || !answer) return;
    if (node.scrollHeight - node.scrollTop - node.clientHeight < 160) node.scrollTop = node.scrollHeight;
  }, [answer]);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

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

  async function openSession(id: string) {
    cancelVoiceRef.current();
    const response = await fetch(`/api/live/sessions?sessionId=${encodeURIComponent(id)}`);
    const payload = (await response.json()) as { state?: LivePublicState };
    if (payload.state) applyState(payload.state);
  }

  function newChat() {
    cancelVoiceRef.current();
    setSessionId(null);
    setMessages([]);
    setQueue(null);
    setSteps([]);
    setAnswer("");
    setError("");
    inputRef.current?.focus();
  }

  async function send(text = draft) {
    const message = text.replace(/\s+/g, " ").trim();
    if (!message || busy) return;
    setDraft("");
    setError("");
    setSteps([]);
    setAnswer("");
    setBusy(true);
    setStatus("Thinking");
    setMessages((current) => [
      ...current,
      { id: `local_${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() },
    ]);
    try {
      const response = await fetch("/api/live/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message }),
      });
      if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Live could not reply.");
      }
      let completed: LivePublicState | null = null;
      let streamedAnswer = "";
      let streamedSteps: LiveThinkingStep[] = [];
      let streamedSources: LiveSource[] = [];
      await readStream(response, (event) => {
        if (event.type === "status") setStatus(event.message);
        if (event.type === "step") {
          streamedSteps = [...streamedSteps, event.step];
          setSteps(streamedSteps);
        }
        if (event.type === "sources") {
          streamedSources = event.sources;
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
      if (completed) {
        applyState(completed);
      } else if (streamedAnswer.trim()) {
        setMessages((current) => [
          ...current,
          {
            id: `local_${Date.now()}`,
            role: "assistant",
            content: streamedAnswer,
            createdAt: new Date().toISOString(),
            sources: streamedSources.length ? streamedSources : undefined,
            thinking: streamedSteps.length ? streamedSteps : undefined,
          },
        ]);
      } else {
        throw new Error("Live ended before a reply came back.");
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Live could not reply.");
    } finally {
      setBusy(false);
      setStatus("");
      setSteps([]);
      setAnswer("");
      inputRef.current?.focus();
    }
  }

  sendRef.current = send;

  const groups = useMemo(
    () => (mounted ? groupSessions(sessions.filter((item) => item.preview !== "New chat")) : []),
    [sessions, mounted],
  );
  const current = queue?.current ?? null;
  const recent = useMemo(() => {
    const seen = new Set<string>();
    return (groups[0]?.items ?? [])
      .filter((item) => {
        const key = item.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 4);
  }, [groups]);
  // The territory already has its own row in the card, so drop the fact that duplicates it.
  const facts = useMemo(() => memory.filter((item) => item.kind !== "territory").slice(0, 4), [memory]);
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
    onNotice: setVoiceNotice,
    onSubmit: (text) => {
      setDraft("");
      void sendRef.current(text);
    },
  });
  cancelVoiceRef.current = voice.cancel;

  useEffect(() => {
    if (!voice.listening && !voice.transcribing) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") voice.cancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [voice.cancel, voice.listening, voice.transcribing]);

  const composerIdle =
    !draft.trim() && !focused && !busy && !voice.listening && !voice.transcribing;
  const voiceOpen = voice.listening || voice.transcribing;

  return (
    <main className="flex h-[100dvh] overflow-hidden bg-[#fbfbf9]">
      <LiveSidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        groups={groups}
        sessionId={sessionId}
        onOpenSession={(id) => void openSession(id)}
        onNewChat={newChat}
        onHome={newChat}
        memory={memory}
        queue={queue}
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
              className="h-[22px] w-auto lg:hidden"
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

        <div ref={scroller} className={cn("min-h-0 flex-1 overflow-y-auto px-4 sm:px-8", atHome && "flex flex-col")}>
          {atHome ? (
            <div className="mx-auto my-auto w-full max-w-[720px] py-8">
              <h1 className="text-center text-[30px] font-semibold leading-[1.18] tracking-[-0.035em] sm:text-[38px]">
                <span className="live-hero-mark">Welcome back</span>
                <br />
                <span className="text-[#b4b4ac]">What are we working today?</span>
              </h1>

              <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
                <HomeCard title="Pick up where you left off" icon={Clock3}>
                  {recent.length ? (
                    <ul className="-mx-1.5">
                      {recent.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => void openSession(item.id)}
                            className="group flex w-full items-center gap-2.5 rounded-[9px] px-1.5 py-[7px] text-left transition hover:bg-[#f7f7f4]"
                          >
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#f2f2ee] text-[#8a8a84]">
                              <Sparkles size={11} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[#26261f]">{item.title}</span>
                            <ChevronRight size={13} className="shrink-0 text-[#cfcfc7] transition group-hover:text-[#8a8a84]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] leading-6 text-[#a4a49c]">
                      Nothing yet. Name an area below and Live will build your first list.
                    </p>
                  )}
                </HomeCard>

                <HomeCard title="What Live remembers" icon={Brain}>
                  {queue?.locationLabel && (
                    <div className="mb-2.5 flex items-start gap-2.5 rounded-[12px] bg-[#f7f7f4] px-2.5 py-2">
                      <MapPin size={12} strokeWidth={1.9} className="mt-[3px] shrink-0 text-[#8a8a84]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold tracking-[-0.01em] text-[#14140f]">
                          {queue.locationLabel}
                        </p>
                        <p className="text-[11.5px] leading-5 text-[#a4a49c]">
                          {queue.total} on the list · {queue.radiusMiles} mi radius
                        </p>
                      </div>
                    </div>
                  )}
                  {facts.length ? (
                    <ul className="space-y-1">
                      {facts.map((item) => (
                        <li key={item.id} className="flex gap-2 text-[12.5px] leading-5 text-[#5f5f59]">
                          <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[#cfcfc7]" />
                          <span className="min-w-0 flex-1">{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : queue?.locationLabel ? null : (
                    <p className="text-[13px] leading-6 text-[#a4a49c]">
                      Live keeps your territory, the industries you sell, and who you already called.
                    </p>
                  )}
                </HomeCard>

              </div>

              {queue && queue.cards.length > 0 && (
                <section className="mt-3 rounded-[18px] border border-[#eaeae4] bg-white p-4 shadow-[0_1px_2px_rgba(20,20,16,0.04)]">
                  <div className="flex flex-wrap items-center gap-2 pb-3">
                    <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.01em] text-[#14140f]">
                      <MapPin size={13} strokeWidth={1.9} className="text-[#a4a49c]" />
                      Your list
                      <span className="text-[12px] font-medium text-[#a4a49c]">{queue.total}</span>
                    </h2>
                    <label className="ml-auto flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[#eaeae4] bg-[#fbfbf9] px-3 sm:max-w-[240px]">
                      <Search size={12} className="shrink-0 text-[#b4b4ac]" />
                      <span className="sr-only">Filter your list</span>
                      <input
                        value={listFilter}
                        onChange={(event) => setListFilter(event.target.value)}
                        placeholder="Search for name…"
                        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#26261f] outline-none placeholder:text-[#b4b4ac]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void send("Who is worth calling first, and why?")}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#e2e2db] px-3 text-[12px] font-medium text-[#3a3a35] transition hover:border-[#cfcfc7] hover:bg-[#f7f7f4]"
                    >
                      <Sparkles size={12} className="text-[#8a8a84]" /> Prioritize
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void send(
                          "Scan local news on the current list for recent expansions or new locations. Flag anything you can actually source next to the phone.",
                        )
                      }
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[#e2e2db] px-3 text-[12px] font-medium text-[#3a3a35] transition hover:border-[#cfcfc7] hover:bg-[#f7f7f4]"
                    >
                      <Newspaper size={12} className="text-[#8a8a84]" /> What's new
                    </button>
                  </div>
                  <div className="-mx-2">
                    {filteredCards.map((card, index) => (
                      <ProspectRow
                        key={card.id}
                        card={card}
                        index={index}
                        current={card.id === current?.id}
                        onOpen={() => void send(`Tell me about ${card.name}`)}
                      />
                    ))}
                    {filteredCards.length === 0 && (
                      <p className="px-2 py-2 text-[12.5px] text-[#a4a49c]">Nothing on the list matches that.</p>
                    )}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-[720px] space-y-6 pb-8 pt-6">
              {messages.map((message, index) => {
                if (message.role === "user") {
                  return (
                    <article key={message.id} className="flex justify-end">
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
                  <article key={message.id} className="animate-enter">
                    {message.thinking?.length ? <LiveThoughtTrace steps={message.thinking} seconds={elapsed} /> : null}
                    <LiveMarkdown content={message.content} />
                    {message.sources?.length ? <LiveSources sources={message.sources} /> : null}
                  </article>
                );
              })}

              {busy && (
                <article className="animate-enter">
                  {answer ? (
                    <>
                      {steps.length > 0 && <LiveThoughtTrace steps={steps} />}
                      <LiveMarkdown content={answer} streaming />
                    </>
                  ) : (
                    <LiveThinking steps={steps} status={status} />
                  )}
                </article>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 px-4 pb-4 sm:px-8">
          <div className="mx-auto w-full max-w-[720px]">
            {(error || voiceNotice) && (
              <p role="alert" className="mb-2 text-[12.5px] font-medium text-[#a63a31]">
                {error || voiceNotice}
              </p>
            )}

            {current && !atHome && (
              <div className="group/lead mb-1.5 flex items-center gap-2 px-1">
                <p className="min-w-0 flex-1 truncate text-[11.5px] text-[#b4b4ac]">
                  <span className="font-medium text-[#8a8a84]">{current.name}</span>
                  <span className="text-[#c8c8c0]">
                    {" "}
                    · {queue && queue.total > 0 ? `${queue.currentIndex + 1}/${queue.total}` : "now"} · {current.category}
                  </span>
                </p>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-[#c2c2ba] opacity-0 transition-opacity duration-200 group-hover/lead:opacity-100 group-focus-within/lead:opacity-100">
                  {current.phone && (
                    <a href={`tel:${current.phone}`} title={`Call ${current.phone}`} className="transition hover:text-[#171715]">
                      Call
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      void send(
                        `What's new with ${current.name}? Scan local news for this one business — openings, a new location, a move, new ownership, or a community event.`,
                      )
                    }
                    disabled={busy}
                    className="transition hover:text-[#171715] disabled:opacity-30"
                  >
                    New
                  </button>
                  <button
                    type="button"
                    onClick={() => void send("Skip to the next one")}
                    disabled={busy || (queue?.currentIndex ?? 0) >= (queue?.total ?? 1) - 1}
                    className="transition hover:text-[#171715] disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            <BorderBeam
              size="md"
              colorVariant="sunset"
              theme="light"
              active={busy || focused || Boolean(draft.trim()) || voiceOpen}
              duration={busy || voiceOpen ? 1.5 : 2.4}
              brightness={busy || voice.listening ? 1.25 : 1.05}
              saturation={1.45}
              hueRange={18}
              strength={busy || voiceOpen ? 1 : focused ? 0.9 : 0.7}
              borderRadius={24}
              className="w-full"
            >
              {voiceOpen ? (
                <div className="overflow-hidden rounded-[24px] border border-[#e6e6e0] bg-white shadow-[0_2px_6px_rgba(20,20,16,0.04),0_16px_40px_rgba(20,20,16,0.06)]">
                  <LiveVoiceEdge
                    analyserRef={voice.analyserRef}
                    onCancel={voice.cancel}
                    onFinish={voice.finish}
                    reduceMotion={reduceMotion}
                    stage={voice.stage}
                  />
                </div>
              ) : (
              <form
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
                onDragLeave={() => setComposerArmed(false)}
                onDrop={(event) => {
                  if (!acceptsAddressDrag(event) && !heldAddress()) return;
                  event.preventDefault();
                  setComposerArmed(false);
                  identifyDroppedAddress(addressFromDrop(event));
                }}
                className={cn(
                  "rounded-[24px] border bg-white p-1.5 shadow-[0_2px_6px_rgba(20,20,16,0.04),0_16px_40px_rgba(20,20,16,0.06)] transition",
                  composerArmed || holdingAddress ? "border-[#e0c19a] bg-[#fffaf3]" : "border-[#e6e6e0]",
                )}
              >
                <div className="flex items-end gap-1.5">
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
                  className="relative min-w-0 flex-1"
                  onPointerUp={() => {
                    if (!heldAddress() || document.body.dataset.paiAddressNative === "on") return;
                    identifyDroppedAddress(heldAddress());
                  }}
                >
                  <span className="sr-only">Message Live</span>
                  {holdingAddress || composerArmed ? (
                    <span className="pointer-events-none absolute inset-0 flex items-center text-[13.5px] text-[#b08958]">
                      Drop here to identify in Live
                    </span>
                  ) : (
                    <LiveTypewriter active={mounted && composerIdle} />
                  )}
                  <textarea
                    ref={inputRef}
                    value={draft}
                    rows={1}
                    onChange={(event) => setDraft(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder=""
                    className="max-h-[168px] min-h-[38px] w-full resize-none bg-transparent py-2 text-[14px] leading-6 text-[#1c1c19] outline-none placeholder:text-[#b0b0a8]"
                  />
                </label>
                <button
                  type="button"
                  className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#a4a49c] transition hover:bg-[#f2f2ee] hover:text-[#3a3a35] disabled:opacity-30"
                  aria-label="Talk to Live"
                  title="Talk to Live"
                  onPointerDown={(event) => {
                    setMenuOpen(false);
                    voice.handlePointerDown(event);
                  }}
                  onClick={voice.handleClick}
                  disabled={busy}
                >
                  <Mic size={16} strokeWidth={1.9} />
                </button>
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  aria-label="Send"
                  className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171715] text-white transition hover:bg-black disabled:bg-[#e6e6e0] disabled:text-[#b0b0a8]"
                >
                  <ArrowUp size={16} strokeWidth={2.2} />
                </button>
                </div>
              </form>
              )}
            </BorderBeam>

            <p className="mt-2.5 text-center text-[11px] text-[#b4b4ac]">
              Live works from public listings. It will not invent businesses.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
