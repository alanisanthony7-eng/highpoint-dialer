// GET  /api/dialer/setup     -> connection status for the signed-in agent
// POST /api/dialer/setup     -> (admin) one-click: create API key + TwiML app, point numbers at this site
// PUT  /api/dialer/setup     -> (admin) save dialer settings
import { wrap, json, bad, requireUser, config as loadConfig, setJ, getJ, tw, siteUrl, SID, TOKEN, DEFAULT_SETTINGS, updateJ, numberHooks } from "../lib/hp.mjs";

export default wrap(async (req) => {
  const user = await requireUser(req);
  const cfg = await loadConfig();

  if (req.method === "GET") {
    const nums = Object.values((await getJ("numbers", "all")) || {}).filter((n) => !n.released);
    const prefs = (await getJ("prefs", user.identity)) || {};
    return json({
      twilio: !!(SID() && TOKEN()),
      ready: !!(SID() && TOKEN() && cfg.appSid && cfg.keySid),
      site: siteUrl(),
      me: { identity: user.identity, email: user.email, name: user.name, admin: user.admin },
      settings: cfg.settings,
      prefs,
      numbers: { mine: nums.filter((n) => n.owner === user.identity).length, team: nums.length },
      trust: cfg.trust || {},
    });
  }

  if (req.method === "PATCH") { // agent's own preferences
    const body = await req.json();
    const allowed = ["lines", "autoVm", "vmGreeting", "defaultCallerId", "ringMode", "localPresence"];
    const next = await updateJ("prefs", user.identity, (p) => { for (const k of allowed) if (k in body) p[k] = body[k]; return p; }, {});
    return json({ prefs: next });
  }

  if (!user.admin) return bad("Only an admin can change dialer setup.", 403);

  if (req.method === "PUT") {
    const body = await req.json();
    const s = { ...cfg.settings };
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in (body.settings || {})) s[k] = body.settings[k];
    s.maxLines = Math.max(1, Math.min(3, +s.maxLines || 1));
    s.dailyCapPerNumber = Math.max(10, Math.min(300, +s.dailyCapPerNumber || 75));
    const next = { ...cfg, settings: s };
    if (body.trust) next.trust = { ...(cfg.trust || {}), ...body.trust };
    await setJ("config", "app", next);
    return json({ ok: true, settings: s });
  }

  if (req.method === "POST") {
    if (!SID() || !TOKEN()) return bad("Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Netlify → Site configuration → Environment variables, then redeploy.", 400);
    if (!/^https:\/\//.test(siteUrl())) return bad("Site URL is missing. Set HP_PUBLIC_URL to your https site address.");
    const base = siteUrl();
    const next = { ...cfg };
    // verify credentials
    const acct = await tw("/Accounts/{SID}.json");
    if (!next.keySid) {
      const k = await tw("/Accounts/{SID}/Keys.json", { method: "POST", form: { FriendlyName: "Highpoint Dialer" } });
      next.keySid = k.sid; next.keySecret = k.secret;
    }
    const appForm = {
      FriendlyName: "Highpoint Dialer",
      VoiceUrl: base + "/api/dialer/voice", VoiceMethod: "POST",
      StatusCallback: base + "/api/dialer/events?type=parent", StatusCallbackMethod: "POST",
    };
    if (next.appSid) await tw(`/Accounts/{SID}/Applications/${next.appSid}.json`, { method: "POST", form: appForm }).catch(async () => { next.appSid = ""; });
    if (!next.appSid) { const a = await tw("/Accounts/{SID}/Applications.json", { method: "POST", form: appForm }); next.appSid = a.sid; }
    next.account = { name: acct.friendly_name, type: acct.type, status: acct.status };
    next.setupAt = Date.now();
    await setJ("config", "app", next);

    // point every number we manage at this site
    const all = (await getJ("numbers", "all")) || {};
    for (const n of Object.values(all)) if (!n.released && n.sid) {
      await tw(`/Accounts/{SID}/IncomingPhoneNumbers/${n.sid}.json`, { method: "POST", form: numberHooks(base) }).catch(() => {});
    }
    return json({ ok: true, account: next.account, trial: acct.type === "Trial" });
  }
  return bad("Method not allowed", 405);
});

export const config = { path: "/api/dialer/setup" };
