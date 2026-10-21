// Phone and desktop alerts (Web Push). No outside service and nothing for the owner to set up:
// the desk makes its own VAPID key the first time it's needed, and sends straight to each browser's push service.
//  GET  /api/push/key                        public key for the browser to subscribe with
//  POST /api/push/subscribe   {subscription, label}     this device wants alerts
//  POST /api/push/unsubscribe {endpoint}
//  GET  /api/push/status                     this person's devices and which alerts are on
//  POST /api/push/prefs       {events: {newLead, booked, text, appt, whisper}}
//  POST /api/push/test                       sends an alert to all of this person's devices
import { getStore } from "./store.mjs";
import { requireUser } from "./auth.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const kv = () => getStore("hpd-push");
const enc = new TextEncoder();
const subtle = () => globalThis.crypto.subtle;

export const EVENTS = {
  newLead: "A new lead arrives",
  booked: "A client books a call",
  text: "A client texts back",
  appt: "An appointment is about to start",
  whisper: "A manager sends me a message during a call",
};
const DEFAULT_PREFS = { newLead: true, booked: true, text: true, appt: true, whisper: true };

/* ---------- base64url + bytes ---------- */
export const b64u = (buf) => { const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ""; for (const x of a) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
export const unb64u = (s) => { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/* ---------- the desk's VAPID key (made once, kept in the database) ---------- */
let vapidCache = null;
export async function vapid() {
  if (vapidCache) return vapidCache;
  let rec = await kv().get("vapid", { type: "json" }).catch(() => null);
  if (!rec) {
    const kp = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    rec = { pub: b64u(await subtle().exportKey("raw", kp.publicKey)), jwk: await subtle().exportKey("jwk", kp.privateKey), at: Date.now() };
    const r = await kv().setJSON("vapid", rec, { onlyIfNew: true });
    if (r?.modified === false) rec = await kv().get("vapid", { type: "json" }); // another request made it first
  }
  const key = await subtle().importKey("jwk", rec.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return (vapidCache = { pub: rec.pub, key });
}
async function vapidHeader(endpoint) {
  const v = await vapid(), aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:" + (env("HP_PUSH_CONTACT") || "support@highpointfinancial.co") })));
  const sig = new Uint8Array(await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.pub}`;
}

/* ---------- message encryption (RFC 8291, aes128gcm) ---------- */
async function hkdf(salt, ikm, info, bytes) {
  const k = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}
// `fixed` is for tests only: a known ephemeral key and salt
export async function encryptPayload(sub, text, fixed) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const uaKey = await subtle().importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = fixed?.eph || (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPub = new Uint8Array(await subtle().exportKey("raw", eph.publicKey));
  const secret = new Uint8Array(await subtle().deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, secret, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = fixed?.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const data = enc.encode(text); if (data.length > 4096 - 17 - 1) throw new Error("Alert too long"); // one 4096-byte record
  const plain = cat(data, new Uint8Array([2])); // 0x02 ends the only record
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return cat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

/* ---------- sending ---------- */
// resolves to "ok", "gone" (the device removed the subscription) or "error"
export async function sendOne(sub, payload, { ttl = 3600, urgency = "high" } = {}) {
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const r = await fetch(sub.endpoint, { method: "POST", headers: { authorization: await vapidHeader(sub.endpoint), "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: String(ttl), urgency }, body, signal: AbortSignal.timeout?.(8000) });
    if (r.status === 404 || r.status === 410) return "gone";
    if (r.status === 413 || r.status === 400) return "error";
    return r.ok ? "ok" : "error";
  } catch (e) { console.error("push", e?.message); return "error"; }
}

/* ---------- who has what ---------- */
const subsOf = async (uid) => (await kv().get("s:" + uid, { type: "json" }).catch(() => null)) || [];
export async function prefsOf(uid) { return { ...DEFAULT_PREFS, ...((await kv().get("p:" + uid, { type: "json" }).catch(() => null)) || {}) }; }
async function saveSubs(uid, list) { await kv().setJSON("s:" + uid, list.slice(-8)); }

// an alert for one person. event: one of EVENTS; payload: { title, body, url, tag }. Never throws.
// `ctx` (optional) lets the work finish after the response has gone out.
export function notify(uid, event, payload, ctx) {
  const run = (async () => {
    try {
      if (!uid || !EVENTS[event]) return { sent: 0 };
      const prefs = await prefsOf(uid); if (prefs[event] === false) return { sent: 0, off: true };
      const subs = await subsOf(uid); if (!subs.length) return { sent: 0 };
      const msg = { title: String(payload.title || "Highpoint Desk").slice(0, 80), body: String(payload.body || "").slice(0, 220), url: payload.url || "/", tag: payload.tag || event, event, at: Date.now() };
      const res = await Promise.all(subs.map((s) => sendOne(s, msg, { ttl: payload.ttl || 3600 })));
      const keep = subs.filter((_, i) => res[i] !== "gone");
      if (keep.length !== subs.length) await saveSubs(uid, keep);
      return { sent: res.filter((x) => x === "ok").length, failed: res.filter((x) => x === "error").length };
    } catch (e) { console.error("notify", e?.message); return { sent: 0 }; }
  })();
  if (ctx?.waitUntil) { ctx.waitUntil(run); return run; }
  return run;
}

/* ---------- routes ---------- */
export async function pushRoute(req, action) {
  if (action === "key") return json({ key: (await vapid()).pub });
  const user = await requireUser(req);
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (action === "status") {
    const subs = await subsOf(user.id);
    return json({ devices: subs.map((s) => ({ endpoint: s.endpoint, label: s.label || "A device", at: s.at })), prefs: await prefsOf(user.id), events: EVENTS });
  }
  if (action === "subscribe" && req.method === "POST") {
    const s = b.subscription || {};
    let host = ""; try { const u = new URL(s.endpoint); if (u.protocol !== "https:") throw new Error("x"); host = u.hostname; } catch { return json({ error: "That device didn't send a valid alert address." }, 400); }
    if (!s.keys?.p256dh || !s.keys?.auth) return json({ error: "That device didn't send its keys." }, 400);
    const label = String(b.label || "").replace(/[<>]/g, "").slice(0, 60) || host;
    const list = (await subsOf(user.id)).filter((x) => x.endpoint !== s.endpoint);
    list.push({ endpoint: s.endpoint, keys: { p256dh: String(s.keys.p256dh), auth: String(s.keys.auth) }, label, at: Date.now() });
    await saveSubs(user.id, list);
    return json({ ok: true, devices: list.length });
  }
  if (action === "unsubscribe" && req.method === "POST") {
    await saveSubs(user.id, (await subsOf(user.id)).filter((x) => x.endpoint !== String(b.endpoint || "")));
    return json({ ok: true });
  }
  if (action === "prefs" && req.method === "POST") {
    const cur = await prefsOf(user.id), next = { ...cur };
    for (const k of Object.keys(EVENTS)) if (typeof b.events?.[k] === "boolean") next[k] = b.events[k];
    await kv().setJSON("p:" + user.id, next);
    return json({ ok: true, prefs: next });
  }
  if (action === "test" && req.method === "POST") {
    const subs = await subsOf(user.id);
    if (!subs.length) return json({ error: "No device on this account has alerts turned on yet." }, 400);
    const msg = { title: "Highpoint Desk alerts are on", body: "You'll see new leads, bookings and texts here.", url: "/", tag: "test", event: "test", at: Date.now() };
    const res = await Promise.all(subs.map((s) => sendOne(s, msg, { ttl: 300 })));
    const keep = subs.filter((_, i) => res[i] !== "gone"); if (keep.length !== subs.length) await saveSubs(user.id, keep);
    return json({ ok: true, sent: res.filter((x) => x === "ok").length, failed: res.filter((x) => x !== "ok").length });
  }
  return json({ error: "Unknown action" }, 404);
}
