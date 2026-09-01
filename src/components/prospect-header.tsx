"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil } from "lucide-react";

import { beginPageTransition } from "@/components/page-transition";
import { cn } from "@/components/ui";

const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/sforskeezy/findbiz";

const ROTATING_LINES = ["Find prospects", "Check broadband", "Research sales fit"];

function GitHubIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function RotatingTagline() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const id = window.setInterval(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((current) => (current + 1) % ROTATING_LINES.length);
        setVisible(true);
      }, 280);
    }, 2600);

    return () => window.clearInterval(id);
  }, []);

  return (
    <span
      className="hidden text-[12px] font-semibold tracking-[-0.02em] text-[#5f5f59] lg:inline"
      aria-live="polite"
    >
      <span
        className="inline-block transition duration-300 ease-out"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateY(0)" : "translateY(6px)",
        }}
      >
        {ROTATING_LINES[index]}
      </span>
    </span>
  );
}

function RewriteBackLink({ href, label }: { href: string; label: string }) {
  const [display, setDisplay] = useState(label);
  const [phase, setPhase] = useState<"idle" | "erase" | "write">("idle");
  const timersRef = useRef<number[]>([]);

  function clearTimers() {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }

  function schedule(fn: () => void, delay: number) {
    timersRef.current.push(window.setTimeout(fn, delay));
  }

  function startRewrite() {
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    if (phase !== "idle") return;

    clearTimers();
    setPhase("erase");

    const eraseStep = 32;
    const typeStep = 40;

    for (let i = 0; i <= label.length; i += 1) {
      schedule(() => setDisplay(label.slice(0, label.length - i)), i * eraseStep);
    }

    const eraseDone = label.length * eraseStep + 120;
    schedule(() => setPhase("write"), eraseDone);

    for (let i = 1; i <= label.length; i += 1) {
      schedule(() => setDisplay(label.slice(0, i)), eraseDone + i * typeStep);
    }

    schedule(() => {
      setDisplay(label);
      setPhase("idle");
    }, eraseDone + label.length * typeStep + 60);
  }

  function stopRewrite() {
    clearTimers();
    setDisplay(label);
    setPhase("idle");
  }

  useEffect(() => () => clearTimers(), []);

  const rewriting = phase !== "idle";
  const progress = label.length ? display.length / label.length : 1;

  return (
    <Link
      href={href}
      aria-label={label}
      className="group inline-flex items-center text-xs font-semibold text-[#666660] transition hover:text-[#151513] focus:outline-none focus-visible:outline-none"
      onMouseLeave={stopRewrite}
    >
      <span className="relative inline-grid tracking-[-0.01em]">
        {/* Width lock so the header doesn't jump while the pencil writes. */}
        <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-1 whitespace-nowrap" aria-hidden="true">
          {label}
          <Pencil size={14} strokeWidth={2} />
        </span>

        <span className="col-start-1 row-start-1 inline-flex items-end whitespace-nowrap" aria-hidden="true">
          <span className="relative">
            {display}
            <span
              className="pointer-events-none absolute bottom-[-2px] left-0 h-px origin-left bg-current/35 transition-[width] duration-75"
              style={{ width: rewriting ? `${progress * 100}%` : "0%" }}
            />
          </span>
          <span
            className="relative ml-0.5 inline-flex shrink-0"
            onMouseEnter={startRewrite}
            onFocus={startRewrite}
          >
            <Pencil
              size={14}
              strokeWidth={2}
              aria-hidden="true"
              className={
                phase === "erase"
                  ? "pencil-erase text-[#151513]"
                  : phase === "write"
                    ? "pencil-write text-[#151513]"
                    : "transition duration-300 group-hover:-rotate-12"
              }
            />
          </span>
        </span>
      </span>
    </Link>
  );
}

type Mode = "normal" | "live";

const MODES: Array<{ mode: Mode; href: string; label: string }> = [
  { mode: "normal", href: "/", label: "Normal" },
  { mode: "live", href: "/live", label: "Live" },
];

function modeForPath(pathname: string): Mode {
  return pathname.startsWith("/live") || pathname.startsWith("/radar") ? "live" : "normal";
}

/**
 * Shared Normal/Live switch. Reads the route itself so callers only pick a size.
 * The indicator moves the moment you click rather than when the next route
 * commits, so the pill is the one thing that holds still across the navigation.
 */
export function ModeSwitch({ small = false }: { small?: boolean }) {
  const pathname = usePathname();
  const routeMode = modeForPath(pathname);
  const [pending, setPending] = useState<{ target: Mode; from: Mode } | null>(null);

  // The optimistic pill position holds only while we are still on the route the
  // click came from. Nothing has to clear it: each mode renders its own switch,
  // so arriving anywhere else mounts a fresh one with no pending state.
  const mode = pending && pending.from === routeMode ? pending.target : routeMode;

  return (
    <div
      className={cn(
        "relative inline-grid shrink-0 grid-cols-2 items-center bg-[#ededea] p-[3px]",
        small ? "rounded-[10px]" : "rounded-[11px] sm:rounded-[13px]",
      )}
      role="group"
      aria-label="PAI mode"
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc(50%-3px)] border border-[#e2e2dd] bg-white shadow-[0_1px_2px_rgba(20,20,16,0.10),0_2px_6px_rgba(20,20,16,0.05)] transition-transform duration-[460ms] ease-[cubic-bezier(0.34,1.26,0.38,1)] motion-reduce:transition-none",
          small ? "rounded-[8px]" : "rounded-[9px] sm:rounded-[11px]",
        )}
        style={{ transform: mode === "live" ? "translateX(100%)" : "translateX(0)" }}
      />
      {MODES.map((item) => (
        <Link
          key={item.mode}
          href={item.href}
          aria-current={mode === item.mode ? "page" : undefined}
          onClick={() => {
            if (item.mode === routeMode) return;
            setPending({ target: item.mode, from: routeMode });
            beginPageTransition("mode");
          }}
          className={cn(
            "relative inline-flex items-center justify-center font-medium tracking-[-0.01em] transition-colors duration-200",
            small ? "h-7 px-3.5 text-[12.5px]" : "h-8 px-3.5 text-[13px] sm:h-10 sm:px-6 sm:text-[15px]",
            mode === item.mode ? "text-[#14140f]" : "text-[#6f6f69] hover:text-[#26261f]",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function ProspectHeader({
  backHref,
  backLabel,
  wide = false,
  compact = false,
}: {
  backHref?: string;
  backLabel?: string;
  wide?: boolean;
  compact?: boolean;
}) {
  const pathname = usePathname();
  const liveActive = pathname.startsWith("/live") || pathname.startsWith("/radar");

  return (
    <header
      className={cn(
        "relative z-20 mx-auto flex w-full items-center justify-between px-5 sm:px-8",
        compact ? "h-[72px] sm:h-20" : "h-28",
        wide || compact ? "max-w-[1400px]" : "max-w-[1180px]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-5">
        <Link href="/" className="flex shrink-0 items-center" aria-label="PAI home">
          <Image
            src="/pai-logo-lockup.png"
            alt="PAI"
            width={960}
            height={321}
            className={compact ? "h-[19px] w-auto sm:h-6" : "h-6 w-auto sm:h-9"}
            priority
          />
        </Link>
        <ModeSwitch />
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        {backHref ? (
          <RewriteBackLink href={backHref} label={backLabel ?? "Back"} />
        ) : (
          <div className="flex items-center gap-3 sm:gap-4">
            {!liveActive && <RotatingTagline />}
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 rounded-full border border-[#e0e0db] bg-white/70 px-3.5 py-2 text-xs font-semibold text-[#44443f] backdrop-blur transition hover:border-[#cfcfc9] hover:text-[#151513] sm:inline-flex"
              aria-label="View source on GitHub"
            >
              <GitHubIcon />
              GitHub
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
