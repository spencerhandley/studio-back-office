import { test } from "node:test";
import assert from "node:assert/strict";
import { setMockResponder, type LlmRequest } from "../src/llm.ts";
import { handleInbound } from "../src/conversation.ts";
import { artifacts, memories, messages, reminders, steps, users } from "../src/db.ts";
import { tick } from "../src/scheduler.ts";
import { parseContent } from "../src/artifacts.ts";
import { lintReply } from "../improve/lint.ts";

const PHONE = "+14155550123";
const lastOut = () => {
  const u = users.byPhone(PHONE)!;
  return messages.recent(u.id, 30).filter((m) => m.direction === "out").at(-1)?.body ?? "";
};

const calls: LlmRequest[] = [];
// Set per test: how the mock answers onboarding turns. Null makes the model fail so the scripted path runs.
let onboardingMock: ((req: LlmRequest) => unknown) | null = null;
setMockResponder((req) => {
  calls.push(req);
  if (req.purpose === "onboarding") {
    if (!onboardingMock) throw new Error("model down");
    return onboardingMock(req);
  }
  if (req.purpose === "onboarding_complete") {
    return { reply: "Thanks, Maya. Your plan is ready: {{link:plan}}\n\nFirst up: text me your available works.", actions: [] };
  }
  const latest = req.prompt.match(/The creator just texted:\n"""([\s\S]*?)"""/)?.[1] ?? "";
  if (latest.includes("Sunset Study")) {
    return {
      reply: "Your inventory is started with 2 works. {{link:inventory}}\n\nNext: which galleries hold your work?",
      actions: [
        {
          type: "upsert_artifact",
          key: "inventory",
          title: "Available works",
          summary: "2 works",
          sections: [{ heading: "Available now", table: { columns: ["Title", "Size", "Price", "Where"], rows: [["Sunset Study", "24x36", "$2,400", "Studio"], ["Blue Hour", "18x24", "$1,600", "Hall Gallery"]] } }],
        },
        { type: "remember", note: "Hall Gallery holds Blue Hour on consignment." },
        { type: "complete_step", step_key: "inventory" },
        // Far-future dates, so the agent never drops this reminder as already past.
        { type: "set_reminder", when: "2036-10-26T15:00", text: "Email Hall Gallery about Blue Hour." },
        { type: "upsert_artifact", key: "plan", title: "Hijack", sections: [{ heading: "x" }] },
      ],
    };
  }
  return { reply: "Got it — noted. **Anything else?**", actions: [] };
});

test("a new creator onboards by text (scripted fallback) and gets a plan, steps and a first ask", async () => {
  await handleInbound(PHONE, "hi");
  let user = users.byPhone(PHONE)!;
  assert.equal(user.consent_source, "inbound_sms");
  assert.match(lastOut(), /what should I call you/i);

  await handleInbound(PHONE, "I'm Maya");
  assert.match(lastOut(), /Nice to meet you, Maya/);

  await handleInbound(PHONE, "Oil paintings, mostly big landscapes");
  assert.match(lastOut(), /Got it: painter\. .*galleries/);

  await handleInbound(PHONE, "Two galleries and some commissions");
  await handleInbound(PHONE, "Keeping track of which gallery has which painting");
  assert.match(lastOut(), /best work/);

  await handleInbound(PHONE, "9am to 1pm, eastern");
  user = users.byPhone(PHONE)!;
  assert.equal(user.onboarding_step, "done");
  assert.ok(user.onboarded_at);
  assert.equal(user.creator_type, "painters");
  assert.equal(user.tz, "America/New_York");
  assert.equal(user.work_start, "09:00");
  assert.equal(user.work_end, "13:00");

  const s = steps.list(user.id);
  assert.deepEqual(s.map((x) => x.key), ["inventory", "galleries", "deadlines"]);
  assert.equal(steps.active(user.id)?.key, "inventory");

  const plan = artifacts.byKey(user.id, "plan")!;
  assert.ok(plan);
  const content = parseContent(plan);
  assert.ok(content.sections.some((sec) => sec.heading === "Your setup path"));
  assert.ok(content.sections.some((sec) => sec.table && sec.table.rows.length >= 8));
  assert.match(lastOut(), new RegExp(`/a/${plan.public_id}`));
  assert.equal(calls.filter((c) => c.purpose === "onboarding_complete").length, 1);
});

test("agent actions build pages, remember facts, advance setup and set reminders", async () => {
  await handleInbound(PHONE, "Sunset Study 24x36 oil $2400 at the studio\nBlue Hour 18x24 $1600 at Hall Gallery");
  const user = users.byPhone(PHONE)!;
  const inv = artifacts.byKey(user.id, "inventory")!;
  assert.equal(inv.title, "Available works");
  assert.equal(parseContent(inv).sections[0].table?.rows.length, 2);
  assert.match(lastOut(), new RegExp(`/a/${inv.public_id}`));
  assert.equal(memories.list(user.id).length, 1);
  assert.equal(steps.byKey(user.id, "inventory")?.status, "done");
  assert.equal(steps.active(user.id)?.key, "galleries");
  // The model cannot overwrite the server-owned plan page.
  assert.notEqual(artifacts.byKey(user.id, "plan")?.title, "Hijack");
  const r = reminders.pending(user.id);
  assert.equal(r.length, 1);
  assert.equal(r[0].due_at, "2036-10-26T19:00:00.000Z");
});

test("replies are cleaned of markdown and em dashes", async () => {
  await handleInbound(PHONE, "thanks");
  assert.equal(lastOut(), "Got it, noted. Anything else?");
});

test("keywords: HELP, LINK, PAUSE, STOP and START", async () => {
  await handleInbound(PHONE, "help");
  assert.match(lastOut(), /back-office agent/);
  await handleInbound(PHONE, "LINK");
  assert.match(lastOut(), /\/login\?t=/);
  await handleInbound(PHONE, "pause");
  assert.equal(users.byPhone(PHONE)!.paused, 1);
  await handleInbound(PHONE, "resume");
  assert.equal(users.byPhone(PHONE)!.paused, 0);
  const before = calls.length;
  await handleInbound(PHONE, "STOP");
  assert.equal(users.byPhone(PHONE)!.opted_out, 1);
  await handleInbound(PHONE, "are you there?");
  assert.equal(calls.length, before, "no model call after STOP");
  await handleInbound(PHONE, "START");
  assert.equal(users.byPhone(PHONE)!.opted_out, 0);
});

test("the scheduler sends due reminders and respects quiet hours for nudges", async () => {
  const user = users.byPhone(PHONE)!;
  const sent = await tick(new Date("2036-10-26T19:01:00Z"));
  assert.equal(sent.reminders, 1);
  assert.match(lastOut(), /^Reminder: Email Hall Gallery/);

  // Make the creator look idle for two days.
  const old = "2036-10-20T12:00:00.000Z";
  users.update(user.id, { last_inbound_at: old, last_nudge_at: null, nudges_since_reply: 0 });
  const { db } = await import("../src/db.ts");
  db.prepare("UPDATE messages SET created_at = ? WHERE user_id = ?").run(old, user.id);

  // 10:30am Eastern is inside Maya's 9 to 1 making time: no nudge.
  assert.equal((await tick(new Date("2036-10-27T14:30:00Z"))).nudges, 0);
  // 3pm Eastern: nudge with the active step's question.
  assert.equal((await tick(new Date("2036-10-27T19:00:00Z"))).nudges, 1);
  assert.match(lastOut(), /galleries/i);
  // The check-in asks only the step's question, so it passes lint like any other reply.
  assert.deepEqual(lintReply(lastOut()), []);
  // Not again within 48 hours.
  assert.equal((await tick(new Date("2036-10-28T19:00:00Z"))).nudges, 0);

  // No reply to that check-in: the next one offers a different setup step instead of repeating itself,
  // preferring one that touches the headache they named over the next one in line.
  steps.add(user.id, "pricing", "Set your prices", "What do your paintings sell for now, small to large?");
  users.update(user.id, { headache: "Pricing my work" });
  const asked = steps.active(user.id)!;
  const firstCheckIn = lastOut();
  assert.equal((await tick(new Date("2036-10-29T19:30:00Z"))).nudges, 1);
  const second = lastOut();
  assert.notEqual(second, firstCheckIn);
  assert.ok(!second.includes(asked.ask), "does not repeat the unanswered step's question");
  const now = steps.active(user.id)!;
  assert.equal(now.key, "pricing");
  assert.ok(second.includes(now.ask));
  assert.equal(steps.byKey(user.id, asked.key)!.status, "pending", "the skipped step stays on the list");
  assert.deepEqual(lintReply(second), []);
});

test("model-led onboarding keeps every discipline and skips what was already answered", async () => {
  const phone = "+14155550999";
  const out = () => messages.recent(users.byPhone(phone)!.id, 30).filter((m) => m.direction === "out").at(-1)?.body ?? "";
  const turns: Record<string, unknown>[] = [
    { name: "Spencer Handley", done: false, reply: "Good to meet you, Spencer. What do you make? If it's several things, list them all." },
    {
      creator_types: ["musicians", "youtubers", "podcasters", "teachers"],
      what_they_make: "Musician, YouTuber, podcaster, runs Sonora, a guitar course company",
      done: false,
      reply: "A lot going on, and Sonora sounds like the engine. How does it all make money today: lessons, gigs, session work, sponsors?",
    },
    { earning: "Teaching, gigs, session work", headache: "Keeping up with booking", done: false, reply: "Got it. When do you do your best work, and what time zone?" },
    { work_start: "08:00", work_end: "12:00", tz: "America/Los_Angeles", done: true, reply: "" },
  ];
  let i = 0;
  onboardingMock = () => turns[i++];
  await handleInbound(phone, "hi");
  await handleInbound(phone, "I'm Spencer Handley");
  assert.match(out(), /Spencer\./);
  assert.doesNotMatch(out(), /Spencer Handley/);
  await handleInbound(phone, "musician, YouTuber, podcast, and a course company called Sonora");
  assert.match(out(), /Sonora/);
  await handleInbound(phone, "teaching, gigs and session work. booking stresses me out");
  await handleInbound(phone, "mornings, pacific");
  const u = users.byPhone(phone)!;
  assert.deepEqual(JSON.parse(u.creator_types!), ["musicians", "youtubers", "podcasters", "teachers"]);
  assert.equal(u.creator_type, "musicians");
  assert.equal(u.onboarding_step, "done");
  assert.equal(u.tz, "America/Los_Angeles");
  const keys = steps.list(u.id).map((s) => s.key);
  assert.ok(keys.includes("deals") && keys.includes("students"), `steps were ${keys.join(",")}`);
  const plan = parseContent(artifacts.byKey(u.id, "plan")!);
  const ideas = plan.sections.find((s) => s.table)!;
  assert.equal(ideas.table!.columns[1], "For your work as");
  assert.ok(!JSON.stringify(plan).includes("galler"), "a musician's plan never mentions galleries");
  onboardingMock = null;
});

test("onboarding never asks the same question a third time", async () => {
  const phone = "+14155550888";
  onboardingMock = (req) =>
    req.prompt.includes('"name": null')
      ? { name: "Maya", creator_types: ["painters"], done: false, reply: "How does your painting make money today?" }
      : { done: false, reply: "Got it. How does your painting make money today?" };
  await handleInbound(phone, "hey");
  await handleInbound(phone, "Maya, I paint");
  await handleInbound(phone, "tracking paintings is a nightmare");
  await handleInbound(phone, "9 to 1 eastern");
  const u = users.byPhone(phone)!;
  assert.equal(u.earning, "(not given during setup)");
  assert.notEqual(u.onboarding_step, "earn");
  onboardingMock = null;
});

test("a clarifying question at the end of onboarding waits for the answer before the plan", async () => {
  const phone = "+14155550777";
  const outs = () => messages.recent(users.byPhone(phone)!.id, 30).filter((m) => m.direction === "out").map((m) => m.body);
  const turns: Record<string, unknown>[] = [
    { name: "Jess", creator_types: ["musicians"], earning: "shows", headache: "tour money", done: false, reply: "When do you do your best work, and what time zone?" },
    { tz: "America/Chicago", work_start: "10:00", work_end: "14:00", done: false, reply: "Is that 10am to 2pm, or 10pm to 2am?" },
    { work_start: "22:00", work_end: "02:00", done: true, reply: "" },
  ];
  let i = 0;
  onboardingMock = () => turns[i++];
  await handleInbound(phone, "hi");
  await handleInbound(phone, "Jess, band, shows, tour money stress");
  await handleInbound(phone, "10-2 central");
  assert.match(outs().at(-1)!, /10am to 2pm, or 10pm/);
  assert.equal(users.byPhone(phone)!.onboarded_at, null);
  await handleInbound(phone, "pm, we're night owls");
  const u = users.byPhone(phone)!;
  assert.ok(u.onboarded_at);
  assert.equal(u.work_start, "22:00");
  onboardingMock = null;
});
