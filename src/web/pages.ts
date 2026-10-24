import { config } from "../config.ts";
import { artifacts, memories, messages, reminders, steps, type Artifact, type User } from "../db.ts";
import { TYPES, describeTypes, getType, userTypeIds } from "../catalog.ts";
import { artifactUrl, parseContent } from "../artifacts.ts";
import { DEFAULT_TZ, formatClock, formatFriendly } from "../time.ts";
import { esc, linkify, page } from "./layout.ts";

const smsHref = () => `sms:${config.displayNumber.replace(/[^\d+]/g, "")}`;

// ---------- Landing ----------

export function landingPage(notice?: { kind: "ok" | "error"; text: string }): string {
  const swatches = TYPES.map((t) => `<span title="${esc(t.name)}" style="background:${t.color}"></span>`).join("");
  const sim = config.devTools
    ? `<p class="dev">Running locally in simulator mode. <a href="/dev/phone">Open the phone simulator</a> to text Studio without Twilio.</p>`
    : "";
  return page({
    title: "Studio",
    css: `
      .hero { padding-block: 56px 32px; display: grid; gap: 18px; max-width: 720px; }
      .hero h1 { font-size: clamp(42px, 8vw, 80px); font-weight: 800; line-height: 0.96; letter-spacing: -0.02em; }
      .hero p { font-size: 18px; max-width: 58ch; margin: 0; }
      .swatches { display: flex; gap: 6px; flex-wrap: wrap; }
      .swatches span { width: 30px; height: 12px; border-radius: 6px; }
      .grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 20px; padding-bottom: 64px; align-items: start; }
      .steps { margin: 0; padding: 0; list-style: none; display: grid; gap: 14px; }
      .steps li { display: grid; grid-template-columns: 28px 1fr; gap: 10px; }
      .steps b { font-family: var(--mono); font-weight: 500; color: var(--muted); }
      form { display: grid; gap: 14px; }
      .consent { display: grid; grid-template-columns: 20px 1fr; gap: 10px; font-weight: 400; font-size: 13px; color: var(--muted); align-items: start; }
      .consent input { width: 18px; height: 18px; margin: 2px 0 0; }
      .notice { padding: 12px 14px; border-radius: 8px; border: 1px solid var(--line); }
      .notice.ok { border-color: var(--good); color: var(--good); }
      .notice.error { border-color: var(--warn); color: var(--warn); }
      .dev { font-size: 13px; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 12px; margin: 0; }
      .textus { font-family: var(--mono); font-size: 14px; }
      @media (max-width: 760px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    `,
    body: `
    <div class="wrap">
      <div class="topbar"><a class="mark" href="/"><i></i>Studio</a><a href="/app" class="muted">Sign in</a></div>
      <section class="hero">
        <div class="swatches" aria-hidden="true">${swatches}</div>
        <h1>Your back office, by&nbsp;text.</h1>
        <p>Studio is an agent that runs the business side of creative work: inventory, rates, shows, deadlines, follow-ups. You text it like you'd text a studio manager, and it builds the pages and reminders that keep things moving.</p>
      </section>
      <div class="grid">
        <div class="panel">
          <div class="eyebrow">How setup works</div>
          <ol class="steps" style="margin-top:14px">
            <li><b>1</b><span>Five quick questions by text: your name, what you make, how it earns, what eats your time, and when you do your best work.</span></li>
            <li><b>2</b><span>You get a studio plan page written for your kind of work, whether you paint, play shows, shoot weddings or tattoo.</span></li>
            <li><b>3</b><span>Studio walks you through setup one step at a time and turns your answers into pages you can keep and share.</span></li>
          </ol>
        </div>
        <div class="panel">
          <form method="post" action="/signup">
            <div>
              <div class="eyebrow">Get started</div>
              <p style="margin:6px 0 0">Text <span class="textus">START</span> to <a class="textus" href="${smsHref()}">${esc(config.displayNumber)}</a>, or have Studio text you first.</p>
            </div>
            ${notice ? `<div class="notice ${notice.kind}" role="status">${esc(notice.text)}</div>` : ""}
            <label for="phone">Mobile number<input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(415) 555-0123" required></label>
            <label class="consent" for="consent"><input id="consent" name="consent" type="checkbox" value="yes" required><span>I agree to get recurring automated texts from Studio at this number. Consent isn't a condition of any purchase. Msg &amp; data rates may apply. Reply STOP to cancel or HELP for help.</span></label>
            <button class="btn" type="submit">Text me</button>
            ${sim}
          </form>
        </div>
      </div>
    </div>`,
  });
}

// ---------- Sign-in needed ----------

export function signInPage(message?: string): string {
  return page({
    title: "Sign in to Studio",
    css: `.box { max-width: 520px; margin: 12vh auto 0; display: grid; gap: 12px; }`,
    body: `<div class="wrap"><div class="box panel">
      <a class="mark" href="/"><i></i>Studio</a>
      <h1 style="font-size:28px">${esc(message ?? "Sign in by text")}</h1>
      <p class="muted" style="margin:0">Text <b>LINK</b> to <a href="${smsHref()}">${esc(config.displayNumber)}</a> and Studio will send you a sign-in link. Your phone number is your account, so there's no password.</p>
    </div></div>`,
  });
}

// ---------- Dashboard ----------

const COMMON_TZS = [
  ["America/Los_Angeles", "Pacific"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Chicago", "Central"],
  ["America/New_York", "Eastern"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
  ["America/Toronto", "Toronto"],
  ["America/Vancouver", "Vancouver"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Central Europe"],
  ["Australia/Sydney", "Sydney"],
];

export function dashboardPage(user: User, flash?: string): string {
  const ids = userTypeIds(user);
  const type = getType(ids[0]);
  const tz = user.tz ?? DEFAULT_TZ;
  const stepList = steps.list(user.id);
  const active = stepList.find((s) => s.status === "active");
  const pages = artifacts.list(user.id);
  const plan = pages.find((a) => a.key === "plan");
  const others = pages.filter((a) => a.key !== "plan");
  const pending = reminders.pending(user.id);
  const notes = memories.list(user.id);
  const recent = messages.recent(user.id, 12);
  const doneCount = stepList.filter((s) => s.status === "done").length;

  const tzOptions = [...COMMON_TZS, ...(COMMON_TZS.some(([v]) => v === tz) ? [] : [[tz, tz]])]
    .map(([v, l]) => `<option value="${esc(v)}" ${v === tz ? "selected" : ""}>${esc(l)}</option>`)
    .join("");
  const typeOptions = [...TYPES.map((t) => [t.id, t.name]), ["other", "Something else"]]
    .map(([v, l]) => `<option value="${esc(v)}" ${v === (user.creator_type ?? "other") ? "selected" : ""}>${esc(l)}</option>`)
    .join("");

  const pageRow = (a: Artifact) => `
    <li><a href="${artifactUrl(a)}" target="_blank" rel="noopener">${esc(a.title)}</a>
      <span class="muted">${a.summary ? esc(a.summary) + " · " : ""}Updated ${esc(formatFriendly(new Date(a.updated_at), tz))}</span></li>`;

  const onboardingNote = user.onboarded_at
    ? ""
    : `<div class="panel note">Setup isn't finished yet. Reply to Studio's last text to keep going.</div>`;

  return page({
    title: `${user.name ? `${user.name.split(/\s+/)[0]}'s` : "Your"} studio`,
    accent: type.color,
    css: `
      .head { display: grid; grid-template-columns: auto 1fr; gap: 4px 16px; align-items: center; padding-block: 18px 22px; }
      .smear { width: 52px; height: 52px; border-radius: 46% 54% 42% 58% / 55% 45% 55% 45%; background: var(--accent); grid-row: span 2; box-shadow: 0 0 0 1px var(--line); }
      .head h1 { font-size: clamp(26px, 4vw, 36px); font-weight: 800; letter-spacing: -0.01em; }
      .cols { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 18px; padding-bottom: 64px; align-items: start; }
      .stack { display: grid; gap: 18px; }
      .panel h2 { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
      .upnext { border-color: var(--accent); }
      .upnext p { margin: 6px 0 0; }
      ul.clean { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
      ul.clean li { display: grid; gap: 2px; }
      .check { display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: start; }
      .box { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--ink); margin-top: 3px; display: grid; place-items: center; }
      .box.done { background: var(--ink); }
      .box.done::after { content: ""; width: 7px; height: 4px; border-left: 2px solid var(--paper); border-bottom: 2px solid var(--paper); transform: rotate(-45deg) translate(1px, -1px); }
      .box.active { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent); }
      .row { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
      .row form { flex: none; }
      .settings { display: grid; gap: 12px; }
      .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .toggle { display: grid; grid-template-columns: 20px 1fr; gap: 10px; font-weight: 400; align-items: start; }
      .toggle input { width: 18px; height: 18px; margin: 2px 0 0; }
      .flash { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--good); color: var(--good); margin-bottom: 14px; }
      .thread { display: grid; gap: 8px; }
      .bubble { max-width: 88%; padding: 8px 12px; border-radius: 14px; font-size: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .bubble.in { justify-self: end; background: color-mix(in srgb, var(--accent) 22%, var(--surface)); color: var(--ink); border-bottom-right-radius: 4px; }
      .bubble.in a { color: var(--ink); }
      .bubble.out { background: var(--paper); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
      .danger { display: grid; gap: 10px; }
      .danger .btn { background: var(--warn); }
      .count { font-family: var(--mono); font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
      @media (max-width: 800px) { .cols { grid-template-columns: minmax(0, 1fr); } .two { grid-template-columns: minmax(0, 1fr); } }
    `,
    body: `
    <div class="wrap">
      <div class="topbar"><a class="mark" href="/"><i></i>Studio</a>
        <form method="post" action="/logout"><button class="btn ghost small" type="submit">Sign out</button></form></div>
      ${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ""}
      <div class="head">
        <div class="smear" aria-hidden="true"></div>
        <h1>${esc(user.name ? `${user.name.split(/\s+/)[0]}'s` : "Your")} studio</h1>
        <div class="eyebrow">${esc(describeTypes(ids))} · ${esc(type.pigment)}</div>
      </div>
      ${onboardingNote}
      <div class="cols">
        <div class="stack">
          ${
            active
              ? `<div class="panel upnext"><div class="eyebrow">Up next</div><h2 style="margin:4px 0 0">${esc(active.title)}</h2><p>${esc(active.ask)}</p>
                 <p class="muted" style="font-size:13px">Answer by text to <a href="${smsHref()}">${esc(config.displayNumber)}</a>.</p></div>`
              : ""
          }
          <div class="panel">
            <div class="row"><h2>Setup path</h2><span class="count">${doneCount} of ${stepList.length} done</span></div>
            ${
              stepList.length
                ? `<ul class="clean">${stepList
                    .map((s) => `<li class="check"><span class="box ${s.status}" aria-label="${s.status}"></span><span>${esc(s.title)}${s.status === "active" ? ' <span class="muted">(up now)</span>' : ""}</span></li>`)
                    .join("")}</ul>`
                : `<p class="muted">Your setup path appears once the first five questions are done.</p>`
            }
          </div>
          <div class="panel">
            <h2>Pages</h2>
            ${
              plan || others.length
                ? `<ul class="clean">${plan ? pageRow(plan) : ""}${others.map(pageRow).join("")}</ul>`
                : `<p class="muted">Pages Studio builds for you show up here, like an inventory, a rate card or a show list.</p>`
            }
          </div>
          <div class="panel">
            <h2>Reminders</h2>
            ${
              pending.length
                ? `<ul class="clean">${pending
                    .map(
                      (r) => `<li class="row"><span><b>${esc(formatFriendly(new Date(r.due_at), tz))}</b><br>${esc(r.text)}</span>
                      <form method="post" action="/app/reminders/${r.id}/cancel"><button class="btn ghost small" type="submit">Cancel</button></form></li>`,
                    )
                    .join("")}</ul>`
                : `<p class="muted">No reminders yet. Text something like "remind me Thursday at 10 to call the gallery".</p>`
            }
          </div>
          <div class="panel">
            <h2>What Studio remembers</h2>
            ${
              notes.length
                ? `<ul class="clean">${notes
                    .map(
                      (m) => `<li class="row"><span>${esc(m.note)}</span>
                      <form method="post" action="/app/memories/${m.id}/delete"><button class="btn ghost small" type="submit" aria-label="Forget this">Forget</button></form></li>`,
                    )
                    .join("")}</ul>`
                : `<p class="muted">Facts you share by text (prices, galleries, clients) are saved here. You can delete any of them.</p>`
            }
          </div>
        </div>
        <div class="stack">
          <div class="panel">
            <h2>Settings</h2>
            <form class="settings" method="post" action="/app/settings">
              <label for="name">Name<input id="name" name="name" value="${esc(user.name ?? "")}" maxlength="40"></label>
              <label for="creator_type">Main discipline<select id="creator_type" name="creator_type">${typeOptions}</select></label>
              <div class="two">
                <label for="work_start">Making time starts<input id="work_start" name="work_start" type="time" value="${esc(user.work_start ?? "")}"></label>
                <label for="work_end">Making time ends<input id="work_end" name="work_end" type="time" value="${esc(user.work_end ?? "")}"></label>
              </div>
              <label for="tz">Time zone<select id="tz" name="tz">${tzOptions}</select></label>
              <label class="toggle" for="checkins"><input id="checkins" name="checkins" type="checkbox" value="on" ${user.paused ? "" : "checked"}><span>Send check-ins when setup stalls. Studio never texts at night${user.work_start ? ` or during your making time (${esc(formatClock(user.work_start))} to ${esc(formatClock(user.work_end))})` : ""}.</span></label>
              <button class="btn" type="submit">Save settings</button>
            </form>
          </div>
          <div class="panel">
            <h2>Recent texts</h2>
            <div class="thread">${recent.map((m) => `<div class="bubble ${m.direction}">${linkify(m.body)}</div>`).join("") || '<p class="muted">No texts yet.</p>'}</div>
          </div>
          <div class="panel">
            <h2>Delete your account</h2>
            <form class="danger" method="post" action="/app/delete">
              <p class="muted" style="margin:0">Removes your profile, pages, reminders, memory and text history. This can't be undone.</p>
              <label class="toggle" for="confirm_delete"><input id="confirm_delete" name="confirm" type="checkbox" value="yes" required><span>I understand everything will be deleted.</span></label>
              <button class="btn" type="submit">Delete everything</button>
            </form>
          </div>
        </div>
      </div>
    </div>`,
  });
}

// ---------- Artifact page ----------

export function artifactPage(a: Artifact, user: User): string {
  const type = getType(userTypeIds(user)[0]);
  const content = parseContent(a);
  const sections = content.sections
    .map((s) => {
      const parts: string[] = [`<h2>${esc(s.heading)}</h2>`];
      for (const p of s.paragraphs ?? []) parts.push(`<p>${esc(p)}</p>`);
      if (s.bullets?.length) parts.push(`<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`);
      if (s.checklist?.length) {
        parts.push(
          `<ul class="checks">${s.checklist.map((c) => `<li class="${c.done ? "done" : ""}"><span class="box" aria-label="${c.done ? "done" : "to do"}"></span><span>${esc(c.text)}</span></li>`).join("")}</ul>`,
        );
      }
      if (s.table) {
        parts.push(
          `<div class="scroll-x"><table><thead><tr>${s.table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.table.rows
            .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table></div>`,
        );
      }
      return `<section>${parts.join("")}</section>`;
    })
    .join("");
  return page({
    title: a.title,
    accent: type.color,
    css: `
      .doc { max-width: 860px; padding-block: 8px 72px; }
      .doc header { padding-block: 28px 18px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; }
      .doc header h1 { font-size: clamp(30px, 5vw, 48px); font-weight: 800; letter-spacing: -0.015em; line-height: 1.05; }
      .doc header .meta { font-size: 13px; color: var(--muted); display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .chip { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 1px var(--line); }
      section { padding-block: 24px 4px; }
      section h2 { font-size: 21px; font-weight: 600; margin-bottom: 8px; }
      section p { max-width: 68ch; margin: 0 0 10px; }
      section ul { margin: 0 0 10px; padding-left: 20px; display: grid; gap: 4px; max-width: 70ch; }
      ul.checks { list-style: none; padding: 0; }
      ul.checks li { display: grid; grid-template-columns: 18px 1fr; gap: 10px; align-items: start; }
      ul.checks .box { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid var(--ink); margin-top: 3px; display: grid; place-items: center; }
      ul.checks li.done .box { background: var(--ink); }
      ul.checks li.done .box::after { content: ""; width: 7px; height: 4px; border-left: 2px solid var(--paper); border-bottom: 2px solid var(--paper); transform: rotate(-45deg) translate(1px, -1px); }
      ul.checks li.done span:last-child { color: var(--muted); text-decoration: line-through; }
      table { border-collapse: collapse; width: 100%; font-size: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
      th { text-align: left; font-family: var(--mono); font-weight: 500; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
      td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; font-variant-numeric: tabular-nums; }
      tr:last-child td { border-bottom: 0; }
      .foot { margin-top: 36px; font-size: 13px; color: var(--muted); }
    `,
    body: `
    <div class="wrap doc">
      <header>
        <a class="mark" href="/" style="font-size:16px"><i></i>Studio</a>
        <h1>${esc(a.title)}</h1>
        <div class="meta"><span class="chip" aria-hidden="true"></span><span>Prepared for ${esc(user.name ?? "you")}</span><span>·</span><span>Updated ${esc(formatFriendly(new Date(a.updated_at), user.tz ?? DEFAULT_TZ))}</span></div>
      </header>
      ${sections || '<section><p class="muted">This page is empty for now.</p></section>'}
      <p class="foot">Built by Studio from your texts. To change anything on this page, just text Studio what to change.</p>
    </div>`,
  });
}

// ---------- Phone simulator (dev only) ----------

export function simulatorPage(): string {
  return page({
    title: "Studio phone simulator",
    css: `
      .sim { display: grid; grid-template-columns: minmax(0, 380px) minmax(0, 1fr); gap: 24px; padding-block: 8px 40px; align-items: start; }
      .phone { background: var(--surface); border: 1px solid var(--line); border-radius: 28px; height: min(760px, calc(100vh - 120px)); display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
      .phone header { padding: 14px 16px; border-bottom: 1px solid var(--line); text-align: center; font-weight: 600; }
      .phone header small { display: block; font-weight: 400; color: var(--muted); font-family: var(--mono); font-size: 11px; }
      #thread { overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 8px; }
      .b { max-width: 82%; padding: 8px 12px; border-radius: 16px; font-size: 14.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .b.in { align-self: flex-end; background: #2F6FE4; color: #fff; border-bottom-right-radius: 4px; }
      .b.in a { color: #fff; }
      .b.out { align-self: flex-start; background: var(--paper); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
      .typing { align-self: flex-start; color: var(--muted); font-size: 13px; }
      form.compose { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 10px; border-top: 1px solid var(--line); }
      .side { display: grid; gap: 14px; }
      .side .panel { display: grid; gap: 10px; }
      .side .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      code { font-family: var(--mono); font-size: 13px; }
      @media (max-width: 760px) { .sim { grid-template-columns: minmax(0, 1fr); } }
    `,
    body: `
    <div class="wrap">
      <div class="topbar"><a class="mark" href="/"><i></i>Studio</a><span class="eyebrow">Phone simulator</span></div>
      <div class="sim">
        <div class="phone">
          <header>Studio<small id="numlabel"></small></header>
          <div id="thread" aria-live="polite"></div>
          <form class="compose" id="compose">
            <input id="msg" autocomplete="off" placeholder="Text message" aria-label="Message">
            <button class="btn" type="submit">Send</button>
          </form>
        </div>
        <div class="side">
          <div class="panel">
            <label for="phone">Your test number<input id="phone" value="+15555550123"></label>
            <div class="actions">
              <button class="btn ghost small" id="reset" type="button">Start over as a new creator</button>
              <button class="btn ghost small" id="tick" type="button">Run the scheduler now</button>
            </div>
            <p class="muted" id="status" style="margin:0;font-size:13px"></p>
          </div>
          <div class="panel">
            <div class="eyebrow">Try</div>
            <p class="muted" style="margin:0">Text <code>hi</code> to begin onboarding. Afterward, try a real task: list a few works with prices, ask for a reminder, or text <code>LINK</code> for the dashboard. <code>HELP</code>, <code>PAUSE</code> and <code>STOP</code> work too.</p>
          </div>
        </div>
      </div>
    </div>`,
    script: `
const $ = (s) => document.querySelector(s);
let lastId = 0, waiting = false;
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const linkify = (s) => esc(s).replace(/https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)]/g, (u) => '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
function phone() { return $("#phone").value.trim(); }
function render(msgs) {
  const t = $("#thread");
  t.querySelector(".typing")?.remove();
  for (const m of msgs) {
    const d = document.createElement("div");
    d.className = "b " + m.direction;
    d.innerHTML = linkify(m.body);
    t.appendChild(d);
    lastId = Math.max(lastId, m.id);
    if (m.direction === "out") waiting = false;
  }
  if (waiting) { const ty = document.createElement("div"); ty.className = "typing"; ty.textContent = "Studio is typing..."; t.appendChild(ty); }
  t.scrollTop = t.scrollHeight;
}
async function poll() {
  try {
    const r = await fetch("/dev/api/thread?phone=" + encodeURIComponent(phone()) + "&after=" + lastId);
    const j = await r.json();
    if (j.messages.length || waiting) render(j.messages);
  } catch {}
}
function restart() { lastId = 0; waiting = false; $("#thread").innerHTML = ""; $("#numlabel").textContent = phone(); poll(); }
$("#compose").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = $("#msg").value.trim();
  if (!body) return;
  $("#msg").value = "";
  waiting = true;
  await fetch("/dev/api/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: phone(), body }) });
  poll();
});
$("#reset").addEventListener("click", async () => {
  await fetch("/dev/api/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: phone() }) });
  $("#status").textContent = "Cleared " + phone() + ". Text hi to start onboarding.";
  restart();
});
$("#tick").addEventListener("click", async () => {
  const r = await fetch("/dev/api/tick", { method: "POST" });
  const j = await r.json();
  $("#status").textContent = "Scheduler sent " + j.reminders + " reminder(s) and " + j.nudges + " check-in(s).";
  poll();
});
$("#phone").addEventListener("change", restart);
restart();
setInterval(poll, 1500);
`,
  });
}
