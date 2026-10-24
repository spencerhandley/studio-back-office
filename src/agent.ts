import { config } from "./config.ts";
import { artifacts, memories, messages, reminders, steps, users, type User } from "./db.ts";
import { callStructured, type LlmImage } from "./llm.ts";
import { ALL_TYPE_IDS, getType } from "./catalog.ts";
import { SECTION_SCHEMA, artifactUrl, parseContent, rebuildPlan, sanitizeContent } from "./artifacts.ts";
import { DEFAULT_TZ, formatFriendly, formatLocalIso, isValidTz, localParts, zonedToUtc } from "./time.ts";
import { sendSms, fetchMedia } from "./sms.ts";
import { loginLink } from "./auth.ts";

const ACTION_TYPES = [
  "remember",
  "upsert_artifact",
  "set_reminder",
  "cancel_reminder",
  "complete_step",
  "activate_step",
  "add_step",
  "update_profile",
  "send_dashboard_link",
] as const;

const PROFILE_FIELDS = ["name", "creator_type", "creator_raw", "earning", "headache", "tz", "work_start", "work_end"] as const;

export const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string", description: "The text message to send back. Plain text, no markdown." },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ACTION_TYPES },
          note: { type: "string" },
          key: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          sections: { type: "array", items: SECTION_SCHEMA },
          when: { type: "string" },
          text: { type: "string" },
          reminder_id: { type: "integer" },
          step_key: { type: "string" },
          ask: { type: "string" },
          field: { type: "string", enum: PROFILE_FIELDS },
          value: { type: "string" },
        },
        required: ["type"],
      },
    },
  },
  required: ["reply", "actions"],
};

export type Action = {
  type: (typeof ACTION_TYPES)[number];
  note?: string;
  key?: string;
  title?: string;
  summary?: string;
  sections?: unknown;
  when?: string;
  text?: string;
  reminder_id?: number;
  step_key?: string;
  ask?: string;
  field?: (typeof PROFILE_FIELDS)[number];
  value?: string;
};
export type TurnResult = { reply: string; actions: Action[] };

export type TurnEvent =
  | { kind: "message"; text: string; media?: string[] }
  | { kind: "onboarding_complete" };

const SYSTEM = `You are Studio, a back-office agent that runs the business side of a creative professional's work over text message, so they can spend their time making things. You talk to one creator. Their profile, setup steps, pages, memory and recent texts are in the context.

What you can do in this version:
- Remember durable facts (prices, galleries, clients, splits, preferences) with "remember".
- Build and update pages with "upsert_artifact": inventories, rate cards, show lists, budgets, policies, plans, reply templates. Each page has a stable lowercase key (like "inventory" or "rates"). Always send the page's full content, since an upsert replaces it. Put a page's link in your reply by writing {{link:KEY}}.
- Set reminders with "set_reminder" using "when" as local time "YYYY-MM-DDTHH:mm" in the creator's time zone, and "text" as the reminder they'll receive. Cancel with "cancel_reminder" and "reminder_id".
- Lead setup. The active setup step is what you're working on together. When the creator gives you what a step needs, build its page, "complete_step" it, and ask the next step's question in the same reply. Use "activate_step" to switch to a step that fits better, and "add_step" (key, title, ask) to add one the creator needs.
- "update_profile" with field and value when they correct their name, time zone (IANA name), working hours (work_start and work_end as HH:MM, 24-hour) or what they make (creator_type must be one of: ${ALL_TYPE_IDS.join(", ")}).
- "send_dashboard_link" when they ask for the website, dashboard or settings.

What you can't do yet: send email, post, log into their accounts, take payments, or contact anyone for them. If they ask, say plainly that it isn't connected yet, then offer what you can do now (a draft they can paste, a page, a reminder). Never claim you did something you didn't.

How to text:
- Plain text only. No markdown, no bullets with asterisks, no headings. Line breaks are fine.
- Keep most replies under 320 characters. Longer only for a draft they asked for.
- One question at a time. Never send a list of questions.
- Sound like a sharp, warm studio manager. Specific, never gushing. No emoji unless they use them first. Never use em dashes.
- Use their words for their work. A painter's "pieces", a band's "shows".
- After you handle what they asked, steer back to the active setup step if it's still open, with one short question.
- If a request is vague, make a sensible assumption and say what you assumed instead of asking.`;

function buildContext(user: User, now: Date): string {
  const tz = user.tz ?? DEFAULT_TZ;
  const type = getType(user.creator_type);
  const stepList = steps.list(user.id);
  const pages = artifacts.list(user.id).filter((a) => a.key !== "plan");
  // Pages go in whole, newest first, until the budget runs out. A clipped page would get saved back clipped, so never clip.
  let pageBudget = 24_000;
  const pageDump = pages.map((a) => {
    const content = JSON.stringify(parseContent(a));
    const fits = content.length <= pageBudget;
    if (fits) pageBudget -= content.length;
    return { key: a.key, title: a.title, summary: a.summary, content: fits ? content : "(too long to include; do not upsert this page this turn)" };
  });
  const ctx = {
    now_local: `${formatLocalIso(now, tz)} (${localParts(now, tz).weekday})`,
    time_zone: tz,
    creator: {
      name: user.name,
      creator_type: type.id,
      type_label: type.label,
      what_they_make: user.creator_raw,
      how_they_earn: user.earning,
      biggest_headache: user.headache,
      best_working_hours: user.work_start && user.work_end ? `${user.work_start}-${user.work_end}` : "not set",
    },
    first_agent_to_hire_for_this_type: type.firstHire,
    idea_menu_for_this_type: type.ideas.map((i) => `${i.title}: ${i.text}`),
    setup_steps: stepList.map((s) => ({ key: s.key, title: s.title, status: s.status, ask: s.ask })),
    pages: pageDump,
    plan_page_link_token: "{{link:plan}}",
    memory: memories.list(user.id).slice(-60).map((m) => m.note),
    pending_reminders: reminders.pending(user.id).map((r) => ({ id: r.id, when_local: formatLocalIso(new Date(r.due_at), tz), text: r.text })),
    recent_texts: messages.recent(user.id, 16).map((m) => `${m.direction === "in" ? "Creator" : "Studio"}: ${m.body}`),
  };
  return JSON.stringify(ctx, null, 1);
}

function eventPrompt(event: TurnEvent): string {
  if (event.kind === "onboarding_complete") {
    return `Onboarding just finished. Write the first message after setup. In 2 to 4 short lines: thank them by name, say their studio plan page is ready at {{link:plan}}, connect the first setup step to the headache they named, then ask that step's question. If a different starter step fits their headache better, activate_step it first and ask that one instead.`;
  }
  const media = event.media?.length ? `\n(They attached ${event.media.length} photo(s).)` : "";
  return `The creator just texted:\n"""${event.text}"""${media}\n\nRespond with your reply and any actions.`;
}

// Runs one agent turn: builds context, calls the model, applies actions, sends the reply.
export async function agentTurn(user: User, event: TurnEvent, now = new Date()): Promise<string> {
  let images: LlmImage[] = [];
  if (event.kind === "message" && event.media?.length && config.llm.provider === "anthropic") {
    images = (await Promise.all(event.media.slice(0, 3).map(fetchMedia))).filter((x): x is LlmImage => Boolean(x));
  }

  let result: TurnResult;
  try {
    result = await callStructured<TurnResult>({
      purpose: event.kind === "onboarding_complete" ? "onboarding_complete" : "turn",
      system: SYSTEM,
      prompt: `<context>\n${buildContext(user, now)}\n</context>\n\n${eventPrompt(event)}`,
      schema: TURN_SCHEMA,
      images,
      userId: user.id,
    });
  } catch (err) {
    console.error(`[agent] turn failed for user ${user.id}:`, err);
    const fallback =
      event.kind === "onboarding_complete" ? onboardingFallback(user) : "Sorry, something broke on my end and I didn't catch that. Mind sending it again in a minute?";
    await sendSms(user, fallback);
    return fallback;
  }

  const touched = applyActions(users.byId(user.id)!, Array.isArray(result.actions) ? result.actions : [], now);
  const fresh = users.byId(user.id)!;
  if (touched.stepsChanged || touched.profileChanged || event.kind === "onboarding_complete") rebuildPlan(fresh);

  const reply = finalizeReply(fresh, String(result.reply ?? ""), touched.upserted);
  if (reply) await sendSms(fresh, reply);
  if (touched.sendLink) await sendSms(fresh, `Your dashboard: ${loginLink(fresh.id)}\nThe link works for 7 days.`);
  return reply;
}

export function onboardingFallback(user: User): string {
  const plan = artifacts.byKey(user.id, "plan");
  const active = steps.active(user.id);
  return [
    `Thanks${user.name ? `, ${user.name}` : ""}. Your studio plan is ready${plan ? `: ${artifactUrl(plan)}` : "."}`,
    active ? `Let's start with the first step. ${active.ask}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Replaces link tokens with real URLs, appends links for pages built this turn, and cleans up formatting.
export function finalizeReply(user: User, raw: string, upsertedKeys: string[]): string {
  let reply = raw.replace(/\{\{link:([a-z0-9_-]+)\}\}/gi, (_, key: string) => {
    const a = artifacts.byKey(user.id, key.toLowerCase());
    return a ? artifactUrl(a) : "";
  });
  for (const key of upsertedKeys) {
    const a = artifacts.byKey(user.id, key);
    if (a && !reply.includes(artifactUrl(a))) reply += `\n\n${a.title}: ${artifactUrl(a)}`;
  }
  return reply
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function applyActions(user: User, actions: Action[], now = new Date()) {
  const touched = { upserted: [] as string[], stepsChanged: false, profileChanged: false, sendLink: false };
  const tz = user.tz ?? DEFAULT_TZ;
  for (const a of actions.slice(0, 12)) {
    try {
      switch (a.type) {
        case "remember":
          if (a.note?.trim()) memories.add(user.id, a.note.trim().slice(0, 500));
          break;
        case "upsert_artifact": {
          const key = slug(a.key ?? a.title ?? "");
          if (!key || key === "plan") break;
          const content = sanitizeContent({ sections: a.sections });
          if (!content.sections.length) break;
          artifacts.upsert(user.id, key, (a.title ?? key).slice(0, 120), a.summary?.slice(0, 300) ?? null, content);
          if (!touched.upserted.includes(key)) touched.upserted.push(key);
          break;
        }
        case "set_reminder": {
          const due = a.when ? zonedToUtc(a.when, tz) : null;
          if (!due || !a.text?.trim()) break;
          // A reminder in the past fires on the next scheduler tick.
          if (due.getTime() < now.getTime() - 24 * 3600_000) break;
          reminders.add(user.id, due.toISOString(), a.text.trim().slice(0, 500));
          break;
        }
        case "cancel_reminder":
          if (typeof a.reminder_id === "number") reminders.cancel(user.id, a.reminder_id);
          break;
        case "complete_step":
          if (a.step_key) {
            steps.complete(user.id, a.step_key);
            touched.stepsChanged = true;
          }
          break;
        case "activate_step":
          if (a.step_key && steps.activate(user.id, a.step_key)) touched.stepsChanged = true;
          break;
        case "add_step": {
          const key = slug(a.step_key ?? a.key ?? a.title ?? "");
          if (!key || !a.title || !a.ask) break;
          steps.add(user.id, key, a.title.slice(0, 120), a.ask.slice(0, 600));
          if (!steps.active(user.id)) steps.activate(user.id, key);
          touched.stepsChanged = true;
          break;
        }
        case "update_profile": {
          const v = a.value?.trim() ?? "";
          if (!a.field || !PROFILE_FIELDS.includes(a.field)) break;
          if (a.field === "tz" && !isValidTz(v)) break;
          if ((a.field === "work_start" || a.field === "work_end") && !/^\d{2}:\d{2}$/.test(v)) break;
          if (a.field === "creator_type" && !ALL_TYPE_IDS.includes(v)) break;
          users.update(user.id, { [a.field]: v.slice(0, 300) || null });
          touched.profileChanged = true;
          break;
        }
        case "send_dashboard_link":
          touched.sendLink = true;
          break;
      }
    } catch (err) {
      console.error(`[agent] action ${a.type} failed for user ${user.id}:`, err);
    }
  }
  return touched;
}

export function describeReminder(r: { due_at: string; text: string }, tz: string) {
  return `${formatFriendly(new Date(r.due_at), tz)}: ${r.text}`;
}
