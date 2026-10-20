// Forgot password by email, two-step verification, emailed invites — local, with a fake Resend.
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
import { totp } from "../src/lib/auth.mjs";
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com" };
const mails = [];
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.host === "api.resend.com") { const b = JSON.parse(o.body); mails.push(b); return new Response(JSON.stringify({ id: "em_" + mails.length }), { status: 200, headers: { "content-type": "application/json" } }); }
  return new Response("{}", { status: 200 });
};
const jars = {};
async function call(who, path, { method = "GET", body } = {}) {
  const h = {}; if (jars[who]) h.cookie = jars[who];
  let b; if (body !== undefined) { b = JSON.stringify(body); h["content-type"] = "application/json"; }
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: b }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const code = async (secret, d = 0) => totp(secret, Math.floor(Date.now() / 30000) + d);

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss Lady" } });
await call("rep", "/api/auth/signup", { method: "POST", body: { email: "rep@hp.com", password: "password1", name: "Rita Rep", invite: "HP2026", agree: true } });

// ---------- forgot password ----------
let r = await call("x", "/api/auth/forgot", { method: "POST", body: { email: "rep@hp.com" } });
ok(r.s === 200 && r.j.email === false && !mails.length, "without an email key, forgot password says to ask the admin (nothing sent)");
env.RESEND_API_KEY = "re_test"; env.HP_EMAIL_FROM = "Highpoint Desk <desk@highpointfinancial.co>";
r = await call("x", "/api/auth/me"); ok(r.j.email === true, "the sign-in screen can tell email is on");
r = await call("x", "/api/auth/forgot", { method: "POST", body: { email: "nobody@hp.com" } });
ok(r.s === 200 && r.j.email === true && !mails.length, "an unknown email gets the same answer and no email (no account fishing)");
r = await call("x", "/api/auth/forgot", { method: "POST", body: { email: "REP@hp.com " } });
const m1 = mails[0], link = (m1?.html.match(/https:\/\/desk\.example\.com\/\?reset=[a-f0-9]+/) || [])[0];
ok(m1 && m1.to[0] === "rep@hp.com" && m1.from === "Highpoint Desk <desk@highpointfinancial.co>" && /Reset your password/.test(m1.subject + m1.html) && link, "the agent gets a reset email with a one-hour link");
ok(/Choose a new password/.test(m1.text) && /one hour/.test(m1.text), "with a plain-text version too");
const token = link.split("=")[1];
r = await call("x", "/api/auth/reset-password", { method: "POST", body: { token, password: "short" } }); ok(r.s === 400, "the new password needs 8+ characters");
r = await call("rep", "/api/auth/reset-password", { method: "POST", body: { token, password: "brandnew99" } });
ok(r.s === 200 && r.j.user?.email === "rep@hp.com", "the link sets a new password and signs them in");
r = await call("x", "/api/auth/reset-password", { method: "POST", body: { token, password: "another999" } }); ok(r.s === 400 && /expired or was already used/.test(r.j.error), "the link works once");
r = await call("rep2", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "password1" } }); ok(r.s === 401, "the old password stops working");
r = await call("rep2", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } }); ok(r.s === 200 && r.j.user, "the new one works");
for (let i = 0; i < 4; i++) await call("x", "/api/auth/forgot", { method: "POST", body: { email: "rep@hp.com" } });
ok(mails.length === 3, "at most 3 reset emails an hour per login (" + mails.length + " sent)");

// ---------- two-step verification ----------
r = await call("rep", "/api/auth/2fa-setup", { method: "POST", body: {} });
const secret = r.j.secret;
ok(r.s === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.j.uri.startsWith("otpauth://totp/Highpoint%3Arep%40hp.com?secret=" + secret), "setup gives a secret and an authenticator link");
r = await call("rep", "/api/auth/2fa-enable", { method: "POST", body: { code: "000000" } }); ok(r.s === 400, "a wrong code doesn't turn it on");
r = await call("rep", "/api/auth/2fa-enable", { method: "POST", body: { code: await code(secret) } });
const recovery = r.j.recovery || [];
ok(r.s === 200 && recovery.length === 10 && /^[a-f0-9]{5}-[a-f0-9]{5}$/.test(recovery[0]), "the right code turns it on and gives 10 recovery codes");
r = await call("rep", "/api/auth/me"); ok(r.j.user.twofa === true, "the account shows two-step is on");
r = await call("rep3", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } });
const ticket = r.j.ticket;
ok(r.s === 200 && r.j.twofa && ticket && !r.j.user && !jars.rep3, "the password alone no longer signs in: it asks for a code");
r = await call("rep3", "/api/auth/2fa-login", { method: "POST", body: { ticket, code: "123456" } }); ok(r.s === 401 && !jars.rep3, "a wrong code is refused");
r = await call("rep3", "/api/auth/2fa-login", { method: "POST", body: { ticket, code: await code(secret, 1) } });
ok(r.s === 200 && r.j.user?.email === "rep@hp.com" && jars.rep3, "the authenticator code signs in");
r = await call("rep4", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } });
r = await call("rep4", "/api/auth/2fa-login", { method: "POST", body: { ticket: r.j.ticket, code: await code(secret, 1) } });
ok(r.s === 401, "the same code can't be used twice");
r = await call("rep4", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } });
r = await call("rep4", "/api/auth/2fa-login", { method: "POST", body: { ticket: r.j.ticket, code: recovery[0].toUpperCase() } });
ok(r.s === 200 && r.j.recoveryLeft === 9, "a recovery code works once (9 left)");
r = await call("rep5", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } });
const t5 = r.j.ticket;
for (let i = 0; i < 5; i++) r = await call("rep5", "/api/auth/2fa-login", { method: "POST", body: { ticket: t5, code: recovery[0] } });
r = await call("rep5", "/api/auth/2fa-login", { method: "POST", body: { ticket: t5, code: await code(secret, -1) } });
ok(r.s === 401 && !jars.rep5, "after 5 wrong tries the sign-in has to start over");
// reset by email keeps two-step
await call("x", "/api/auth/forgot", { method: "POST", body: { email: "boss@hp.com" } });
const bossTok = mails[mails.length - 1].html.match(/reset=([a-f0-9]+)/)[1];
r = await call("rep", "/api/auth/forgot", { method: "POST", body: { email: "rep@hp.com" } }); // already over the hourly limit, nothing sent
// admin turns it off for a lost phone
const repId = (await call("rep3", "/api/auth/me")).j.user.id;
r = await call("boss", "/api/team/members"); ok(r.j.members.find((m) => m.id === repId)?.twofa === true, "admins see who has two-step on");
r = await call("rep3", "/api/team/member", { method: "POST", body: { id: repId, reset2fa: true } }); ok(r.s === 403, "agents can't reset it");
r = await call("boss", "/api/team/member", { method: "POST", body: { id: repId, reset2fa: true } }); ok(r.s === 200, "admins can (lost phone)");
r = await call("rep6", "/api/auth/login", { method: "POST", body: { email: "rep@hp.com", password: "brandnew99" } }); ok(r.s === 200 && r.j.user && !r.j.twofa, "then the password alone signs in again");
// turning it off yourself needs your password
await call("rep6", "/api/auth/2fa-setup", { method: "POST", body: {} });
r = await call("rep6", "/api/auth/2fa-disable", { method: "POST", body: { password: "nope" } }); ok(r.s === 401, "turning it off needs your password");
// ---------- emailed invites ----------
const before = mails.length;
r = await call("boss", "/api/team/invite", { method: "POST", body: { plan: "full", email: "newbie@hp.com" } });
const inv = mails[mails.length - 1];
ok(r.j.emailed && mails.length === before + 1 && inv.to[0] === "newbie@hp.com" && inv.html.includes(r.j.url) && /Boss Lady invited you/.test(inv.subject), "admins can email an invite link");
// a reset link for someone with two-step makes them sign in again with a code
r = await call("boss", "/api/auth/2fa-setup", { method: "POST", body: {} }); const bs = r.j.secret;
await call("boss", "/api/auth/2fa-enable", { method: "POST", body: { code: await code(bs) } });
r = await call("y", "/api/auth/reset-password", { method: "POST", body: { token: bossTok, password: "bossnew123" } });
ok(r.s === 200 && r.j.signIn && !r.j.user && !jars.y, "with two-step on, a reset link changes the password but still needs a code to sign in");

console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
