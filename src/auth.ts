import { config } from "./config.ts";
import { one, run, randomId, nowIso, users, type User } from "./db.ts";

const LINK_TTL_MS = 7 * 24 * 3600_000;
const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const SESSION_COOKIE = "studio_session";

// Sign-in links go out by text. The phone number is the account.
export function loginLink(userId: number): string {
  const token = randomId(24);
  run("INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?, ?, ?)", token, userId, new Date(Date.now() + LINK_TTL_MS).toISOString());
  return `${config.publicUrl}/login?t=${token}`;
}

// Links can be opened more than once within their window, because SMS link previews and second devices open them too.
export function redeemLoginToken(token: string): string | null {
  const row = one<{ user_id: number; expires_at: string }>("SELECT user_id, expires_at FROM login_tokens WHERE token = ?", token);
  if (!row || row.expires_at < nowIso()) return null;
  run("UPDATE login_tokens SET used_at = COALESCE(used_at, ?) WHERE token = ?", nowIso(), token);
  const session = randomId(32);
  run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", session, row.user_id, new Date(Date.now() + SESSION_TTL_MS).toISOString());
  return session;
}

export function userForSession(session: string | undefined): User | undefined {
  if (!session) return undefined;
  const row = one<{ user_id: number; expires_at: string }>("SELECT user_id, expires_at FROM sessions WHERE token = ?", session);
  if (!row || row.expires_at < nowIso()) return undefined;
  return users.byId(row.user_id);
}

export function endSession(session: string | undefined) {
  if (session) run("DELETE FROM sessions WHERE token = ?", session);
}

export function sessionCookie(value: string, maxAgeMs = SESSION_TTL_MS): string {
  const secure = config.publicUrl.startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
}
