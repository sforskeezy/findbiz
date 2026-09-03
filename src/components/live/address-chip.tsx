"use client";

import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { cn } from "@/components/ui";

export const ADDRESS_DRAG_TYPE = "application/x-pai-address";
const ADDRESS_DRAG_FLAG = "paiAddressDrag";

const STREET =
  /\d{1,6}\s+[A-Za-z0-9'.#-]+(?:\s+[A-Za-z0-9'.#-]+){0,4}\s+(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Cir|Circle|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Trl|Trail)\b\.?(?:\s*(?:Ste\.?|Suite|Unit|#)\s*[\w-]+)?(?:,\s*[A-Za-z][A-Za-z .'-]{1,28})?(?:,\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/g;

export function isStreetAddress(value: string) {
  return new RegExp(`^(?:${STREET.source})$`, "i").test(value.trim());
}

export function extractStreetAddresses(text: string) {
  return text.match(new RegExp(STREET.source, "gi"))?.map((item) => item.replace(/[.,;:]+$/, "")) ?? [];
}

export function beginAddressDrag(address: string) {
  document.body.dataset[ADDRESS_DRAG_FLAG] = "on";
  document.body.dataset.paiAddressValue = address;
  window.dispatchEvent(new CustomEvent("pai-address-drag", { detail: { address, phase: "start" } }));
}

export function endAddressDrag() {
  delete document.body.dataset[ADDRESS_DRAG_FLAG];
  delete document.body.dataset.paiAddressValue;
  window.dispatchEvent(new CustomEvent("pai-address-drag", { detail: { phase: "end" } }));
}

export function heldAddress() {
  return document.body.dataset.paiAddressValue?.trim() || "";
}

export function acceptsAddressDrag(event: DragEvent) {
  return event.dataTransfer.types.includes(ADDRESS_DRAG_TYPE);
}

export function addressFromDrop(event: DragEvent) {
  return event.dataTransfer.getData(ADDRESS_DRAG_TYPE).trim() || heldAddress();
}

/** Question-mark orb that holds the sentence open while the address is in the air. */
export function AddressOrb({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={cn("live-address-orb", size === "sm" && "live-address-orb-sm")} aria-hidden="true">
      <i />
      <i />
      <i />
      <span>?</span>
    </span>
  );
}

/**
 * A street address you can pick up. Click or drag lifts it out of the sentence
 * and leaves the orb in its place. Drop it on Normal for the full report, or
 * on the composer to identify it in Live.
 */
export function AddressChip({
  value,
  tone = "light",
}: {
  value: string;
  tone?: "light" | "dark";
}) {
  const [lifted, setLifted] = useState(false);
  const dragged = useRef(false);

  function lift(event?: DragEvent<HTMLSpanElement>) {
    beginAddressDrag(value);
    setLifted(true);
    if (!event) return;
    dragged.current = true;
    document.body.dataset.paiAddressNative = "on";
    event.dataTransfer.setData(ADDRESS_DRAG_TYPE, value);
    event.dataTransfer.setData("text/plain", value);
    event.dataTransfer.effectAllowed = "copy";
    const ghost = document.getElementById("pai-address-ghost");
    if (ghost) event.dataTransfer.setDragImage(ghost, 16, 16);
  }

  function restore() {
    delete document.body.dataset.paiAddressNative;
    endAddressDrag();
    setLifted(false);
  }

  useEffect(() => {
    function onDrag(event: Event) {
      const detail = (event as CustomEvent<{ address?: string; phase: string }>).detail;
      if (detail.phase === "end") setLifted(false);
      if (detail.phase === "start" && detail.address !== value) setLifted(false);
    }
    window.addEventListener("pai-address-drag", onDrag);
    return () => window.removeEventListener("pai-address-drag", onDrag);
  }, [value]);

  return (
    <span
      draggable
      role="button"
      tabIndex={0}
      title="Pick me up. Drop on Normal for a full report, or on the chat box to identify here."
      onDragStart={(event) => lift(event)}
      onDragEnd={restore}
      onClick={(event) => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (lifted) restore();
        else lift();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (lifted) restore();
          else lift();
        }
        if (event.key === "Escape" && lifted) restore();
      }}
      className={cn(
        "cursor-grab select-none rounded-[5px] px-[0.2em] transition-colors active:cursor-grabbing",
        lifted && "align-middle",
        !lifted && tone === "light" &&
          "bg-[#f3f3ee] text-[#2c2c26] underline decoration-dotted decoration-[#c8c8c0] underline-offset-[3px] hover:bg-[#e9e9e2] hover:decoration-[#8a8a84]",
        !lifted && tone === "dark" &&
          "bg-white/12 text-white underline decoration-dotted decoration-white/45 underline-offset-[3px] hover:bg-white/18",
      )}
    >
      {lifted ? <AddressOrb /> : value}
    </span>
  );
}

/** Walks a string and wraps every street address in an AddressChip. */
export function AddressText({
  text,
  tone = "light",
}: {
  text: string;
  tone?: "light" | "dark";
}) {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(STREET.source, "gi");
  const isStreet = new RegExp(`^(?:${STREET.source})$`, "i");
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const value = match[0];
    const trimmed = value.replace(/[.,;:]+$/, "");
    const trailing = value.slice(trimmed.length);
    if (isStreet.test(trimmed)) {
      nodes.push(<AddressChip key={`addr-${index}`} value={trimmed} tone={tone} />);
    } else {
      nodes.push(trimmed);
    }
    if (trailing) nodes.push(trailing);
    last = match.index + value.length;
    index += 1;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((node, i) => (typeof node === "string" ? <Fragment key={i}>{node}</Fragment> : node))}</>;
}

/**
 * Follows the pointer while an address is held, so the pickup reads as an
 * object in the hand rather than a disappearing line of text.
 */
export function AddressDragGhost() {
  const [held, setHeld] = useState("");
  const [native, setNative] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });

  useEffect(() => {
    function onDrag(event: Event) {
      const detail = (event as CustomEvent<{ address?: string; phase: string }>).detail;
      setHeld(detail.phase === "start" && detail.address ? detail.address : "");
      if (detail.phase === "end") setNative(false);
    }
    function onMove(event: PointerEvent) {
      setPoint({ x: event.clientX, y: event.clientY });
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") endAddressDrag();
    }
    function onNativeStart() {
      setNative(true);
    }
    function onNativeEnd() {
      setNative(false);
    }
    window.addEventListener("pai-address-drag", onDrag);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragstart", onNativeStart);
    window.addEventListener("dragend", onNativeEnd);
    return () => {
      window.removeEventListener("pai-address-drag", onDrag);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragstart", onNativeStart);
      window.removeEventListener("dragend", onNativeEnd);
    };
  }, []);

  return (
    <>
      <span id="pai-address-ghost" className="pointer-events-none fixed -left-[200px] top-0" aria-hidden="true">
        <AddressOrb />
      </span>
      {held && !native ? (
        <span
          className="pointer-events-none fixed z-[80] flex items-center gap-1.5 rounded-full border border-[#ead7be] bg-white/95 px-2.5 py-1 text-[12px] font-medium text-[#3a3a35] shadow-[0_8px_24px_rgba(20,20,16,0.12)]"
          style={{ left: point.x + 14, top: point.y + 14 }}
        >
          <AddressOrb size="sm" />
          <span className="max-w-[220px] truncate">{held}</span>
        </span>
      ) : null}
    </>
  );
}
