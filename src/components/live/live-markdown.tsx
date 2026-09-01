"use client";

import { Fragment, type ReactNode } from "react";

const PHONE =
  /(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const URL = /https?:\/\/[^\s)<]+/gi;

function linkifyPlain(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = new RegExp(`${URL.source}|${PHONE.source}`, "gi");
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const value = match[0];
    const href = /^https?:/i.test(value) ? value.replace(/[.,;:]+$/, "") : `tel:${value.replace(/[^\d+]/g, "")}`;
    nodes.push(
      <a
        key={`${keyPrefix}-a${index}`}
        href={href}
        {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
        className="underline decoration-[#d8d8d0] underline-offset-[3px] transition hover:decoration-[#8a8a84]"
      >
        {value}
      </a>,
    );
    last = match.index + value.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** Bold, italic, inline code, markdown links, plus phones and URLs. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) nodes.push(...linkifyPlain(text.slice(last, match.index), `${keyPrefix}-p${index}`));
    if (match[1] && match[2]) {
      nodes.push(
        <a
          key={`${keyPrefix}-l${index}`}
          href={match[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium underline decoration-[#d8d8d0] underline-offset-[3px] transition hover:decoration-[#8a8a84]"
        >
          {match[1]}
        </a>,
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-[#14140f]">
          {match[3]}
        </strong>,
      );
    } else if (match[4]) {
      nodes.push(
        <em key={`${keyPrefix}-i${index}`} className="italic text-[#3a3a35]">
          {match[4]}
        </em>,
      );
    } else if (match[5]) {
      nodes.push(
        <code key={`${keyPrefix}-c${index}`} className="rounded-[5px] bg-[#f2f2ee] px-1 py-px text-[13px]">
          {match[5]}
        </code>,
      );
    }
    last = match.index + match[0].length;
    index += 1;
  }
  if (last < text.length) nodes.push(...linkifyPlain(text.slice(last), `${keyPrefix}-t`));
  return nodes;
}

function splitRow(line: string) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "hr" }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

function parse(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      index += 1;
      const body: string[] = [];
      while (index < lines.length && !/^```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1].length === 2 ? 2 : 3, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }

    if (isTableRow(line)) {
      const table = [];
      while (index < lines.length && isTableRow(lines[index])) {
        table.push(lines[index]);
        index += 1;
      }
      const rows = table.filter((row) => !isDivider(row)).map(splitRow);
      const [head, ...body] = rows;
      if (head) blocks.push({ kind: "table", head, rows: body });
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && (/^\s*[-*•]\s+/.test(lines[index]) || (/^\s{2,}\S/.test(lines[index]) && items.length))) {
        if (/^\s*[-*•]\s+/.test(lines[index])) items.push(lines[index].replace(/^\s*[-*•]\s+/, ""));
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && (/^\s*\d+[.)]\s+/.test(lines[index]) || (/^\s{2,}\S/.test(lines[index]) && items.length))) {
        if (/^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index].replace(/^\s*\d+[.)]\s+/, ""));
        else items[items.length - 1] += ` ${lines[index].trim()}`;
        index += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isTableRow(lines[index]) &&
      !/^```/.test(lines[index]) &&
      !/^\s*---+\s*$/.test(lines[index]) &&
      !/^#{2,3}\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*([-*•]|\d+[.)])\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ kind: "p", lines: paragraph });
  }

  return blocks;
}

export function LiveMarkdown({ content }: { content: string }) {
  const blocks = parse(content);

  return (
    <div className="space-y-3.5 text-[15px] leading-[1.65] tracking-[-0.011em] text-[#1c1c19]">
      {blocks.map((block, blockIndex) => {
        const key = `b${blockIndex}`;

        if (block.kind === "h") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return (
            <Tag
              key={key}
              className={
                block.level === 2
                  ? "pt-1 text-[15px] font-semibold tracking-[-0.02em] text-[#14140f]"
                  : "text-[13px] font-semibold uppercase tracking-[0.04em] text-[#8a8a84]"
              }
            >
              {inline(block.text, key)}
            </Tag>
          );
        }

        if (block.kind === "hr") {
          return <hr key={key} className="border-0 border-t border-[#ecece6]" />;
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={key}
              className="rounded-[14px] border border-[#ecece6] bg-[#f7f7f4] px-4 py-3 text-[14px] leading-6 text-[#3a3a35]"
            >
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`${key}-q${lineIndex}`}>
                  {lineIndex > 0 && <br />}
                  {inline(line, `${key}-q${lineIndex}`)}
                </Fragment>
              ))}
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <pre key={key} className="overflow-x-auto rounded-[14px] bg-[#171715] px-4 py-3 text-[12.5px] leading-6 text-[#f4f4ef]">
              <code>{block.text}</code>
            </pre>
          );
        }

        if (block.kind === "p") {
          return (
            <p key={key}>
              {block.lines.map((line, lineIndex) => (
                <Fragment key={`${key}-l${lineIndex}`}>
                  {lineIndex > 0 && <br />}
                  {inline(line, `${key}-l${lineIndex}`)}
                </Fragment>
              ))}
            </p>
          );
        }

        if (block.kind === "table") {
          return (
            <div key={key} className="overflow-x-auto rounded-[14px] border border-[#eaeae4]">
              <table className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr className="bg-[#fbfbf9]">
                    {block.head.map((cell, cellIndex) => (
                      <th
                        key={`${key}-h${cellIndex}`}
                        className="border-b border-[#eaeae4] px-3 py-2 text-left font-medium text-[#6f6f69]"
                      >
                        {inline(cell, `${key}-h${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-r${rowIndex}`} className="border-b border-[#f2f2ee] last:border-b-0">
                      {row.map((cell, cellIndex) => (
                        <td key={`${key}-r${rowIndex}c${cellIndex}`} className="px-3 py-2 align-top leading-6 text-[#26261f]">
                          {inline(cell, `${key}-r${rowIndex}c${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        const ordered = block.kind === "ol";
        const ListTag = ordered ? "ol" : "ul";
        return (
          <ListTag key={key} className="space-y-2">
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-i${itemIndex}`} className="flex gap-2.5">
                <span
                  className={
                    ordered
                      ? "mt-[2px] w-4 shrink-0 text-right text-[13px] font-medium tabular-nums text-[#a4a49c]"
                      : "mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#cfcfc7]"
                  }
                  aria-hidden={!ordered}
                >
                  {ordered ? itemIndex + 1 : null}
                </span>
                <span className="min-w-0 flex-1">{inline(item, `${key}-i${itemIndex}`)}</span>
              </li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}
