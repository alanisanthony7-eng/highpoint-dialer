// Caller-ID numbers: search, buy, assign, pause, release, health
//  GET  /api/dialer/numbers                 list (mine + team; admins see all)
//  GET  /api/dialer/numbers/search?areaCode=&state=&contains=&near=
//  POST /api/dialer/numbers/buy      {phoneNumber, owner?, shared?, price?}  (agents pay for their own numbers: price is the monthly price they were shown)
//  POST /api/dialer/numbers/update   {e164, owner?, shared?, label?, paused?, spamReport?}
//  POST /api/dialer/numbers/release  {e164}
//  POST /api/dialer/numbers/import   (admin) adopt numbers already in the Twilio account
import { isTelnyx, tx, txSearch, txBuy, txRelease, txImport } from "../telnyx/tx.mjs";
import { txMessagingProfile } from "../lib/sms.mjs";
import { numberTerms, chargeNumber, refundNumber, stopNumber, publicCard } from "../lib/numberpay.mjs";
import { wrap, json, bad, requireUser, config as loadConfig, getJ, updateJ, tw, siteUrl, numberHooks, numberCap, today, AREA, to10, listKeys } from "../lib/hp.mjs";

// Agents can always buy their own numbers. The cap is the admin's setting; 0 or unset means the default of 5.
const maxNumbers = (S) => (S.agentMaxNumbers > 0 ? S.agentMaxNumbers : 5);

function health(n, settings, rep) {
  // last 7 days of usage for this number
  let dials = 0, answered = 0, short = 0;
  for (let i = 0; i < 7; i++) {
    const d = today("America/New_York", Date.now() - i * 864e5);
    const v = n.days?.[d]; if (v) { dials += v.dials || 0; answered += v.answered || 0; short += v.short || 0; }
  }
  const rate = dials ? answered / dials : 0;
  const shortRate = answered ? short / answered : 0;
  let status = "healthy", why = [];
  if (n.spamReports?.length) { status = "flagged"; why.push(`${n.spamReports.length} spam-label report${n.spamReports.length > 1 ? "s" : ""}`); }
  // Telnyx Number Reputation: the spam-risk rating carriers' analytics engines give this number (Trust Hub)
  const cat = rep?.spam_category ? ` as ${String(rep.spam_category).toLowerCase()}` : "";
  if (rep?.spam_risk === "high") { status = "flagged"; why.unshift(`carriers rate it high spam risk${cat}`); }
  else if (rep?.spam_risk === "medium") { if (status !== "flagged") status = "watch"; why.push(`carriers rate it medium spam risk${cat}`); }
  if (dials >= 60 && rate < 0.06) { status = status === "flagged" ? status : "watch"; why.push(`only ${(rate * 100).toFixed(1)}% of calls answered this week`); }
  if (answered >= 20 && shortRate > 0.45) { status = status === "flagged" ? status : "watch"; why.push(`${Math.round(shortRate * 100)}% of answers hang up within 10s`); }
  const td = n.days?.[today()] || {};
  const reputation = rep ? { risk: rep.spam_risk || null, category: rep.spam_category || null, scores: { maturity: rep.maturity_score ?? null, connection: rep.connection_score ?? null, engagement: rep.engagement_score ?? null, sentiment: rep.sentiment_score ?? null }, at: rep.last_refreshed_at || null } : null;
  return { status, why, week: { dials, answered, short, answerRate: rate }, todayDials: td.dials || 0, cap: null, reputation };
}

export default wrap(async (req) => {
  const user = await requireUser(req);
  const cfg = await loadConfig(); const S = cfg.settings;
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  const q = new URL(req.url).searchParams;
  const all = (await getJ("numbers", "all")) || {};
  const canEdit = (n) => user.admin || n.owner === user.identity;

  if (req.method === "GET" && action === "numbers") {
    const agents = {};
    if (user.admin) for (const k of await listKeys("agents", "")) { const a = await getJ("agents", k); if (a) agents[k] = a.name || a.email; }
    const rep = (await getJ("trust", "rep")) || {}; // spam-risk scores from the Trust Hub, when monitoring is on
    const list = Object.values(all).filter((n) => !n.released && (user.admin || n.owner === user.identity || n.shared || !n.owner))
      .map((n) => ({ ...n, days: undefined, billing: n.billing && (user.admin || n.owner === user.identity) ? { price: n.billing.price, status: n.billing.status } : undefined, mine: n.owner === user.identity, ownerName: agents[n.owner] || (n.owner === user.identity ? user.name : n.owner ? "Agent" : "Team"), health: health(n, S, rep[n.e164]) }))
      .sort((a, b) => (b.mine - a.mine) || a.e164.localeCompare(b.e164));
    const t = await numberTerms(user);
    return json({ numbers: list, agents: user.admin ? agents : undefined, settings: { agentMaxNumbers: maxNumbers(S) },
      buy: { charged: t.charged, price: t.price, connected: t.connected, card: publicCard(t.card), allowed: true } });
  }

  if (action === "search") {
    const ac = (q.get("areaCode") || "").replace(/\D/g, "").slice(0, 3);
    const st = (q.get("state") || (ac && AREA[ac]) || "").toUpperCase().slice(0, 2);
    if (isTelnyx()) return json(await txSearch(ac, st, (q.get("contains") || "").replace(/[^0-9]/g, "").slice(0, 7)));
    const query = { VoiceEnabled: "true", SmsEnabled: "true", ExcludeAllAddressRequired: "true", PageSize: 30 };
    if (ac) query.AreaCode = ac; else if (st) query.InRegion = st;
    if (q.get("contains")) query.Contains = q.get("contains").replace(/[^0-9*]/g, "").slice(0, 7);
    let r = await tw("/Accounts/{SID}/AvailablePhoneNumbers/US/Local.json", { query });
    let fallback = false;
    if (!r.available_phone_numbers?.length && ac && st) { // area code sold out: offer the same state
      delete query.AreaCode; query.InRegion = st; fallback = true;
      r = await tw("/Accounts/{SID}/AvailablePhoneNumbers/US/Local.json", { query });
    }
    return json({ fallback, results: (r.available_phone_numbers || []).map((n) => ({ e164: n.phone_number, pretty: n.friendly_name, city: n.locality, state: n.region, areaCode: to10(n.phone_number).slice(0, 3), sms: n.capabilities?.SMS ?? n.capabilities?.sms })) });
  }

  if (action === "buy") {
    const b = await req.json();
    const mineCount = Object.values(all).filter((n) => n.owner === user.identity && !n.released).length;
    if (!user.admin && mineCount >= maxNumbers(S)) return bad(`You can hold up to ${maxNumbers(S)} numbers. Release one first or ask an admin.`, 403);
    if (!/^\+1\d{10}$/.test(b.phoneNumber || "")) return bad("Pick a number from the search results.");
    if (all[b.phoneNumber] && !all[b.phoneNumber].released) return bad("That number is already on your team.", 409);
    const owner = user.admin ? (b.owner ?? user.identity) : user.identity;
    const terms = await numberTerms(user);
    let sub = null, lock = false;
    if (terms.charged) {
      if (!terms.card) return bad("Add a card first. Your number is billed to it each month.", 402, { code: "card_needed", price: terms.price });
      if (!(Math.abs(+b.price - terms.price) <= 0.004)) return bad(`The price is $${terms.price.toFixed(2)} a month. Check it and confirm again.`, 409, { code: "price_changed", price: terms.price });
      // one paid purchase at a time per agent, so a double click can't charge twice
      await updateJ("numbers", "buying", (a) => { if (a[user.identity] && Date.now() - a[user.identity] < 90e3) return undefined; a[user.identity] = Date.now(); lock = true; return a; }, {});
      if (!lock) return bad("Your last purchase is still going through. Give it a few seconds.", 409);
    }
    try {
      if (terms.charged) {
        try { sub = await chargeNumber(user, b.phoneNumber, terms); }
        catch (e) { if (e.code) return bad(e.message, e.status, { code: e.code }); throw e; }
      }
      let t, twn;
      try {
        if (isTelnyx()) {
          t = await txBuy(b.phoneNumber);
          if (t.status === "failure") throw new Error("Telnyx couldn't complete the order");
        } else {
          twn = await tw("/Accounts/{SID}/IncomingPhoneNumbers.json", { method: "POST", form: { PhoneNumber: b.phoneNumber, FriendlyName: `Highpoint · ${user.name}`.slice(0, 64), ...numberHooks(siteUrl()) } });
        }
      } catch (e) {
        if (!sub) throw e;
        const r = await refundNumber(sub, e.message);
        const money = `$${r.amount.toFixed(2)}`;
        return bad(`We couldn't get ${b.phoneNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")}: ${e.message.replace(/^Telnyx: /, "")}. ${r.refunded ? `Your ${money} charge was refunded; it can take 5–10 days to show on your card.` : r.charged ? `Your ${money} charge couldn't be refunded automatically. Contact your Highpoint admin to get it back.` : "You weren't charged."} Try another number.`, 502, { code: "order_failed", refunded: r.refunded });
      }
      if (t?.sid) { const prof = await txMessagingProfile(); if (prof) await tx(`/v2/phone_numbers/${t.sid}/messaging`, { method: "PATCH", body: { messaging_profile_id: prof } }).catch(() => {}); }
      const e164n = twn ? twn.phone_number : b.phoneNumber;
      const rec = { e164: e164n, sid: twn ? twn.sid : t.sid, ...(twn ? {} : { provider: "telnyx" }), areaCode: to10(e164n).slice(0, 3), state: AREA[to10(e164n).slice(0, 3)] || "", owner: owner || "", shared: !!b.shared, boughtAt: Date.now(), boughtBy: user.identity,
        ...(twn ? { label: "", days: {} } : {}), ...(sub ? { billing: { sub: sub.id, price: terms.price, status: sub.status, user: user.id } } : {}) };
      await updateJ("numbers", "all", (a) => { a[rec.e164] = rec; return a; }, {});
      return json({ ok: true, number: { ...rec, billing: rec.billing && { price: rec.billing.price, status: rec.billing.status } }, charged: sub ? terms.price : 0 });
    } finally {
      if (lock) await updateJ("numbers", "buying", (a) => { delete a[user.identity]; return a; }, {}).catch(() => {});
    }
  }

  if (action === "update") {
    const b = await req.json(); const n = all[b.e164];
    if (!n) return bad("Number not found", 404);
    if (!canEdit(n) && !b.spamReport) return bad("That number belongs to someone else.", 403);
    const next = await updateJ("numbers", "all", (a) => {
      const z = a[b.e164];
      if (user.admin && "owner" in b) z.owner = b.owner || "";
      if (user.admin && "shared" in b) z.shared = !!b.shared;
      if ("label" in b) z.label = String(b.label).slice(0, 40);
      if ("paused" in b) z.paused = !!b.paused;
      if (b.spamReport) { z.spamReports = [...(z.spamReports || []), { at: Date.now(), by: user.identity, carrier: String(b.carrier || "").slice(0, 30) }]; z.paused = true; }
      if (b.clearReports && user.admin) { z.spamReports = []; z.paused = false; }
      return a;
    });
    return json({ ok: true, number: next[b.e164] });
  }

  if (action === "release") {
    const b = await req.json(); const n = all[b.e164];
    if (!n) return bad("Number not found", 404);
    if (!canEdit(n)) return bad("Only the owner or an admin can release this number.", 403);
    if (n.provider === "telnyx" || isTelnyx()) await txRelease(n.sid).catch((e) => { if (!/not found|404|10005/i.test(e.message)) throw e; });
    else await tw(`/Accounts/{SID}/IncomingPhoneNumbers/${n.sid}.json`, { method: "DELETE" }).catch((e) => { if (!/20404|not found/i.test(e.message)) throw e; });
    await updateJ("numbers", "all", (a) => { a[b.e164].released = Date.now(); return a; });
    let billingStopped = !n.billing?.sub;
    if (n.billing?.sub) {
      try { await stopNumber(n); billingStopped = true; await updateJ("numbers", "all", (a) => { a[b.e164].billing.status = "canceled"; return a; }); }
      catch (e) { console.error("number billing didn't stop", b.e164, n.billing.sub, e.message); }
    }
    return json({ ok: true, billingStopped });
  }

  if (action === "import") {
    if (!user.admin) return bad("Admins only", 403);
    if (isTelnyx()) return json({ ok: true, ...(await txImport()) });
    const r = await tw("/Accounts/{SID}/IncomingPhoneNumbers.json", { query: { PageSize: 200 } });
    let added = 0;
    for (const n of r.incoming_phone_numbers || []) {
      await tw(`/Accounts/{SID}/IncomingPhoneNumbers/${n.sid}.json`, { method: "POST", form: numberHooks(siteUrl()) }).catch(() => {});
      await updateJ("numbers", "all", (a) => {
        if (!a[n.phone_number] || a[n.phone_number].released) { a[n.phone_number] = { e164: n.phone_number, sid: n.sid, areaCode: to10(n.phone_number).slice(0, 3), state: AREA[to10(n.phone_number).slice(0, 3)] || "", owner: "", shared: true, boughtAt: Date.parse(n.date_created) || Date.now(), label: n.friendly_name || "", days: {} }; added++; }
        return a;
      }, {});
    }
    return json({ ok: true, added });
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/numbers", "/api/dialer/numbers/*"] };
