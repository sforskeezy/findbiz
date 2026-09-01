"use client";

import { useEffect, useState } from "react";

import { cn } from "@/components/ui";

export type PageTransitionKind = "mode";

type Listener = (kind: PageTransitionKind) => void;

const listeners = new Set<Listener>();

/**
 * Set by whichever control started the navigation and read once by the next
 * `PageTransition` that mounts, so the incoming page knows which entrance to
 * play. Module state is enough: only one page shell mounts per navigation.
 */
let incoming: PageTransitionKind | null = null;

/**
 * Announce a navigation before pushing the route. The page shell that is still
 * on screen plays its exit while Next.js resolves the next route.
 */
export function beginPageTransition(kind: PageTransitionKind) {
  incoming = kind;
  for (const listener of listeners) listener(kind);
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const [enter] = useState(() => incoming);
  const [exit, setExit] = useState<PageTransitionKind | null>(null);

  useEffect(() => {
    incoming = null;
    const listener = (kind: PageTransitionKind) => setExit(kind);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div
      className={cn(
        "min-h-0",
        exit === "mode" ? "page-exit-mode" : enter === "mode" ? "page-enter-mode" : "page-enter",
      )}
    >
      {children}
    </div>
  );
}
