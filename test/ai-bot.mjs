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
const hi = { messages: [{ role: "user", content: "hi" }], nocache: true };

await call("rep", "/api/auth/signup", { email: "rep@hp.com", password: "password1", name: "Rep", invite: "HP2026", agree: true });

let r = await call("rep", "/api/ai", hi);
ok(r.s === 200 && r.j.text === "Hello from Workers AI", "Workers AI answers when the AI binding is set");
ok(cfAsked.at(-1).model === "@cf/google/gemma-4-26b-a4b-it" && asked.length === 0, "it uses Gemma 4 and does not call Anthropic");
ok(cfAsked.at(-1).input.messages[0].role === "system" && /Highpoint Bot/.test(cfAsked.at(-1).input.messages[0].content) && /Heart attack/.test(cfAsked.at(-1).input.messages[0].content) && /packet/.test(cfAsked.at(-1).input.messages[0].content) && cfAsked.at(-1).input.messages[1].content === "hi", "the Highpoint knowledge prompt and the user's message both go to the model");
ok(cfAsked.at(-1).input.temperature === 0.2 && cfAsked.at(-1).input.chat_template_kwargs?.enable_thinking === false, "answers stay conservative so rates are not invented, and skip the slow thinking pass");

env.ANTHROPIC_API_KEY = "sk-ant-should-not-be-used";
await call("rep", "/api/ai", hi);
ok(asked.length === 0, "with a Workers AI binding, a leftover Anthropic key is not used");

env.HP_AI_MODEL = "@cf/meta/llama-3.2-3b-instruct";
await call("rep", "/api/ai", hi);
ok(cfAsked.at(-1).model === "@cf/meta/llama-3.2-3b-instruct" && !cfAsked.at(-1).input.chat_template_kwargs, "HP_AI_MODEL can pick a cheaper Cloudflare model");
env.HP_AI_MODEL = "claude-sonnet-5-5";
await call("rep", "/api/ai", hi);
ok(cfAsked.at(-1).model === "@cf/google/gemma-4-26b-a4b-it", "a Claude model name is ignored when Workers AI is on");
env.HP_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";
await call("rep", "/api/ai", hi);
ok(cfAsked.at(-1).model === "@cf/google/gemma-4-26b-a4b-it", "the retired Llama 3.1 8B id is remapped to Gemma 4");
delete env.HP_AI_MODEL;

await call("rep", "/api/ai", { messages: [{ role: "user", content: "What is Transamerica FE Express at age 80?" }], mode: "train" });
ok(/training coach/.test(cfAsked.at(-1).input.messages[0].content) && /FE Express/.test(cfAsked.at(-1).input.messages[0].content), "training mode adds the coach and the matching carrier chapter");

cfReply = () => ({ response: "<think>internal notes</think>Typical after 2 years is Standard / level. Confirm in the guide." });
r = await call("rep", "/api/ai", { messages: [{ role: "user", content: "heart attack 3 years ago" }] });
ok(r.s === 200 && /Standard/.test(r.j.text) && !/think|internal notes/i.test(r.j.text), "thinking notes stay hidden from the agent");
cfReply = () => ({ response: "Hello from Workers AI" });

cfReply = () => { throw new Error("30000 neurons remaining would drop below 0 (3028)"); };
r = await call("rep", "/api/ai", hi);
ok(r.s === 429 && r.j.code === "quota" && /Workers AI/.test(r.j.error), "hitting the daily allowance says so, and still doesn't call Claude");

// speed: no thinking pass, small prompts for notes, streaming, and instant repeats
r = await call("rep", "/api/ai", { ...hi, think: true });
ok(cfAsked.at(-1).input.chat_template_kwargs?.enable_thinking === true, "thinking can still be switched on per request");
cfReply = () => ({ response: "Summary text" });
const noteReq = { system: "You write CRM notes. Reply with JSON only.", messages: [{ role: "user", content: "Client: I take metformin. Agent: ok" }], mode: "copilot" };
r = await call("rep", "/api/ai", noteReq);
const noteSys = cfAsked.at(-1).input.messages[0].content;
ok(noteSys === "You write CRM notes. Reply with JSON only." && cfAsked.at(-1).input.max_tokens === 900, "call notes skip the big product pack and cap the answer length");
const before = cfAsked.length;
r = await call("rep", "/api/ai", noteReq);
ok(r.j.text === "Summary text" && r.j.cached === true && cfAsked.length === before, "the same question inside five minutes answers instantly without calling the model");
r = await call("rep", "/api/ai", { messages: [{ role: "user", content: "stroke 2 years ago, who takes him?" }], nocache: true });
ok(cfAsked.at(-1).input.max_tokens === 1800 && /Highpoint Bot/.test(cfAsked.at(-1).input.messages[0].content), "the Bot keeps its product knowledge");
env.AI.run = async (model, input) => { cfAsked.push({ model, input }); if (!input.stream) return { response: "x" }; const enc = new TextEncoder(); return new ReadableStream({ start(c) { for (const w of ["Hel", "lo ", "there"]) c.enqueue(enc.encode(`data: ${JSON.stringify({ response: w })}\n\n`)); c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } }); };
const sr = await onRequest({ request: new Request("https://desk.example.com/api/ai", { method: "POST", headers: { "content-type": "application/json", cookie: jars.rep }, body: JSON.stringify({ ...hi, stream: true }) }), env, waitUntil: () => {} });
const streamed = await sr.text();
ok(/event-stream/.test(sr.headers.get("content-type")) && cfAsked.at(-1).input.stream === true && /"Hel"/.test(streamed) && /\[DONE\]/.test(streamed), "answers stream word by word when the desk asks for it");
env.AI.run = async (model, input) => { cfAsked.push({ model, input }); const r = cfReply(model, input); if (r instanceof Error) throw r; return r; };
cfReply = () => ({ response: "Hello from Workers AI" });

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
