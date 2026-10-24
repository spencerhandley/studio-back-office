import { config } from "./config.ts";
import { messages, users, nowIso, type User } from "./db.ts";
import { sendSms } from "./sms.ts";
import { loginLink } from "./auth.ts";
import { WELCOME, currentQuestion, handleOnboarding } from "./onboarding.ts";
import { agentTurn } from "./agent.ts";

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
const LINK_WORDS = new Set(["LINK", "DASHBOARD", "LOGIN", "SETTINGS"]);
const PAUSE_WORDS = new Set(["PAUSE", "PAUSECHECKINS"]);
const RESUME_WORDS = new Set(["RESUME", "RESUMECHECKINS", "UNPAUSE"]);

export const HELP_TEXT = `Studio is a back-office agent for creative work. Text me like an assistant: tell me what you're working on, ask for a reminder, or ask for a page. Text LINK for your dashboard, STOP to stop texts. Msg & data rates may apply.`;

// One conversation at a time per phone number, so two quick texts can't race each other.
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

export function handleInbound(phone: string, body: string, media: string[] = []): Promise<void> {
  return serialize(phone, async () => {
    const text = body.trim();
    const keyword = text.toUpperCase().replace(/[^A-Z]/g, "");
    let user = users.byPhone(phone);

    if (STOP_WORDS.has(keyword)) {
      if (!user) return;
      messages.add(user.id, "in", text);
      users.update(user.id, { opted_out: 1 });
      // Twilio sends the carrier-required STOP confirmation itself. The simulator shows one so the flow is visible.
      if (config.smsMode !== "twilio") messages.add(user.id, "out", "You're unsubscribed and won't get more texts. Reply START to come back.", { status: "simulated" });
      return;
    }

    if (!user) {
      // Texting the number first is the opt-in.
      user = users.create(phone, "inbound_sms");
      messages.add(user.id, "in", text, { media });
      users.update(user.id, { last_inbound_at: nowIso() });
      await sendSms(user, WELCOME);
      return;
    }

    messages.add(user.id, "in", text || "(photo)", { media });
    users.update(user.id, { last_inbound_at: nowIso(), nudges_since_reply: 0 });

    if (START_WORDS.has(keyword)) {
      users.update(user.id, { opted_out: 0 });
      const fresh = users.byId(user.id)!;
      await sendSms(fresh, fresh.onboarded_at ? "You're back on. What are you working on?" : `You're back on. ${currentQuestion(fresh)}`);
      return;
    }
    if (user.opted_out) return;
    if (HELP_WORDS.has(keyword)) {
      await sendSms(user, HELP_TEXT);
      return;
    }
    if (LINK_WORDS.has(keyword)) {
      await sendSms(user, `Your dashboard: ${loginLink(user.id)}\nThe link works for 7 days.`);
      return;
    }
    if (PAUSE_WORDS.has(keyword)) {
      users.update(user.id, { paused: 1 });
      await sendSms(user, "Check-ins paused. I'll only text when you text me or a reminder you set comes due. Text RESUME to turn them back on.");
      return;
    }
    if (RESUME_WORDS.has(keyword)) {
      users.update(user.id, { paused: 0 });
      await sendSms(user, "Check-ins are back on.");
      return;
    }

    const fresh = users.byId(user.id)!;
    if (!fresh.onboarded_at) {
      if (!text) {
        await sendSms(fresh, `Got the photo. Quick setup first: ${currentQuestion(fresh)}`);
        return;
      }
      await handleOnboarding(fresh, text);
      return;
    }
    await agentTurn(fresh, { kind: "message", text, media });
  });
}

// Signup from the website: creates the account and sends the first text.
export function startFromWeb(phone: string): Promise<"started" | "resumed" | "link_sent"> {
  return serialize(phone, async () => {
    let user: User | undefined = users.byPhone(phone);
    if (!user) {
      user = users.create(phone, "web_form");
      await sendSms(user, WELCOME);
      return "started";
    }
    if (user.opted_out) users.update(user.id, { opted_out: 0, consent_at: nowIso(), consent_source: "web_form" });
    const fresh = users.byId(user.id)!;
    if (fresh.onboarded_at) {
      await sendSms(fresh, `Here's your dashboard link: ${loginLink(fresh.id)}`);
      return "link_sent";
    }
    await sendSms(fresh, `Welcome back. ${currentQuestion(fresh)}`);
    return "resumed";
  });
}
