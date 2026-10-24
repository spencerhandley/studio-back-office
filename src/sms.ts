import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { messages, type User } from "./db.ts";

// Twilio joins long messages up to 1,600 characters. Split above that so nothing is cut off.
const MAX_SEGMENT = 1500;

export function splitForSms(body: string): string[] {
  const text = body.trim();
  if (text.length <= MAX_SEGMENT) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_SEGMENT) {
    let cut = rest.lastIndexOf("\n", MAX_SEGMENT);
    if (cut < MAX_SEGMENT / 2) cut = rest.lastIndexOf(" ", MAX_SEGMENT);
    if (cut < MAX_SEGMENT / 2) cut = MAX_SEGMENT;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendSms(user: Pick<User, "id" | "phone" | "opted_out">, body: string): Promise<void> {
  if (user.opted_out) return;
  for (const part of splitForSms(body)) {
    const id = messages.add(user.id, "out", part, { status: config.smsMode === "twilio" ? "queued" : "simulated" });
    if (config.smsMode !== "twilio") continue;
    try {
      const sid = await twilioSend(user.phone, part);
      messages.setStatus(id, "sent", null, sid);
    } catch (err) {
      messages.setStatus(id, "failed", String(err));
      console.error(`[sms] send to user ${user.id} failed:`, err);
    }
  }
}

async function twilioSend(to: string, body: string): Promise<string> {
  const { accountSid, authToken, from, messagingServiceSid } = config.twilio;
  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const json = (await res.json()) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${json.message ?? "unknown error"}`);
  return json.sid ?? "";
}

// Twilio signs the full URL plus every POST param sorted by name, with HMAC-SHA1 and the auth token.
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Downloads MMS images so the model can see them. Twilio media URLs need account auth.
export async function fetchMedia(url: string): Promise<{ mediaType: string; base64: string } | null> {
  try {
    const headers: Record<string, string> = {};
    if (config.twilio.accountSid && url.startsWith("https://api.twilio.com")) {
      headers.Authorization = "Basic " + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
    }
    const res = await fetch(url, { headers, redirect: "follow" });
    if (!res.ok) return null;
    const mediaType = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4.5 * 1024 * 1024) return null;
    return { mediaType, base64: buf.toString("base64") };
  } catch {
    return null;
  }
}

export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
