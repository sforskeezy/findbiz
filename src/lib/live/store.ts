import { readFile, rename, writeFile, rm, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

import type {
  LiveMemoryFact,
  LiveSession,
  LiveSessionSummary,
} from "@/lib/live/types";
import { ensureWritableStore, preferredStorePath } from "@/lib/writable-store";

type LiveIndex = {
  version: 1;
  sessionIds: string[];
};

let resolvedRoot: string | null = null;

async function ensureRoot() {
  if (resolvedRoot) return resolvedRoot;
  resolvedRoot = await ensureWritableStore(preferredStorePath(process.env.LIVE_STORE_PATH, "live"), ["sessions"]);
  return resolvedRoot;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value));
    await rename(/* turbopackIgnore: true */ tmp, file);
  } finally { await rm(tmp, { force: true }); }
}

/** Serialize read/modify/write transactions across requests and Node workers. */
async function withStoreLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const lock = path.join(await ensureRoot(), `${name}.lock`);
  let acquired = false;
  for (let attempt = 0; attempt < 250; attempt++) {
    try { await mkdir(lock); acquired = true; break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - (await stat(lock)).mtimeMs > 60_000) await rm(lock, {recursive: true, force: true}); } catch { /* Another writer released it. */ }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  if (!acquired) throw new Error("Memory is busy saving. Please retry.");
  try { return await work(); }
  finally { await rm(lock, {recursive: true, force: true}); }
}

export function liveId(prefix: string) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function isLiveSessionId(id: string) {
  return /^live_[a-f0-9]{12}$/.test(id);
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
    activeCompany: null,
  };
}

export async function createSession() {
  return withStoreLock("index", async () => {
    const session = emptySession();
    const root = await ensureRoot();
    await writeJson(path.join(root, "sessions", `${session.id}.json`), session);
    const index = await loadIndex();
    index.sessionIds = [session.id, ...index.sessionIds.filter((item) => item !== session.id)];
    await saveIndex(index);
    return session;
  });
}

export async function loadSession(id: string) {
  if (!isLiveSessionId(id)) return null;
  const root = await ensureRoot();
  const session = await readJson<LiveSession | null>(path.join(root, "sessions", `${id}.json`), null);
  return session;
}

export async function saveSession(session: LiveSession) {
  return withStoreLock("index", async () => {
    if (!isLiveSessionId(session.id)) throw new Error("Invalid Live session.");
    session.updatedAt = new Date().toISOString();
    const root = await ensureRoot();
    await writeJson(path.join(root, "sessions", `${session.id}.json`), session);
    const index = await loadIndex();
    index.sessionIds = [session.id, ...index.sessionIds.filter((item) => item !== session.id)];
    await saveIndex(index);
    return session;
  });
}

export async function deleteSession(id: string) {
  return withStoreLock("index", async () => {
    const index = await loadIndex();
    index.sessionIds = index.sessionIds.filter((item) => item !== id);
    await saveIndex(index);
    if (isLiveSessionId(id)) await rm(path.join(await ensureRoot(), "sessions", `${id}.json`), { force: true });
  });
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

async function writeMemory(facts: LiveMemoryFact[]) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "memory.json"), { facts: facts.slice(0, 500) });
}

export async function saveMemory(facts: LiveMemoryFact[]) {
  return withStoreLock("memory", () => writeMemory(facts));
}

export async function rememberFact(input: { kind: LiveMemoryFact["kind"]; text: string }) {
  return withStoreLock("memory", async () => {
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
      ...facts,
    ];
    await writeMemory(next);
    return next;
  });
}

export async function forgetFact(id: string) {
  return withStoreLock("memory", async () => {
    const facts = await loadMemory();
    const next = facts.filter((item) => item.id !== id);
    await writeMemory(next);
    return next;
  });
}

export async function liveStoreStatus() {
  const root = await ensureRoot();
  const index = await loadIndex();
  return {
    path: root,
    sessions: index.sessionIds.length,
    memory: (await loadMemory()).length,
  };
}

/** Full saved history for retrieval; the model prompt still uses a bounded excerpt. */
export async function listStoredSessions(): Promise<LiveSession[]> {
  const index = await loadIndex();
  const sessions = await Promise.all(index.sessionIds.map(loadSession));
  return sessions.filter((session): session is LiveSession => !!session && session.messages.length > 0).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
