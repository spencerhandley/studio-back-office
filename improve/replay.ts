// Replays conversations through the current code against a throwaway in-memory database.
//
//   node --experimental-strip-types improve/replay.ts improve/eval-set.json [--only name,name] [--out after.json]
//   node --experimental-strip-types improve/replay.ts --from-db data/studio.db --user 1 [--out after.json]
//
// Each scenario is {name, texts: [...], expect}. Texts are sent one at a time, exactly like real
// inbound SMS, and every reply is captured. The model provider comes from LLM_PROVIDER
// (default claude-cli, which runs on the Claude subscription). Nothing is sent to a real phone.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";

process.env.DB_PATH = ":memory:";
process.env.SMS_MODE = "simulator";
process.env.LLM_PROVIDER ??= "claude-cli";
process.env.PUBLIC_URL ??= "http://localhost:8787";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

type Scenario = { name: string; texts: string[]; expect?: string };
let scenarios: Scenario[];
const fromDb = arg("from-db");
if (fromDb) {
  const src = new DatabaseSync(fromDb, { readOnly: true });
  const userId = Number(arg("user"));
  const texts = (src.prepare("SELECT body FROM messages WHERE user_id = ? AND direction = 'in' ORDER BY id").all(userId) as { body: string }[]).map((r) => r.body);
  scenarios = [{ name: `user-${userId}`, texts }];
} else {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("Pass a scenario file or --from-db <path> --user <id>");
  scenarios = JSON.parse(readFileSync(file, "utf8")) as Scenario[];
  const only = arg("only")?.split(",");
  if (only) scenarios = scenarios.filter((s) => only.includes(s.name));
}

const { handleInbound } = await import("../src/conversation.ts");
const { users, messages, steps, artifacts, reminders, memories } = await import("../src/db.ts");
const { parseContent } = await import("../src/artifacts.ts");
const { lintReply } = await import("./lint.ts");
const { userTypeIds } = await import("../src/catalog.ts");

const results = [];
for (const [i, s] of scenarios.entries()) {
  const phone = `+1555010${String(i).padStart(4, "0")}`;
  const started = Date.now();
  for (const text of s.texts) await handleInbound(phone, text);
  const u = users.byPhone(phone)!;
  const types = userTypeIds(u);
  let onboarding = true;
  const lint: string[] = [];
  const transcript = messages.recent(u.id, 500).map((m) => {
    if (m.direction === "in") return `CREATOR: ${m.body}`;
    const issues = lintReply(m.body, { onboarding, creatorTypes: types });
    if (m.body.includes("/a/")) onboarding = false;
    if (issues.length) lint.push(`message ${m.id}: ${issues.join(", ")}`);
    return `STUDIO : ${m.body}${issues.length ? `\n         [lint: ${issues.join(", ")}]` : ""}`;
  });
  const result = {
    name: s.name,
    expect: s.expect,
    lint,
    seconds: Math.round((Date.now() - started) / 1000),
    transcript,
    profile: { name: u.name, creator_types: u.creator_types, earning: u.earning, headache: u.headache, hours: u.work_start ? `${u.work_start}-${u.work_end}` : null, tz: u.tz, onboarded: Boolean(u.onboarded_at) },
    steps: steps.list(u.id).map((x) => `${x.key}:${x.status}`),
    pages: artifacts.list(u.id).map((a) => ({ key: a.key, title: a.title, sections: parseContent(a).sections.map((sec) => sec.heading) })),
    reminders: reminders.pending(u.id).map((r) => `${r.due_at} ${r.text}`),
    memory: memories.list(u.id).map((m) => m.note),
  };
  results.push(result);
  console.log(`\n=== ${s.name} (${result.seconds}s)${s.expect ? `\nexpect: ${s.expect}` : ""}`);
  for (const line of transcript) console.log(line.replace(/\n/g, "\n         "));
  console.log(`profile: ${JSON.stringify(result.profile)}\nsteps: ${result.steps.join(" ")}\npages: ${result.pages.map((p) => p.key).join(" ")}`);
}
const out = arg("out");
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
