// Caller-ID numbers: search, buy, assign, pause, release, health
//  GET  /api/dialer/numbers                 list (mine + team; admins see all)
//  GET  /api/dialer/numbers/search?areaCode=&state=&contains=&near=
//  POST /api/dialer/numbers/buy      {phoneNumber, owner?, shared?}
//  POST /api/dialer/numbers/update   {e164, owner?, shared?, label?, paused?, spamReport?}
//  POST /api/dialer/numbers/release  {e164}
//  POST /api/dialer/numbers/import   (admin) adopt numbers already in the Twilio account
import { isTelnyx, txSearch, txBuy } from "../telnyx/tx.mjs";
import { wrap, json, bad, requireUser, config as loadConfig, getJ, updateJ, tw, siteUrl, numberHooks, numberCap, today, AREA, to10, listKeys } from "../lib/hp.mjs";

function health(n, settings) {
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
  if (dials >= 60 && rate < 0.06) { status = status === "flagged" ? status : "watch"; why.push(`only ${(rate * 100).toFixed(1)}% of calls answered this week`); }
  if (answered >= 20 && shortRate > 0.45) { status = status === "flagged" ? status : "watch"; why.push(`${Math.round(shortRate * 100)}% of answers hang up within 10s`); }
  const age = (Date.now() - (n.boughtAt || 0)) / 864e5;
  if (age < settings.rampDays) why.push(`warming up (day ${Math.floor(age) + 1} of ${settings.rampDays})`);
  const td = n.days?.[today()] || {};
  return { status, why, week: { dials, answered, short, answerRate: rate }, todayDials: td.dials || 0, cap: numberCap(n, settings) };
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
    const list = Object.values(all).filter((n) => !n.released && (user.admin || n.owner === user.identity || n.shared || !n.owner))
      .map((n) => ({ ...n, days: undefined, mine: n.owner === user.identity, ownerName: agents[n.owner] || (n.owner === user.identity ? user.name : n.owner ? "Agent" : "Team"), health: health(n, S) }))
      .sort((a, b) => (b.mine - a.mine) || a.e164.localeCompare(b.e164));
    return json({ numbers: list, agents: user.admin ? agents : undefined, settings: { agentMaxNumbers: S.agentMaxNumbers, dailyCapPerNumber: S.dailyCapPerNumber } });
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
    if (!user.admin) {
      if (!S.agentMaxNumbers) return bad("Ask an admin to buy numbers for you.", 403);
      if (mineCount >= S.agentMaxNumbers) return bad(`You can hold up to ${S.agentMaxNumbers} numbers. Release one first or ask an admin.`, 403);
    }
    if (!/^\+1\d{10}$/.test(b.phoneNumber || "")) return bad("Pick a number from the search results.");
    const owner = user.admin ? (b.owner ?? user.identity) : user.identity;
    if (isTelnyx()) {
      const t = await txBuy(b.phoneNumber);
      const rec = { e164: b.phoneNumber, sid: t.sid, provider: "telnyx", areaCode: to10(b.phoneNumber).slice(0, 3), state: AREA[to10(b.phoneNumber).slice(0, 3)] || "", owner: owner || "", shared: !!b.shared, boughtAt: Date.now(), boughtBy: user.identity };
      await updateJ("numbers", "all", (a) => { a[rec.e164] = rec; return a; }, {});
      return json({ ok: true, number: rec });
    }
    const n = await tw("/Accounts/{SID}/IncomingPhoneNumbers.json", { method: "POST", form: { PhoneNumber: b.phoneNumber, FriendlyName: `Highpoint · ${user.name}`.slice(0, 64), ...numberHooks(siteUrl()) } });
    const rec = { e164: n.phone_number, sid: n.sid, areaCode: to10(n.phone_number).slice(0, 3), state: AREA[to10(n.phone_number).slice(0, 3)] || "", owner: owner || "", shared: !!b.shared, boughtAt: Date.now(), boughtBy: user.identity, label: "", days: {} };
    await updateJ("numbers", "all", (a) => { a[rec.e164] = rec; return a; }, {});
    return json({ ok: true, number: rec });
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
    await tw(`/Accounts/{SID}/IncomingPhoneNumbers/${n.sid}.json`, { method: "DELETE" }).catch((e) => { if (!/20404|not found/i.test(e.message)) throw e; });
    await updateJ("numbers", "all", (a) => { a[b.e164].released = Date.now(); return a; });
    return json({ ok: true });
  }

  if (action === "import") {
    if (!user.admin) return bad("Admins only", 403);
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
