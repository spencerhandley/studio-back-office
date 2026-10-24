import data from "./catalog-data.json" with { type: "json" };

export type Area = "ops" | "money" | "growth" | "rights" | "craft" | "care";
export type Level = "draft" | "ask" | "auto";
export type Idea = { title: string; area: Area; level: Level; text: string };
export type StarterStep = { key: string; title: string; ask: string };
export type CreatorType = {
  id: string;
  name: string;
  label: string;
  pigment: string;
  color: string;
  who: string;
  firstHire: string;
  ideas: Idea[];
  keywords: string[];
  starters: StarterStep[];
};

export const AREAS = data.areas as Record<Area, { label: string; color: string }>;
export const LEVEL_LABEL: Record<Level, string> = {
  draft: "Drafts for you",
  ask: "Asks before acting",
  auto: "Runs on its own",
};

const deadlines: StarterStep = {
  key: "deadlines",
  title: "Collect your deadlines",
  ask: "What deadlines are coming up? Shows, calls for entry, client due dates, anything with a date. I'll remind you ahead of each one.",
};

// Per-type extras: the singular label used in texts, classification keywords, and the first setup steps.
const extras: Record<string, { label: string; keywords: string[]; starters: StarterStep[] }> = {
  painters: {
    label: "painter",
    keywords: ["paint", "painter", "painting", "canvas", "oil", "acrylic", "watercolor", "mural", "gouache", "pastel", "fine art", "abstract", "portraits"],
    starters: [
      { key: "inventory", title: "Start your inventory", ask: "Let's start your inventory. Text me your available works, one per line: title, size, medium, price, and where it is now (your studio or which gallery). Photos are welcome too." },
      { key: "galleries", title: "Map your galleries", ask: "Which galleries or shops hold your work right now? For each one, tell me the commission split and when the consignment ends, if you know." },
      deadlines,
    ],
  },
  illustrators: {
    label: "illustrator",
    keywords: ["illustrat", "comic", "cartoon", "manga", "webcomic", "graphic novel", "concept art", "drawing", "draw", "picture book"],
    starters: [
      { key: "rates", title: "Build your rate card", ask: "Let's build your rate card. What did you charge for your last 3 to 5 jobs, and what was each one (book cover, editorial spot, ad campaign)?" },
      { key: "jobs", title: "List your open jobs", ask: "What jobs are open right now? Client, what's due when, and how many revision rounds the contract allows." },
      deadlines,
    ],
  },
  sculptors: {
    label: "sculptor",
    keywords: ["sculpt", "ceramic", "pottery", "potter", "clay", "bronze", "kiln", "glass", "stone carv", "wheel thrown"],
    starters: [
      { key: "inventory", title: "Start your inventory", ask: "Let's start your inventory. Text me finished pieces, one per line: title, material, dimensions, edition or cast number if any, price, and where it is." },
      { key: "production", title: "Track work in production", ask: "What's in production right now, at a foundry, a fabricator or in the kiln? Tell me each piece and where it stands." },
      deadlines,
    ],
  },
  photographers: {
    label: "photographer",
    keywords: ["photo", "photographer", "photography", "headshots", "portrait session", "wedding photo"],
    starters: [
      { key: "packages", title: "Write down your packages", ask: "What packages do you offer and what do they cost? Rough is fine, like 'Wedding 8hr $4,200'." },
      { key: "bookings", title: "List your booked shoots", ask: "What shoots are booked for the next few months? Date, client, type of shoot, and whether the retainer is paid." },
      { key: "inquiry", title: "Draft your inquiry reply", ask: "Paste or describe the last inquiry you got and how you answered it. I'll turn it into a reply template you can reuse." },
    ],
  },
  musicians: {
    label: "musician",
    keywords: ["band", "musician", "singer", "gig", "gigs", "tour", "touring", "guitarist", "drummer", "bassist", "rapper", "dj", "live music", "play shows", "songs"],
    starters: [
      { key: "shows", title: "List upcoming shows", ask: "What shows do you have coming up? Date, venue, city, and the deal (guarantee, door split, or both)." },
      { key: "registrations", title: "Check your royalty registrations", ask: "Let's make sure every song pays you. Which PRO are you with (ASCAP, BMI, SESAC, other, or none), and roughly how many songs have you released?" },
      { key: "release", title: "Plan your next release", ask: "Is a release coming up? Tell me the title and date and I'll build the rollout plan." },
    ],
  },
  composers: {
    label: "composer and producer",
    keywords: ["compose", "composer", "producer", "beats", "beatmaker", "songwriter", "sync", "film score", "scoring", "music production", "produce music", "library music"],
    starters: [
      { key: "catalog", title: "Inventory your catalog", ask: "Text me the tracks you'd pitch for sync, one per line: title, genre or mood, tempo, and whether you own 100% or share it." },
      { key: "registrations", title: "Check your royalty registrations", ask: "Which PRO are you with, and are your songs registered with The MLC and SoundExchange? Tell me what you know and I'll list what's missing." },
      { key: "pitching", title: "Set up sync pitching", ask: "Which music libraries, publishers or music supervisors do you work with now? I'll track who has heard what." },
    ],
  },
  youtubers: {
    label: "video creator",
    keywords: ["youtube", "youtuber", "content creator", "tiktok", "influencer", "vlog", "streamer", "twitch", "instagram", "reels", "channel", "subscribers"],
    starters: [
      { key: "deals", title: "Set up your deal desk", ask: "Let's set up your deal desk. What are your average views per video over the last 90 days, and what did your last sponsor pay?" },
      { key: "income", title: "Map your income", ask: "List every way the channel makes money (AdSense, sponsors, memberships, merch, affiliates, products) and roughly what each brought in last month." },
      { key: "schedule", title: "Set your upload schedule", ask: "How often do you upload, and how many videos are filmed but not published yet?" },
    ],
  },
  videographers: {
    label: "videographer",
    keywords: ["videograph", "wedding video", "wedding films", "commercial video", "video production", "cinematograph", "event video", "corporate video"],
    starters: [
      { key: "pricing", title: "Write down your pricing", ask: "What do you usually charge? Day rate, edit days, and any packages you sell." },
      { key: "jobs", title: "List your open jobs", ask: "What jobs are open now? Client, shoot date, delivery date, and where the edit stands." },
      { key: "crew", title: "List your crew", ask: "Who do you hire as second shooters or editors? Name, role and their rate." },
    ],
  },
  filmmakers: {
    label: "filmmaker",
    keywords: ["film", "filmmaker", "director", "documentary", "short film", "feature film", "movie", "screenplay"],
    starters: [
      { key: "project", title: "Describe your project", ask: "Tell me about the project you're on: title, stage (writing, prep, shooting, post, festivals), budget, and the next big date." },
      { key: "budget", title: "Start the budget tracker", ask: "What's the total budget and what has been spent so far? Rough categories are fine." },
      { key: "festivals", title: "Build a festival list", ask: "Is the film headed to festivals? Tell me the runtime and premiere status and I'll start a festival list with deadlines." },
    ],
  },
  writers: {
    label: "writer",
    keywords: ["write", "writer", "writing", "author", "novel", "novelist", "book", "books", "poet", "poetry", "journalist", "essay", "screenwrit", "newsletter", "substack"],
    starters: [
      { key: "projects", title: "List your projects", ask: "What are you writing right now, and what's published? Title, stage, and publisher or self-published for each." },
      { key: "submissions", title: "Track your submissions", ask: "Do you have anything out on submission? Agent queries, magazines, contests. List where and when you sent each one." },
      { key: "habit", title: "Set a writing target", ask: "What's a realistic daily or weekly word count goal? I'll check in at the end of your writing day." },
    ],
  },
  podcasters: {
    label: "podcaster",
    keywords: ["podcast", "podcaster", "episodes", "audio show"],
    starters: [
      { key: "show", title: "Describe your show", ask: "Tell me about the show: name, how often it publishes, and roughly how many downloads an episode gets." },
      { key: "guests", title: "Build a guest list", ask: "Who are the next guests you want to book? Names or links, plus anyone already scheduled." },
      { key: "sponsors", title: "Map your sponsors", ask: "Do you have sponsors now? List each one, the ad format, and what they pay per episode." },
    ],
  },
  designers: {
    label: "designer",
    keywords: ["design", "designer", "branding", "brand identity", "logo", "logos", "ux", "ui", "web design", "graphic design"],
    starters: [
      { key: "rates", title: "Build your rate sheet", ask: "How do you price work: hourly, per project, retainers? Tell me your last few projects and what you charged." },
      { key: "projects", title: "List active projects", ask: "What projects are active? Client, scope in one line, due date, and how much is invoiced so far." },
      { key: "retainers", title: "Track your retainers", ask: "Any retainer clients? List each with monthly hours and the price." },
    ],
  },
  makers: {
    label: "maker",
    keywords: ["jewelry", "jeweler", "woodwork", "furniture", "candle", "soap", "knit", "crochet", "textile", "quilt", "leather", "etsy", "handmade", "craft", "maker", "sewing", "embroider"],
    starters: [
      { key: "products", title: "List your products", ask: "Let's work out your real margins. Text me your main products with price, material cost, and how long each one takes to make." },
      { key: "channels", title: "Map where you sell", ask: "Where do you sell: Etsy, your own site, markets, wholesale? Roughly what share of sales comes from each?" },
      { key: "events", title: "Collect upcoming markets", ask: "Any craft fairs, markets or wholesale orders coming up? Tell me the dates." },
    ],
  },
  tattoo: {
    label: "tattoo artist",
    keywords: ["tattoo", "tattoos", "tattooer", "flash"],
    starters: [
      { key: "booking", title: "Set your booking rules", ask: "Let's set your booking rules. What's your deposit, your cancellation policy, and how far out are you booked?" },
      { key: "style", title: "Describe your style", ask: "What work do you want more of, and what do you turn down? This is how I'll sort inquiries." },
      { key: "events", title: "Plan books open and guest spots", ask: "When do you next plan to open books, do a flash day or a guest spot? Give me dates if you have them." },
    ],
  },
  performers: {
    label: "performer",
    keywords: ["actor", "actress", "acting", "dancer", "dance", "choreograph", "theater", "theatre", "voice actor", "voiceover", "voice over", "comedian", "stand-up", "standup", "improv", "auditions"],
    starters: [
      { key: "profile", title: "Build your casting profile", ask: "Tell me your casting basics: union status, age range, home market, and any reps (agent or manager)." },
      { key: "auditions", title: "Track your auditions", ask: "What auditions or callbacks are coming up, and what have you submitted for recently?" },
      { key: "materials", title: "Check your materials", ask: "When were your headshots and reel last updated? I'll remind you when they're due for a refresh." },
    ],
  },
  teachers: {
    label: "educator",
    keywords: ["teach", "teacher", "teaching", "lessons", "instructor", "tutor", "course", "students", "coach", "workshops"],
    starters: [
      { key: "students", title: "List your students", ask: "How many students do you teach right now, and how do they pay (per lesson, monthly, packages)?" },
      { key: "policies", title: "Write your policies", ask: "What's your policy on cancellations and makeup lessons? I'll turn it into a clean page you can send students." },
      { key: "enrollment", title: "Map your enrollment", ask: "How do new students find you, and about how many inquiries turn into students?" },
    ],
  },
};

const OTHER: CreatorType = {
  id: "other",
  name: "Creative professionals",
  label: "creative professional",
  pigment: "PW6 Titanium White",
  color: "#6B7280",
  who: "Creative work that doesn't fit one box.",
  firstHire: "A money and deadlines agent. Every creative business needs to know what's owed and what's due.",
  ideas: [],
  keywords: [],
  starters: [
    { key: "income", title: "Map your income", ask: "List every way you make money from your work and roughly what each brought in last month." },
    { key: "inprogress", title: "List what's in progress", ask: "What projects or client jobs are in progress right now? One per line with the next due date." },
    deadlines,
  ],
};

export const TYPES: CreatorType[] = (data.types as Omit<CreatorType, "label" | "keywords" | "starters">[]).map((t) => ({
  ...t,
  ...extras[t.id],
}));

export function getType(id: string | null | undefined): CreatorType {
  return TYPES.find((t) => t.id === id) ?? OTHER;
}

export const ALL_TYPE_IDS = [...TYPES.map((t) => t.id), "other"];

// Every creator type the text mentions, in the order the creator mentioned them.
export function classifyCreatorAll(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  const hits: { id: string; at: number; score: number }[] = [];
  for (const type of TYPES) {
    let score = 0;
    let at = Infinity;
    for (const k of type.keywords) {
      const m = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").exec(t);
      if (m) {
        score += k.length;
        at = Math.min(at, m.index);
      }
    }
    if (score > 0) hits.push({ id: type.id, at, score });
  }
  return hits.sort((a, b) => a.at - b.at || b.score - a.score).map((h) => h.id);
}

// The single best match: longer, more specific keywords count more. Null when nothing matches.
export function classifyCreator(text: string): string | null {
  const t = ` ${text.toLowerCase()} `;
  let best: { id: string; score: number } | null = null;
  for (const type of TYPES) {
    let score = 0;
    for (const k of type.keywords) {
      const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
      if (re.test(t)) score += k.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: type.id, score };
  }
  return best?.id ?? null;
}

// ---------- Creators with more than one discipline ----------

export function userTypeIds(user: { creator_type: string | null; creator_types?: string | null }): string[] {
  try {
    const ids = JSON.parse(user.creator_types ?? "[]");
    if (Array.isArray(ids)) {
      const valid = ids.filter((id): id is string => typeof id === "string" && ALL_TYPE_IDS.includes(id));
      if (valid.length) return [...new Set(valid)];
    }
  } catch {
    // Fall through to the single type.
  }
  return user.creator_type ? [user.creator_type] : [];
}

const LABEL_OVERRIDES: Record<string, string> = { youtubers: "YouTuber" };

export function describeTypes(ids: string[]): string {
  const labels = (ids.length ? ids : ["other"]).map((id) => LABEL_OVERRIDES[id] ?? getType(id).label);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

// One discipline gets its three starter steps. Several get the primary's first two, then the
// first step of each other discipline, so every discipline is represented. Five at most.
export function mergedStarters(ids: string[]): StarterStep[] {
  const types = (ids.length ? ids : ["other"]).map(getType);
  const out: StarterStep[] = [];
  const add = (s: StarterStep) => {
    if (!out.some((x) => x.key === s.key)) out.push(s);
  };
  types[0].starters.slice(0, types.length > 1 ? 2 : 3).forEach(add);
  for (const t of types.slice(1)) {
    const first = t.starters.find((s) => !out.some((x) => x.key === s.key));
    if (first) add(first);
  }
  return out.slice(0, 5);
}

export function mergedIdeas(ids: string[]): (Idea & { typeLabel: string })[] {
  const seen = new Set<string>();
  const out: (Idea & { typeLabel: string })[] = [];
  for (const id of ids.length ? ids : ["other"]) {
    const t = getType(id);
    for (const idea of t.ideas) {
      if (seen.has(idea.title)) continue;
      seen.add(idea.title);
      out.push({ ...idea, typeLabel: LABEL_OVERRIDES[id] ?? t.label });
    }
  }
  return out;
}

// Examples for "how does your work make money", in each discipline's own terms.
export const EARN_EXAMPLES: Record<string, string[]> = {
  painters: ["galleries", "commissions", "prints", "open studios"],
  illustrators: ["client jobs", "licensing", "prints", "Patreon"],
  sculptors: ["galleries", "commissions", "public art", "shop sales"],
  photographers: ["weddings", "portrait sessions", "commercial clients", "prints"],
  musicians: ["shows", "streaming", "merch", "session work", "teaching"],
  composers: ["sync placements", "royalties", "beat sales", "scoring work"],
  youtubers: ["AdSense", "sponsors", "memberships", "courses"],
  videographers: ["client shoots", "day rates", "packages"],
  filmmakers: ["grants", "commissions", "distribution", "client work"],
  writers: ["advances", "royalties", "freelance pieces", "a newsletter"],
  podcasters: ["sponsors", "listener support", "ads"],
  designers: ["client projects", "retainers", "templates"],
  makers: ["Etsy", "your own shop", "markets", "wholesale"],
  tattoo: ["appointments", "flash days", "guest spots"],
  performers: ["bookings", "residuals", "teaching"],
  teachers: ["lessons", "courses", "memberships", "workshops"],
  other: ["clients", "sales", "teaching"],
};

export function earnExamples(ids: string[]): string {
  const all = [...new Set((ids.length ? ids : ["other"]).flatMap((id) => EARN_EXAMPLES[id] ?? EARN_EXAMPLES.other))].slice(0, 6);
  return all.join(", ");
}
