// Points TWILIO_FROM's incoming-message webhook at {PUBLIC_URL}/sms/inbound. Leaves voice settings alone.
// Useful when PUBLIC_URL changes, for example a tunnel that gets a new address on restart.
//
//   node --env-file=.env --experimental-strip-types scripts/set-webhook.ts
const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from, PUBLIC_URL: publicUrl } = process.env;
if (!sid || !token || !from || !publicUrl) throw new Error("Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM and PUBLIC_URL");

const auth = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers`;
const list = (await (await fetch(`${base}.json?PhoneNumber=${encodeURIComponent(from)}`, { headers: { Authorization: auth } })).json()) as {
  incoming_phone_numbers?: { sid: string; sms_url: string }[];
};
const number = list.incoming_phone_numbers?.[0];
if (!number) throw new Error(`${from} is not on this Twilio account`);

const target = `${publicUrl.replace(/\/$/, "")}/sms/inbound`;
if (number.sms_url === target) {
  console.log(`webhook already ${target}`);
} else {
  const res = await fetch(`${base}/${number.sid}.json`, {
    method: "POST",
    headers: { Authorization: auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SmsUrl: target, SmsMethod: "POST" }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
  console.log(`webhook ${number.sms_url} -> ${target}`);
}
