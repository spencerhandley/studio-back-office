// Exports every conversation with new messages since a cursor, with automatic signals, for grading.
//
//   node --experimental-strip-types improve/export.ts --db data/studio.db --since 2026-10-24T00:00:00Z --out new.json
//
// Prints {users, new_messages, flagged, newest}. Read-only: opens the database without writing.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { lintReply } from "./lint.ts";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const dbPath = arg("db", process.env.DB_PATH ?? "data/studio.db")!;
const since = arg("since", "1970-01-01T00:00:00.000Z")!;
const outPath = arg("out", "new.json")!;

const db = new DatabaseSync(dbPath, { readOnly: true });
type Row = Record<string, string | number | null>;
const q = (sql: string, ...p: (string | number)[]) => db.prepare(sql).all(...p) as Row[];

const CONFUSION = /(\?\s*$|what do you mean|that'?s not|not what i|\bwrong\b|confus|\bhuh\b|i already (said|told)|i just (said|told)|\bno,|doesn'?t make sense|why are you)/i;
const FALLBACK = /something broke on my end/i;

const userIds = q("SELECT DISTINCT user_id FROM messages WHERE created_at > ?", since).map((r) => Number(r.user_id));
let newest = since;
let newMessages = 0;
let flagged = 0;

const conversations = userIds.map((id) => {
  const u = q("SELECT * FROM users WHERE id = ?", id)[0];
  const thread = q("SELECT id, direction, body, created_at FROM messages WHERE user_id = ? ORDER BY id", id);
  const fresh = thread.filter((m) => String(m.created_at) > since);
  newMessages += fresh.length;
  for (const m of fresh) if (String(m.created_at) > newest) newest = String(m.created_at);

  const signals: string[] = [];
  let types: string[] = [];
  try {
    types = JSON.parse(String(u.creator_types ?? "[]"));
  } catch {
    types = u.creator_type ? [String(u.creator_type)] : [];
  }
  let onboarding = true;
  thread.forEach((m, i) => {
    if (String(m.created_at) <= since) return;
    const next = thread[i + 1];
    if (m.direction === "in") {
      if (!next || next.direction !== "out") signals.push(`unanswered: message ${m.id}`);
      else {
        const secs = (Date.parse(String(next.created_at)) - Date.parse(String(m.created_at))) / 1000;
        if (secs > 30) signals.push(`slow_reply: ${Math.round(secs)}s after message ${m.id}`);
      }
      if (CONFUSION.test(String(m.body))) signals.push(`possible_confusion: message ${m.id}`);
      const prevIn = thread.slice(0, i).reverse().find((x) => x.direction === "in");
      if (prevIn && String(prevIn.body).trim().toLowerCase() === String(m.body).trim().toLowerCase()) signals.push(`repeated_text: message ${m.id}`);
    } else {
      if (FALLBACK.test(String(m.body))) signals.push(`fallback_reply: message ${m.id}`);
      const issues = lintReply(String(m.body), { onboarding, creatorTypes: types });
      if (issues.length) signals.push(`lint: message ${m.id}: ${issues.join(", ")}`);
    }
    if (m.direction === "out" && String(m.body).includes("/a/")) onboarding = false;
  });
  if (u.opted_out) signals.push("opted_out");
  if (!u.onboarded_at && u.last_inbound_at && Date.now() - Date.parse(String(u.last_inbound_at)) > 24 * 3600_000) signals.push("onboarding_stalled");
  const failures = q("SELECT purpose, ms, error, created_at FROM llm_calls WHERE user_id = ? AND ok = 0 AND created_at > ?", id, since);
  for (const f of failures) signals.push(`model_failed: ${f.purpose}: ${String(f.error).slice(0, 160)}`);
  const calls = q("SELECT purpose, ms, ok, created_at FROM llm_calls WHERE user_id = ? AND created_at > ?", id, since);
  if (signals.length) flagged++;

  return {
    user_id: id,
    phone_last4: String(u.phone).slice(-4),
    profile: {
      name: u.name,
      creator_types: u.creator_types ?? u.creator_type,
      what_they_make: u.creator_raw,
      earning: u.earning,
      headache: u.headache,
      hours: u.work_start ? `${u.work_start}-${u.work_end}` : null,
      tz: u.tz,
      onboarding_step: u.onboarding_step,
      onboarded: Boolean(u.onboarded_at),
      paused: Boolean(u.paused),
      opted_out: Boolean(u.opted_out),
    },
    steps: q("SELECT key, title, status FROM steps WHERE user_id = ? ORDER BY position", id),
    pages: q("SELECT key, title, summary, version, content_json FROM artifacts WHERE user_id = ?", id).map((a) => ({
      key: a.key,
      title: a.title,
      summary: a.summary,
      version: a.version,
      content: JSON.parse(String(a.content_json)),
    })),
    reminders: q("SELECT due_at, text, status FROM reminders WHERE user_id = ?", id),
    memory: q("SELECT note FROM memories WHERE user_id = ?", id).map((m) => m.note),
    model_calls: calls,
    signals,
    // The whole thread, so each new exchange can be read in context. `new` marks what to grade.
    thread: thread.map((m) => ({ id: m.id, new: String(m.created_at) > since, at: m.created_at, from: m.direction === "in" ? "creator" : "studio", text: m.body })),
  };
});

writeFileSync(outPath, JSON.stringify({ since, newest, conversations }, null, 1));
console.log(JSON.stringify({ users: conversations.length, new_messages: newMessages, flagged, newest }));
