// Spotify per agent: each Highpoint login connects its own Spotify account (OAuth, authorization code).
// Tokens are stored per login, encrypted with a key derived from SPOTIFY_CLIENT_SECRET, and refreshed here,
// so the secret never reaches the browser. Premium is detected in the browser (Spotify's Web Playback SDK
// only plays for Premium) and saved here, because Spotify no longer returns the account type to new apps.
import { getStore } from "./store.mjs";
import { currentUser, requireFeature, httpErr } from "./auth.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (u8) => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const go = (to) => new Response(null, { status: 302, headers: { location: to, "cache-control": "no-store" } });
const site = () => (env("HP_PUBLIC_URL") || globalThis.__ORIGIN || "").replace(/\/$/, "");
const ID = () => String(env("SPOTIFY_CLIENT_ID") || "").trim(), SECRET = () => String(env("SPOTIFY_CLIENT_SECRET") || "").trim();
export const configured = () => !!(ID() && SECRET());
const REDIRECT = () => site() + "/api/spotify/callback";
const SCOPES = "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative";
const kv = () => getStore("hpd-spotify");

/* ---------- small crypto helpers ---------- */
async function aesKey() { return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(SECRET() + ":hp-spotify-tokens")), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(text)); return b64(iv) + "." + b64(ct); }
async function open(box) { const [iv, ct] = String(box || "").split("."); return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct))); }
async function hmac(text) { const k = await crypto.subtle.importKey("raw", enc.encode(SECRET() + ":hp-spotify-state"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return b64url(await crypto.subtle.sign("HMAC", k, enc.encode(text))); }
const same = (a, b) => a.length === b.length && [...a].reduce((r, c, i) => r | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

/* ---------- storage: one record per Highpoint login ---------- */
const get = async (uid) => (await kv().get("u:" + uid, { type: "json" })) || {};
const put = async (uid, rec) => kv().setJSON("u:" + uid, rec);
const PREFS = (p = {}) => ({ uri: typeof p.uri === "string" && /^spotify:(playlist|album|track|artist|show|episode):[A-Za-z0-9]{10,}$/.test(p.uri) ? p.uri : undefined, autoPause: p.autoPause !== false, autoResume: p.autoResume !== false });

async function tokenFor(uid, rec) {
  if (!rec.refresh) return null;
  if (rec.access && rec.exp > Date.now() + 60_000) return { access: await open(rec.access), exp: rec.exp };
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { authorization: "Basic " + btoa(ID() + ":" + SECRET()), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: await open(rec.refresh) }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") { await put(uid, { prefs: rec.prefs, lost: true }); throw Object.assign(httpErr(401, "Spotify signed you out. Connect Spotify again."), { code: "relink" }); }
    throw httpErr(502, "Spotify didn't respond. Try again in a moment.");
  }
  rec.access = await seal(j.access_token); rec.exp = Date.now() + (j.expires_in || 3600) * 1000;
  if (j.refresh_token) rec.refresh = await seal(j.refresh_token);
  await put(uid, rec);
  return { access: j.access_token, exp: rec.exp };
}

// /api/spotify/{status|login|callback|token|product|prefs|disconnect}
export async function spotifyRoute(req, action) {
  if (action === "callback") return callback(req);
  const u = await requireFeature(req, "music");
  const rec = await get(u.id);
  if (action === "status") {
    return json({ configured: configured(), connected: !!rec.refresh, lost: !!rec.lost, name: rec.name || null, product: rec.product || null, prefs: PREFS(rec.prefs) });
  }
  if (action === "login") {
    if (!configured()) return go("/?spotify=off");
    const exp = Date.now() + 10 * 60_000, nonce = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const state = `${u.id}.${exp}.${nonce}`;
    const q = new URLSearchParams({ client_id: ID(), response_type: "code", redirect_uri: REDIRECT(), scope: SCOPES, state: state + "." + (await hmac(state)), show_dialog: "true" });
    return go("https://accounts.spotify.com/authorize?" + q.toString());
  }
  if (action === "token") {
    if (!configured()) return json({ error: "Spotify isn't set up for the team yet." }, 503);
    const t = await tokenFor(u.id, rec);
    if (!t) return json({ error: "Connect Spotify first.", code: "relink" }, 401);
    return json({ access_token: t.access, expires_at: t.exp });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  if (action === "product") { // the browser found out whether this account is Premium
    if (!rec.refresh) return json({ ok: false });
    rec.product = b.product === "premium" ? "premium" : "free"; rec.checked = Date.now();
    await put(u.id, rec); return json({ ok: true, product: rec.product });
  }
  if (action === "prefs") { rec.prefs = PREFS({ ...rec.prefs, ...b }); await put(u.id, rec); return json({ ok: true, prefs: rec.prefs }); }
  if (action === "disconnect") { await put(u.id, { prefs: rec.prefs }); return json({ ok: true }); }
  return json({ error: "Unknown action" }, 404);
}

async function callback(req) {
  const q = new URL(req.url).searchParams, back = (why) => go("/?spotify=" + why);
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "canceled" : "error");
  const u = await currentUser(req); if (!u) return back("signin");
  const parts = String(q.get("state") || "").split(".");
  if (parts.length !== 4) return back("error");
  const [uid, exp, nonce, sig] = parts;
  if (uid !== u.id || +exp < Date.now() || !same(sig, await hmac(`${uid}.${exp}.${nonce}`))) return back("error");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { authorization: "Basic " + btoa(ID() + ":" + SECRET()), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(q.get("code") || ""), redirect_uri: REDIRECT() }).toString(),
  });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.refresh_token) return back("error");
  // who is this? (in Spotify's development mode, only people the app owner added in User Management get through)
  const me = await fetch("https://api.spotify.com/v1/me", { headers: { authorization: "Bearer " + t.access_token } });
  if (me.status === 403) return back("notallowed");
  const mj = await me.json().catch(() => ({}));
  const prev = await get(u.id);
  await put(u.id, {
    refresh: await seal(t.refresh_token), access: await seal(t.access_token), exp: Date.now() + (t.expires_in || 3600) * 1000,
    sid: mj.id || null, name: mj.display_name || mj.id || "Spotify", product: mj.product || (prev.sid && prev.sid === mj.id ? prev.product : null) || null,
    prefs: prev.prefs, at: Date.now(),
  });
  return back("connected");
}
