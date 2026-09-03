"use client";

import { Fragment, createContext, useContext, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

import { AddressChip, isStreetAddress } from "@/components/live/address-chip";
import { WorkingDots } from "@/components/live/working-dots";
import { cn } from "@/components/ui";

const PHONE =
  /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const URL = /https?:\/\/[^\s)<]+/gi;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const STREET =
  /\d{1,6}\s+[A-Za-z0-9'.#-]+(?:\s+[A-Za-z0-9'.#-]+){0,4}\s+(?:Rd|Road|St|Street|Ave|Avenue|Blvd|Boulevard|Ln|Lane|Dr|Drive|Ct|Court|Cir|Circle|Way|Pl|Place|Pkwy|Parkway|Hwy|Highway|Ter|Terrace|Trl|Trail)\b\.?(?:\s*(?:Ste\.?|Suite|Unit|#)\s*[\w-]+)?(?:,\s*[A-Za-z][A-Za-z .'-]{1,28})?(?:,\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?/g;

const linkClass =
  "underline decoration-[#c8c8c0] decoration-[1.5px] underline-offset-[3px] transition hover:decoration-[#5f5f59]";

const StreamingContext = createContext(false);

/**
 * While an answer is streaming, each new word fades up on its own. Keys are
 * positional, so words already on screen keep their identity and never replay
 * the animation when the next chunk arrives.
 */
function Words({ value }: { value: string }) {
  const streaming = useContext(StreamingContext);
  if (!streaming || !value) return <>{value}</>;
  const parts = value.split(/(\s+)/);
  return (
    <>
      {parts.map((part, index) =>
        part && !/^\s+$/.test(part) ? (
          <span key={index} className="live-word">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** Bare URLs, emails, phones, and street addresses — addresses can be picked up. */
function linkifyPlain(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(`${URL.source}|${EMAIL.source}|${PHONE.source}|${STREET.source}`, "gi");
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) {
      nodes.push(<Words key={`${keyPrefix}-w${index}`} value={text.slice(last, match.index)} />);
    }
    const value = match[0];
    const trimmed = value.replace(/[.,;:]+$/, "");
    const trailing = value.slice(trimmed.length);

    if (isStreetAddress(trimmed)) {
      nodes.push(<AddressChip key={`${keyPrefix}-addr${index}`} value={trimmed} />);
      if (trailing) nodes.push(trailing);
      last = match.index + value.length;
      index += 1;
      continue;
    }

    const href = /^https?:/i.test(trimmed)
      ? trimmed
      : trimmed.includes("@")
        ? `mailto:${trimmed}`
        : `tel:${trimmed.replace(/[^\d+]/g, "")}`;

    nodes.push(
      <a
        key={`${keyPrefix}-a${index}`}
        href={href}
        {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
        className={linkClass}
      >
        {trimmed}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = match.index + value.length;
    index += 1;
  }

  if (last < text.length) nodes.push(<Words key={`${keyPrefix}-wt`} value={text.slice(last)} />);
  return nodes;
}

/**
 * Inline span parsing. Code runs first so nothing inside a code span is treated
 * as markup, and `_` is deliberately not an emphasis marker so identifiers and
 * URLs survive untouched.
 */
const INLINE = new RegExp(
  [
    /\\([\\*`~[\]])/.source,
    /`([^`\n]+)`/.source,
    /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|tel:[^)\s]+|mailto:[^)\s]+)\)/.source,
    /\*\*([^*\n]+)\*\*|__([^_\n]+)__/.source,
    /~~([^~\n]+)~~/.source,
    /\*([^*\n]+)\*/.source,
  ].join("|"),
  "g",
);

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(INLINE.source, "g");
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(...linkifyPlain(text.slice(last, match.index), `${keyPrefix}-p${index}`));
    const [, escaped, code, linkText, linkHref, boldStar, boldUnderscore, struck, italic] = match;
    const key = `${keyPrefix}-${index}`;

    if (escaped) {
      nodes.push(escaped);
    } else if (code) {
      nodes.push(
        <code
          key={key}
          className="rounded-[5px] border border-[#e9e9e3] bg-[#f4f4f0] px-[0.34em] py-[0.09em] text-[0.88em] text-[#2c2c26]"
        >
          {code}
        </code>,
      );
    } else if (linkText && linkHref) {
      nodes.push(
        <a
          key={key}
          href={linkHref}
          {...(linkHref.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
          className={cn("font-medium", linkClass)}
        >
          {linkText}
        </a>,
      );
    } else if (boldStar || boldUnderscore) {
      nodes.push(
        <strong key={key} className="font-semibold text-[#14140f]">
          {inline(boldStar || boldUnderscore, `${key}s`)}
        </strong>,
      );
    } else if (struck) {
      nodes.push(
        <span key={key} className="text-[#9a9a92] line-through decoration-[#cfcfc7]">
          {inline(struck, `${key}s`)}
        </span>,
      );
    } else if (italic) {
      nodes.push(
        <em key={key} className="italic text-[#3a3a35]">
          {inline(italic, `${key}s`)}
        </em>,
      );
    }

    last = match.index + match[0].length;
    index += 1;
  }

  if (last < text.length) nodes.push(...linkifyPlain(text.slice(last), `${keyPrefix}-t`));
  return nodes;
}

type Align = "left" | "center" | "right";

type ListItem = { checked: boolean | null; blocks: Block[] };

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "hr" }
  | { kind: "code"; language: string | null; text: string; open: boolean }
  | { kind: "table"; head: string[]; align: Align[]; rows: string[][] };

const BULLET = /^(\s*)([-*+•])[ \t]+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)][ \t]+(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*$/;
const FENCE = /^\s*(`{3,}|~{3,})[ \t]*([\w+#.-]*)[ \t]*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^\s*>[ \t]?(.*)$/;
const TASK = /^\[([ xX])\][ \t]+/;

const indentOf = (line: string) => (line.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
const isTableRow = (line: string) => /^\s*\|.*\|?\s*$/.test(line) && line.includes("|");
const isTableDivider = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes("-");

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function alignmentsFrom(divider: string): Align[] {
  return splitRow(divider).map((cell) => {
    if (/^:.*:$/.test(cell)) return "center";
    if (/:$/.test(cell)) return "right";
    return "left";
  });
}

function dedent(lines: string[], amount: number) {
  return lines.map((line) => (indentOf(line) >= amount ? line.slice(amount) : line.trimStart()));
}

/** Collects one list, recursing so nested bullets and multi-paragraph items survive. */
function parseList(lines: string[], start: number): { block: Block; next: number } {
  const first = lines[start];
  const ordered = ORDERED.test(first) && !BULLET.test(first);
  const baseIndent = indentOf(first);
  const items: ListItem[] = [];
  let index = start;
  let startNumber = 1;

  while (index < lines.length) {
    const line = lines[index];
    const match = ordered ? ORDERED.exec(line) : BULLET.exec(line);
    if (!match || indentOf(line) !== baseIndent) break;
    if (ordered && items.length === 0) startNumber = Number(match[2]) || 1;

    const body = [match[3]];
    const contentIndent = match[1].length + match[2].length + 1;
    index += 1;

    // Keep pulling lines that belong to this item: deeper indentation, or blank
    // lines followed by deeper indentation.
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) {
        const after = lines[index + 1];
        if (after && after.trim() && indentOf(after) > baseIndent) {
          body.push("");
          index += 1;
          continue;
        }
        break;
      }
      if (indentOf(next) > baseIndent) {
        body.push(next);
        index += 1;
        continue;
      }
      break;
    }

    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].replace(TASK, "");

    items.push({
      checked: task ? task[1].toLowerCase() === "x" : null,
      blocks: parse([body[0], ...dedent(body.slice(1), contentIndent)].join("\n")),
    });

    // A single blank line between items keeps them in the same list.
    if (index < lines.length && !lines[index].trim()) {
      const after = lines[index + 1];
      const continues = after && (ordered ? ORDERED : BULLET).test(after) && indentOf(after) === baseIndent;
      if (continues) index += 1;
    }
  }

  return { block: { kind: "list", ordered, start: startNumber, items }, next: index };
}

function parse(content: string): Block[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const closer = fence[1][0];
      const body: string[] = [];
      index += 1;
      let closed = false;
      while (index < lines.length) {
        if (new RegExp(`^\\s*${closer}{3,}\\s*$`).test(lines[index])) {
          closed = true;
          index += 1;
          break;
        }
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({
        kind: "code",
        language: fence[2] || null,
        text: body.join("\n").replace(/\n+$/, ""),
        open: !closed,
      });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "h",
        level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])?.[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "quote", blocks: parse(quoted.join("\n")) });
      continue;
    }

    if (isTableRow(line) && isTableRow(lines[index + 1] ?? "") && isTableDivider(lines[index + 1] ?? "")) {
      const head = splitRow(line);
      const align = alignmentsFrom(lines[index + 1]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && isTableRow(lines[index]) && !isTableDivider(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", head, align, rows });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const { block, next } = parseList(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (
        !candidate.trim() ||
        FENCE.test(candidate) ||
        RULE.test(candidate) ||
        HEADING.test(candidate) ||
        QUOTE.test(candidate) ||
        BULLET.test(candidate) ||
        ORDERED.test(candidate) ||
        isTableRow(candidate)
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
  }

  return blocks;
}

function Paragraph({ text, keyPrefix }: { text: string; keyPrefix: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, lineIndex) => (
        <Fragment key={`${keyPrefix}-l${lineIndex}`}>
          {lineIndex > 0 && <br />}
          {inline(line, `${keyPrefix}-l${lineIndex}`)}
        </Fragment>
      ))}
    </>
  );
}

function CodeBlock({ language, text }: { language: string | null; text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission denied; the text is still selectable.
    }
  }

  return (
    <div className="group overflow-hidden rounded-[14px] border border-[#23231f] bg-[#171715]">
      <div className="flex items-center justify-between border-b border-[#2c2c27] px-3 py-1.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#7d7d75]">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium text-[#9a9a92] transition hover:bg-[#26261f] hover:text-[#f4f4ef]"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-[12.5px] leading-[1.62] text-[#f0f0ea]">
        <code>{text}</code>
      </pre>
    </div>
  );
}

const HEADING_CLASS: Record<1 | 2 | 3 | 4, string> = {
  1: "text-[19px] font-semibold leading-[1.3] tracking-[-0.024em] text-[#14140f]",
  2: "text-[16px] font-semibold leading-[1.35] tracking-[-0.02em] text-[#14140f]",
  3: "text-[14.5px] font-semibold leading-[1.4] tracking-[-0.015em] text-[#14140f]",
  4: "text-[12px] font-semibold uppercase tracking-[0.06em] text-[#8a8a84]",
};

function Blocks({ blocks, keyPrefix, dense }: { blocks: Block[]; keyPrefix: string; dense?: boolean }) {
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const key = `${keyPrefix}-b${blockIndex}`;
        const first = blockIndex === 0;
        const spacing = dense ? "mt-1.5" : "mt-3.5";

        if (block.kind === "h") {
          // Answers live inside a page that already owns its h1, so shift a
          // markdown level down one to keep the document outline honest.
          const Tag = (["h2", "h3", "h4", "h5"] as const)[block.level - 1];
          return (
            <Tag key={key} className={cn(HEADING_CLASS[block.level], !first && (dense ? "mt-2" : "mt-5"))}>
              {inline(block.text, key)}
            </Tag>
          );
        }

        if (block.kind === "hr") {
          return <hr key={key} className={cn("border-0 border-t border-[#ecece6]", !first && "mt-4")} />;
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className={cn(
                "border-l-2 border-[#dcdcd4] pl-3.5 text-[#4a4a44] italic",
                !first && spacing,
              )}
            >
              <Blocks blocks={block.blocks} keyPrefix={key} dense />
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <div key={key} className={cn(!first && spacing)}>
              <CodeBlock language={block.language} text={block.text} />
            </div>
          );
        }

        if (block.kind === "p") {
          return (
            <p key={key} className={cn(!first && spacing)}>
              <Paragraph text={block.text} keyPrefix={key} />
            </p>
          );
        }

        if (block.kind === "table") {
          return (
            <ol key={key} className={cn("space-y-1.5", !first && spacing)}>
              {block.rows.map((row, rowIndex) => (
                <li key={`${key}-r${rowIndex}`} className="flex gap-2.5">
                  <span className="w-[18px] shrink-0 text-right text-[13px] font-medium tabular-nums text-[#a4a49c]">
                    {rowIndex + 1}.
                  </span>
                  <p className="min-w-0 flex-1 leading-[1.68] text-[#1c1c19]">
                    {row.map((cell, cellIndex) => {
                      const label = block.head[cellIndex]?.replace(/\*+/g, "").trim() ?? "";
                      if (!cell.trim() || /^(#|business|name)$/i.test(cell.trim())) return null;
                      return (
                        <Fragment key={`${key}-r${rowIndex}c${cellIndex}`}>
                          {cellIndex > 0 && <span className="text-[#c2c2ba]"> — </span>}
                          {cellIndex === 0 ? (
                            <strong className="font-semibold text-[#14140f]">{inline(cell, `${key}-r${rowIndex}c${cellIndex}`)}</strong>
                          ) : /\b(miles|distance)\b/i.test(label) && !/\bmi\b/i.test(cell) ? (
                            <>{inline(cell, `${key}-r${rowIndex}c${cellIndex}`)} mi</>
                          ) : (
                            inline(cell, `${key}-r${rowIndex}c${cellIndex}`)
                          )}
                        </Fragment>
                      );
                    })}
                  </p>
                </li>
              ))}
            </ol>
          );
        }

        const ListTag = block.ordered ? "ol" : "ul";
        return (
          <ListTag
            key={key}
            {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}
            className={cn("space-y-1.5", !first && (dense ? "mt-1.5" : "mt-3"))}
          >
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-i${itemIndex}`} className="flex gap-2.5">
                {item.checked != null ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-[5px] inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[4px] border",
                      item.checked ? "border-[#171715] bg-[#171715] text-white" : "border-[#cfcfc7] bg-white",
                    )}
                  >
                    {item.checked && <Check size={9} strokeWidth={3} />}
                  </span>
                ) : (
                  <span
                    aria-hidden={!block.ordered}
                    className={
                      block.ordered
                        ? "w-[18px] shrink-0 text-right text-[13px] font-medium tabular-nums text-[#a4a49c]"
                        : "mt-[10px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#cfcfc7]"
                    }
                  >
                    {block.ordered ? `${block.start + itemIndex}.` : null}
                  </span>
                )}
                <div className={cn("min-w-0 flex-1", item.checked && "text-[#9a9a92] line-through decoration-[#dcdcd4]")}>
                  <Blocks blocks={item.blocks} keyPrefix={`${key}-i${itemIndex}`} dense />
                </div>
              </li>
            ))}
          </ListTag>
        );
      })}
    </>
  );
}

export function LiveMarkdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const blocks = parse(content);

  return (
    <StreamingContext.Provider value={streaming}>
      <div className="text-[15px] leading-[1.68] tracking-[-0.008em] text-[#1c1c19] [&_a]:break-words">
        <Blocks blocks={blocks} keyPrefix="md" />
        {streaming && (
          <WorkingDots size={12} className="ml-1.5 inline-block align-middle text-[#3a3a35]" />
        )}
      </div>
    </StreamingContext.Provider>
  );
}
