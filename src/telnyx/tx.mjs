// Telnyx: REST helper, one-click setup, per-agent browser-phone tokens, numbers
import crypto from "node:crypto";
import { env, json, bad, requireUser, wrap, httpErr, getJ, setJ, updateJ, config as loadConfig, to10, AREA } from "../lib/hp.mjs";

export const TX_KEY = () => env("TELNYX_API_KEY");
export const isTelnyx = () => !!TX_KEY();
export async function tx(path, { method = "GET", body, query, raw } = {}) {
  if (!TX_KEY()) throw httpErr(503, "Telnyx isn't connected yet. Add TELNYX_API_KEY in Cloudflare Pages → Settings → Variables and secrets.");
  let url = "https://api.telnyx.com" + path;
  if (query) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString();
  const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: "Bearer " + TX_KEY(), "content-type": "application/json", accept: raw ? "*/*" : "application/json" } });
  if (raw && r.ok) return r.text();
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(r.status >= 500 ? 502 : 400, "Telnyx: " + (j.errors?.[0]?.detail || j.errors?.[0]?.title || r.statusText));
  return j;
}
const rnd = (n, abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789") => Array.from(crypto.randomBytes(n), (b) => abc[b % abc.length]).join("");

// Create (or repair) the credential connection every agent's browser phone signs in through.
export async function txSetup() {
  const cfg = await loadConfig();
  const t = { ...(cfg.tx || {}) };
  const ovps = (await tx("/v2/outbound_voice_profiles", { query: { "page[size]": 50 } })).data || [];
  const ovp = ovps.find((o) => o.id === t.ovpId) || ovps.find((o) => o.enabled) || ovps[0];
  if (!ovp) throw httpErr(400, "Your Telnyx account has no outbound voice profile. In the Telnyx portal open Voice → Outbound Voice Profiles and add one.");
  t.ovpId = ovp.id;
  let conn = null;
  if (t.connId) conn = (await tx(`/v2/credential_connections/${t.connId}`).catch(() => null))?.data || null;
  const body = { connection_name: "Highpoint Dialer", active: true, anchorsite_override: "Latency", outbound: { outbound_voice_profile_id: ovp.id }, inbound: { ani_number_format: "+E.164", dnis_number_format: "+e164", simultaneous_ringing: "enabled" } };
  if (conn) await tx(`/v2/credential_connections/${conn.id}`, { method: "PATCH", body });
  else { const c = await tx("/v2/credential_connections", { method: "POST", body: { ...body, user_name: "hpdialer" + rnd(10, "abcdefghijkmnpqrstuvwxyz23456789"), password: rnd(28) } }); t.connId = c.data.id; }
  // make sure the outbound profile allows this connection
  await setJ("config", "app", { ...cfg, tx: { ...t, setupAt: Date.now() } });
  // point our numbers at the connection so they can call out and ring the browser
  const all = (await getJ("numbers", "all")) || {};
  for (const n of Object.values(all)) if (!n.released && n.provider === "telnyx" && n.sid) await tx(`/v2/phone_numbers/${n.sid}`, { method: "PATCH", body: { connection_id: t.connId } }).catch(() => {});
  return { ...t, ovpName: ovp.name };
}

// Browser-phone login token for this agent (one telephony credential per agent)
export async function txToken(user) {
  const cfg = await loadConfig();
  if (!cfg.tx?.connId) throw httpErr(409, "The dialer isn't set up yet. An admin needs to press Connect once.");
  let cred = await getJ("txcred", user.identity);
  if (cred && cred.connId !== cfg.tx.connId) cred = null;
  let fresh = false;
  if (!cred) {
    const c = await tx("/v2/telephony_credentials", { method: "POST", body: { connection_id: cfg.tx.connId, name: user.identity, tag: "highpoint" } });
    cred = { id: c.data.id, sip: c.data.sip_username, connId: cfg.tx.connId, at: Date.now() };
    await setJ("txcred", user.identity, cred); fresh = true;
  }
  let tok = "";
  try { tok = await tx(`/v2/telephony_credentials/${cred.id}/token`, { method: "POST", raw: true }); }
  catch (e) { await setJ("txcred", user.identity, null); throw e; }
  tok = String(tok).trim();
  if (tok.startsWith("{")) { try { const j = JSON.parse(tok); tok = j.data?.token || j.token || j.data || ""; } catch {} }
  return { token: tok, sip: cred.sip, fresh };
}

export async function txSearch(ac, st, contains) {
  const q = { "filter[country_code]": "US", "filter[features][]": "voice", "filter[limit]": 30, "filter[phone_number_type]": "local" };
  if (ac) q["filter[national_destination_code]"] = ac; else if (st) q["filter[administrative_area]"] = st;
  if (contains) q["filter[phone_number][contains]"] = contains;
  let r = await tx("/v2/available_phone_numbers", { query: q }); let fallback = false;
  if (!r.data?.length && ac && st) { delete q["filter[national_destination_code]"]; q["filter[administrative_area]"] = st; r = await tx("/v2/available_phone_numbers", { query: q }); fallback = true; }
  const pretty = (e) => { const d = to10(e); return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`; };
  return { fallback, results: (r.data || []).map((n) => { const loc = Object.fromEntries((n.region_information || []).map((x) => [x.region_type, x.region_name])); return { e164: n.phone_number, pretty: pretty(n.phone_number), city: String(loc.rate_center || loc.location || "").split(":")[0].toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()), state: loc.state || AREA[to10(n.phone_number).slice(0, 3)] || "", areaCode: to10(n.phone_number).slice(0, 3), sms: (n.features || []).some((f) => f.name === "sms"), monthly: n.cost_information?.monthly_cost }; }) };
}

export async function txBuy(phoneNumber) {
  const cfg = await loadConfig();
  const o = await tx("/v2/number_orders", { method: "POST", body: { phone_numbers: [{ phone_number: phoneNumber }], ...(cfg.tx?.connId ? { connection_id: cfg.tx.connId } : {}) } });
  // the order completes in a few seconds; look the number up so we can store its id
  let id = "";
  for (let i = 0; i < 8 && !id; i++) {
    await new Promise((r) => setTimeout(r, 900));
    const l = await tx("/v2/phone_numbers", { query: { "filter[phone_number]": phoneNumber } }).catch(() => ({}));
    id = l.data?.[0]?.id || "";
  }
  if (id && cfg.tx?.connId) await tx(`/v2/phone_numbers/${id}`, { method: "PATCH", body: { connection_id: cfg.tx.connId } }).catch(() => {});
  return { sid: id, orderId: o.data?.id, status: o.data?.status };
}

// /api/telnyx/*  (admin status + setup, agent token)
export const telnyxRoute = wrap(async (req, action) => {
  const user = await requireUser(req);
  if (action === "token") return json({ ...(await txToken(user)), expires: Date.now() + 23 * 36e5 });
  if (!user.admin) return bad("Admins only", 403);
  if (action === "setup" && req.method === "POST") return json({ ok: true, ...(await txSetup()) });
  if (action === "get") { // admin read-only look at the Telnyx account (diagnostics)
    const path = new URL(req.url).searchParams.get("p") || "";
    if (!/^\/v2\/[a-z_\/0-9-]+(\?[^#]*)?$/i.test(path) || /token|secret|key/i.test(path)) return bad("Not allowed", 400);
    return json(await tx(path));
  }
  if (action === "status") {
    if (!TX_KEY()) return json({ connected: false });
    const out = { connected: true, cfg: (await loadConfig()).tx || null };
    const safe = async (k, p, f) => { try { out[k] = f(await tx(p)); } catch (e) { out[k] = { error: e.message }; } };
    await safe("balance", "/v2/balance", (j) => ({ balance: j.data?.balance, available: j.data?.available_credit, currency: j.data?.currency }));
    await safe("numbers", "/v2/phone_numbers?page[size]=50", (j) => (j.data || []).map((n) => ({ number: n.phone_number, status: n.status, connection: n.connection_id || null })));
    await safe("credentialConnections", "/v2/credential_connections?page[size]=50", (j) => (j.data || []).map((c) => ({ id: c.id, name: c.connection_name, ovp: c.outbound?.outbound_voice_profile_id })));
    await safe("outboundProfiles", "/v2/outbound_voice_profiles?page[size]=50", (j) => (j.data || []).map((o) => ({ id: o.id, name: o.name, enabled: o.enabled })));
    return json(out);
  }
  return bad("Unknown action", 404);
});
