import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuiet, parseHours, parseTz, zonedToUtc, formatLocalIso } from "../src/time.ts";
import { classifyCreator, classifyCreatorAll, describeTypes, earnExamples, getType, mergedStarters, TYPES } from "../src/catalog.ts";
import { parseName } from "../src/onboarding.ts";
import { normalizePhone, splitForSms, twilioSignature, verifyTwilioSignature } from "../src/sms.ts";

test("parseHours reads common answers", () => {
  assert.deepEqual(parseHours("9am to 1pm, Eastern"), { start: "09:00", end: "13:00" });
  assert.deepEqual(parseHours("9-1"), { start: "09:00", end: "13:00" });
  assert.deepEqual(parseHours("1-5"), { start: "13:00", end: "17:00" });
  assert.deepEqual(parseHours("10:30am - 2:30pm"), { start: "10:30", end: "14:30" });
  assert.deepEqual(parseHours("9-1pm pacific"), { start: "09:00", end: "13:00" });
  assert.deepEqual(parseHours("8pm to 11pm"), { start: "20:00", end: "23:00" });
  assert.deepEqual(parseHours("mornings mostly"), { start: "08:00", end: "12:00" });
  assert.equal(parseHours("it varies, honestly"), "none");
  assert.equal(parseHours("I'm in Denver"), null);
});

test("parseTz maps words and cities to zones", () => {
  assert.equal(parseTz("9-1, Eastern"), "America/New_York");
  assert.equal(parseTz("pacific time"), "America/Los_Angeles");
  assert.equal(parseTz("I live in Austin"), "America/Chicago");
  assert.equal(parseTz("Denver"), "America/Denver");
  assert.equal(parseTz("Europe/Lisbon"), "Europe/Lisbon");
  assert.equal(parseTz("mornings"), null);
});

test("classifyCreator picks the closest creator type", () => {
  assert.equal(classifyCreator("oil paintings, mostly landscapes"), "painters");
  assert.equal(classifyCreator("I shoot weddings and portraits as a photographer"), "photographers");
  assert.equal(classifyCreator("wedding videos and some corporate video"), "videographers");
  assert.equal(classifyCreator("I play in a band and we tour"), "musicians");
  assert.equal(classifyCreator("tattoos, mostly fine line"), "tattoo");
  assert.equal(classifyCreator("I teach guitar lessons online"), "teachers");
  assert.equal(classifyCreator("a YouTube channel about cooking"), "youtubers");
  assert.equal(classifyCreator("handmade silver jewelry on Etsy"), "makers");
  assert.equal(classifyCreator("stuff"), null);
});

test("multi-discipline creators keep every discipline, in the order they said them", () => {
  const ids = classifyCreatorAll("I'm a musician and a YouTuber and I have a podcast that I published on YouTube and I run a course Company for guitarist called Sonora");
  assert.deepEqual(ids, ["musicians", "youtubers", "podcasters", "teachers"]);
  assert.equal(describeTypes(ids), "musician, YouTuber, podcaster and educator");
  assert.doesNotMatch(earnExamples(ids), /galler/i);
  assert.match(earnExamples(["painters"]), /galleries/);
  const starters = mergedStarters(ids).map((s) => s.key);
  assert.equal(starters[0], "shows");
  assert.ok(starters.includes("deals") && starters.includes("show") && starters.includes("students"));
  assert.ok(starters.length <= 5);
});

test("parseName strips greetings and lead-ins", () => {
  assert.equal(parseName("I'm Maya"), "Maya");
  assert.equal(parseName("hey, it's dev patel"), "Dev Patel");
  assert.equal(parseName("Call me Jo."), "Jo");
  assert.equal(parseName("hi"), null);
  assert.equal(parseName("555 1234"), null);
});

test("normalizePhone produces E.164", () => {
  assert.equal(normalizePhone("(415) 555-0123"), "+14155550123");
  assert.equal(normalizePhone("1 415 555 0123"), "+14155550123");
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalizePhone("12345"), null);
});

test("zonedToUtc round-trips through DST", () => {
  const summer = zonedToUtc("2026-07-01T14:00", "America/New_York")!;
  assert.equal(summer.toISOString(), "2026-07-01T18:00:00.000Z");
  const winter = zonedToUtc("2026-12-01T14:00", "America/New_York")!;
  assert.equal(winter.toISOString(), "2026-12-01T19:00:00.000Z");
  assert.equal(formatLocalIso(winter, "America/New_York"), "2026-12-01T14:00");
});

test("isQuiet covers night and making time", () => {
  const user = { tz: "America/New_York", work_start: "09:00", work_end: "13:00" };
  assert.equal(isQuiet(user, zonedToUtc("2026-10-26T10:00", user.tz)!), true);
  assert.equal(isQuiet(user, zonedToUtc("2026-10-26T15:00", user.tz)!), false);
  assert.equal(isQuiet(user, zonedToUtc("2026-10-26T22:30", user.tz)!), true);
  assert.equal(isQuiet({ ...user, work_start: null, work_end: null }, zonedToUtc("2026-10-26T10:00", user.tz)!), false);
});

test("splitForSms keeps long replies intact across parts", () => {
  const long = Array.from({ length: 80 }, (_, i) => `Line ${i} of a long draft reply.`).join("\n");
  const parts = splitForSms(long);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1500));
  assert.equal(parts.join("\n"), long);
});

test("Twilio signatures verify and reject tampering", () => {
  const url = "https://studio.example.com/sms/inbound";
  const params = { From: "+14155550123", Body: "hi", NumMedia: "0" };
  const sig = twilioSignature("secret", url, params);
  assert.equal(verifyTwilioSignature("secret", url, params, sig), true);
  assert.equal(verifyTwilioSignature("secret", url, { ...params, Body: "bye" }, sig), false);
  assert.equal(verifyTwilioSignature("other", url, params, sig), false);
  assert.equal(verifyTwilioSignature("secret", url, params, undefined), false);
});

test("every starter step asks one question, since its ask is texted as is in replies and check-ins", () => {
  const starters = [...TYPES, getType("other")].flatMap((t) => t.starters);
  assert.ok(starters.length > 30);
  for (const s of starters) assert.ok((s.ask.match(/\?/g) ?? []).length <= 1, `${s.key}: ${s.ask}`);
});
