// Desk APIs: per-user documents (leads, appointments, calls), team docs (crew, settings),
// names, lobby presence, and the Highpoint Bot.
import { D1, ensureSchema } from "./lib/store.mjs";
import { requireUser, requireFeature } from "./lib/auth.mjs";
import { redact } from "./lib/redact.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const TEAM = new Set(["crew", "settings"]);
const okName = (s) => /^[A-Za-z0-9_-]{1,40}$/.test(s);

async function bump(scope, col) {
  await D1().prepare("INSERT INTO colver (scope, col, v) VALUES (?1, ?2, 1) ON CONFLICT(scope, col) DO UPDATE SET v = v + 1").bind(scope, col).run();
}

export async function docsRoute(req, parts) {
  const user = await requireUser(req); await ensureSchema();
  const [col, id] = parts;
  if (!okName(col)) return json({ error: "Bad collection" }, 400);
  const scope = TEAM.has(col) ? "team" : user.id;
  if (req.method === "GET" && !id) {
    const v = (await D1().prepare("SELECT v FROM colver WHERE scope=?1 AND col=?2").bind(scope, col).first())?.v || 0;
    const since = new URL(req.url).searchParams.get("v");
    if (since && +since === v) return json({ unchanged: true, version: String(v) });
    const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col=?2").bind(scope, col).all();
    return json({ version: String(v), docs: (r.results || []).map((x) => ({ id: x.id, data: JSON.parse(x.data) })) });
  }
  if (!id || id.length > 120) return json({ error: "Bad id" }, 400);
  if (col === "crew" && id !== user.id) return json({ error: "You can only change your own crew card." }, 403);
  if (req.method === "GET") { const r = await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).first(); return json({ id, data: r ? JSON.parse(r.data) : null }); }
  if (req.method === "PUT") {
    const body = await req.text();
    if (body.length > 900_000) return json({ error: "That record is too big." }, 413);
    const next = JSON.parse(body);
    const prev = col === "leads" ? await D1().prepare("SELECT data FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).first().then((r) => (r ? JSON.parse(r.data) : null)).catch(() => null) : null;
    await D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, ?2, ?3, ?4, ?5)").bind(scope, col, id, body, Date.now()).run();
    await bump(scope, col);
    // automatic text follow-ups (no-answer texts, appointment reminders)
    if (col === "leads" || col === "appts") { try { const fu = await import("./lib/followups.mjs"); if (col === "leads") await fu.onLeadSaved(user, id, prev, next); else await fu.onApptSaved(user, id, next); } catch (e) { console.error("follow-ups", e); } }
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await D1().prepare("DELETE FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(scope, col, id).run();
    await bump(scope, col); return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

// One request to check many collections: GET /api/docs/_sync?c=leads:3,appts:0
export async function docsSync(req) {
  const user = await requireUser(req); await ensureSchema();
  const want = (new URL(req.url).searchParams.get("c") || "").split(",").map((x) => x.split(":")).filter(([n]) => okName(n || "")).slice(0, 20);
  const out = {};
  for (const [col, since] of want) {
    const scope = TEAM.has(col) ? "team" : user.id;
    const v = (await D1().prepare("SELECT v FROM colver WHERE scope=?1 AND col=?2").bind(scope, col).first())?.v || 0;
    if (since !== "" && since !== undefined && +since === v) { out[col] = { unchanged: true, version: String(v) }; continue; }
    const r = await D1().prepare("SELECT id, data FROM docs WHERE scope=?1 AND col=?2").bind(scope, col).all();
    out[col] = { version: String(v), docs: (r.results || []).map((x) => ({ id: x.id, data: JSON.parse(x.data) })) };
  }
  return json({ cols: out });
}

// Many writes in one request (imports of hundreds of leads)
export async function docsBatch(req) {
  const user = await requireUser(req); await ensureSchema();
  const { col, items = [] } = await req.json();
  if (!okName(col) || TEAM.has(col)) return json({ error: "Bad collection" }, 400);
  const stmts = items.slice(0, 500).map((it) => it.delete
    ? D1().prepare("DELETE FROM docs WHERE scope=?1 AND col=?2 AND id=?3").bind(user.id, col, String(it.id))
    : D1().prepare("INSERT OR REPLACE INTO docs (scope, col, id, data, updated) VALUES (?1, ?2, ?3, ?4, ?5)").bind(user.id, col, String(it.id), JSON.stringify(it.data), Date.now()));
  if (stmts.length) await D1().batch(stmts);
  await bump(user.id, col);
  return json({ ok: true, count: stmts.length });
}

export async function usersRoute(req) {
  await requireUser(req); await ensureSchema();
  const ids = (new URL(req.url).searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 100);
  if (!ids.length) return json({});
  const r = await D1().prepare(`SELECT id, name FROM users WHERE id IN (${ids.map((_, i) => "?" + (i + 1)).join(",")})`).bind(...ids).all();
  return json(Object.fromEntries((r.results || []).map((u) => [u.id, { name: u.name }])));
}

export async function roomRoute(req, action) {
  const user = await requireUser(req); await ensureSchema();
  if (action === "presence" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await D1().prepare("INSERT OR REPLACE INTO room (user_id, name, presence, at) VALUES (?1, ?2, ?3, ?4)").bind(user.id, user.name, JSON.stringify(b || {}).slice(0, 2000), Date.now()).run();
    return json({ ok: true });
  }
  if (action === "peers") {
    const r = await D1().prepare("SELECT user_id, name, presence, at FROM room WHERE at > ?1").bind(Date.now() - 90_000).all();
    return json({ me: user.id, peers: (r.results || []).map((p) => ({ id: p.user_id, peerId: p.user_id, name: p.name, kind: "viewer", presence: JSON.parse(p.presence || "{}"), isMe: p.user_id === user.id })) });
  }
  if (action === "emit" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    await D1().prepare("INSERT INTO roomev (topic, by, data, at) VALUES (?1, ?2, ?3, ?4)").bind(String(b.topic || "").slice(0, 40), user.id, JSON.stringify(b.data ?? null).slice(0, 4000), Date.now()).run();
    await D1().prepare("DELETE FROM roomev WHERE at < ?1").bind(Date.now() - 864e5).run();
    return json({ ok: true });
  }
  if (action === "events") {
    const q = new URL(req.url).searchParams;
    if (!q.has("after")) return json({ me: user.id, last: (await D1().prepare("SELECT MAX(id) AS m FROM roomev").first())?.m || 0, events: [] });
    const r = await D1().prepare("SELECT id, topic, by, data, at FROM roomev WHERE id > ?1 ORDER BY id LIMIT 100").bind(+q.get("after") || 0).all();
    return json({ me: user.id, events: (r.results || []).map((e) => ({ ...e, data: JSON.parse(e.data), isMe: e.by === user.id })) });
  }
  return json({ error: "Unknown action" }, 404);
}

// Highpoint Bot + call summaries. Prefers Cloudflare Workers AI (10,000 neurons/day
// free, then cheap). Anthropic is only used when there is no AI binding (local/dev).
const DEFAULT_CF = "@cf/google/gemma-4-26b-a4b-it";
const FALLBACK_CF = "@cf/zai-org/glm-4.7-flash";
const DEFAULT_CLAUDE = "claude-haiku-5-5";
const HP_BOT_SYSTEM = `You are Highpoint Bot for licensed agents at Highpoint Financial. Products: final expense (FE), mortgage protection / term (MP), and IUL. Be concise, practical and accurate. You are not a lawyer or the carrier. If you are not sure, say so and tell the agent what to confirm. Do not invent clients, premiums, or underwriting rules that are not listed here.

Desk facts (Oct 2026) — source of truth for Quote & compare:
- FE issue ages: level/graded typically 45–85. GI typically 50–80.
- FE plans: Level = full death benefit day one if health answers are clean. Graded = partial benefit years 1–2 for natural causes, full after. GI = no health questions; return of premium plus interest years 1–2, full after.
- Exact FE charts: Transamerica FE Express (level, $42 policy fee, not NY; face $5k–$100k to age 75, $25k after). American Amicable Senior Choice. Mutual of Omaha Living Promise (form UC8167, Texas; women and men 55–75 match published, men 45/50/80 may run up to ~6% low; graded is estimated). Aetna, Foresters, Corebridge, Ethos, American Home Life, Fidelity Life and Royal Neighbors are market-checked estimates from real Toolkits quotes, not carrier rates.
- FE partners and typical plans: Transamerica, Mutual of Omaha, Aetna, Aetna Accendo, American Amicable, Royal Neighbors, Foresters, American Home Life = level + graded. Corebridge = level + graded + GI (often 50–80; GI ages sometimes to 85; no NY). Ethos = level + GI (no NY). Fidelity Life = level + GI. American Amicable often 50–85, no DE. Mutual of Omaha often 45–80, graded face cap around $20k.
- Term: Ethos prices come from Ethos's own online estimator (Texas, Oct 2026). Other term (Corebridge/AIG, Transamerica, Mutual of Omaha, Foresters, American Amicable) are rough estimates scaled from that curve. Typical max issue age by term: 10yr 75, 15yr 70, 20yr 65, 25yr 55, 30yr 50. Age + term should stay ≤ 85.
- IUL (Transamerica, F&G, Mutual of Omaha, Ethos, AIG): Highpoint model estimates, ages typically 18–75. Designs: protection (more death benefit), balanced, cash value (more accumulation). Ethos and AIG lean protection. Run the carrier software before presenting.
- Never invent a specific monthly premium. Point the agent to Quote & compare, or say it is an estimate they must confirm.

Highpoint FE UW model used by Quote & compare (typical market pattern — always confirm in that carrier's current guide):
Tiers: 0 Preferred (level on preferred-friendly carriers), 1 Standard (level), 2 Graded, 3 GI, 4 will not issue.
Preferred-friendly FE names in the desk: Transamerica, Aetna, Aetna Accendo, American Home Life, American Amicable, Royal Neighbors, Foresters, Corebridge, Ethos, Fidelity Life.
Typical condition → tier (years since last treatment). Worst condition wins.
- Anytime Preferred: controlled high blood pressure, high cholesterol, asthma, sleep apnea, basal/squamous skin cancer, depression or anxiety, hip or knee replacement, thyroid.
- Anytime Standard: diabetes on oral meds, diet, or insulin; rheumatoid arthritis; bipolar.
- Diabetes with complications (neuropathy, retinopathy): Graded if under 2 years, Standard after.
- Heart attack or stroke: GI under 1 year, Graded 1–2 years, Standard after 2 years.
- TIA: Graded under 1 year, Standard after. CAD / angina / stent / bypass: Graded under 1 year, Standard after.
- CHF: GI under 1 year, Graded after. AFib / irregular heartbeat: Graded under 1 year, Standard after.
- COPD / emphysema / chronic bronchitis: Graded under 2 years, Standard after. Oxygen use: GI.
- Current cancer (not basal/squamous): GI. Past cancer: GI under 2 years, Graded 2–3 years, Standard after 3 years.
- Chronic kidney disease: Graded. Dialysis, cirrhosis / liver disease, Alzheimer's / dementia, HIV/AIDS, wheelchair or help with daily activities: GI.
- Parkinson's, MS, lupus, schizophrenia, organ transplant, pending surgery or tests: Graded.
- Alcohol or drug treatment: GI under 2 years, Graded 2–5 years, Standard after 5 years. Amputation from disease: Graded under 2 years, Standard after.
- Nursing home, hospice, currently hospitalized, or terminal illness: will not issue.
BMI: under 17 Graded; 17–38 clean; 38–43 Standard; 43–48 Graded; 48+ GI.
Nicotine in this model (tobacco rates): cigarettes, cigars, pipe, chew, vape/e-cigarette, nicotine patch or gum. Marijuana is treated as non-tobacco.
Carrier exceptions in the desk: American Amicable keeps AFib, insulin diabetes, bipolar and schizophrenia at Standard (not worse) and depression Preferred. Mutual of Omaha: AFib Graded under 1 year else Standard; past cancer Graded under 4 years else Standard; heart attack / stroke / CAD Graded under 2 years else Standard; diabetes Standard.
Meds agents hear: insulin brands → insulin diabetes. Metformin, Ozempic, Mounjaro, Jardiance, Trulicity → oral diabetes. Eliquis, Xarelto, Warfarin → AFib. Lasix, Entresto → CHF. Plavix, nitroglycerin → CAD. Spiriva, Trelegy, Symbicort → COPD. Aricept, Namenda → dementia. Sinemet → Parkinson's. Biktarvy → HIV. Suboxone, Methadone → substance treatment. Keytruda, Opdivo → current cancer.

Compliance: no guarantees of approval or returns; never pretend to be a government program; client texts must include "Reply STOP to opt out." Refer to clients by name, never internal ids. Plain text, no markdown headings.`;
function stripThink(s) {
  return String(s || "").replace(/<(?:think|thought|reasoning)>[\s\S]*?<\/(?:think|thought|reasoning)>/gi, "").replace(/^\s*thinking[:\s]+[\s\S]*?\n\s*(?:answer|final)[:\s]+/i, "").trim();
}
function aiText(out) {
  if (out == null) return "";
  const pick = (v) => stripThink(typeof v === "string" ? v : "");
  if (typeof out === "string") return pick(out);
  for (const v of [out.response, out.result?.response, out.output_text, out.text]) {
    const t = pick(v);
    if (t) return t;
  }
  if (Array.isArray(out.choices)) return pick(out.choices.map((c) => c?.message?.content || c?.text || "").join(""));
  if (Array.isArray(out.content)) return pick(out.content.filter((c) => c?.type === "text" || typeof c?.text === "string").map((c) => (typeof c === "string" ? c : c.text)).join(""));
  return "";
}
export async function aiRoute(req) {
  await requireFeature(req, "bot", "dialer"); // Highpoint Bot, or the dialer's call summaries and Copilot
  const ai = globalThis.__ENV?.AI;
  const key = String(env("ANTHROPIC_API_KEY") || "").trim();
  if (!ai?.run && !key) return json({ error: "The assistant isn't turned on yet. Add a Workers AI binding named AI in Cloudflare Pages → Settings → Bindings, then redeploy.", code: "unavailable" }, 503);
  const b = await req.json().catch(() => ({}));
  const messages = (b.messages || []).filter((m) => m && (m.role === "user" || m.role === "assistant")).map((m) => ({ role: m.role, content: typeof m.content === "string" ? redact(m.content.slice(0, 40000)) : redact(JSON.stringify(m.content)).slice(0, 40000) })).slice(-30);
  if (!messages.length) return json({ error: "Nothing to send" }, 400);
  const extra = String(b.system || "").trim();
  const system = [HP_BOT_SYSTEM, extra].filter(Boolean).join("\n\n").slice(0, 12000);
  const chosen = String(env("HP_AI_MODEL") || "").trim();

  if (ai?.run) {
    const retired = /llama-3(\.1)?-8b-instruct(?!-fp8)|glm-4\.7-flash/.test(chosen);
    const model = chosen.startsWith("@cf/") && !retired ? chosen : DEFAULT_CF;
    const run = async (m) => aiText(await ai.run(m, {
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: 2500,
      temperature: 0.2,
      ...(m === DEFAULT_CF ? { chat_template_kwargs: { enable_thinking: true } } : {}),
    }));
    try {
      let text;
      try { text = await run(model); }
      catch (e) {
        const detail = String(e?.message || e || "");
        if (model !== FALLBACK_CF && /5028|deprecated|not found|unavailable/i.test(detail)) text = await run(FALLBACK_CF);
        else throw e;
      }
      if (!String(text).trim()) return json({ error: "The assistant didn't return an answer. Try again.", code: "empty" }, 502);
      return json({ text });
    } catch (e) {
      const detail = String(e?.message || e || "");
      if (/neuron|quota|limit|429|3028/i.test(detail)) return json({ error: "Today's free Workers AI allowance is used up. Try again tomorrow — extra use is billed in cents on a paid Workers plan, not Claude credits.", code: "quota" }, 429);
      return json({ error: detail || "Assistant error" }, 502);
    }
  }

  const ask = (model) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages }),
  });
  let model = chosen || DEFAULT_CLAUDE;
  if (!model.startsWith("claude-")) model = DEFAULT_CLAUDE;
  let r = await ask(model);
  let j = await r.json().catch(() => ({}));
  if (r.status === 404 && model !== DEFAULT_CLAUDE) { r = await ask(DEFAULT_CLAUDE); j = await r.json().catch(() => ({})); }
  if (r.ok) return json({ text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("") });
  const detail = String(j.error?.message || "");
  if (r.status === 401) return json({ error: "The Anthropic API key isn't valid. An admin needs to check ANTHROPIC_API_KEY in Cloudflare (it starts with sk-ant-).", code: "bad_key" }, 502);
  if (r.status === 403) return json({ error: "This Anthropic API key doesn't have access. Check the key's workspace in the Claude Console.", code: "forbidden" }, 502);
  if (/credit balance|billing|purchase credits/i.test(detail)) return json({ error: "The Anthropic account is out of credits. An admin needs to add credits in the Claude Console (Billing).", code: "no_credit" }, 502);
  if (r.status === 429) return json({ error: "Too many requests right now. Try again in a minute.", code: "rate_limited" }, 429);
  if (r.status === 529 || r.status >= 500) return json({ error: "Claude is busy right now. Try again in a moment.", code: "busy" }, 503);
  return json({ error: detail || "Assistant error" }, 502);
}
