// Telnyx REST helper + admin status check
import { env, json, bad, requireUser, wrap, httpErr } from "../lib/hp.mjs";

export const TX_KEY = () => env("TELNYX_API_KEY");
export async function tx(path, { method = "GET", body, query } = {}) {
  if (!TX_KEY()) throw httpErr(503, "Telnyx isn't connected yet. Add TELNYX_API_KEY in Cloudflare Pages → Settings → Variables and secrets.");
  let url = "https://api.telnyx.com" + path;
  if (query) url += "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "")).toString();
  const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined, headers: { authorization: "Bearer " + TX_KEY(), "content-type": "application/json", accept: "application/json" } });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(r.status >= 500 ? 502 : 400, "Telnyx: " + (j.errors?.[0]?.detail || j.errors?.[0]?.title || r.statusText));
  return j;
}

// GET /api/telnyx/status  (admin) -> is the key valid, balance, numbers, apps
export const telnyxRoute = wrap(async (req, action) => {
  const user = await requireUser(req);
  if (!user.admin) return bad("Admins only", 403);
  if (action === "status") {
    if (!TX_KEY()) return json({ connected: false });
    const out = { connected: true };
    const safe = async (k, p, f) => { try { out[k] = f(await tx(p)); } catch (e) { out[k] = { error: e.message }; } };
    await safe("balance", "/v2/balance", (j) => ({ balance: j.data?.balance, credit: j.data?.credit_limit, available: j.data?.available_credit, currency: j.data?.currency }));
    await safe("numbers", "/v2/phone_numbers?page[size]=50", (j) => (j.data || []).map((n) => ({ number: n.phone_number, status: n.status, connection: n.connection_id || null })));
    await safe("texmlApps", "/v2/texml_applications?page[size]=50", (j) => (j.data || []).map((a) => ({ id: a.id, name: a.friendly_name, voiceUrl: a.voice_url })));
    await safe("credentialConnections", "/v2/credential_connections?page[size]=50", (j) => (j.data || []).map((c) => ({ id: c.id, name: c.connection_name })));
    await safe("outboundProfiles", "/v2/outbound_voice_profiles?page[size]=50", (j) => (j.data || []).map((o) => ({ id: o.id, name: o.name, enabled: o.enabled })));
    return json(out);
  }
  return bad("Unknown action", 404);
});
