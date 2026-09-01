"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ChevronsLeft, ChevronsRight, House, Search, Settings, SquarePen } from "lucide-react";

import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";
import type { LiveMemoryFact, LivePublicState, LiveSessionSummary } from "@/lib/live/types";

export type SessionGroup = { label: string; items: LiveSessionSummary[] };

const COLLAPSED_CHAT_COUNT = 14;

function capGroups(groups: SessionGroup[], limit: number) {
  let remaining = limit;
  const capped: SessionGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) break;
    const items = group.items.slice(0, remaining);
    remaining -= items.length;
    capped.push({ label: group.label, items });
  }
  return capped;
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

type NavItem = {
  key: string;
  label: string;
  icon: typeof House;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
};

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const body = (
    <>
      <Icon size={16} strokeWidth={1.7} className="shrink-0 text-[#7a7a74] group-hover:text-[#2e2e29]" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
    </>
  );
  const className = cn(
    "group flex h-[30px] items-center gap-2 rounded-[8px] text-left text-[13px] text-[#3a3a35] transition",
    collapsed ? "w-8 justify-center px-0" : "w-full px-2",
    item.active ? "bg-[#ebebe7] text-[#14140f]" : "hover:bg-[#ecece8]",
  );

  if (item.href) {
    return (
      <Link href={item.href} className={className} title={collapsed ? item.label : undefined}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={item.onSelect} className={className} title={collapsed ? item.label : undefined}>
      {body}
    </button>
  );
}

export function LiveSidebar({
  collapsed,
  onToggleCollapse,
  groups,
  sessionId,
  onOpenSession,
  onNewChat,
  onHome,
  atHome,
  busy = false,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
  groups: SessionGroup[];
  sessionId: string | null;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  onHome: () => void;
  memory: LiveMemoryFact[];
  queue: LivePublicState["queue"];
  atHome: boolean;
  busy?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const visible = showAll ? groups : capGroups(groups, COLLAPSED_CHAT_COUNT);

  const nav: NavItem[] = [
    { key: "home", label: "Home", icon: House, onSelect: onHome, active: atHome },
    { key: "new", label: "New chat", icon: SquarePen, onSelect: onNewChat },
    { key: "search", label: "Search", icon: Search, href: "/" },
  ];

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-[#ecece8] bg-[#f7f7f4] transition-[width] duration-300 ease-out lg:flex",
        collapsed ? "w-[60px] px-2" : "w-[252px] px-2",
      )}
    >
      <div className={cn("flex h-[72px] shrink-0 items-center", collapsed ? "flex-col justify-center gap-1" : "justify-between px-1")}>
        <Link
          href="/"
          className={cn("flex min-w-0 items-center gap-2", collapsed && "justify-center")}
          aria-label="PAI home"
        >
          {collapsed ? (
            <Image src="/pai-logo-icon.png" alt="PAI" width={462} height={321} className="h-[26px] w-auto" priority />
          ) : (
            <Image src="/pai-logo-lockup.png" alt="PAI" width={960} height={321} className="h-[34px] w-auto" priority />
          )}
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#a4a49c] transition hover:bg-[#ecece8] hover:text-[#3a3a35]"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className={cn("flex flex-col pb-3", collapsed && "items-center")}>
        {nav.map((item) => (
          <NavRow key={item.key} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto pt-1 scrollbar-none">
        {collapsed ? null : visible.length === 0 ? (
          <p className="px-2 text-[12px] leading-5 text-[#a4a49c]">Your chats with Live show up here.</p>
        ) : (
          <>
            <p className="px-2 pb-1.5 text-[11px] font-medium tracking-[0.01em] text-[#b0b0a8]">Chats</p>
            {visible.map((group) => (
              <div key={group.label} className="mb-1">
                {group.items.map((item) => {
                  const active = item.id === sessionId;
                  const working = active && busy;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpenSession(item.id)}
                      title={item.title}
                      className={cn(
                        "flex h-[30px] w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] leading-5 tracking-[-0.01em] transition",
                        active ? "bg-[#e8e8e4] text-[#14140f]" : "text-[#4c4c46] hover:bg-[#ecece8]",
                      )}
                    >
                      {working ? <WorkingDots size={12} className="text-[#3a3a35]" /> : null}
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#b0b0a8]">{relativeTime(item.updatedAt)}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {total > COLLAPSED_CHAT_COUNT && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mb-2 flex w-full items-center gap-1 rounded-[8px] px-2 py-[5px] text-left text-[12px] text-[#8a8a84] transition hover:bg-[#ecece8] hover:text-[#3a3a35]"
              >
                <ChevronDown size={12} className={cn("transition-transform duration-200", showAll && "rotate-180")} />
                {showAll ? "Show less" : `Show ${total - COLLAPSED_CHAT_COUNT} more`}
              </button>
            )}
          </>
        )}
      </div>

      <div className={cn("flex h-[44px] shrink-0 items-center", collapsed && "justify-center")}>
        <NavRow item={{ key: "settings", label: "Settings", icon: Settings, href: "/" }} collapsed={collapsed} />
      </div>
    </aside>
  );
}
