import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";

if (config.dbPath !== ":memory:") mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  name TEXT,
  creator_type TEXT,
  creator_raw TEXT,
  earning TEXT,
  headache TEXT,
  work_start TEXT,
  work_end TEXT,
  tz TEXT,
  onboarding_step TEXT NOT NULL DEFAULT 'name',
  onboarded_at TEXT,
  consent_at TEXT,
  consent_source TEXT,
  opted_out INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  last_inbound_at TEXT,
  last_nudge_at TEXT,
  nudges_since_reply INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  media_json TEXT,
  status TEXT,
  error TEXT,
  provider_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_user ON messages(user_id, id);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS steps (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  ask TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  done_at TEXT,
  UNIQUE (user_id, key)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  content_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, key)
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'canceled')),
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS reminders_due ON reminders(status, due_at);
CREATE TABLE IF NOT EXISTS login_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  ms INTEGER,
  ok INTEGER NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
`);

export type User = {
  id: number;
  phone: string;
  name: string | null;
  creator_type: string | null;
  creator_raw: string | null;
  earning: string | null;
  headache: string | null;
  work_start: string | null;
  work_end: string | null;
  tz: string | null;
  onboarding_step: string;
  onboarded_at: string | null;
  consent_at: string | null;
  consent_source: string | null;
  opted_out: number;
  paused: number;
  last_inbound_at: string | null;
  last_nudge_at: string | null;
  nudges_since_reply: number;
  created_at: string;
};

export type Message = {
  id: number;
  user_id: number;
  direction: "in" | "out";
  body: string;
  media_json: string | null;
  status: string | null;
  error: string | null;
  created_at: string;
};

export type Step = {
  id: number;
  user_id: number;
  key: string;
  title: string;
  ask: string;
  status: "pending" | "active" | "done";
  position: number;
  done_at: string | null;
};

export type Artifact = {
  id: number;
  user_id: number;
  key: string;
  public_id: string;
  title: string;
  summary: string | null;
  content_json: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: number;
  user_id: number;
  due_at: string;
  text: string;
  status: "pending" | "sent" | "canceled";
  created_at: string;
  sent_at: string | null;
};

export type Memory = { id: number; user_id: number; note: string; created_at: string };

export const nowIso = () => new Date().toISOString();
export const randomId = (bytes = 16) => randomBytes(bytes).toString("base64url");

// node:sqlite returns rows typed as Record<string, SQLOutputValue>; these helpers cast to our row types.
export function one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}

export const users = {
  byPhone: (phone: string) => one<User>("SELECT * FROM users WHERE phone = ?", phone),
  byId: (id: number) => one<User>("SELECT * FROM users WHERE id = ?", id),
  create(phone: string, consentSource: string): User {
    const now = nowIso();
    run("INSERT INTO users (phone, created_at, consent_at, consent_source) VALUES (?, ?, ?, ?)", phone, now, now, consentSource);
    return users.byPhone(phone)!;
  },
  update(id: number, fields: Partial<Omit<User, "id" | "phone" | "created_at">>) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    run(`UPDATE users SET ${sets} WHERE id = ?`, ...keys.map((k) => (fields as Record<string, string | number | null>)[k]), id);
  },
  delete: (id: number) => run("DELETE FROM users WHERE id = ?", id),
};

export const messages = {
  add(userId: number, direction: "in" | "out", body: string, extra: { media?: string[]; status?: string } = {}) {
    const r = run(
      "INSERT INTO messages (user_id, direction, body, media_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      userId,
      direction,
      body,
      extra.media?.length ? JSON.stringify(extra.media) : null,
      extra.status ?? null,
      nowIso(),
    );
    return Number(r.lastInsertRowid);
  },
  setStatus(id: number, status: string, error: string | null = null, providerId: string | null = null) {
    run("UPDATE messages SET status = ?, error = ?, provider_id = COALESCE(?, provider_id) WHERE id = ?", status, error, providerId, id);
  },
  recent: (userId: number, limit = 16) =>
    all<Message>("SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?", userId, limit).reverse(),
  since: (userId: number, afterId: number) =>
    all<Message>("SELECT * FROM messages WHERE user_id = ? AND id > ? ORDER BY id", userId, afterId),
};

export const memories = {
  add: (userId: number, note: string) => run("INSERT INTO memories (user_id, note, created_at) VALUES (?, ?, ?)", userId, note, nowIso()),
  list: (userId: number) => all<Memory>("SELECT * FROM memories WHERE user_id = ? ORDER BY id", userId),
  delete: (userId: number, id: number) => run("DELETE FROM memories WHERE user_id = ? AND id = ?", userId, id),
};

export const steps = {
  list: (userId: number) => all<Step>("SELECT * FROM steps WHERE user_id = ? ORDER BY position, id", userId),
  active: (userId: number) => one<Step>("SELECT * FROM steps WHERE user_id = ? AND status = 'active' LIMIT 1", userId),
  byKey: (userId: number, key: string) => one<Step>("SELECT * FROM steps WHERE user_id = ? AND key = ?", userId, key),
  add(userId: number, key: string, title: string, ask: string) {
    const max = one<{ m: number | null }>("SELECT MAX(position) AS m FROM steps WHERE user_id = ?", userId)?.m ?? 0;
    run("INSERT OR IGNORE INTO steps (user_id, key, title, ask, position, created_at) VALUES (?, ?, ?, ?, ?, ?)", userId, key, title, ask, max + 1, nowIso());
  },
  activate(userId: number, key: string) {
    const s = steps.byKey(userId, key);
    if (!s || s.status === "done") return false;
    run("UPDATE steps SET status = 'pending' WHERE user_id = ? AND status = 'active'", userId);
    run("UPDATE steps SET status = 'active' WHERE id = ?", s.id);
    return true;
  },
  // Marks a step done and moves the next pending one to active. Returns the newly active step, if any.
  complete(userId: number, key: string): Step | undefined {
    const s = steps.byKey(userId, key);
    if (!s || s.status === "done") return steps.active(userId);
    run("UPDATE steps SET status = 'done', done_at = ? WHERE id = ?", nowIso(), s.id);
    const current = steps.active(userId);
    if (current) return current;
    const next = one<Step>("SELECT * FROM steps WHERE user_id = ? AND status = 'pending' ORDER BY position, id LIMIT 1", userId);
    if (next) run("UPDATE steps SET status = 'active' WHERE id = ?", next.id);
    return next ? steps.byKey(userId, next.key) : undefined;
  },
};

export const artifacts = {
  list: (userId: number) => all<Artifact>("SELECT * FROM artifacts WHERE user_id = ? ORDER BY updated_at DESC", userId),
  byKey: (userId: number, key: string) => one<Artifact>("SELECT * FROM artifacts WHERE user_id = ? AND key = ?", userId, key),
  byPublicId: (publicId: string) => one<Artifact>("SELECT * FROM artifacts WHERE public_id = ?", publicId),
  upsert(userId: number, key: string, title: string, summary: string | null, content: unknown): Artifact {
    const now = nowIso();
    const json = JSON.stringify(content);
    const existing = artifacts.byKey(userId, key);
    if (existing) {
      run(
        "UPDATE artifacts SET title = ?, summary = ?, content_json = ?, version = version + 1, updated_at = ? WHERE id = ?",
        title,
        summary,
        json,
        now,
        existing.id,
      );
    } else {
      run(
        "INSERT INTO artifacts (user_id, key, public_id, title, summary, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        userId,
        key,
        randomId(12),
        title,
        summary,
        json,
        now,
        now,
      );
    }
    return artifacts.byKey(userId, key)!;
  },
};

export const reminders = {
  add: (userId: number, dueAtUtc: string, text: string) =>
    Number(run("INSERT INTO reminders (user_id, due_at, text, created_at) VALUES (?, ?, ?, ?)", userId, dueAtUtc, text, nowIso()).lastInsertRowid),
  pending: (userId: number) => all<Reminder>("SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' ORDER BY due_at", userId),
  due: (nowUtc: string) => all<Reminder>("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at", nowUtc),
  cancel: (userId: number, id: number) => run("UPDATE reminders SET status = 'canceled' WHERE user_id = ? AND id = ? AND status = 'pending'", userId, id),
  markSent: (id: number) => run("UPDATE reminders SET status = 'sent', sent_at = ? WHERE id = ?", nowIso(), id),
};

export function logLlmCall(userId: number | null, purpose: string, provider: string, model: string, ms: number, ok: boolean, error?: string) {
  run(
    "INSERT INTO llm_calls (user_id, purpose, provider, model, ms, ok, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    userId,
    purpose,
    provider,
    model,
    ms,
    ok ? 1 : 0,
    error ?? null,
    nowIso(),
  );
}
