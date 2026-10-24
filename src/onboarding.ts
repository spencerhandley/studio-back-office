import { users, steps, type User } from "./db.ts";
import { ALL_TYPE_IDS, classifyCreator, getType } from "./catalog.ts";
import { callStructured, llmAvailable } from "./llm.ts";
import { DEFAULT_TZ, parseHours, parseTz } from "./time.ts";
import { rebuildPlan } from "./artifacts.ts";
import { sendSms } from "./sms.ts";
import { agentTurn, onboardingFallback } from "./agent.ts";

export const WELCOME =
  "Hi, I'm Studio. I run the business side of creative work by text, so you can spend more time making things.\n\n" +
  "Five quick questions to get you set up. First, what should I call you?\n\n" +
  "Reply STOP to opt out or HELP for help. Msg & data rates may apply.";

const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

export const QUESTIONS = {
  name: "What should I call you?",
  make: (name: string) => `Nice to meet you, ${name}. What do you make? Paintings, music, video, tattoos, books, anything counts.`,
  earn: (label: string | null) =>
    `${label ? `Got it, ${article(label)} ${label}. ` : "Got it. "}How does your work make money right now? List whatever applies: galleries, commissions, clients, shows, a shop, teaching.`,
  headache: "What part of the business side eats the most time or stresses you out the most?",
  hours: `Noted, that's where we'll start.\n\nLast one. When do you do your best work, and what time zone are you in? I'll keep those hours quiet. Something like "9am to 1pm, Eastern".`,
  tz: "Which time zone are you in? Pacific, Mountain, Central, Eastern, or just tell me your city.",
};

// The question to resend when someone comes back mid-onboarding.
export function currentQuestion(user: User): string {
  switch (user.onboarding_step) {
    case "make":
      return QUESTIONS.make(user.name ?? "there");
    case "earn":
      return QUESTIONS.earn(user.creator_type && user.creator_type !== "other" ? getType(user.creator_type).label : null);
    case "headache":
      return QUESTIONS.headache;
    case "hours":
      return QUESTIONS.hours.replace(/^Noted, that's where we'll start\.\n\n/, "");
    case "tz":
    case "tz2":
      return QUESTIONS.tz;
    default:
      return QUESTIONS.name;
  }
}

export function parseName(text: string): string | null {
  let t = text.trim();
  if (/^(hi|hey|hello|yo|sup|hiya|howdy)\W*$/i.test(t)) return null;
  t = t.replace(/^(hi|hey|hello)[,!.\s]+/i, "");
  t = t.replace(/^(i'?m|i am|my name is|my name's|it'?s|this is|call me|name'?s|you can call me)\s+/i, "");
  t = t.replace(/[.!?]+$/, "").trim();
  const words = t.split(/\s+/).filter(Boolean).slice(0, 3);
  const name = words.join(" ");
  if (!name || name.length > 40 || /\d/.test(name)) return null;
  return name === name.toLowerCase() ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : name;
}

async function classifyWithModel(user: User, text: string): Promise<string> {
  if (!llmAvailable()) return "other";
  try {
    const out = await callStructured<{ creator_type: string }>({
      purpose: "classify_creator",
      userId: user.id,
      system: "You sort creative professionals into one category. Answer with the single closest category id.",
      prompt: `Categories: ${ALL_TYPE_IDS.join(", ")}.\nThe creator said what they make: "${text}"`,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { creator_type: { type: "string", enum: ALL_TYPE_IDS } },
        required: ["creator_type"],
      },
    });
    return ALL_TYPE_IDS.includes(out.creator_type) ? out.creator_type : "other";
  } catch {
    return "other";
  }
}

// Advances onboarding by one answer. Every branch sends exactly one text.
export async function handleOnboarding(user: User, text: string): Promise<void> {
  const answer = text.trim();
  switch (user.onboarding_step) {
    case "name": {
      const name = parseName(answer);
      if (!name) return sendSms(user, `Hi! ${QUESTIONS.name}`);
      users.update(user.id, { name, onboarding_step: "make" });
      return sendSms(user, QUESTIONS.make(name));
    }
    case "make": {
      const type = classifyCreator(answer) ?? (await classifyWithModel(user, answer));
      users.update(user.id, { creator_raw: answer.slice(0, 500), creator_type: type, onboarding_step: "earn" });
      return sendSms(user, QUESTIONS.earn(type === "other" ? null : getType(type).label));
    }
    case "earn":
      users.update(user.id, { earning: answer.slice(0, 500), onboarding_step: "headache" });
      return sendSms(user, QUESTIONS.headache);
    case "headache":
      users.update(user.id, { headache: answer.slice(0, 500), onboarding_step: "hours" });
      return sendSms(user, QUESTIONS.hours);
    case "hours": {
      const hours = parseHours(answer);
      const tz = parseTz(answer);
      if (hours && hours !== "none") users.update(user.id, { work_start: hours.start, work_end: hours.end });
      if (!tz) {
        users.update(user.id, { onboarding_step: "tz" });
        return sendSms(user, QUESTIONS.tz);
      }
      users.update(user.id, { tz });
      return finishOnboarding(users.byId(user.id)!);
    }
    case "tz":
    case "tz2": {
      const tz = parseTz(answer);
      if (!tz && user.onboarding_step === "tz") {
        users.update(user.id, { onboarding_step: "tz2" });
        return sendSms(user, `I didn't catch a time zone in that. ${QUESTIONS.tz}`);
      }
      users.update(user.id, { tz: tz ?? DEFAULT_TZ });
      if (!tz) await sendSms(user, "I'll use Pacific time for now. Text me your time zone whenever and I'll switch it.");
      return finishOnboarding(users.byId(user.id)!);
    }
  }
}

export async function finishOnboarding(user: User): Promise<void> {
  const type = getType(user.creator_type);
  for (const s of type.starters) steps.add(user.id, s.key, s.title, s.ask);
  const first = steps.list(user.id)[0];
  if (first) steps.activate(user.id, first.key);
  users.update(user.id, { onboarding_step: "done", onboarded_at: new Date().toISOString() });
  const fresh = users.byId(user.id)!;
  rebuildPlan(fresh);
  if (llmAvailable()) await agentTurn(fresh, { kind: "onboarding_complete" });
  else await sendSms(fresh, onboardingFallback(fresh));
}
