// National DNC / state DNC / TCPA-litigator scrubbing before calls — local, with a fake Blacklist Alliance.
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; } });
const DB = { prepare: (q) => stmt(q), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; } };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: "https://desk.example.com", TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok" };
const BA = { calls: 0, bodies: {
  "2125550100": [200, { status: "success", message: "Good", code: [], results: 0 }],
  "2125550101": [200, { status: "success", message: "Blacklisted", code: ["plaintiff-primary"], results: 1 }],
  "2125550102": [200, { status: "success", message: "FederalDNC", code: ["federal-dnc"], results: 1 }],
  "2125550103": [200, { status: "success", message: "StateDNC", code: ["florida-dnc"], results: 1 }],
  "2125550104": [500, {}],
  "2125550105": [200, { status: "success", message: "Blacklisted", code: ["anti-telemarketing"], results: 1 }],
} };
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.host === "api.blacklistalliance.net") {
    BA.calls++;
    if (u.searchParams.get("key") !== "ba_good") return new Response("{}", { status: 403 });
    const [st, j] = BA.bodies[u.searchParams.get("phone")] || [200, { message: "Good", code: [] }];
    return new Response(JSON.stringify(j), { status: st, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
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
const check = (n) => call("boss", "/api/dialer/calls/check", { method: "POST", body: { to: n, leadState: "NY" } });

await call("boss", "/api/auth/signup", { method: "POST", body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { quietHours: { start: 0, end: 24 }, maxAttempts24h: 50 } } });
let r = await call("boss", "/api/dialer/calls/scrub"); ok(r.j.configured === false && r.j.on === false, "scrubbing is off until the key is added");
r = await check("2125550101"); ok(r.j.ok === true && BA.calls === 0, "without a key, calls aren't held up (and nothing is looked up)");
env.BLACKLIST_ALLIANCE_KEY = "ba_bad";
r = await check("2125550100"); ok(r.j.ok === false && /key isn't valid/.test(r.j.why), "a wrong key stops calls and says why: " + r.j.why);
env.BLACKLIST_ALLIANCE_KEY = "ba_good";
r = await call("boss", "/api/dialer/calls/scrub"); ok(r.j.on && r.j.settings.litigators && r.j.settings.federal, "with the key, scrubbing is on (litigators, National DNC, state lists)");
r = await check("2125550100"); ok(r.j.ok === true, "a clean number goes through");
r = await check("2125550101"); ok(r.j.ok === false && r.j.scrub === "litigator" && /TCPA litigator/.test(r.j.why), "a known TCPA litigator is blocked: " + r.j.why);
r = await check("2125550102"); ok(r.j.ok === false && r.j.scrub === "federal" && /National Do Not Call/.test(r.j.why), "the National DNC is blocked");
r = await check("2125550103"); ok(r.j.ok === false && r.j.scrub === "state" && /Florida Do Not Call/.test(r.j.why), "state lists are blocked, by name: " + r.j.why);
r = await check("2125550104"); ok(r.j.ok === false && /didn't go through/.test(r.j.why), "if the check can't run, the call doesn't go through");
r = await check("2125550105"); ok(r.j.ok === false && /anti-telemarketing/.test(r.j.why), "anti-telemarketing flags are blocked");
const before = BA.calls; await check("2125550102"); await check("2125550100");
ok(BA.calls === before, "repeat checks use the saved result (no extra lookups for 30 days)");
// admins choose what blocks
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { scrub: { on: true, litigators: true, federal: false, state: true, other: true } } } });
r = await check("2125550102"); ok(r.j.ok === true, "admins can allow National DNC numbers (for written-consent leads)");
r = await check("2125550101"); ok(r.j.ok === false, "litigators stay blocked");
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { scrub: { on: true, litigators: true, federal: true, state: true, other: true } } } });
// a whole list
r = await call("boss", "/api/dialer/calls/scrub", { method: "POST", body: { numbers: ["(212) 555-0100", "212-555-0101", "2125550102", "2125550103", "2125550106", "2125550106"] } });
const R = r.j.results;
ok(r.j.on && Object.keys(R).length === 5, "a list is checked in one go (duplicates once)");
ok(!R["2125550100"].blocked && R["2125550101"].blocked && R["2125550102"].blocked && R["2125550103"].blocked && !R["2125550106"].blocked, "each number comes back clear or flagged with the reason");
// your own DNC list still comes first
await call("boss", "/api/dialer/calls/dnc", { method: "POST", body: { number: "2125550100" } });
r = await check("2125550100"); ok(r.j.ok === false && /your Do Not Call list/.test(r.j.why), "your own Do Not Call list still applies");
await call("boss", "/api/dialer/setup", { method: "PUT", body: { settings: { scrub: { on: false, litigators: true, federal: true, state: true, other: true } } } });
r = await check("2125550101"); ok(r.j.ok === true, "admins can pause scrubbing");
console.log(process.exitCode ? "SOME FAILED" : "ALL PASSED");
