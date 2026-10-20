// Highpoint Bot (/api/ai): Workers AI by default, Anthropic only when there is no AI binding.
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

const asked = [];
let reply = () => ({ status: 200, body: { content: [{ type: "text", text: "Hello from Claude" }] } });
globalThis.fetch = async (url, o = {}) => {
  if (!String(url).includes("api.anthropic.com")) return new Response("{}", { status: 500 });
  const body = JSON.parse(o.body); asked.push({ model: body.model, key: o.headers["x-api-key"] });
  const r = reply(body.model);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
};
const cfAsked = [];
let cfReply = () => ({ response: "Hello from Workers AI" });
env.AI = { run: async (model, input) => { cfAsked.push({ model, input }); const r = cfReply(model, input); if (r instanceof Error) throw r; return r; } };

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
ok(r.s === 200 && r.j.text === "Hello from Workers AI", "Workers AI answers when the AI binding is set");
ok(cfAsked.at(-1).model === "@cf/meta/llama-3.1-8b-instruct" && asked.length === 0, "it uses Llama 3.1 8B and does not call Anthropic");
ok(cfAsked.at(-1).input.messages[0].role === "system" && cfAsked.at(-1).input.messages[1].content === "hi", "the desk prompt and the user's message both go to the model");

env.ANTHROPIC_API_KEY = "sk-ant-should-not-be-used";
await call("rep", "/api/ai", hi);
ok(asked.length === 0, "with a Workers AI binding, a leftover Anthropic key is not used");

env.HP_AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";
await call("rep", "/api/ai", hi);
ok(cfAsked.at(-1).model === "@cf/meta/llama-3.2-3b-instruct", "HP_AI_MODEL can pick a cheaper Cloudflare model");
env.HP_AI_MODEL = "claude-sonnet-5-5";
await call("rep", "/api/ai", hi);
ok(cfAsked.at(-1).model === "@cf/meta/llama-3.1-8b-instruct", "a Claude model name is ignored when Workers AI is on");
delete env.HP_AI_MODEL;

cfReply = () => { throw new Error("30000 neurons remaining would drop below 0 (3028)"); };
r = await call("rep", "/api/ai", hi);
ok(r.s === 429 && r.j.code === "quota" && /Workers AI/.test(r.j.error), "hitting the daily allowance says so, and still doesn't call Claude");

delete env.AI;
asked.length = 0;
r = await call("rep", "/api/ai", hi);
ok(r.s === 200 && r.j.text === "Hello from Claude" && asked.at(-1).key === "sk-ant-should-not-be-used", "without an AI binding, a leftover Anthropic key is the fallback");
ok(asked.at(-1).model === "claude-haiku-5-5", "the fallback uses Haiku");

delete env.ANTHROPIC_API_KEY;
r = await call("rep", "/api/ai", hi);
ok(r.s === 503 && /Workers AI binding/.test(r.j.error) && asked.length === 1, "with neither binding nor key, the bot says what to add");

env.ANTHROPIC_API_KEY = "  sk-ant-test  ";
reply = () => ({ status: 401, body: { error: { type: "authentication_error", message: "invalid x-api-key" } } });
r = await call("rep", "/api/ai", hi);
ok(r.j.code === "bad_key" && /isn't valid/.test(r.j.error), "a wrong leftover Anthropic key says so");
ok((await call("nobody", "/api/ai", hi)).s === 401, "signed-out visitors can't use the bot");
console.log("done");
