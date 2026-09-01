import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type {
  LiveMemoryFact,
  LiveSession,
  LiveSessionSummary,
} from "@/lib/live/types";

type LiveIndex = {
  version: 1;
  sessionIds: string[];
};

function liveRoot() {
  const configured = process.env.LIVE_STORE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(/* turbopackIgnore: true */ process.cwd(), "data", "live");
}

async function ensureRoot() {
  const root = liveRoot();
  await mkdir(/* turbopackIgnore: true */ root, { recursive: true });
  await mkdir(/* turbopackIgnore: true */ path.join(root, "sessions"), { recursive: true });
  return root;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value));
  await rename(/* turbopackIgnore: true */ tmp, file);
}

export function liveId(prefix: string) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

function emptyIndex(): LiveIndex {
  return { version: 1, sessionIds: [] };
}

async function loadIndex() {
  const root = await ensureRoot();
  return readJson<LiveIndex>(path.join(root, "index.json"), emptyIndex());
}

async function saveIndex(index: LiveIndex) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "index.json"), index);
}

export function emptySession(id = liveId("live")): LiveSession {
  const now = new Date().toISOString();
  return {
    id,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
    queue: null,
  };
}

export async function createSession() {
  const session = emptySession();
  const root = await ensureRoot();
  await writeJson(path.join(root, "sessions", `${session.id}.json`), session);
  const index = await loadIndex();
  index.sessionIds = [session.id, ...index.sessionIds.filter((item) => item !== session.id)].slice(0, 40);
  await saveIndex(index);
  return session;
}

export async function loadSession(id: string) {
  const root = await ensureRoot();
  const session = await readJson<LiveSession | null>(path.join(root, "sessions", `${id}.json`), null);
  return session;
}

export async function saveSession(session: LiveSession) {
  session.updatedAt = new Date().toISOString();
  const root = await ensureRoot();
  await writeJson(path.join(root, "sessions", `${session.id}.json`), session);
  const index = await loadIndex();
  index.sessionIds = [session.id, ...index.sessionIds.filter((item) => item !== session.id)].slice(0, 40);
  await saveIndex(index);
  return session;
}

export async function deleteSession(id: string) {
  const index = await loadIndex();
  index.sessionIds = index.sessionIds.filter((item) => item !== id);
  await saveIndex(index);
}

export function sessionSummary(session: LiveSession): LiveSessionSummary {
  const last = [...session.messages].reverse().find((item) => item.role === "user") ?? session.messages.at(-1);
  return {
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    preview: last?.content.slice(0, 90) || "New chat",
  };
}

export async function listSessions(): Promise<LiveSessionSummary[]> {
  const index = await loadIndex();
  const sessions = await Promise.all(index.sessionIds.map((id) => loadSession(id)));
  return sessions
    .filter((item): item is LiveSession => item != null && item.messages.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(sessionSummary);
}

export async function loadMemory(): Promise<LiveMemoryFact[]> {
  const root = await ensureRoot();
  const payload = await readJson<{ facts?: LiveMemoryFact[] }>(path.join(root, "memory.json"), { facts: [] });
  return payload.facts ?? [];
}

export async function saveMemory(facts: LiveMemoryFact[]) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "memory.json"), { facts: facts.slice(0, 40) });
}

export async function rememberFact(input: { kind: LiveMemoryFact["kind"]; text: string }) {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 280) return loadMemory();
  const facts = await loadMemory();
  const duplicate = facts.find((item) => item.text.toLowerCase() === text.toLowerCase());
  if (duplicate) return facts;
  const next = [
    {
      id: liveId("mem"),
      kind: input.kind,
      text,
      createdAt: new Date().toISOString(),
    },
    ...facts.filter((item) => !(item.kind === input.kind && item.kind === "territory")),
  ].slice(0, 40);
  await saveMemory(next);
  return next;
}

export async function forgetFact(id: string) {
  const facts = await loadMemory();
  const next = facts.filter((item) => item.id !== id);
  await saveMemory(next);
  return next;
}

export async function liveStoreStatus() {
  const index = await loadIndex();
  return {
    path: "data/live",
    sessions: index.sessionIds.length,
    memory: (await loadMemory()).length,
  };
}
