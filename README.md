# Studio

An SMS-first back-office agent for creative professionals. Creators text it like they'd text a studio manager. It onboards them in five questions, writes a studio plan for their kind of work (16 creator types, from painters to tattoo artists), then leads setup one step at a time and turns their answers into pages and reminders.

Texting is the main interface. The web side is deliberately small: a landing page, a magic-link dashboard, and the pages Studio builds.

## Run it locally

```sh
npm install
npm run dev
```

Open http://localhost:8787/dev/phone and text `hi`. Locally, texts go to a phone simulator instead of Twilio, and the model runs through the `claude` CLI on your Claude subscription (no API key, no API spend).

```sh
npm test          # 14 tests on a mock model: parsers, signatures, onboarding, actions, scheduler, STOP
npm run typecheck
```

## How it works

- `src/conversation.ts` routes every inbound text: carrier keywords (STOP, START, HELP), LINK for a dashboard link, PAUSE and RESUME for check-ins, onboarding, then the agent. Texts from one number are handled one at a time.
- `src/onboarding.ts` asks five fixed questions (name, what you make, how it earns, the biggest headache, best working hours and time zone). The answers are parsed in code, and the model is only called when a creator's work doesn't match any keyword.
- `src/agent.ts` runs one model turn per text. The model gets the creator's profile, setup steps, pages, memory, reminders and recent texts, and returns a reply plus actions: `remember`, `upsert_artifact`, `set_reminder`, `cancel_reminder`, `complete_step`, `activate_step`, `add_step`, `update_profile` and `send_dashboard_link`.
- `src/artifacts.ts` stores pages as structured sections (paragraphs, bullets, checklists, tables). The server renders and escapes them, so the model never writes HTML. The studio plan page belongs to the server and is rebuilt whenever setup changes.
- `src/scheduler.ts` sends reminders at the time they were set for. If setup stalls for 24 hours it sends a check-in, at most once every 48 hours and at most three in a row, and only between 10am and 7pm outside the creator's making time.
- `src/catalog.ts` and `catalog-data.json` hold the 16 creator types, their 132 ideas, the first agent each type should hire, and three starter setup steps per type.
- `src/llm.ts` has three providers: `anthropic` for production (the Messages API with a forced tool for structured output), `claude-cli` for local testing on the subscription, and `mock` for tests.

## Improvement loop

Studio gets better from its real conversations. The tools live in `improve/`:

- `export.ts` writes every conversation with new messages since a cursor, with automatic signals: unanswered or slow replies, model failures, fallback replies, the creator repeating themselves or sounding confused, opt-outs, stalled onboarding, and lint on each reply.
- `lint.ts` checks replies mechanically: more than one question, too long for a text, markdown, em dashes, another discipline's terms (galleries for a musician), and promises Studio can't keep yet.
- `replay.ts` runs conversations through the current code against a throwaway database and prints every reply. Pass `improve/eval-set.json`, or `--from-db <path> --user <id>` to replay a real creator's texts exactly.
- `eval-set.json` is the regression set. Every failure that gets fixed adds a conversation here with a one-line `expect`.

A daily run exports what's new, grades each exchange in context, fixes root causes in code or prompts, proves each fix by replaying the failing conversation plus the whole regression set, and ships it.

```sh
node --experimental-strip-types improve/export.ts --db data/studio.db --since 2026-10-24T00:00:00Z --out new.json
node --experimental-strip-types improve/replay.ts improve/eval-set.json
```

## Going live

1. Get a Twilio number and register it for A2P 10DLC. Carriers require this for business texting in the US. The landing page's consent language and the first text's STOP/HELP lines are written to pass review.
2. Copy `.env.example` to `.env` and set `SMS_MODE=twilio`, `LLM_PROVIDER=anthropic`, the Twilio credentials, `ANTHROPIC_API_KEY` and `PUBLIC_URL`.
3. Point the number's incoming message webhook at `POST {PUBLIC_URL}/sms/inbound`. Requests are verified with Twilio's signature.
4. Run `npm start` on any host that keeps a process running (Fly, Render, Railway, a VM), and mount a volume for `DB_PATH`. SQLite is fine for this stage.

## Not in v1

Studio can't send email, post, log into creators' accounts or take payments yet, and it says so when asked. The next layer is connectors: Gmail drafts, Google Calendar, Stripe and Square for income, and Shopify and Etsy for makers, gated by the autonomy ladder (drafts, then asks, then runs on its own). Page links are unguessable but not signed in, which suits sharing a rate card and doesn't suit anything private.

## License

MIT. See [LICENSE](LICENSE).
