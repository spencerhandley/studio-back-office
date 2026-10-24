import { messages, users, steps, type User } from "./db.ts";
import { ALL_TYPE_IDS, TYPES, classifyCreatorAll, describeTypes, earnExamples, mergedStarters, userTypeIds } from "./catalog.ts";
import { callStructured, llmAvailable } from "./llm.ts";
import { DEFAULT_TZ, isValidTz, parseHours, parseTz } from "./time.ts";
import { rebuildPlan } from "./artifacts.ts";
import { sendSms } from "./sms.ts";
import { agentTurn, onboardingFallback } from "./agent.ts";

export const WELCOME =
  "Hi, I'm Studio. I run the business side of creative work by text, so you can spend more time making things.\n\n" +
  "Five quick questions to get you set up. First, what should I call you?\n\n" +
  "Reply STOP to opt out or HELP for help. Msg & data rates may apply.";

// After this many onboarding answers, finish with whatever we have rather than keep asking.
const MAX_ONBOARDING_TURNS = 8;

export const firstName = (user: Pick<User, "name">) => (user.name ?? "").trim().split(/\s+/)[0] || "there";

export const QUESTIONS = {
  name: "What should I call you?",
  make: (name: string) => `Nice to meet you, ${name}. What do you make? Paintings, music, video, tattoos, books, anything counts. If you do several things, list them all.`,
  earn: (ids: string[]) =>
    `${ids.length ? `Got it: ${describeTypes(ids)}. ` : "Got it. "}How does your work make money right now? List whatever applies, like ${earnExamples(ids)}.`,
  headache: "What part of the business side eats the most time or stresses you out the most?",
  hours: `Last one. When do you do your best work, and what time zone are you in? I'll keep those hours quiet. Something like "9am to 1pm, Eastern".`,
  tz: "Which time zone are you in? Pacific, Mountain, Central, Eastern, or just tell me your city.",
};

type Missing = "name" | "make" | "earn" | "headache" | "hours";

function missingFields(u: User): Missing[] {
  const out: Missing[] = [];
  if (!u.name) out.push("name");
  if (!userTypeIds(u).length) out.push("make");
  if (!u.earning) out.push("earn");
  if (!u.headache) out.push("headache");
  if (!u.tz) out.push("hours");
  return out;
}

// The question to resend when someone comes back mid-onboarding.
export function currentQuestion(user: User): string {
  switch (user.onboarding_step) {
    case "make":
      return QUESTIONS.make(firstName(user));
    case "earn":
      return QUESTIONS.earn(userTypeIds(user));
    case "headache":
      return QUESTIONS.headache;
    case "hours":
      return QUESTIONS.hours.replace(/^Last one\. /, "");
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

// ---------- Model-led onboarding ----------

const TYPE_GUIDE = [...TYPES.map((t) => `${t.id} (${t.label}: ${t.who})`), "other (anything that fits none of these)"].join("\n");

const ONBOARD_SYSTEM = `You are Studio, a back-office agent for creative professionals, onboarding a new creator over text message.

You need five things:
1. Their name.
2. What they make. Map every discipline they mention to creator_types ids, most important to their income first. Many creators do several things (a musician who also runs a YouTube channel, a podcast and a course business is musicians, youtubers, podcasters and teachers). Never collapse them to one.
3. How the work makes money today.
4. The part of the business side that eats the most time or causes the most stress.
5. When they do their best work (Studio keeps those hours quiet) and their time zone as an IANA name. "No fixed hours" is a fine answer.

Creator type ids:
${TYPE_GUIDE}

What Studio does today, if they ask: it keeps track of their business by text. It builds pages they can keep and share (inventories, rate cards, show lists, budgets, policies), remembers the details they tell it, sets reminders, and walks them through setting up their business one step at a time. It does not send email, post, take payments, send invoices or log into their accounts yet. Never promise more than this.

Each turn:
- Extract everything the latest text tells you. People often answer two questions at once or volunteer extra details. Only return fields you learned or corrected. Anything already in "Known so far" is answered: never ask about it again, not even to add detail.
- Any mention of how they get paid counts as the money answer ("I sell through two galleries" is enough). Record it right away. Never probe for a fuller list; you'll learn the rest later.
- If something they said shows an earlier field was wrong (for example they were filed as only a musician), correct it, and say so in a few words.
- Then write the next text: a short, specific acknowledgment of what they just said in their own words (name a business or project they mentioned), then ask for the next missing item, in the order listed above.
- Ask exactly one question per text. No follow-up like "Do you also..." and no "Which brings in the most?" tacked on. Exactly one question mark.
- Examples in your question must fit their disciplines. A musician earns from shows, streaming, session work, sync and teaching, never galleries. A tattoo artist books appointments and flash days.
- If they ask a question, answer it briefly first. If they seem confused or push back, say in one line why you're asking.
- Use their first name, sparingly. Plain text, no emoji, no markdown, never an em dash. Keep it under 300 characters.
- When all five are known, set done to true and leave reply empty. Their studio plan goes out right after.`;

const ONBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", description: "Full name or what they want to be called." },
    creator_types: { type: "array", items: { type: "string", enum: ALL_TYPE_IDS } },
    what_they_make: { type: "string", description: "Their own description of their work, all disciplines, one line." },
    earning: { type: "string" },
    headache: { type: "string" },
    work_start: { type: "string", description: "HH:MM, 24-hour" },
    work_end: { type: "string", description: "HH:MM, 24-hour" },
    no_fixed_hours: { type: "boolean" },
    tz: { type: "string", description: "IANA time zone" },
    done: { type: "boolean" },
    reply: { type: "string" },
  },
  required: ["done", "reply"],
};

type OnboardOut = {
  name?: string;
  creator_types?: string[];
  what_they_make?: string;
  earning?: string;
  headache?: string;
  work_start?: string;
  work_end?: string;
  no_fixed_hours?: boolean;
  tz?: string;
  done: boolean;
  reply: string;
};

function applyOnboardFields(user: User, out: OnboardOut) {
  const fields: Partial<User> = {};
  const clean = (s: string | undefined, max = 500) => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : undefined);
  const name = clean(out.name, 40);
  if (name) fields.name = name;
  const types = (out.creator_types ?? []).filter((t) => ALL_TYPE_IDS.includes(t));
  if (types.length) {
    const unique = [...new Set(types)];
    // "other" only stands in when nothing else fits.
    const ids = unique.length > 1 ? unique.filter((t) => t !== "other") : unique;
    fields.creator_types = JSON.stringify(ids);
    fields.creator_type = ids[0];
  }
  const make = clean(out.what_they_make);
  if (make) fields.creator_raw = make;
  const earning = clean(out.earning);
  if (earning) fields.earning = earning;
  const headache = clean(out.headache);
  if (headache) fields.headache = headache;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (out.work_start && out.work_end && hhmm.test(out.work_start) && hhmm.test(out.work_end) && out.work_start !== out.work_end) {
    fields.work_start = out.work_start;
    fields.work_end = out.work_end;
  }
  if (out.tz && isValidTz(out.tz)) fields.tz = out.tz;
  users.update(user.id, fields);
}

function skipField(user: User, field: Missing) {
  const NOT_GIVEN = "(not given during setup)";
  if (field === "name") users.update(user.id, { name: "there" });
  if (field === "make") users.update(user.id, { creator_type: "other", creator_types: JSON.stringify(["other"]) });
  if (field === "earn") users.update(user.id, { earning: NOT_GIVEN });
  if (field === "headache") users.update(user.id, { headache: NOT_GIVEN });
  if (field === "hours") users.update(user.id, { tz: DEFAULT_TZ });
}

async function modelOnboarding(user: User, text: string): Promise<boolean> {
  const transcript = messages.recent(user.id, 30).map((m) => `${m.direction === "in" ? "Creator" : "Studio"}: ${m.body}`);
  const known = {
    name: user.name,
    creator_types: userTypeIds(user),
    what_they_make: user.creator_raw,
    earning: user.earning,
    headache: user.headache,
    best_hours: user.work_start && user.work_end ? `${user.work_start}-${user.work_end}` : null,
    tz: user.tz,
  };
  let out: OnboardOut;
  try {
    out = await callStructured<OnboardOut>({
      purpose: "onboarding",
      userId: user.id,
      system: ONBOARD_SYSTEM,
      prompt: `Known so far:\n${JSON.stringify(known, null, 1)}\n\nConversation so far:\n${transcript.join("\n")}\n\nThe creator's latest text:\n"""${text}"""`,
      schema: ONBOARD_SCHEMA,
    });
  } catch (err) {
    console.error(`[onboarding] model turn failed for user ${user.id}:`, err);
    return false;
  }

  applyOnboardFields(user, out);
  let fresh = users.byId(user.id)!;
  let missing = missingFields(fresh);
  // Loop guard: a question that is still unanswered after two more texts gets skipped, never asked a third time.
  const repeat = missing[0] && missing[0] === user.onboarding_step ? fresh.onboarding_repeat + 1 : 0;
  if (repeat >= 2 && missing[0]) {
    skipField(fresh, missing[0]);
    fresh = users.byId(user.id)!;
    missing = missingFields(fresh);
  }
  const turns = fresh.onboarding_turns + 1;
  users.update(user.id, { onboarding_turns: turns, onboarding_step: missing[0] ?? "done", onboarding_repeat: repeat >= 2 ? 0 : repeat });

  const reply = out.reply?.trim();
  // The model may still be clarifying something ("10am or 10pm?") after every field is filled. Wait for that answer.
  const stillAsking = !out.done && Boolean(reply) && reply!.includes("?");
  if ((!missing.length && !stillAsking) || turns >= MAX_ONBOARDING_TURNS) {
    if (!fresh.tz) users.update(user.id, { tz: DEFAULT_TZ });
    await finishOnboarding(users.byId(user.id)!);
    return true;
  }
  await sendSms(fresh, reply || currentQuestion(users.byId(user.id)!));
  return true;
}

// ---------- Scripted fallback, used when the model is unavailable ----------

async function scriptedOnboarding(user: User, answer: string): Promise<void> {
  switch (user.onboarding_step) {
    case "name": {
      const name = parseName(answer);
      if (!name) return sendSms(user, `Hi! ${QUESTIONS.name}`);
      users.update(user.id, { name, onboarding_step: "make" });
      return sendSms(user, QUESTIONS.make(firstName({ name })));
    }
    case "make": {
      const found = classifyCreatorAll(answer);
      const ids = found.length ? found : ["other"];
      users.update(user.id, { creator_raw: answer.slice(0, 500), creator_type: ids[0], creator_types: JSON.stringify(ids), onboarding_step: "earn" });
      return sendSms(user, QUESTIONS.earn(found));
    }
    case "earn":
      users.update(user.id, { earning: answer.slice(0, 500), onboarding_step: "headache" });
      return sendSms(user, QUESTIONS.headache);
    case "headache":
      users.update(user.id, { headache: answer.slice(0, 500), onboarding_step: "hours" });
      return sendSms(user, `Noted, that's where we'll start.\n\n${QUESTIONS.hours}`);
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

// Advances onboarding by one answer: the model when it's available, the script otherwise.
export async function handleOnboarding(user: User, text: string): Promise<void> {
  const answer = text.trim();
  if (llmAvailable() && (await modelOnboarding(user, answer))) return;
  await scriptedOnboarding(users.byId(user.id)!, answer);
}

export async function finishOnboarding(user: User): Promise<void> {
  for (const s of mergedStarters(userTypeIds(user))) steps.add(user.id, s.key, s.title, s.ask);
  const first = steps.list(user.id)[0];
  if (first) steps.activate(user.id, first.key);
  users.update(user.id, { onboarding_step: "done", onboarded_at: new Date().toISOString() });
  const fresh = users.byId(user.id)!;
  rebuildPlan(fresh);
  if (llmAvailable()) await agentTurn(fresh, { kind: "onboarding_complete" });
  else await sendSms(fresh, onboardingFallback(fresh));
}
