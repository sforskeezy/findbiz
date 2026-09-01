"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Brain, ChevronDown, ChevronsLeft, ChevronsRight, House, ListChecks, Search, Settings, SquarePen } from "lucide-react";

import { cn } from "@/components/ui";
import type { LiveMemoryFact, LivePublicState, LiveSessionSummary } from "@/lib/live/types";

export type SessionGroup = { label: string; items: LiveSessionSummary[] };

const COLLAPSED_CHAT_COUNT = 4;

/** Trim to the newest N chats overall, keeping the day headings that still have rows. */
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

type NavItem = {
  key: string;
  label: string;
  icon: typeof House;
  href?: string;
  onSelect?: () => void;
  active?: boolean;
  badge?: string;
};

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const body = (
    <>
      <Icon size={15} strokeWidth={1.8} className="shrink-0 text-[#8a8a84] group-hover:text-[#2e2e29]" />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge && <span className="shrink-0 text-[11px] tabular-nums text-[#a4a49c]">{item.badge}</span>}
        </>
      )}
    </>
  );
  const className = cn(
    "group flex h-8 items-center gap-2.5 rounded-[8px] text-left text-[13px] font-medium text-[#3a3a35] transition",
    collapsed ? "w-8 justify-center px-0" : "w-full px-2",
    item.active ? "bg-white shadow-[0_1px_2px_rgba(20,20,16,0.06)]" : "hover:bg-[#efefeb]",
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
  memory,
  queue,
  atHome,
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
}) {
  const [showAll, setShowAll] = useState(false);
  const total = groups.reduce((count, group) => count + group.items.length, 0);
  const visible = showAll ? groups : capGroups(groups, COLLAPSED_CHAT_COUNT);

  const nav: NavItem[] = [
    { key: "home", label: "Home", icon: House, onSelect: onHome, active: atHome },
    { key: "new", label: "New chat", icon: SquarePen, onSelect: onNewChat },
    { key: "list", label: "My list", icon: ListChecks, onSelect: onHome, badge: queue?.total ? String(queue.total) : undefined },
    { key: "memory", label: "Remembered", icon: Brain, onSelect: onHome, badge: memory.length ? String(memory.length) : undefined },
    { key: "search", label: "Normal search", icon: Search, href: "/" },
  ];

  return (
    <aside
      className={cn(
        "hidden h-full shrink-0 flex-col border-r border-[#e9e9e3] bg-[#f5f5f2] transition-[width] duration-300 ease-out lg:flex",
        collapsed ? "w-[60px] px-2.5" : "w-[248px] px-2.5",
      )}
    >
      <div className={cn("flex h-[72px] shrink-0 items-center", collapsed ? "flex-col justify-center gap-1" : "justify-between")}>
        <Link
          href="/"
          className={cn("flex min-w-0 items-center gap-2", collapsed && "justify-center")}
          aria-label="PAI home"
        >
          <Image
            src="/PAINEWLOGO.png"
            alt="PAI"
            width={1536}
            height={1024}
            className={collapsed ? "h-8 w-auto" : "h-12 w-auto"}
            priority
          />
        </Link>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-[#a4a49c] transition hover:bg-[#eaeae4] hover:text-[#3a3a35]"
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>

      <nav className={cn("flex flex-col pb-2", collapsed && "items-center")}>
        {nav.map((item) => (
          <NavRow key={item.key} item={item} collapsed={collapsed} />
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#e9e9e3] pt-2 scrollbar-none">
        {collapsed ? null : visible.length === 0 ? (
          <p className="px-2 text-[12px] leading-5 text-[#a4a49c]">Your chats with Live show up here.</p>
        ) : (
          <>
            {visible.map((group) => (
              <div key={group.label} className="mb-2.5">
                <p className="px-2 pb-1 text-[11px] font-medium text-[#b0b0a8]">{group.label}</p>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onOpenSession(item.id)}
                    title={item.title}
                    className={cn(
                      "block w-full truncate rounded-[8px] px-2 py-[5px] text-left text-[13px] font-medium leading-5 tracking-[-0.01em] transition",
                      item.id === sessionId ? "bg-white text-[#14140f] shadow-[0_1px_2px_rgba(20,20,16,0.06)]" : "text-[#4c4c46] hover:bg-[#efefeb]",
                    )}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            ))}
            {total > COLLAPSED_CHAT_COUNT && (
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mb-2 flex w-full items-center gap-1 rounded-[8px] px-2 py-[5px] text-left text-[12px] font-medium text-[#8a8a84] transition hover:bg-[#efefeb] hover:text-[#3a3a35]"
              >
                <ChevronDown size={12} className={cn("transition-transform duration-200", showAll && "rotate-180")} />
                {showAll ? "Show less" : `Show ${total - COLLAPSED_CHAT_COUNT} more`}
              </button>
            )}
          </>
        )}
      </div>

      <div className={cn("flex h-[44px] shrink-0 items-center border-t border-[#e9e9e3]", collapsed && "justify-center")}>
        <NavRow item={{ key: "settings", label: "Settings", icon: Settings, href: "/" }} collapsed={collapsed} />
      </div>
    </aside>
  );
}
