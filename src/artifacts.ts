import { config } from "./config.ts";
import { artifacts, steps, type Artifact, type User } from "./db.ts";
import { AREAS, LEVEL_LABEL, describeTypes, getType, mergedIdeas, userTypeIds } from "./catalog.ts";
import { formatClock } from "./time.ts";

// Artifacts are structured content, never model-written HTML. The server renders and escapes every field.
export type Section = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  checklist?: { text: string; done: boolean }[];
  table?: { columns: string[]; rows: string[][] };
};
export type ArtifactContent = { sections: Section[] };

export const SECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    heading: { type: "string" },
    paragraphs: { type: "array", items: { type: "string" } },
    bullets: { type: "array", items: { type: "string" } },
    checklist: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { text: { type: "string" }, done: { type: "boolean" } },
        required: ["text", "done"],
      },
    },
    table: {
      type: "object",
      additionalProperties: false,
      properties: {
        columns: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array", items: { type: "string" } } },
      },
      required: ["columns", "rows"],
    },
  },
  required: ["heading"],
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max: number, count: number) =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, count) : undefined;

export function sanitizeContent(raw: unknown): ArtifactContent {
  const sections = Array.isArray((raw as ArtifactContent)?.sections) ? (raw as ArtifactContent).sections : [];
  return {
    sections: sections.slice(0, 30).map((s) => {
      const out: Section = { heading: str(s?.heading, 140) || "Notes" };
      const paragraphs = strs(s?.paragraphs, 2000, 20);
      if (paragraphs?.length) out.paragraphs = paragraphs;
      const bullets = strs(s?.bullets, 500, 60);
      if (bullets?.length) out.bullets = bullets;
      if (Array.isArray(s?.checklist)) {
        out.checklist = s.checklist.slice(0, 60).map((c) => ({ text: str(c?.text, 500), done: Boolean(c?.done) })).filter((c) => c.text);
      }
      if (s?.table && Array.isArray(s.table.columns)) {
        const columns = s.table.columns.map((c) => str(c, 80)).slice(0, 10);
        const rows = Array.isArray(s.table.rows)
          ? s.table.rows.slice(0, 300).map((r) => (Array.isArray(r) ? columns.map((_, i) => str(r[i], 400)) : columns.map(() => "")))
          : [];
        if (columns.length) out.table = { columns, rows };
      }
      return out;
    }),
  };
}

export const artifactUrl = (a: Pick<Artifact, "public_id">) => `${config.publicUrl}/a/${a.public_id}`;

export function parseContent(a: Artifact): ArtifactContent {
  try {
    return sanitizeContent(JSON.parse(a.content_json));
  } catch {
    return { sections: [] };
  }
}

// The studio plan is the one artifact the server owns. It is rebuilt whenever the profile or setup steps change.
export function rebuildPlan(user: User): Artifact {
  const ids = userTypeIds(user);
  const type = getType(ids[0]);
  const ideas = mergedIdeas(ids);
  const multi = ids.length > 1;
  const stepList = steps.list(user.id);
  const about: string[] = [];
  if (user.creator_raw) about.push(`What you make: ${user.creator_raw}`);
  if (ids.length) about.push(`How I'll think about your work: ${describeTypes(ids)}`);
  if (user.earning) about.push(`How it earns today: ${user.earning}`);
  if (user.headache) about.push(`What eats your time: ${user.headache}`);
  if (user.work_start && user.work_end) {
    about.push(`Making time I keep quiet: ${formatClock(user.work_start)} to ${formatClock(user.work_end)}`);
  }

  const sections: Section[] = [
    { heading: "Your studio", bullets: about.length ? about : ["We'll fill this in as we talk."] },
    { heading: "First agent to hire", paragraphs: [type.firstHire] },
    {
      heading: "Your setup path",
      paragraphs: ["We'll work through these by text, one at a time. Each one turns into a page you can keep and share."],
      checklist: stepList.map((s) => ({ text: s.status === "active" ? `${s.title} (up now)` : s.title, done: s.status === "done" })),
    },
  ];
  if (ideas.length) {
    sections.push({
      heading: multi ? `Where this can grow across your work` : `Where this can grow for a ${describeTypes(ids)}`,
      paragraphs: ["Ideas for what I can take on as we go. Each shows how much I'd do without asking you first."],
      table: {
        columns: multi ? ["Idea", "For your work as", "Area", "How I'd work", "What it does"] : ["Idea", "Area", "How I'd work", "What it does"],
        rows: ideas.map((i) =>
          multi ? [i.title, i.typeLabel, AREAS[i.area].label, LEVEL_LABEL[i.level], i.text] : [i.title, AREAS[i.area].label, LEVEL_LABEL[i.level], i.text],
        ),
      },
    });
  }
  sections.push({
    heading: "Texting me",
    bullets: [
      "Text me like you'd text an assistant. Photos are fine.",
      "Ask for a reminder in plain words, like \"remind me Friday at 3 to ship the Denver crate\".",
      "Text LINK for a sign-in link to your dashboard.",
      "Text HELP for help, or STOP to stop all texts.",
    ],
  });
  return artifacts.upsert(user.id, "plan", `${user.name ? `${user.name.split(/\s+/)[0]}'s` : "Your"} studio plan`, "Your profile, setup path and what comes next.", { sections });
}
