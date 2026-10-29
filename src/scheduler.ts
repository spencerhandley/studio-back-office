import { all, one, reminders, steps, users, type Step, type User } from "./db.ts";
import { rebuildPlan } from "./artifacts.ts";
import { sendSms } from "./sms.ts";
import { DEFAULT_TZ, isQuiet, localParts } from "./time.ts";
import { currentQuestion } from "./onboarding.ts";

const HOUR = 3600_000;
const MAX_NUDGES = 3;

function lastActivity(user: User): number {
  const lastOut = one<{ t: string | null }>("SELECT MAX(created_at) AS t FROM messages WHERE user_id = ?", user.id)?.t;
  return Math.max(Date.parse(user.last_inbound_at ?? user.created_at), lastOut ? Date.parse(lastOut) : 0);
}

const words = (text: string) => new Set((text.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/s$/, "")));

// The next pending step to offer: one that touches the headache they named if there is one,
// otherwise the one after the active step, wrapping to the top of the list.
function nextPendingStep(user: User, active: Step): Step | undefined {
  const all = steps.list(user.id).filter((s) => s.status === "pending");
  const pending = [...all.filter((s) => s.position > active.position), ...all.filter((s) => s.position <= active.position)];
  const headache = words(user.headache ?? "");
  return pending.find((s) => [...words(`${s.key} ${s.title}`)].some((w) => headache.has(w))) ?? pending[0];
}

// Nudges go out only in daytime hours outside the creator's making time.
function goodTimeToNudge(user: User, now: Date) {
  const hour = localParts(now, user.tz ?? DEFAULT_TZ).hour;
  return hour >= 10 && hour < 19 && !isQuiet(user, now);
}

export async function tick(now = new Date()): Promise<{ reminders: number; nudges: number }> {
  let sentReminders = 0;
  let nudges = 0;
  const remindedNow = new Set<number>();

  // Reminders were asked for at a specific time, so they go out at that time.
  for (const r of reminders.due(now.toISOString())) {
    const user = users.byId(r.user_id);
    if (!user || user.opted_out) {
      if (user) reminders.cancel(user.id, r.id);
      continue;
    }
    reminders.markSent(r.id);
    await sendSms(user, `Reminder: ${r.text}`);
    remindedNow.add(user.id);
    sentReminders++;
  }

  const candidates = all<User>(
    "SELECT * FROM users WHERE opted_out = 0 AND paused = 0 AND nudges_since_reply < ? AND (last_nudge_at IS NULL OR last_nudge_at < ?)",
    MAX_NUDGES,
    new Date(now.getTime() - 48 * HOUR).toISOString(),
  );
  for (const user of candidates) {
    if (remindedNow.has(user.id)) continue;
    if (now.getTime() - lastActivity(user) < 24 * HOUR) continue;
    if (!goodTimeToNudge(user, now)) continue;
    let text: string | null = null;
    if (!user.onboarded_at) {
      // One nudge for an unfinished setup, then silence.
      if (user.nudges_since_reply >= 1) continue;
      text = `Still here whenever you're ready to finish setup. ${currentQuestion(user)}`;
    } else {
      const active = steps.active(user.id);
      if (!active) continue;
      const name = user.name ?? "there";
      const footer = "\n\nIf this is a busy stretch, text PAUSE and I'll hold off on check-ins.";
      // The last check-in went unanswered, so asking the same thing again just repeats us.
      // Offer the next setup step instead; the skipped one stays on the list for later.
      const next = user.nudges_since_reply >= 1 ? nextPendingStep(user, active) : undefined;
      if (next && steps.activate(user.id, next.key)) {
        rebuildPlan(users.byId(user.id)!);
        text = `Hi ${name}, no rush on "${active.title}", we can come back to it. Something else we can knock out in the meantime: ${next.ask}${footer}`;
      } else {
        text = `Hi ${name}, picking up where we left off. ${active.ask}${footer}`;
      }
    }
    users.update(user.id, { last_nudge_at: now.toISOString(), nudges_since_reply: user.nudges_since_reply + 1 });
    await sendSms(user, text);
    nudges++;
  }
  return { reminders: sentReminders, nudges };
}

let timer: NodeJS.Timeout | null = null;
let running = false;
export function startScheduler(intervalMs: number) {
  if (timer) return;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    } finally {
      running = false;
    }
  }, intervalMs);
}
