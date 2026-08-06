"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BorderBeam } from "border-beam";
import { ChevronDown, Search } from "lucide-react";

import { ProspectHeader } from "@/components/prospect-header";
import { cn } from "@/components/ui";

const radii = [
  { value: "0.25", label: "0.25 mi" },
  { value: "0.5", label: "0.5 mi" },
  { value: "1", label: "1 mi" },
  { value: "2", label: "2 mi" },
  { value: "5", label: "5 mi" },
];

export function SearchLanding() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState("0.5");
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (address.trim().length < 6) {
      setError("Enter a street address with ZIP code.");
      return;
    }
    setError("");
    setLeaving(true);
    router.push(`/search?address=${encodeURIComponent(address.trim())}&radius=${radius}`);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f4f1]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-[#f4f4f1]/55 backdrop-blur-[18px]" />
        <div className="ambient-orb absolute -left-[12%] top-[8%] h-[520px] w-[520px] rounded-full bg-[#d5dae8]/80 blur-[120px]" />
        <div className="ambient-orb-delayed absolute -right-[10%] bottom-[0%] h-[560px] w-[560px] rounded-full bg-white/90 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.55),transparent_55%)]" />
      </div>

      <ProspectHeader />

      <section className="relative z-10 flex min-h-[calc(100vh-112px)] items-center justify-center px-5 pb-24 pt-10 sm:px-8">
        <div className="w-full max-w-[820px] text-center">
          <p className="text-[13px] font-medium tracking-[-0.01em] text-[#6f6f69]">
            Business prospect research
          </p>
          <h1 className="mx-auto mt-4 max-w-[760px] text-[42px] font-semibold leading-[1.03] tracking-[-0.055em] text-[#11110f] sm:text-[62px] lg:text-[72px]">
            Find businesses near an address.
          </h1>
          <p className="mx-auto mt-6 max-w-[610px] text-sm leading-6 text-[#6e6e68] sm:text-base">
            Enter an address, choose a nearby business, then research its sales fit and broadband availability.
          </p>

          <form onSubmit={submit} className="mx-auto mt-10 max-w-[760px]">
            <BorderBeam
              size="md"
              colorVariant="ocean"
              theme="light"
              active={focused || Boolean(address) || leaving}
              duration={2.4}
              brightness={1.05}
              strength={focused ? 1 : 0.72}
              borderRadius={24}
              className="w-full"
            >
              <div
                className={cn(
                  "rounded-[24px] border border-white/80 bg-white/78 p-2.5 shadow-[0_24px_80px_rgba(25,25,20,0.10)] backdrop-blur-2xl transition duration-300",
                  focused && "bg-white/90 shadow-[0_28px_90px_rgba(25,25,20,0.14)]",
                )}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="flex h-14 min-w-0 flex-1 items-center gap-3 px-3 sm:px-4">
                    <Search size={18} strokeWidth={1.7} className="shrink-0 text-[#6d6d67]" />
                    <span className="sr-only">Street address</span>
                    <input
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-[#1c1c19] outline-none focus:outline-none focus-visible:outline-none placeholder:font-normal placeholder:text-[#999992]"
                      placeholder="Street address or street + ZIP"
                      autoComplete="street-address"
                      autoFocus
                    />
                  </label>
                  <div className="flex gap-2">
                    <label className="relative flex h-12 flex-1 items-center sm:w-[128px] sm:flex-none">
                      <span className="sr-only">Search radius</span>
                      <select
                        value={radius}
                        onChange={(event) => setRadius(event.target.value)}
                        className="h-full w-full appearance-none rounded-full border border-[#e4e4df]/90 bg-[#f7f7f4]/90 pl-4 pr-9 text-xs font-semibold text-[#252522] outline-none transition hover:bg-white focus:border-[#c9d2ef] focus:bg-white"
                      >
                        {radii.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a84]"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={leaving}
                      className="h-12 flex-1 whitespace-nowrap rounded-full bg-[#151513] px-6 text-xs font-semibold text-white shadow-sm transition hover:bg-black disabled:opacity-60 sm:flex-none"
                    >
                      {leaving ? "Opening search…" : "Find businesses"}
                    </button>
                  </div>
                </div>
              </div>
            </BorderBeam>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-xs font-medium text-[#a63a31]">
              {error}
            </p>
          )}

          <p className="mx-auto mt-6 max-w-[520px] text-[10px] leading-5 text-[#898983]">
            Built on open public data only — no scraping, no internal systems.{" "}
            <a
              href={process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/sforskeezy/findbiz"}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[#5f5f59] underline-offset-2 transition hover:text-[#151513] hover:underline"
            >
              Source on GitHub
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
