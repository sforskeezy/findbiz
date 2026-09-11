"use client";

import { Fragment, type ReactNode } from "react";

import { CopyContact } from "@/components/copy-contact";

import { cn } from "@/components/ui";

const STREET =
  /\d{1,6}\s+[A-Za-z0-9'.#-]+(?:\s+[A-Za-z0-9'.#-]+){0,4}\s+(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Cir|Circle|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Trl|Trail)\b\.?(?:\s*(?:Ste\.?|Suite|Unit|#)\s*[\w-]+)?(?:,\s*[A-Za-z][A-Za-z .'-]{1,28})?(?:,\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/g;

export function isStreetAddress(value: string) {
  return new RegExp(`^(?:${STREET.source})$`, "i").test(value.trim());
}

export function extractStreetAddresses(text: string) {
  return text.match(new RegExp(STREET.source, "gi"))?.map((item) => item.replace(/[.,;:]+$/, "")) ?? [];
}

/** Addresses copy directly without changing the current mode. */
export function AddressChip({ value, tone = "light" }: { value: string; tone?: "light" | "dark" }) {
  return <CopyContact value={value} className={cn("rounded px-[0.2em] underline decoration-dotted underline-offset-[3px]", tone === "dark" ? "bg-white/12 text-white" : "text-[#2c2c26] decoration-[#c8c8c0] hover:bg-[#e9e9e2]")} />;
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
  const phone = /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/;
  const pattern = new RegExp(`${STREET.source}|${phone.source}`, "gi");
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
      nodes.push(<CopyContact key={`phone-${index}`} value={trimmed} phone />);
    }
    if (trailing) nodes.push(trailing);
    last = match.index + value.length;
    index += 1;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes.map((node, i) => (typeof node === "string" ? <Fragment key={i}>{node}</Fragment> : node))}</>;
}
