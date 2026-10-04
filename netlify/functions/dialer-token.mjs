// GET /api/dialer/token -> short-lived access token for the in-browser phone
import { wrap, json, bad, requireUser, config as loadConfig, voiceToken } from "../lib/hp.mjs";

export default wrap(async (req) => {
  const user = await requireUser(req);
  const cfg = await loadConfig();
  if (!cfg.keySid || !cfg.appSid) return bad("The dialer isn't set up yet. An admin needs to press “Connect Twilio” once.", 409);
  const ttl = 3600;
  return json({ token: voiceToken({ identity: user.identity, keySid: cfg.keySid, keySecret: cfg.keySecret, appSid: cfg.appSid, ttl }), identity: user.identity, expires: Date.now() + ttl * 1000 });
});

export const config = { path: "/api/dialer/token" };
