// Highpoint accounts: email + password, sessions in D1, HttpOnly cookie.
import { D1, ensureSchema } from "./store.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const COOKIE = "hp_session";
const DAYS = 30;
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n = 32) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPw(pw, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export const admins = () => env("HP_ADMIN_EMAILS").toLowerCase().split(/[,\s]+/).filter(Boolean);
export function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }

function shape(u) {
  const email = String(u.email).toLowerCase();
  return { id: u.id, email, name: u.name || email.split("@")[0], admin: admins().includes(email), identity: "hp_" + String(u.id).replace(/[^A-Za-z0-9_]/g, "").slice(0, 100) };
}
function cookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
async function startSession(userId) {
  const token = rand(32);
  await D1().prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?1, ?2, ?3)").bind(await sha(token), userId, Date.now() + DAYS * 864e5).run();
  return cookie(token, DAYS * 86400);
}

const cache = new Map();
export async function currentUser(req) {
  await ensureSchema();
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!m) return null;
  const hit = cache.get(m[1]); if (hit && hit.exp > Date.now()) return hit.user;
  const row = await D1().prepare("SELECT u.id, u.email, u.name, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1").bind(await sha(m[1])).first();
  if (!row || row.expires < Date.now()) return null;
  const user = shape(row);
  cache.set(m[1], { user, exp: Date.now() + 60_000 });
  return user;
}
export async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) throw httpErr(401, "Sign in first");
  return u;
}

// POST /api/auth/{signup|login|logout|password}, GET /api/auth/me
export async function authRoute(req, action) {
  await ensureSchema();
  const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
  if (action === "me") { const u = await currentUser(req); return u ? json({ user: u }) : json({ user: null }, 401); }
  if (action === "logout") {
    const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
    if (m) { await D1().prepare("DELETE FROM sessions WHERE token=?1").bind(await sha(m[1])).run(); cache.delete(m[1]); }
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  const email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
  if (action === "signup") {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
    if (pw.length < 8) return json({ error: "Use at least 8 characters for your password." }, 400);
    const code = env("HP_INVITE_CODE");
    if (code && !admins().includes(email) && String(b.invite || "").trim() !== code) return json({ error: "That team code isn't right. Ask your Highpoint admin for it." }, 403);
    if (await D1().prepare("SELECT 1 FROM users WHERE email=?1").bind(email).first()) return json({ error: "There's already an account with that email. Sign in instead." }, 409);
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20), salt = rand(16);
    await D1().prepare("INSERT INTO users (id, email, name, salt, hash, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, email, String(b.name || "").trim().slice(0, 60) || email.split("@")[0], salt, await hashPw(pw, salt), Date.now()).run();
    return json({ user: shape({ id, email, name: b.name }) }, 200, { "set-cookie": await startSession(id) });
  }
  if (action === "login") {
    const u = await D1().prepare("SELECT * FROM users WHERE email=?1").bind(email).first();
    if (!u || !same(await hashPw(pw, u.salt), u.hash)) return json({ error: "Email or password is wrong." }, 401);
    return json({ user: shape(u) }, 200, { "set-cookie": await startSession(u.id) });
  }
  if (action === "password") {
    const me = await requireUser(req);
    const u = await D1().prepare("SELECT * FROM users WHERE id=?1").bind(me.id).first();
    if (!same(await hashPw(String(b.current || ""), u.salt), u.hash)) return json({ error: "Your current password is wrong." }, 401);
    if (String(b.next || "").length < 8) return json({ error: "Use at least 8 characters." }, 400);
    const salt = rand(16);
    await D1().prepare("UPDATE users SET salt=?2, hash=?3 WHERE id=?1").bind(me.id, salt, await hashPw(String(b.next), salt)).run();
    return json({ ok: true });
  }
  if (action === "reset") { // admin sets a temporary password for an agent who forgot theirs
    const me = await requireUser(req); if (!me.admin) return json({ error: "Admins only" }, 403);
    const salt = rand(16), temp = rand(5);
    const r = await D1().prepare("UPDATE users SET salt=?2, hash=?3 WHERE email=?1").bind(email, salt, await hashPw(temp, salt)).run();
    if (!r.meta?.changes) return json({ error: "No account with that email." }, 404);
    await D1().prepare("DELETE FROM sessions WHERE user_id=(SELECT id FROM users WHERE email=?1)").bind(email).run();
    return json({ ok: true, tempPassword: temp });
  }
  return json({ error: "Unknown action" }, 404);
}
