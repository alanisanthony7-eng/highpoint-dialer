// Highpoint Bot (/api/ai): turned off without a key, which model it asks for, falling back when a chosen
// model is retired, and plain messages for a bad key, an empty account and a busy API. Run: node test/ai-bot.mjs
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";

const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a.map(norm)),
  first: async () => out(sql.prepare(q).get(...args)) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args).map(out) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
});
const DB = { prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026" };

// fake Anthropic API: answers according to `reply`, records what was asked
const asked = [];
let reply = () => ({ status: 200, body: { content: [{ type: "text", text: "Hello from Claude" }] } });
globalThis.fetch = async (url, o = {}) => {
  if (!String(url).includes("api.anthropic.com")) return new Response("{}", { status: 500 });
  const body = JSON.parse(o.body); asked.push({ model: body.model, key: o.headers["x-api-key"] });
  const r = reply(body.model);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};
const jars = {};
async function call(who, path, body) {
  const h = { "content-type": "application/json" }; if (jars[who]) h.cookie = jars[who];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method: "POST", headers: h, body: JSON.stringify(body) }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const hi = { messages: [{ role: "user", content: "hi" }] };

await call("rep", "/api/auth/signup", { email: "rep@hp.com", password: "password1", name: "Rep", invite: "HP2026", agree: true });

let r = await call("rep", "/api/ai", hi);
ok(r.s === 503 && /ANTHROPIC_API_KEY/.test(r.j.error) && asked.length === 0, "without a key the bot says what to add, and calls nothing");
env.ANTHROPIC_API_KEY = "  sk-ant-test  ";
r = await call("rep", "/api/ai", hi);
ok(r.s === 200 && r.j.text === "Hello from Claude", "with a key the bot answers");
ok(asked.at(-1).model === "claude-haiku-5-5" && asked.at(-1).key === "sk-ant-test", "it uses the current Haiku model, and stray spaces around the key are trimmed");
env.HP_AI_MODEL = "claude-sonnet-5-5";
await call("rep", "/api/ai", hi);
ok(asked.at(-1).model === "claude-sonnet-5-5", "HP_AI_MODEL picks a different model");
env.HP_AI_MODEL = "claude-old-model";
reply = (model) => (model === "claude-old-model" ? { status: 404, body: { error: { type: "not_found_error", message: "model: claude-old-model" } } } : { status: 200, body: { content: [{ type: "text", text: "fallback ok" }] } });
r = await call("rep", "/api/ai", hi);
ok(r.s === 200 && r.j.text === "fallback ok" && asked.at(-1).model === "claude-haiku-5-5", "a retired model in HP_AI_MODEL falls back to the default instead of breaking");
delete env.HP_AI_MODEL;
reply = () => ({ status: 401, body: { error: { type: "authentication_error", message: "invalid x-api-key" } } });
r = await call("rep", "/api/ai", hi);
ok(r.j.code === "bad_key" && /isn't valid/.test(r.j.error), "a wrong key says so");
reply = () => ({ status: 400, body: { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } });
r = await call("rep", "/api/ai", hi);
ok(r.j.code === "no_credit" && /out of credits/.test(r.j.error), "an account with no credits says to add credits");
reply = () => ({ status: 529, body: { error: { type: "overloaded_error", message: "Overloaded" } } });
r = await call("rep", "/api/ai", hi);
ok(r.s === 503 && r.j.code === "busy", "a busy API asks to try again");
reply = () => ({ status: 429, body: { error: { type: "rate_limit_error", message: "rate limited" } } });
r = await call("rep", "/api/ai", hi);
ok(r.s === 429 && r.j.code === "rate_limited", "rate limits still come back as 429");
ok((await call("nobody", "/api/ai", hi)).s === 401, "signed-out visitors can't use the bot");
console.log("done");
