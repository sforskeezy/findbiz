import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 700_000;
const FETCH_TIMEOUT_MS = 7_000;

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIp(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) === 6) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  }
  return true;
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only public HTTP websites can be inspected.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Local network addresses cannot be inspected.");
  }
  if (isIP(hostname)) {
    if (privateIp(hostname)) throw new Error("Private network addresses cannot be inspected.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((result) => privateIp(result.address))) {
      throw new Error("The website does not resolve to a public address.");
    }
  }
  return url;
}

export type PublicPage = {
  url: string;
  title: string;
  text: string;
};

export async function fetchPublicPage(input: string): Promise<PublicPage> {
  let url = await assertPublicUrl(input);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": `ProspectIQ-Radar/1.0${process.env.OSM_CONTACT_EMAIL ? ` (${process.env.OSM_CONTACT_EMAIL})` : ""}`,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Website redirect ${response.status} had no destination.`);
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Website returned ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Website did not return an HTML page.");
    }
    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    return {
      url: url.toString(),
      title: title ? htmlToText(title).slice(0, 160) : url.hostname.replace(/^www\./, ""),
      text: htmlToText(html).slice(0, 20_000),
    };
  }
  throw new Error("Website redirected too many times.");
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeEntities(match[2].trim()) : null;
}

export function discoverSignalPages(htmlOrUrl: string, pageUrl: string, html?: string) {
  const source = html ?? "";
  const origin = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, "");
  const links: string[] = [];
  const wanted = /\b(about|contact|location|locations|news|opening)\b/i;
  for (const tag of source.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    if (!href || !wanted.test(href)) continue;
    try {
      const url = new URL(href, pageUrl);
      url.hash = "";
      if (/^https?:$/.test(url.protocol) && url.hostname.toLowerCase().replace(/^www\./, "") === origin) {
        links.push(url.toString());
      }
    } catch {
      // Ignore malformed public-page links.
    }
  }
  return [...new Set(links)].slice(0, 2);
}
