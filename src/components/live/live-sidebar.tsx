"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronsLeft, ChevronsRight, House, Menu, MessageSquare, Search, SquarePen, X } from "lucide-react";

import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import type { LiveSessionSummary } from "@/lib/live/types";

export type SessionGroup = { label: string; items: LiveSessionSummary[] };
const COLLAPSED_CHAT_COUNT = 14;

function capGroups(groups: SessionGroup[], limit: number) {
  let remaining = limit;
  return groups.flatMap((group) => {
    const items = group.items.slice(0, remaining);
    remaining -= items.length;
    return items.length ? [{ ...group, items }] : [];
  });
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function LiveSidebar({
  collapsed, onToggleCollapse, groups, sessionId, onOpenSession, onNewChat, onHome, atHome, busy = false,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  groups: SessionGroup[];
  sessionId: string | null;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  onHome: () => void;
  atHome: boolean;
  busy?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const search = query.trim().toLocaleLowerCase();
  const filtered = groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !search || `${item.title} ${item.preview}`.toLocaleLowerCase().includes(search)),
  })).filter((group) => group.items.length);
  const visible = showAll || search ? filtered : capGroups(filtered, COLLAPSED_CHAT_COUNT);
  const select = (action: () => void) => {
    dialogRef.current?.close();
    action();
  };

  const content = (compact: boolean, mobile = false) => (
    <>
      <div className={cn("flex h-[76px] shrink-0 items-center", compact ? "flex-col justify-center gap-1" : "justify-between px-2")}>
        <Link href="/" aria-label="PAI home" className="shrink-0 rounded-lg">
          <Image src={compact ? "/pai-logo-icon.png" : "/pai-logo-lockup.png"} alt="PAI"
            width={compact ? 462 : 960} height={321} className={compact ? "h-6 w-auto" : "h-7 w-auto"} priority />
        </Link>
        <button type="button" onClick={mobile ? () => dialogRef.current?.close() : onToggleCollapse}
          aria-label={mobile ? "Close sidebar" : compact ? "Expand sidebar" : "Collapse sidebar"}
          className={cn("flex shrink-0 items-center justify-center rounded-lg text-[#76796c] transition hover:bg-[#e9ebe2] hover:text-[#30372a]", compact ? "h-6 w-11" : "h-11 w-11")}>
          {mobile ? <X size={18} /> : compact ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <nav aria-label="Workspace" className="space-y-1">
        <button type="button" onClick={() => select(onNewChat)} aria-label="New chat" title={compact ? "New chat" : undefined}
          className={cn("live-sidebar-new flex h-11 items-center gap-2.5 rounded-xl bg-[#252e21] text-[13px] font-medium text-white transition hover:bg-[#3b4b31] active:scale-[0.98]", compact ? "w-11 justify-center" : "mb-3 w-full px-3")}>
          <SquarePen size={17} strokeWidth={1.7} />{!compact && <>New chat<span aria-hidden="true" className="ml-auto text-lg font-normal text-[#c8d3bb]">+</span></>}
        </button>
        <button type="button" onClick={() => select(onHome)} aria-label="Home" aria-current={atHome ? "page" : undefined} title={compact ? "Home" : undefined}
          className={cn("flex h-11 items-center gap-2.5 rounded-xl text-[13px] transition", compact ? "w-11 justify-center" : "w-full px-3", atHome ? "bg-[#e8ecdf] font-medium text-[#34482b]" : "text-[#5d6155] hover:bg-[#eceee6]")}>
          <House size={17} strokeWidth={1.7} />{!compact && "Home"}
        </button>
        <Link href="/" aria-label="Find businesses" title={compact ? "Find businesses" : undefined}
          className={cn("flex h-11 items-center gap-2.5 rounded-xl text-[13px] text-[#5d6155] transition hover:bg-[#eceee6]", compact ? "w-11 justify-center" : "px-3")}>
          <Search size={17} strokeWidth={1.7} />{!compact && "Find businesses"}
        </Link>
      </nav>

      {!compact && <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between px-3">
          <h2 className="text-[11px] font-semibold tracking-[0.08em] text-[#646b59] uppercase">Your conversations</h2>
          <span className="text-[11px] tabular-nums text-[#7b816f]">{total}</span>
        </div>
        <label className="mx-1 mb-4 flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#e1e5d8] bg-white/70 px-2.5 focus-within:border-[#839664] focus-within:ring-2 focus-within:ring-[#839664]/15">
          <Search size={14} className="shrink-0 text-[#7b816f]" aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats"
            aria-label="Search chats" className="min-w-0 flex-1 bg-transparent text-[12px] text-[#3e4535] outline-none placeholder:text-[#7c8273]" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear chat search" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#646b59] hover:bg-[#eceee6]"><X size={14} /></button>}
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto pb-3 scrollbar-none">
          {!visible.length ? <p role="status" className="px-3 py-4 text-[12px] leading-5 text-[#707764]">{search ? "No conversations match your search." : "Start a conversation. You can pick it up here anytime."}</p> : visible.map((group) => (
            <section key={group.label} className="mb-4">
              <h3 className="px-3 pb-1.5 text-[10px] font-medium text-[#7c8273]">{group.label}</h3>
              {group.items.map((item) => {
                const active = item.id === sessionId;
                return <button key={item.id} type="button" onClick={() => select(() => onOpenSession(item.id))}
                  aria-current={active ? "page" : undefined} title={item.title}
                  className={cn("group my-0.5 flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-2.5 text-left text-[12px] transition", active ? "border-[#d5ddc6] bg-white font-medium text-[#34482b] shadow-[0_2px_5px_#303c2010]" : "border-transparent text-[#555d49] hover:bg-[#e9ede1]")}>
                  {active && busy ? <WorkingDots size={14} /> : <MessageSquare size={14} strokeWidth={1.6} className={cn("shrink-0", active ? "text-[#6a8945]" : "text-[#9ba38d]")} />}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 text-[10px] font-normal tabular-nums text-[#7c8273]">{relativeTime(item.updatedAt)}</span>
                </button>;
              })}
            </section>
          ))}
          {!search && total > COLLAPSED_CHAT_COUNT && <button type="button" onClick={() => setShowAll((value) => !value)}
            className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-[12px] text-[#646f55] transition hover:bg-[#e9ede1]">
            <ChevronDown size={14} className={cn("transition-transform duration-200", showAll && "rotate-180")} />
            {showAll ? "Show less" : `Show ${total - COLLAPSED_CHAT_COUNT} more`}
          </button>}
        </div>
      </div>}
      <div className={cn("mt-auto flex shrink-0 items-center gap-2.5 border-t border-[#e1e5d8] py-4", compact ? "justify-center" : "px-3")}>
        <span className="h-2 w-2 rounded-full bg-[#7c9658]" aria-hidden="true" />
        {!compact && <><span className="text-[12px] font-medium text-[#46513b]">PAI Live</span><span className="ml-auto text-[10px] text-[#77806c]">Your workspace</span></>}
      </div>
    </>
  );

  return <>
    <aside aria-label="Sidebar" className={cn("live-sidebar hidden h-full shrink-0 flex-col border-r border-[#e3e7db] bg-[#f4f6ef] px-3 transition-[width] duration-300 ease-out lg:flex", collapsed ? "w-[68px]" : "w-[272px]")}>
      {content(collapsed)}
    </aside>
    <button type="button" onClick={() => dialogRef.current?.showModal()} aria-label="Open sidebar"
      className="absolute top-[14px] left-3 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-[#e3e7db] bg-[#f4f6ef] text-[#46513b] lg:hidden">
      <Menu size={20} />
    </button>
    <dialog ref={dialogRef} aria-label="Conversations" onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
      className="live-sidebar-drawer fixed inset-y-0 left-0 m-0 h-[100dvh] max-h-none w-[min(320px,88vw)] max-w-none border-0 bg-[#f4f6ef] p-0 text-[#30372a] shadow-xl backdrop:bg-[#202719]/30 backdrop:backdrop-blur-sm">
      <div className="flex h-full flex-col px-3">{content(false, true)}</div>
    </dialog>
  </>;
}
