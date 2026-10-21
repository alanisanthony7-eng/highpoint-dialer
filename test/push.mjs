// Phone alerts (Web Push) — local, with in-memory D1, a fake push service and an independent decoder for the messages.
import { DatabaseSync } from "node:sqlite";
const { onRequest } = await import("../functions/api/[[path]].js");
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok" };
import crypto from "node:crypto";
let skew = 0; const realNow = Date.now.bind(Date); Date.now = () => realNow() + skew;
const pushes = []; // everything the fake push service receives
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname === "push.example.net") { pushes.push({ path: u.pathname, headers: Object.fromEntries(Object.entries(o.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: Buffer.from(o.body) }); return new Response(null, { status: u.pathname.startsWith("/gone") ? 410 : 201 }); }
  if (/Messages\.json$/.test(u.pathname)) return new Response(JSON.stringify({ sid: "SM1" }), { status: 201, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = { "cf-connecting-ip": "203.0.113.9" }; if (who && jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const waits = [];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  const sc = r.headers.get("set-cookie"); if (sc && who) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j, h: r.headers };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const b64u = (b) => Buffer.from(b).toString("base64url");

/* a browser's side: a subscription we hold the private key for, and a decoder written separately from the sender (RFC 8291) */
function device(path) {
  const ecdh = crypto.createECDH("prime256v1"); ecdh.generateKeys();
  const pub = ecdh.getPublicKey(), auth = crypto.randomBytes(16);
  return { ecdh, pub, auth, sub: { endpoint: "https://push.example.net" + path, keys: { p256dh: b64u(pub), auth: b64u(auth) } } };
}
function decode(dev, msg) {
  const salt = msg.subarray(0, 16), rs = msg.readUInt32BE(16), idlen = msg[20], asPub = msg.subarray(21, 21 + idlen), ct = msg.subarray(21 + idlen);
  const secret = dev.ecdh.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, dev.auth, Buffer.concat([Buffer.from("WebPush: info\0"), dev.pub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  if (plain[plain.length - 1] !== 2) throw new Error("bad padding");
  const text = plain.subarray(0, plain.length - 1).toString(); let json; try { json = JSON.parse(text); } catch {}
  return { rs, idlen, text, json };
}
const last = () => pushes[pushes.length - 1];

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });
await call("rep2", "/api/auth/signup", { method: "POST", body: { email: "rep2@hp.com", password: "password3", name: "Sam Seller", invite: "HP2026", agree: true } });
const rep = (await call("rep", "/api/auth/me")).j.user;
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, company: "Highpoint Financial" } } });

/* ---------- keys and subscribing ---------- */
let r = await call(null, "/api/push/key"); const key = r.j.key;
ok(r.s === 200 && Buffer.from(key, "base64url").length === 65 && Buffer.from(key, "base64url")[0] === 4, "the desk makes its own public key (an uncompressed P-256 point)");
ok((await call(null, "/api/push/key")).j.key === key, "and keeps it");
ok((await call(null, "/api/push/status")).s === 401, "alert settings need a sign-in");
const phone = device("/ok/phone"), laptop = device("/gone/laptop");
ok((await call("rep", "/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: "http://insecure.example/x", keys: phone.sub.keys } } })).s === 400, "an address that isn't https is refused");
ok((await call("rep", "/api/push/subscribe", { method: "POST", body: { subscription: { endpoint: phone.sub.endpoint } } })).s === 400, "and one without keys");
ok((await call("rep", "/api/push/test", { method: "POST", body: {} })).s === 400, "a test with no device says so");
r = await call("rep", "/api/push/subscribe", { method: "POST", body: { subscription: phone.sub, label: "iPhone · Highpoint app" } });
ok(r.s === 200 && r.j.devices === 1, "a phone turns alerts on");
await call("rep", "/api/push/subscribe", { method: "POST", body: { subscription: phone.sub, label: "iPhone · Highpoint app" } });
r = await call("rep", "/api/push/subscribe", { method: "POST", body: { subscription: laptop.sub, label: "Windows · Chrome" } });
ok(r.j.devices === 2, "subscribing the same phone again doesn't add a second copy; a laptop does");
r = await call("rep", "/api/push/status");
ok(r.j.devices.length === 2 && r.j.devices[0].label === "iPhone · Highpoint app" && !JSON.stringify(r.j).includes(phone.sub.keys.auth) && r.j.prefs.newLead === true && r.j.events.whisper, "status lists devices (no secrets) and which alerts are on");
ok((await call("rep2", "/api/push/status")).j.devices.length === 0, "other agents don't see them");

/* ---------- the message itself ---------- */
r = await call("rep", "/api/push/test", { method: "POST", body: {} });
const toPhone = pushes.find((p) => p.path === "/ok/phone");
ok(r.s === 200 && r.j.sent === 1 && toPhone, "a test alert goes to the phone");
const dec = decode(phone, toPhone.body);
ok(dec.rs === 4096 && dec.idlen === 65 && dec.json.title === "Highpoint Desk alerts are on" && dec.json.event === "test", "the message decrypts with the phone's own key (RFC 8291 format): " + dec.json.title);
ok(toPhone.headers["content-encoding"] === "aes128gcm" && toPhone.headers.ttl === "300" && toPhone.headers.urgency, "with the standard headers");
// the VAPID proof the push service checks
const auth = toPhone.headers.authorization, m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
ok(!!m && m[2] === key, "it's signed with the desk's key");
const [h64, c64, s64] = m[1].split("."), claims = JSON.parse(Buffer.from(c64, "base64url")), kb = Buffer.from(key, "base64url");
const pubKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(kb.subarray(1, 33)), y: b64u(kb.subarray(33)) }, format: "jwk" });
ok(crypto.verify("sha256", Buffer.from(h64 + "." + c64), { key: pubKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s64, "base64url")), "and the signature checks out (ES256)");
ok(claims.aud === "https://push.example.net" && claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400 && /^mailto:/.test(claims.sub), "for the right push service, good for under a day, with a contact");
ok(r.j.failed === 1, "the laptop's subscription was gone (410)");
ok((await call("rep", "/api/push/status")).j.devices.length === 1, "so it's removed automatically");
const { encryptPayload } = await import("../src/lib/push.mjs"), longText = "ünïcode ✓ " + "x".repeat(2000);
ok(decode(phone, Buffer.from(await encryptPayload(phone.sub, longText))).text === longText, "long and non-English messages decode too");
let tooBig = false; try { await encryptPayload(phone.sub, "x".repeat(4100)); } catch { tooBig = true; }
ok(tooBig, "a message that wouldn't fit in one record is refused instead of sent broken");

/* ---------- which alerts ---------- */
r = await call("rep", "/api/push/prefs", { method: "POST", body: { events: { newLead: false, bogus: false, booked: "no" } } });
ok(r.j.prefs.newLead === false && r.j.prefs.booked === true && !("bogus" in r.j.prefs), "alerts can be switched off one by one (junk is ignored)");

// a new lead on a posting URL
r = await call("rep", "/api/leads/urls", { method: "POST", body: { op: "create", name: "EverQuote FEX", product: "FE", stage: "new" } });
const token = r.j.url.url.split("/").pop();
let n = pushes.length;
r = await call(null, "/api/leads/in/" + token, { method: "POST", body: { first_name: "Margaret", last_name: "Lee", phone: "2125550142", state: "NY" } });
ok(r.j.status === "added" && pushes.length === n, "with new-lead alerts off, nothing is sent");
await call("rep", "/api/push/prefs", { method: "POST", body: { events: { newLead: true } } });
r = await call(null, "/api/leads/in/" + token, { method: "POST", body: { first_name: "Earl", last_name: "Jones", phone: "3055550100", state: "FL" } });
ok(r.j.status === "added" && pushes.length === n + 1, "with them on, a new lead alerts the agent right away");
let msg = decode(phone, last().body).json;
ok(msg.title === "New lead: Earl Jones" && /EverQuote FEX/.test(msg.body) && msg.url === "/?lead=" + r.j.id && msg.event === "newLead", "it says who, from where, and opens that client: " + msg.title + " / " + msg.body);
n = pushes.length;
await call(null, "/api/leads/in/" + token, { method: "POST", body: { first_name: "Earl", phone: "3055550100" } });
ok(pushes.length === n, "a duplicate isn't announced again");
await call("rep", "/api/leads/test", { method: "POST", body: { id: r.j.id } });
ok(pushes.length === n, "test leads don't alert");

// a booking
const all = Array(7).fill(["00:00", "23:59"]);
await call("rep", "/api/book/settings", { method: "POST", body: { on: true, hours: all, length: 20, buffer: 0, notice: 0, ahead: 14, tz: "America/New_York", maxPerDay: 0 } });
r = await call(null, "/api/book/p/rita-rep"); const at = r.j.days[2].slots[10];
n = pushes.length;
r = await call(null, "/api/book/p/rita-rep", { method: "POST", body: { at, tz: "America/New_York", first: "Ruth", last: "Ann", phone: "(404) 555-0123", state: "GA", product: "MP", consent: true } });
ok(r.j.ok && pushes.length === n + 1, "a client booking a call alerts the agent");
msg = decode(phone, last().body).json;
ok(msg.title === "New booking: Ruth Ann" && /\(404\) 555-0123/.test(msg.body) && msg.event === "booked", msg.title + " / " + msg.body);

// a text from a client
const { setJ } = await import("../src/lib/hp.mjs");
await setJ("numbers", "all", { "+12125550000": { e164: "+12125550000", areaCode: "212", state: "NY", owner: rep.identity, provider: "twilio" } });
await call("rep", "/api/dialer/sms"); // registers the agent
const { receiveText } = await import("../src/lib/sms.mjs");
n = pushes.length;
await receiveText({ from: "+13055550100", line: "+12125550000", body: "Yes please call me after 5" });
ok(pushes.length === n + 1, "a client's text alerts the agent");
msg = decode(phone, last().body).json;
ok(/^Text from /.test(msg.title) && msg.body === "Yes please call me after 5" && msg.event === "text", msg.title);
await receiveText({ from: "+13055550100", line: "+12125550000", body: "STOP" });
ok(pushes.length === n + 1, "a STOP reply isn't announced");

// an appointment 15 minutes ahead
await call("rep", "/api/docs/leads/L9", { method: "PUT", body: { first: "Ray", last: "Cole", phone: "2125550122", state: "NY", stage: "appointment" } });
const apptAt = realNow() + 3 * 36e5;
await call("rep", "/api/docs/appts/A9", { method: "PUT", body: { leadId: "L9", at: apptAt, title: "Call Ray", type: "Phone call", done: false } });
r = await call("rep", "/api/followups/queue");
ok(!r.j.queue.some((x) => x.kind === "pushAppt"), "these reminders don't clutter the text queue");
n = pushes.length;
await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n, "nothing before it's time");
skew = 3 * 36e5 - 14 * 60_000; await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n + 1, "fifteen minutes before the appointment the agent is alerted");
msg = decode(phone, last().body).json;
ok(msg.title === "Appointment in 15 minutes" && /Ray Cole/.test(msg.body) && msg.event === "appt", msg.body);
// moved appointments don't alert at the old time
skew = 0;
await call("rep", "/api/docs/appts/A8", { method: "PUT", body: { leadId: "L9", at: realNow() + 6 * 36e5, title: "Call Ray again", done: false } });
await call("rep", "/api/docs/appts/A8", { method: "PUT", body: { leadId: "L9", at: realNow() + 10 * 36e5, title: "Call Ray again", done: false } });
n = pushes.length; skew = 6 * 36e5 - 14 * 60_000; await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n, "an appointment that moved doesn't alert at its old time");
skew = 10 * 36e5 - 14 * 60_000; await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n + 1 && decode(phone, last().body).json.title === "Appointment in 15 minutes", "it alerts at the new time instead");
n = pushes.length; await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n, "and only once");
await call("rep", "/api/docs/appts/A7", { method: "PUT", body: { leadId: "L9", at: realNow() + 12 * 36e5, title: "Done already", done: false } });
await call("rep", "/api/docs/appts/A7", { method: "PUT", body: { leadId: "L9", at: realNow() + 12 * 36e5, title: "Done already", done: true } });
n = pushes.length; skew = 12 * 36e5 - 14 * 60_000; await call("boss", "/api/followups/run", { method: "POST", body: {} });
ok(pushes.length === n, "a finished appointment doesn't alert");

/* ---------- turning off ---------- */
r = await call("rep", "/api/push/unsubscribe", { method: "POST", body: { endpoint: phone.sub.endpoint } });
ok(r.s === 200 && (await call("rep", "/api/push/status")).j.devices.length === 0, "a device can be removed");
n = pushes.length; await call(null, "/api/leads/in/" + token, { method: "POST", body: { first_name: "Nora", phone: "7275550100" } });
ok(pushes.length === n, "and then nothing is sent to it");
