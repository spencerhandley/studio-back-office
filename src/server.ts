import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.ts";
import { artifacts, memories, messages, reminders, users } from "./db.ts";
import { ALL_TYPE_IDS, userTypeIds } from "./catalog.ts";
import { rebuildPlan } from "./artifacts.ts";
import { handleInbound, startFromWeb } from "./conversation.ts";
import { normalizePhone, verifyTwilioSignature } from "./sms.ts";
import { SESSION_COOKIE, endSession, redeemLoginToken, sessionCookie, userForSession } from "./auth.ts";
import { isValidTz } from "./time.ts";
import { startScheduler, tick } from "./scheduler.ts";
import { artifactPage, dashboardPage, landingPage, signInPage, simulatorPage } from "./web/pages.ts";

const CSP_NO_SCRIPT =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const CSP_INLINE_SCRIPT = CSP_NO_SCRIPT.replace("default-src 'none'", "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'");

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", "content-security-policy": CSP_NO_SCRIPT, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
  res.end(body);
}
const json = (res: ServerResponse, status: number, data: unknown) =>
  send(res, status, JSON.stringify(data), { "content-type": "application/json" });
const redirect = (res: ServerResponse, to: string, headers: Record<string, string> = {}) => {
  res.writeHead(303, { location: to, ...headers });
  res.end();
};

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("Body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await readBody(req)));
}

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k, decodeURIComponent(v)]),
  );
}

// Forms only post from our own pages. SameSite cookies cover most of this; the Origin check covers the rest.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === new URL(config.publicUrl).origin || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

// A light per-IP limit on the signup form so it can't be used to spam numbers.
const signupHits = new Map<string, number[]>();
function signupAllowed(ip: string): boolean {
  const now = Date.now();
  const hits = (signupHits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (hits.length >= 5) return false;
  hits.push(now);
  signupHits.set(ip, hits);
  return true;
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", config.publicUrl);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/health") return json(res, 200, { ok: true });

  if (method === "GET" && path === "/") return send(res, 200, landingPage());

  if (method === "POST" && path === "/signup") {
    if (!sameOrigin(req)) return send(res, 403, "Forbidden");
    const form = await readForm(req);
    const phone = normalizePhone(form.phone ?? "");
    if (!phone) return send(res, 400, landingPage({ kind: "error", text: "That doesn't look like a mobile number. Try it with the area code." }));
    if (form.consent !== "yes") return send(res, 400, landingPage({ kind: "error", text: "Check the box to agree to texts so Studio can reach you." }));
    if (!signupAllowed(req.socket.remoteAddress ?? "unknown")) {
      return send(res, 429, landingPage({ kind: "error", text: "Too many tries from this connection. Wait an hour, or text START instead." }));
    }
    const outcome = await startFromWeb(phone);
    const text = outcome === "link_sent" ? "You already have a studio. We just texted you a sign-in link." : "Check your phone. Studio just texted you.";
    return send(res, 200, landingPage({ kind: "ok", text }));
  }

  if (method === "POST" && path === "/sms/inbound") {
    const params = await readForm(req);
    if (config.smsMode === "twilio" && !config.twilio.skipSignature) {
      const ok = verifyTwilioSignature(config.twilio.authToken, `${config.publicUrl}/sms/inbound`, params, req.headers["x-twilio-signature"] as string | undefined);
      if (!ok) return send(res, 403, "Invalid signature", { "content-type": "text/plain" });
    }
    const phone = normalizePhone(params.From ?? "");
    const media: string[] = [];
    for (let i = 0; i < Number(params.NumMedia ?? 0); i++) if (params[`MediaUrl${i}`]) media.push(params[`MediaUrl${i}`]);
    // Reply to Twilio right away and send our answer through the API, since model calls can take a while.
    send(res, 200, "<Response></Response>", { "content-type": "text/xml" });
    if (phone) handleInbound(phone, params.Body ?? "", media).catch((err) => console.error("[inbound] failed:", err));
    return;
  }

  if (method === "GET" && path === "/login") {
    const session = redeemLoginToken(url.searchParams.get("t") ?? "");
    if (!session) return send(res, 400, signInPage("That link has expired"));
    return redirect(res, "/app", { "set-cookie": sessionCookie(session) });
  }

  if (method === "POST" && path === "/logout") {
    endSession(cookies(req)[SESSION_COOKIE]);
    return redirect(res, "/", { "set-cookie": sessionCookie("", 0) });
  }

  if (path === "/app" || path.startsWith("/app/")) {
    const user = userForSession(cookies(req)[SESSION_COOKIE]);
    if (!user) return send(res, 401, signInPage());
    if (method === "GET" && path === "/app") {
      const flash = url.searchParams.get("saved") ? "Settings saved." : url.searchParams.get("done") ?? undefined;
      return send(res, 200, dashboardPage(user, flash === "canceled" ? "Reminder canceled." : flash === "forgot" ? "Forgotten." : flash));
    }
    if (method !== "POST") return send(res, 405, "Method not allowed");
    if (!sameOrigin(req)) return send(res, 403, "Forbidden");
    const form = await readForm(req);

    if (path === "/app/settings") {
      const start = form.work_start ?? "";
      const end = form.work_end ?? "";
      const hhmm = /^\d{2}:\d{2}$/;
      const hours = hhmm.test(start) && hhmm.test(end) && start !== end ? { work_start: start, work_end: end } : { work_start: null, work_end: null };
      // The main discipline moves to the front; the creator's other disciplines stay.
      const primary = ALL_TYPE_IDS.includes(form.creator_type ?? "") ? form.creator_type! : user.creator_type;
      const types = primary ? [primary, ...userTypeIds(user).filter((t) => t !== primary)] : userTypeIds(user);
      users.update(user.id, {
        name: (form.name ?? "").trim().slice(0, 40) || user.name,
        creator_type: primary,
        creator_types: JSON.stringify(types),
        tz: isValidTz(form.tz ?? "") ? form.tz : user.tz,
        paused: form.checkins === "on" ? 0 : 1,
        ...hours,
      });
      const fresh = users.byId(user.id)!;
      if (fresh.onboarded_at) rebuildPlan(fresh);
      return redirect(res, "/app?saved=1");
    }
    let m = path.match(/^\/app\/reminders\/(\d+)\/cancel$/);
    if (m) {
      reminders.cancel(user.id, Number(m[1]));
      return redirect(res, "/app?done=canceled");
    }
    m = path.match(/^\/app\/memories\/(\d+)\/delete$/);
    if (m) {
      memories.delete(user.id, Number(m[1]));
      return redirect(res, "/app?done=forgot");
    }
    if (path === "/app/delete" && form.confirm === "yes") {
      endSession(cookies(req)[SESSION_COOKIE]);
      users.delete(user.id);
      return redirect(res, "/", { "set-cookie": sessionCookie("", 0) });
    }
    return send(res, 404, "Not found");
  }

  const a = method === "GET" ? path.match(/^\/a\/([A-Za-z0-9_-]{8,40})$/) : null;
  if (a) {
    const artifact = artifacts.byPublicId(a[1]);
    const owner = artifact && users.byId(artifact.user_id);
    if (!artifact || !owner) return send(res, 404, signInPage("That page doesn't exist"));
    return send(res, 200, artifactPage(artifact, owner), { "x-robots-tag": "noindex, nofollow" });
  }

  if (config.devTools && path.startsWith("/dev/")) return devRoute(req, res, url, method, path);

  return send(res, 404, signInPage("Page not found"));
}

// Simulator endpoints. Off in production unless DEV_TOOLS=1.
async function devRoute(req: IncomingMessage, res: ServerResponse, url: URL, method: string, path: string) {
  if (method === "GET" && path === "/dev/phone") return send(res, 200, simulatorPage(), { "content-security-policy": CSP_INLINE_SCRIPT });
  if (method === "GET" && path === "/dev/api/thread") {
    const phone = normalizePhone(url.searchParams.get("phone") ?? "");
    const user = phone ? users.byPhone(phone) : undefined;
    const after = Number(url.searchParams.get("after") ?? 0);
    return json(res, 200, { messages: user ? messages.since(user.id, after).map(({ id, direction, body, created_at }) => ({ id, direction, body, created_at })) : [] });
  }
  if (method === "POST" && path === "/dev/api/send") {
    const body = JSON.parse((await readBody(req)) || "{}") as { phone?: string; body?: string };
    const phone = normalizePhone(body.phone ?? "");
    if (!phone) return json(res, 400, { error: "Bad phone number" });
    const work = handleInbound(phone, body.body ?? "");
    if (url.searchParams.get("wait") === "1") await work;
    else work.catch((err) => console.error("[dev] inbound failed:", err));
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/dev/api/reset") {
    const body = JSON.parse((await readBody(req)) || "{}") as { phone?: string };
    const phone = normalizePhone(body.phone ?? "");
    const user = phone ? users.byPhone(phone) : undefined;
    if (user) users.delete(user.id);
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/dev/api/tick") return json(res, 200, await tick());
  return json(res, 404, { error: "Not found" });
}

const server = createServer((req, res) => {
  route(req, res).catch((err) => {
    console.error("[http] error:", err);
    if (!res.headersSent) send(res, 500, "Something went wrong.", { "content-type": "text/plain" });
  });
});

server.listen(config.port, () => {
  console.log(`Studio listening on ${config.publicUrl} (sms: ${config.smsMode}, llm: ${config.llm.provider})`);
  if (config.devTools) console.log(`Phone simulator: ${config.publicUrl}/dev/phone`);
  startScheduler(config.schedulerIntervalMs);
});
