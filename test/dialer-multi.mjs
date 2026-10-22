// (multi-line) A calling session in a real browser against a simulated Telnyx: the real /api server and signed webhooks, a fake
// Telnyx REST API and a fake browser phone. Checks that unanswered calls log themselves and move on with no popup,
// and that after an answered call the agent picks Resume, Pause or Stop before anything dials.
// Run: node test/dialer-session.mjs            (headless, exits)
//      node test/dialer-session.mjs --serve 8797   (keeps the simulated desk running for clicking through by hand)
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const si = process.argv.indexOf("--serve"), SERVE = si > 0, PORT = SERVE ? +process.argv[si + 1] || 8797 : 0;
const RING = 2500;
// Telnyx parks the browser's leg, and the SDK can report it active right away; --no-park-active waits for our answer
const PARK_ACTIVE = !process.argv.includes("--no-park-active");
const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");
const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a.map(norm)), first: async () => out(sql.prepare(q).get(...args)) ?? null, all: async () => ({ results: sql.prepare(q).all(...args).map(out) }), run: async () => ({ meta: { changes: sql.prepare(q).run(...args).changes } }) });
let ORIGIN = "http://127.0.0.1";
const env = {
  DB: { prepare: (q) => stmt(q), batch: async (l) => Promise.all(l.map((s) => s.run())) },
  HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026", HP_PUBLIC_URL: ORIGIN,
  TELNYX_API_KEY: "KEY_sim", TELNYX_PUBLIC_KEY: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
};
const { onRequest } = await import("../functions/api/[[path]].js");
const { setJ } = await import("../src/lib/hp.mjs");

/* ---- the simulated call world ---- */
const legs = {}, plan = [], dials = [];
let failDial = false;
let n = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function event(type, payload) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ data: { event_type: type, id: "evt" + ++n, payload } });
  const sig = b64(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(`${ts}|${body}`)));
  await onRequest({ request: new Request(ORIGIN + "/api/telnyx/events", { method: "POST", headers: { "content-type": "application/json", "telnyx-timestamp": String(ts), "telnyx-signature-ed25519": sig }, body }), env, waitUntil: () => {} });
  if (SERVE) console.log(`  webhook ${type}${payload.hangup_cause ? " (" + payload.hangup_cause + ")" : ""}`);
}
const leadPayload = (L) => ({ direction: "outgoing", from: L.from, to: L.to, call_control_id: L.id, call_session_id: L.sess, client_state: L.cs });
// What the lead's phone does: human | machine | noanswer | busy | failed | ring (rings until the agent hangs up)
async function runLead(L) {
  const kind = (L.kind = plan.shift() || "human");
  if (SERVE) console.log(`lead ${L.to} plays "${kind}"`);
  if (kind === "failed") { await wait(400); L.hungup = true; return event("call.hangup", { ...leadPayload(L), hangup_cause: "unallocated_number" }); }
  await wait(300); await event("call.initiated", leadPayload(L));
  if (kind === "ring") return;
  if (kind === "busy") { await wait(600); L.hungup = true; return event("call.hangup", { ...leadPayload(L), hangup_cause: "user_busy", sip_hangup_cause: "486" }); }
  await wait(RING);
  if (legs[L.web]?.hungup || L.hungup) return;
  if (kind === "noanswer") { L.hungup = true; return event("call.hangup", { ...leadPayload(L), hangup_cause: "timeout" }); }
  L.answered = true; await event("call.answered", leadPayload(L));
  await wait(kind === "machine" ? 1200 : 800);
  if (L.hungup) return;
  await event("call.machine.premium.detection.ended", { ...leadPayload(L), result: kind === "machine" ? "machine" : "human_residence" });
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.hostname !== "api.telnyx.com") return realFetch(url, o);
  const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  const body = o.body ? JSON.parse(o.body) : undefined, p = u.pathname, m = o.method || "GET";
  if (p === "/v2/outbound_voice_profiles") return J({ data: [{ id: "ovp1", name: "Sim", enabled: true }] });
  if (p.startsWith("/v2/credential_connections")) return J({ data: { id: "cc1" } });
  if (p.startsWith("/v2/call_control_applications")) return J({ data: { id: "app1" } });
  if (p === "/v2/telephony_credentials" && m === "POST") return J({ data: { id: "tc1", sip_username: "simagent" } });
  if (/\/token$/.test(p)) return new Response("tok_sim");
  if (p === "/v2/calls" && m === "POST" && failDial) return J({ errors: [{ detail: "Invalid destination number" }] }, 422);
  if (p === "/v2/calls" && m === "POST") {
    const id = "lead-" + ++n, web = body.link_to;
    const L = (legs[id] = { id, web, sess: legs[web]?.sess, to: body.to, from: body.from, cs: body.client_state, kind: "pstn" });
    legs[web].pstn = id;
    runLead(L).catch(console.error);
    return J({ data: { call_control_id: id, call_session_id: L.sess } });
  }
  const cmd = p.match(/^\/v2\/calls\/(.+)\/actions\/([a-z_]+)$/);
  if (cmd) {
    const [, id, a] = cmd, L = legs[id];
    if (L && a === "answer") { L.answered = true; setTimeout(() => event("call.answered", { direction: "outgoing", from: L.from, to: L.to, call_control_id: id, call_session_id: L.sess }), 100); }
    if (L && a === "hangup" && !L.hungup) {
      L.hungup = true;
      setTimeout(() => event("call.hangup", L.kind === "pstn" ? { ...leadPayload(L), hangup_cause: "normal_clearing" } : { direction: "outgoing", call_control_id: id, call_session_id: L.sess, hangup_cause: "normal_clearing" }), 100);
    }
    return J({ data: { result: "ok" } });
  }
  return J({ data: [] });
};

// Fake @telnyx/webrtc: the browser's call is a parked leg whose state follows the server's answer/hangup commands
const FAKE_SDK = `(() => {
  class Call {
    constructor(client, o) { this.client = client; this.id = "fk" + Math.random().toString(36).slice(2, 8); this.direction = "outbound"; this.options = o; this.state = "new"; this.go(); }
    set(st) { if (this.state === st) return; this.state = st; this.client.emit("telnyx.notification", { type: "callUpdate", call: this }); }
    async go() {
      this.set("trying");
      await fetch("/__sim/dial", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: this.id, to: this.options.destinationNumber, from: this.options.callerNumber }) });
      if (${PARK_ACTIVE}) this.set("active");
      this.iv = setInterval(async () => { const s = await (await fetch("/__sim/leg?id=web-" + this.id)).json(); if (s.hungup) { clearInterval(this.iv); this.set("hangup"); } else if (s.answered) this.set("active"); }, 120);
    }
    hangup() { fetch("/__sim/agent-hangup?id=web-" + this.id, { method: "POST" }); }
    answer() {} muteAudio() {} unmuteAudio() {} dtmf() {}
  }
  class TelnyxRTC { constructor() { this.h = {}; } on(e, f) { (this.h[e] = this.h[e] || []).push(f); } emit(e, x) { (this.h[e] || []).forEach((f) => f(x)); } connect() { setTimeout(() => this.emit("telnyx.ready"), 60); } login() {} newCall(o) { return new Call(this, o); } }
  window.TelnyxWebRTC = { TelnyxRTC };
})();`;

async function sim(req, res, url) {
  const J = (j) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
  const body = req.method === "POST" ? await new Promise((r) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => r(s ? JSON.parse(s) : {})); }) : {};
  if (url.pathname === "/__sim/fake-telnyx.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(FAKE_SDK); }
  if (url.pathname === "/__sim/dial") {
    const id = "web-" + body.id, sess = "sess-" + body.id;
    legs[id] = { id, sess, to: body.to, from: body.from, kind: "web" }; dials.push({ to: body.to, at: Date.now() });
    if (SERVE) console.log(`browser dials ${body.to}`);
    event("call.initiated", { direction: "outgoing", state: "parked", from: body.from, to: body.to, call_control_id: id, call_session_id: sess, connection_id: "cc1" }).catch(console.error);
    return J({ ok: true });
  }
  if (url.pathname === "/__sim/leg") { const L = legs[url.searchParams.get("id")] || {}; return J({ answered: !!L.answered, hungup: !!L.hungup }); }
  if (url.pathname === "/__sim/agent-hangup") {
    const L = legs[url.searchParams.get("id")];
    if (L && !L.hungup) { L.hungup = true; await event("call.hangup", { direction: "outgoing", call_control_id: L.id, call_session_id: L.sess, hangup_cause: "normal_clearing" }); }
    return J({ ok: true });
  }
  if (url.pathname === "/__sim/lead-hangup") { // the lead hangs up first
    const L = Object.values(legs).find((x) => x.web && x.answered && !x.hungup && String(x.to).endsWith(url.searchParams.get("to") || ""));
    if (L) { L.hungup = true; await event("call.hangup", { ...leadPayload(L), hangup_cause: "normal_clearing" }); }
    return J({ ok: !!L });
  }
  if (url.pathname === "/__sim/fail-dial") { failDial = url.searchParams.get("on") === "1"; return J({ failDial }); }
  if (url.pathname === "/__sim/plan-clear") { plan.length = 0; return J({ plan }); }
  if (url.pathname === "/__sim/plan") { plan.push(...(body.kinds || [])); return J({ plan }); }
  if (url.pathname === "/__sim/dials") return J({ dials, plan });
  res.writeHead(404); res.end();
}

const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".wav": "audio/wav", ".webp": "image/webp", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, ORIGIN);
    if (url.pathname.startsWith("/__sim/")) return await sim(req, res, url);
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const r = await onRequest({ request: new Request(ORIGIN + req.url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, waitUntil: () => {} });
      const h = Object.fromEntries(r.headers); if (h["set-cookie"]) h["set-cookie"] = h["set-cookie"].replace("; Secure", "");
      res.writeHead(r.status, h);
      if (!r.body) return res.end();
      return Readable.fromWeb(r.body).pipe(res);
    }
    let f = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""));
    if (!f.startsWith(path.join(root, "public")) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "public", "index.html");
    if (f.endsWith("index.html")) { res.writeHead(200, { "content-type": types[".html"] }); return res.end(fs.readFileSync(f, "utf8").replace("<head>", `<head><script src="/__sim/fake-telnyx.js"></script>`)); }
    res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500); res.end(); }
});

// seed: an admin, a number, 24-hour calling, Connect
const jar = {};
async function api(p, method = "GET", body) {
  const h = { "content-type": "application/json" }; if (jar.c) h.cookie = jar.c;
  const r = await onRequest({ request: new Request(ORIGIN + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jar.c = sc.split(";")[0];
  return r.json().catch(() => ({}));
}
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
ORIGIN = `http://127.0.0.1:${server.address().port}`; env.HP_PUBLIC_URL = ORIGIN;
await api("/api/auth/signup", "POST", { name: "Anthony Sim", email: "boss@hp.com", password: "password2", agree: true });
const me = (await api("/api/auth/me")).user;
await setJ("numbers", "all", { "+12125550100": { e164: "+12125550100", provider: "telnyx", sid: "pn1", owner: me.identity, areaCode: "212", state: "NY", days: {}, boughtAt: Date.now() - 60 * 864e5 } }); // past the new-number ramp (15 dials on day one)
await api("/api/dialer/setup", "PUT", { settings: { quietHours: { start: 0, end: 24 }, maxAttempts24h: 50, stateRules: { NY: { start: 0, end: 24, max24h: 50 } } } });
await api("/api/telnyx/setup", "POST");

if (SERVE) {
  console.log(`Simulated desk: ${ORIGIN}  (boss@hp.com / password2)`);
  console.log(`Queue what the next leads do: POST ${ORIGIN}/__sim/plan {"kinds":["noanswer","human"]}  (human | machine | noanswer | busy | failed | ring)`);
} else {
  const { chromium } = await import("playwright");
  const check = (c, m) => { if (!c) throw new Error("FAIL " + m); console.log("PASS " + m); };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
    const context = await browser.newContext({ permissions: ["microphone"] });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn("page error:", e.message));
    await page.request.post(ORIGIN + "/api/auth/login", { data: { email: "boss@hp.com", password: "password2" } });
    await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
    await page.locator(".hp-acct-b").waitFor();
    await page.evaluate(() => { localStorage.setItem("hpd.filter", JSON.stringify("everyone")); localStorage.setItem("hpd.src", JSON.stringify("all")); localStorage.setItem("hpd.via", JSON.stringify("line")); localStorage.setItem("hpd.lines", "3"); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".hp-acct-b").waitFor();
    await page.waitForFunction(() => window.hpDesk?.putLead, null, { timeout: 20000 });
    const ids = await page.evaluate(async () => {
      const out = [], t = Date.now() - 1e6;
      for (let i = 1; i <= 12; i++) out.push(await window.hpDesk.putLead({ first: "Lead", last: String(i).padStart(2, "0"), phone: "21255502" + String(i).padStart(2, "0"), state: "NY", stage: "new", createdAt: t + i * 1000 }));
      return out;
    });
    await page.waitForFunction((n) => window.hpDesk.leads.size >= n, ids.length);
    await page.locator('.nav[data-view="dialer"]').click();
    await page.locator("#hphFilter").waitFor();
    await page.selectOption("#hphFilter", "everyone");
    await page.waitForFunction(() => window.hpDialer?.ready && document.querySelector("#hphPsGo:not([disabled])"), null, { timeout: 20000 });
    const until = async (fn, what, ms = 25000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) { try { console.log("DIAG", JSON.stringify(await page.evaluate(() => ({ dock: document.querySelector("#hpdDock")?.innerText.replace(/\s+/g, " ").slice(0, 400), ses: window.hpDialer.session, talking: window.hpDialer.talking })))); } catch {} throw new Error("FAIL timed out waiting for " + what); } await wait(150); } };
    const nDials = async () => (await (await realFetch(ORIGIN + "/__sim/dials")).json()).dials.length;
    const rows = (id) => page.evaluate((x) => [...window.hpDesk.calls.values()].filter((c) => c.leadId === x).map((c) => ({ outcome: c.outcome, note: c.note, hpSid: c.hpSid })), id);
    const named = (i) => ids[i];
    const plan = (kinds) => realFetch(ORIGIN + "/__sim/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kinds }) });
    const talking = () => page.evaluate(() => window.hpDialer.talking);

    // a start prompt first: pressing Start never dials by itself
    await plan(["noanswer", "busy", "machine", "human", "ring", "ring", "noanswer", "noanswer", "noanswer", "human", "human", "human"]);
    await page.locator("#hphPsGo").click();
    await page.locator("#hpdAskYes").waitFor();
    await wait(1500);
    check((await nDials()) === 0, "Start session asks first: nothing rings until you confirm");
    await page.locator("#hpdAskYes").click();

    // batch 1: rang out, busy, voicemail ring together; each logs itself with its reason; no popup; the next batch dials on its own
    await until(async () => (await nDials()) === 3, "three lines to ring together");
    check(true, "three leads ring at once");
    const logged = async (id, what) => (await until(async () => { const r = await rows(id); return r.length ? r : null; }, what))[0];
    const a = await logged(ids[0], "lead 1's log"), b = await logged(ids[1], "lead 2's log"), c = await logged(ids[2], "lead 3's log");
    check(a.outcome === "No answer" && a.note === "Rang out" && a.hpSid, "rang out: No answer · Rang out");
    check(b.outcome === "No answer" && b.note === "Busy", "busy: No answer · Busy");
    check(c.outcome === "No answer" && c.note === "Voicemail detected", "voicemail: No answer · Voicemail detected");
    check(!(await talking()), "none of them reached the agent");
    await until(async () => (await nDials()) >= 6, "the next batch to dial by itself");
    check(true, "after a batch with nobody, the next batch dials automatically");

    // batch 2: one human among rings: the human connects, the others are released and logged No answer
    await until(talking, "the human to connect");
    check(true, "a person answering connects to you (Connected)");
    check(await page.evaluate(() => { const p = document.querySelector("#hpdProfile"), d = document.querySelector("#hpdDock"); return !!p && !p.hidden && p.innerText.includes(window.hpDesk.fullName(window.hpDesk.leads.get(window.hpDialer.liveLead))) && d.classList.contains("callbar") && !d.classList.contains("hpdl") && !d.querySelector("#hpdkWide,#hpdkMin"); }), "the client's contact card opens when they pick up; no floating console, stretch or minimize buttons");
    const who = await page.evaluate(() => window.hpDialer.liveLead);
    await until(async () => { const dd = await page.evaluate(() => [...window.hpDesk.calls.values()].map((x) => x.note)); return dd.filter((n) => n === "Another lead answered first").length >= 2; }, "the other two lines to be released and logged");
    check(true, "the lines that were still ringing are released and logged No answer");
    const before = await nDials();
    await page.locator("#hpdkHang").click();
    await page.locator('#hpdProfile [data-pdz="ni"]').waitFor();
    await page.locator('#hpdProfile [data-pdz="ni"]').click();
    await page.locator('#hpdDock [data-next="go"]').waitFor();
    check((await rows(who))[0]?.outcome === "Not interested", "logging the answered call saves its result");
    check(await page.locator("#hpdDock [data-next]").count() === 2 && await page.locator("#hpdkStop").count() === 1, "Resume, Pause and End session appear right under the log");
    await wait(2500);
    check((await nDials()) === before, "nothing dials until you choose");
    await page.locator('#hpdDock [data-next="pause"]').click();
    await wait(1500);
    check((await nDials()) === before && await page.evaluate(() => window.hpDialer.session?.paused), "Pause dialing holds the session");
    await page.locator('#hpdDock [data-next="go"]').click();
    await until(async () => (await nDials()) > before, "Resume to dial the next leads");
    check(true, "Resume dialing continues with the next leads");
    await page.locator("#hpdkStop").click();
    await until(async () => !(await page.evaluate(() => window.hpDialer.session)), "the session to end");
    // a single click-to-call: voicemail and rang-out log themselves (with why); no popup, nothing else dials
    if (await talking()) { await page.locator("#hpdkHang").click(); await until(async () => !(await talking()), "the leftover call to end"); }
    await wait(1500);
    await realFetch(ORIGIN + "/__sim/plan-clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await plan(["machine", "noanswer", "human", "ring"]);
    const base1 = await nDials();
    await page.evaluate((id) => window.hpDialer.dialLead(window.hpDesk.leads.get(id)), ids[10]);
    const v1 = await logged(ids[10], "the single voicemail call to log itself");
    check(v1.outcome === "No answer" && v1.note === "Voicemail detected" && !(await talking()), "single call, voicemail: No answer · Voicemail detected");
    await page.evaluate((id) => window.hpDialer.dialLead(window.hpDesk.leads.get(id)), ids[11]);
    const v2 = await logged(ids[11], "the single rang-out call to log itself");
    check(v2.outcome === "No answer" && v2.note === "Rang out", "single call, rang out: No answer · Rang out");
    check((await nDials()) === base1 + 2, "a single call dials only that lead");
    // a single answered call: connects, hang up, then the result buttons (no auto-dial)
    await page.evaluate((id) => window.hpDialer.dialLead(window.hpDesk.leads.get(id)), ids[9]);
    await until(talking, "the single answered call to connect");
    check(true, "single call, answered: Connected");
    await page.locator("#hpdkHang").click();
    await until(async () => !(await talking()), "the single call to end");
    check(true, "hanging up ends the single call");
    // hanging up while ringing logs No answer and says why
    await plan(["ring"]);
    await page.evaluate((id) => window.hpDialer.dialLead(window.hpDesk.leads.get(id)), ids[8]);
    await wait(900);
    await page.locator("#hpdkHang").click();
    const h1 = await logged(ids[8], "hang-up-while-ringing to log itself");
    check(h1.outcome === "No answer" && h1.note === "Agent hung up while ringing", "hang up while ringing: No answer · Agent hung up while ringing");

    // 1, 2 and 3 lines: answer, talk, hang up (you, the lead, or just log it), log, Resume: every time dialing picks up with the next leads in the list
    await page.evaluate(async () => { const t = Date.now() - 5e5; for (let i = 1; i <= 40; i++) await window.hpDesk.putLead({ first: "Cycle", last: String(i).padStart(2, "0"), phone: "21255503" + String(i).padStart(2, "0"), state: "NY", stage: "new", createdAt: t - i * 1000 }); });
    await page.waitForFunction(() => window.hpDesk.leads.size >= 52);
    for (const N of [1, 2, 3]) {
      await realFetch(ORIGIN + "/__sim/plan-clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      await plan(Array.from({ length: 4 * N }, (_, i) => (i % N === (N > 1 ? 1 : 0) ? "human" : "ring")));
      if (await page.locator('[data-hl="' + N + '"]').count()) await page.locator('[data-hl="' + N + '"]').click();
      const order = (await page.evaluate(() => window.hpDialer.queue().map((l) => String(l.phone).replace(/\D/g, "").slice(-10)))).slice(0, 12);
      const seen0 = (await (await realFetch(ORIGIN + "/__sim/dials")).json()).dials.length;
      await page.locator("#hphPsGo").click();
      await page.locator("#hpdAskYes").waitFor();
      await page.locator("#hpdAskYes").click();
      for (const how of ["agent", "lead", "log"]) {
        await until(talking, `${N} line(s): a person to answer (${how})`);
        const who = await page.evaluate(() => window.hpDialer.liveLead);
        const wph = await page.evaluate((id) => String(window.hpDesk.leads.get(id).phone).replace(/\D/g, "").slice(-10), who);
        await wait(1500);
        if (how === "agent") await page.locator("#hpdkHang").click();
        else if (how === "lead") await realFetch(ORIGIN + "/__sim/lead-hangup?to=" + wph, { method: "POST" });
        if (how !== "log") { await until(async () => !(await talking()), `${N} line(s): the call to end (${how})`); await page.locator('#hpdProfile [data-pdz="ni"]').click(); }
        else await page.evaluate((id) => window.hpDesk.autoLog(id, "Not interested", {}), who);
        if (how !== "agent") { // with the client's profile open the controls are the slim bar: Resume has to work there too
          await page.evaluate((id) => window.hpDialer.openProfile(id), who);
          await page.waitForFunction(() => document.querySelector("#hpdDock")?.classList.contains("callbar"), null, { timeout: 8000 });
        }
        await page.locator('#hpdDock [data-next="go"]').waitFor();
        const b4 = (await (await realFetch(ORIGIN + "/__sim/dials")).json()).dials.length;
        await page.evaluate(() => { window.__seen = []; new MutationObserver(() => window.__seen.push(document.querySelector('#hpdDock')?.innerText || '')).observe(document.body, { childList: true, subtree: true, characterData: true }); });
        await page.locator('#hpdDock [data-next="go"]').click();
        await until(async () => (await (await realFetch(ORIGIN + "/__sim/dials")).json()).dials.length >= b4 + N, `${N} line(s): Resume (${how}) to dial the next ${N}`);
        const nm = await page.evaluate((id) => window.hpDesk.fullName(window.hpDesk.leads.get(id)), who);
        const shown = await page.evaluate(([n]) => !window.__seen.filter((t) => !/Resume dialing/.test(t)).some((t) => /Call ended/.test(t) || (/Ringing|Calling/.test(t) && t.includes(n))), [nm]);
        if (!shown) console.log("SEEN", JSON.stringify(await page.evaluate(([n]) => window.__seen.filter((t) => !/Resume dialing/.test(t)).filter((t) => /Call ended/.test(t) || (/Ringing|Calling/.test(t) && t.includes(n))).slice(0, 2), [nm])).slice(0, 700));
        check(shown, `${N} line${N > 1 ? 's' : ''} (${how}): after Resume the dock shows the new lines ringing, not the client you just talked to`);
        check(true, `${N} line${N > 1 ? "s" : ""}, ${how === "agent" ? "you hang up" : how === "lead" ? "the lead hangs up" : "logged while still on the call"}: Resume dials the next ${N}`);
      }
      const all = (await (await realFetch(ORIGIN + "/__sim/dials")).json()).dials.slice(seen0).map((d) => String(d.to).replace(/\D/g, "").slice(-10));
      check(all.length >= 4 * N - 0 && new Set(all).size === all.length && all.every((t, i) => t === order[i]), `${N} line${N > 1 ? "s" : ""}: the session works through the list in order without repeating (${all.length} dialed)`);
      await page.locator('#hpdDock [data-next="stop"], #hpdkStop').first().click().catch(() => {});
      await until(async () => !(await page.evaluate(() => window.hpDialer.session)), `${N} line(s): the session to end`);
      await page.locator("#hpfClose").click().catch(() => {}); // close the client profile again
    }

    // logging a call while it is still up, then pressing Resume right away, must dial the next leads (the old leg can still be winding down)
    await realFetch(ORIGIN + "/__sim/plan-clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await plan(["human", "noanswer", "noanswer", "noanswer", "noanswer", "noanswer", "noanswer", "noanswer"]);
    await page.locator("#hphPsGo").click();
    await page.locator("#hpdAskYes").waitFor();
    await page.locator("#hpdAskYes").click();
    await until(talking, "a person to answer for the Resume check");
    const live2 = await page.evaluate(() => window.hpDialer.liveLead);
    await page.evaluate((id) => window.hpDesk.autoLog(id, "Not interested", {}), live2);
    await page.locator('#hpdDock [data-next="go"]').waitFor();
    const b4r = await nDials();
    await page.locator('#hpdDock [data-next="go"]').click();
    await until(async () => (await nDials()) > b4r, "Resume right after logging to dial the next leads");
    check(true, "log the call, press Resume right away: dialing picks up with the next leads");
    await page.locator('#hpdDock [data-next="stop"], #hpdkStop').first().click().catch(() => {});
    await until(async () => !(await page.evaluate(() => window.hpDialer.session)), "the session to end after the Resume check");

    // a list whose leads the server refuses (calling hours here) must not burn through the list and end: it pauses and says why
    await realFetch(ORIGIN + "/__sim/plan-clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const nyHour = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/New_York" }).format(new Date()) % 24, st0 = (nyHour + 6) % 24;
    await api("/api/dialer/setup", "PUT", { settings: { quietHours: { start: st0, end: st0 + 1 }, stateRules: { NY: { start: st0, end: st0 + 1 } } } });
    const dials0 = await nDials();
    await page.locator("#hphPsGo").click();
    await page.locator("#hpdAskYes").waitFor();
    await page.locator("#hpdAskYes").click();
    await until(async () => { const s = await page.evaluate(() => window.hpDialer.session); return s && s.paused && s.hold; }, "a fully refused list to pause instead of ending");
    check(true, "leads the server refuses pause the session instead of ending it");
    check((await nDials()) === dials0, "refused leads are never dialed");
    const dockTxt = await page.locator("#hpdDock").innerText(); if (!/couldn.t be called/.test(dockTxt)) console.log("DOCK:", dockTxt.replace(/\s+/g, " ").slice(0, 500), "| SESSION", JSON.stringify(await page.evaluate(() => window.hpDialer.session)));
    check(/couldn.t be called/.test(dockTxt), "the pause says why (couldn't be called)");
    await page.locator("#hpdkStop").click();
    await until(async () => !(await page.evaluate(() => window.hpDialer.session)), "Stop to end the paused session");
    await api("/api/dialer/setup", "PUT", { settings: { quietHours: { start: 0, end: 24 }, maxAttempts24h: 50, stateRules: { NY: { start: 0, end: 24, max24h: 50 } } } });

    // lines that drop before ringing: nothing is logged as No answer, the leads are kept, and the session pauses with Resume
    await realFetch(ORIGIN + "/__sim/plan-clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await realFetch(ORIGIN + "/__sim/fail-dial?on=1", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const noAns = () => page.evaluate(() => [...window.hpDesk.calls.values()].filter((c) => c.outcome === "No answer").length);
    const noAns0 = await noAns();
    await page.locator("#hphPsGo").click();
    await page.locator("#hpdAskYes").waitFor();
    await page.locator("#hpdAskYes").click();
    await until(async () => { const s = await page.evaluate(() => window.hpDialer.session); return s && s.paused && s.hold; }, "dropped lines to pause the session", 40000);
    const dropTxt = await page.locator("#hpdDock").innerText(); if (!/dropping before they ring/.test(dropTxt)) console.log("DOCK:", dropTxt.replace(/\s+/g, " ").slice(0, 400), "| SESSION", JSON.stringify(await page.evaluate(() => window.hpDialer.session)));
    check(/dropping before they ring/.test(dropTxt), "calls that drop before ringing pause with an explanation");
    check((await noAns()) === noAns0, "nothing was logged No answer for lines that never rang");
    await page.locator("#hpdkStop").click();
    await until(async () => !(await page.evaluate(() => window.hpDialer.session)), "Stop to end the paused session");
    await realFetch(ORIGIN + "/__sim/fail-dial?on=0", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    console.log("ALL PASSED");
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    setTimeout(() => process.exit(process.exitCode || 0), 200);
  }
}
