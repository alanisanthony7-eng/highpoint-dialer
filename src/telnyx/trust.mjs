// Trust Hub (Telnyx): the business profile carriers vet, caller name on every number, the free carrier
// registry, and Telnyx Number Reputation (spam-risk scores from the analytics engines US carriers use).
// Admin only, reached through /api/telnyx/trust*.
//
//   GET  /api/telnyx/trust            everything the Trust Hub page shows
//   POST /api/telnyx/trust-profile    save the business profile and register it with Telnyx (free)
//   POST /api/telnyx/trust-cnam       {name} caller name on every Telnyx number
//   POST /api/telnyx/trust-fcr        {done} Free Caller Registry submitted (a web form; no API)
//   POST /api/telnyx/trust-tos        accept Telnyx's Number Reputation terms
//   GET  /api/telnyx/trust-loa        the Letter of Authorization PDF to sign
//   POST /api/telnyx/trust-enable     body = signed LOA (PDF): upload it and turn on monitoring (billed by Telnyx)
//   POST /api/telnyx/trust-numbers    add every number to monitoring
//   POST /api/telnyx/trust-sync       pull the latest (cached, free) scores
import { json, bad, getJ, setJ, updateJ, to10 } from "../lib/hp.mjs";
import { tx, TX_KEY } from "./tx.mjs";

const ORG_TYPES = ["commercial", "government", "non_profit"];
const LEGAL_TYPES = ["corporation", "llc", "partnership", "nonprofit", "other"];
const SIZES = ["1-10", "11-50", "51-200", "201-500", "501-2000", "2001-10000", "10001+"];
const INDUSTRIES = ["insurance", "financial", "finance", "sales", "marketing", "business", "customer service", "healthcare", "real estate", "other"];
const API = "https://api.telnyx.com";

const hubGet = async () => (await getJ("trust", "hub")) || {};
const hubSave = (fn) => updateJ("trust", "hub", (h) => { fn(h); return h; }, {});
async function ourNumbers() {
  const all = (await getJ("numbers", "all")) || {};
  return Object.values(all).filter((n) => !n.released && n.provider === "telnyx" && n.e164);
}

/* ---------- business profile ---------- */
const s = (v, n = 255) => String(v ?? "").trim().slice(0, n);
const einFmt = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2)}` : s(v, 20); };
export function cleanProfile(b = {}) {
  let website = s(b.website);
  if (website && !/^https?:\/\//i.test(website)) website = "https://" + website;
  return {
    legalName: s(b.legalName, 64), dba: s(b.dba), ein: einFmt(b.ein), website,
    legalType: LEGAL_TYPES.includes(b.legalType) ? b.legalType : "llc",
    orgType: ORG_TYPES.includes(b.orgType) ? b.orgType : "commercial",
    industry: INDUSTRIES.includes(b.industry) ? b.industry : "insurance",
    employees: SIZES.includes(b.employees) ? b.employees : "1-10",
    incState: s(b.incState, 60),
    street: s(b.street), suite: s(b.suite), city: s(b.city, 100), state: s(b.state, 2).toUpperCase(), zip: s(b.zip, 10),
    first: s(b.first), last: s(b.last), title: s(b.title), email: s(b.email).toLowerCase(), phone: to10(b.phone) || s(b.phone, 20),
  };
}
export function profileProblems(p) {
  const out = [];
  if (p.legalName.length < 3) out.push("legal business name");
  if (!/^\d{2}-\d{7}$/.test(p.ein)) out.push("EIN (9 digits, like 12-3456789)");
  if (p.website && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(p.website)) out.push("website");
  if (!p.incState) out.push("state of incorporation");
  if (!p.street) out.push("street address");
  if (!p.city) out.push("city");
  if (!/^[A-Z]{2}$/.test(p.state)) out.push("state (2 letters)");
  if (!/^\d{5}(-\d{4})?$/.test(p.zip)) out.push("ZIP code");
  if (!p.first || !p.last) out.push("contact name");
  if (!p.title) out.push("contact job title");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) out.push("contact email");
  if (!/^\d{10}$/.test(p.phone)) out.push("contact phone (10 digits)");
  return out;
}
// One contact and one address serve as both the organization's and billing's: Telnyx requires both.
export function enterpriseBody(p, { create = true, locked = false } = {}) {
  const contact = { first_name: p.first, last_name: p.last, email: p.email, phone_number: "+1" + p.phone };
  const addr = { country: "US", administrative_area: p.state, city: p.city, postal_code: p.zip, street_address: p.street, ...(p.suite ? { extended_address: p.suite } : {}) };
  const body = {
    legal_name: p.legalName, doing_business_as: p.dba, organization_type: p.orgType, organization_legal_type: p.legalType,
    website: p.website, fein: p.ein, industry: p.industry, number_of_employees: p.employees, jurisdiction_of_incorporation: p.incState,
    organization_contact: { ...contact, job_title: p.title }, billing_contact: contact, organization_physical_address: addr, billing_address: addr,
  };
  if (create) body.country_code = "US"; // can't be changed later, so it's only sent once
  if (locked) { delete body.legal_name; delete body.fein; delete body.website; } // fixed once reputation monitoring is on
  return body;
}

/* ---------- reputation scores ---------- */
async function listMonitored(ent) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const j = await tx(`/v2/enterprises/${ent}/reputation/numbers`, { query: { "page[number]": page, "page[size]": 100 } });
    out.push(...(j.data || []));
    if ((j.data || []).length < 100) break;
  }
  return out;
}
// Cached reads are free. High risk takes a number out of caller-ID rotation; medium marks it to watch.
async function syncRep(ent) {
  const rows = await listMonitored(ent);
  const map = {};
  for (const r of rows) if (r.phone_number) map[r.phone_number] = { ...(r.reputation_data || {}), monitored: true };
  await setJ("trust", "rep", map);
  await updateJ("numbers", "all", (all) => {
    for (const n of Object.values(all || {})) {
      const risk = map[n.e164]?.spam_risk;
      if (risk === "high") { n.health = "flagged"; n.healthBy = "reputation"; }
      else if (risk === "medium") { n.health = "watch"; n.healthBy = "reputation"; }
      else if (n.healthBy === "reputation") { delete n.health; delete n.healthBy; }
    }
    return all;
  }, {});
  await hubSave((h) => { h.repSyncAt = Date.now(); });
  return map;
}
const tosAgreed = (hub, tos) => !!hub.rep?.tosAt || tos?.agreed === true || tos?.accepted === true || /^(agreed|accepted)$/i.test(tos?.status || "");

async function trustStatus() {
  let hub = await hubGet();
  const nums = await ourNumbers();
  const out = {
    profile: hub.profile || null, enterpriseId: hub.enterpriseId || null, enterpriseErr: hub.enterpriseErr || null, enterpriseAt: hub.enterpriseAt || null,
    cnam: hub.cnam || null, fcrAt: hub.fcrAt || null, rep: hub.rep || {}, repSyncAt: hub.repSyncAt || null,
    stir: { owned: nums.length }, // Telnyx signs calls from numbers you own with A-level attestation
  };
  if (hub.enterpriseId) {
    try { out.repLive = (await tx(`/v2/enterprises/${hub.enterpriseId}/reputation`)).data || null; }
    catch (e) { out.repLive = null; out.repNote = e.message; }
  }
  try { out.tos = (await tx("/v2/terms_of_service/status", { query: { product_type: "number_reputation" } })).data ?? null; } catch (e) { out.tosErr = e.message; }
  out.tosOk = tosAgreed(hub, out.tos);
  const approved = out.repLive?.status === "approved" && out.repLive?.loa_status === "approved";
  if (approved && Date.now() - (hub.repSyncAt || 0) > 36e5) { try { await syncRep(hub.enterpriseId); hub = await hubGet(); out.repSyncAt = hub.repSyncAt; } catch (e) { out.repSyncErr = e.message; } }
  const rep = (await getJ("trust", "rep")) || {};
  out.numbers = nums.map((n) => ({ e164: n.e164, label: n.label || "", state: n.state || "", rep: rep[n.e164] || null, cnam: hub.cnam?.failed?.[n.e164] ? "failed" : hub.cnam?.name ? "set" : null }));
  return out;
}

export async function trustRoute(req, action) {
  const post = req.method === "POST";
  if (action === "trust" && req.method === "GET") return json(await trustStatus());

  if (action === "trust-profile" && post) {
    const p = cleanProfile(await req.json().catch(() => ({})));
    const missing = profileProblems(p);
    if (missing.length) return bad("Please check: " + missing.join(", ") + ".", 400, { missing });
    const hub = await hubGet();
    let enterpriseId = hub.enterpriseId || null, err = null;
    try {
      if (enterpriseId) await tx(`/v2/enterprises/${enterpriseId}`, { method: "PUT", body: enterpriseBody(p, { create: false, locked: !!hub.rep?.enabledAt }) });
      else enterpriseId = (await tx("/v2/enterprises", { method: "POST", body: enterpriseBody(p) })).data?.id || null;
    } catch (e) { err = e.message; }
    await hubSave((h) => { h.profile = p; h.enterpriseId = enterpriseId; h.enterpriseErr = err; if (!err) h.enterpriseAt = Date.now(); });
    return err ? bad(err, 400, { saved: true }) : json({ ok: true, enterpriseId });
  }

  if (action === "trust-cnam" && post) {
    const name = s((await req.json().catch(() => ({}))).name, 40).toUpperCase().replace(/\s+/g, " ");
    if (!/^[A-Z0-9 ]{1,15}$/.test(name)) return bad("Use up to 15 letters, numbers or spaces.");
    const failed = {}; let ok = 0;
    for (const n of await ourNumbers()) {
      if (!n.sid) { failed[n.e164] = "no Telnyx id for this number"; continue; }
      try { await tx(`/v2/phone_numbers/${n.sid}/voice`, { method: "PATCH", body: { cnam_listing: { cnam_listing_enabled: true, cnam_listing_details: name } } }); ok++; }
      catch (e) { failed[n.e164] = e.message; }
    }
    await hubSave((h) => { h.cnam = { name, at: Date.now(), ok, failed }; });
    return json({ ok: true, name, set: ok, failed });
  }

  if (action === "trust-fcr" && post) {
    const done = !!(await req.json().catch(() => ({}))).done;
    await hubSave((h) => { h.fcrAt = done ? Date.now() : null; });
    return json({ ok: true, done });
  }

  const hub = await hubGet();
  const ent = hub.enterpriseId;
  if (["trust-tos", "trust-loa", "trust-enable", "trust-numbers", "trust-sync"].includes(action) && !ent) return bad("Save your business profile first. Telnyx needs it before anything else.", 409);

  if (action === "trust-tos" && post) {
    await tx("/v2/terms_of_service/number_reputation/agree", { method: "POST", body: {} });
    await hubSave((h) => { h.rep = { ...(h.rep || {}), tosAt: Date.now() }; });
    return json({ ok: true });
  }

  if (action === "trust-loa" && req.method === "GET") { // Telnyx fills the letter in from the business profile
    const r = await fetch(`${API}/v2/enterprises/${ent}/reputation/loa`, { method: "POST", headers: { authorization: "Bearer " + TX_KEY(), "content-type": "application/json", accept: "application/pdf" }, body: "{}" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); return bad("Telnyx: " + (j.errors?.[0]?.detail || r.statusText), 400); }
    return new Response(r.body, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="telnyx-letter-of-authorization.pdf"', "cache-control": "no-store" } });
  }

  if (action === "trust-enable" && post) {
    const buf = new Uint8Array(await req.arrayBuffer());
    if (!buf.length || buf.length > 10 * 1024 * 1024) return bad("Upload the signed letter as a PDF under 10 MB.");
    if (String.fromCharCode(...buf.slice(0, 4)) !== "%PDF") return bad("That file isn't a PDF. Upload the signed letter as a PDF.");
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: "application/pdf" }), "signed-letter-of-authorization.pdf");
    const r = await fetch(`${API}/v2/documents`, { method: "POST", headers: { authorization: "Bearer " + TX_KEY(), accept: "application/json" }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data?.id) return bad("Telnyx couldn't take the letter: " + (j.errors?.[0]?.detail || r.statusText), 400);
    const docId = j.data.id;
    let live;
    try {
      // first time: turn monitoring on; after a rejected letter: swap the letter in
      live = hub.rep?.enabledAt
        ? (await tx(`/v2/enterprises/${ent}/reputation/loa`, { method: "PATCH", body: { loa_document_id: docId } })).data
        : (await tx(`/v2/enterprises/${ent}/reputation`, { method: "POST", body: { loa_document_id: docId, check_frequency: "business_daily" } })).data;
    } catch (e) {
      await hubSave((h) => { h.rep = { ...(h.rep || {}), loaDocId: docId, err: e.message }; });
      return bad(e.message, 400);
    }
    await hubSave((h) => { h.rep = { ...(h.rep || {}), loaDocId: docId, enabledAt: h.rep?.enabledAt || Date.now(), err: null }; });
    return json({ ok: true, status: live?.status || "pending", loaStatus: live?.loa_status || "pending" });
  }

  if (action === "trust-numbers" && post) { // up to 100 per request, and only numbers not already monitored
    const have = new Set((await listMonitored(ent)).map((r) => r.phone_number));
    const add = (await ourNumbers()).map((n) => n.e164).filter((e) => !have.has(e));
    for (let i = 0; i < add.length; i += 100) await tx(`/v2/enterprises/${ent}/reputation/numbers`, { method: "POST", body: { phone_numbers: add.slice(i, i + 100) } });
    await hubSave((h) => { h.rep = { ...(h.rep || {}), numbersAt: Date.now() }; });
    return json({ ok: true, added: add.length, already: have.size });
  }

  if (action === "trust-sync" && post) {
    const map = await syncRep(ent);
    return json({ ok: true, numbers: Object.keys(map).length });
  }

  return bad("Unknown action", 404);
}
