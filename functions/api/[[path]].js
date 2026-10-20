// One entry point for every /api/* request on Cloudflare Pages.
import { authRoute, currentUser } from "../../src/lib/auth.mjs";
import { billingRoute, teamRoute } from "../../src/lib/team.mjs";
import { docsRoute, docsBatch, docsSync, usersRoute, roomRoute, aiRoute } from "../../src/desk.mjs";
import setup from "../../src/dialer/dialer-setup.mjs";
import token from "../../src/dialer/dialer-token.mjs";
import voice from "../../src/dialer/dialer-voice.mjs";
import events from "../../src/dialer/dialer-events.mjs";
import power from "../../src/dialer/dialer-power.mjs";
import numbers from "../../src/dialer/dialer-numbers.mjs";
import vm from "../../src/dialer/dialer-vm.mjs";
import calls from "../../src/dialer/dialer-calls.mjs";
import sms from "../../src/dialer/dialer-sms.mjs";
import { telnyxRoute } from "../../src/telnyx/tx.mjs";
import { spotifyRoute } from "../../src/lib/spotify.mjs";
import { followupsRoute, poke } from "../../src/lib/followups.mjs";
import { leadsRoute } from "../../src/lib/leadpost.mjs";
import { bookingRoute, calRoute } from "../../src/lib/booking.mjs";
import { quoteRoute } from "../../src/lib/quoteshare.mjs";

const DIALER = { setup, token, voice, events, power, numbers, vm, calls, sms };
const json = (b, s) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function health(env) {
  let db = "missing";
  if (env?.DB) {
    try { await env.DB.prepare("SELECT 1 AS ok").first(); db = "ok"; }
    catch { db = "error"; }
  }
  return json({
    ok: db === "ok",
    db,
    twilio: !!(env?.TWILIO_ACCOUNT_SID && env?.TWILIO_AUTH_TOKEN),
    telnyx: !!env?.TELNYX_API_KEY,
    stripe: !!env?.STRIPE_SECRET_KEY,
    spotify: !!(env?.SPOTIFY_CLIENT_ID && env?.SPOTIFY_CLIENT_SECRET),
    email: !!(env?.RESEND_API_KEY && env?.HP_EMAIL_FROM),
    anthropic: !!env?.ANTHROPIC_API_KEY,
    cron: !!env?.HP_CRON_SECRET,
  }, db === "ok" ? 200 : 503);
}

export async function onRequest(ctx) {
  const req = ctx.request;
  globalThis.__ENV = ctx.env;
  globalThis.__ORIGIN = new URL(req.url).origin;
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const c = { waitUntil: (p) => ctx.waitUntil(p) };
  // background jobs (automatic texts) run while the desk is in use, at most once a minute
  if (parts[0] !== "cron" && ctx.env?.DB) { try { ctx.waitUntil(poke().catch((e) => console.error("jobs", e))); } catch {} }
  try {
    switch (parts[0]) {
      case "auth": return await authRoute(req, parts[1]);
      case "billing": return await billingRoute(req, parts[1], parts[1] === "webhook" ? null : await currentUser(req));
      case "team": { const r = await teamRoute(req, parts[1], await currentUser(req)); if (req.method === "POST") (await import("../../src/lib/auth.mjs")).clearUserCache(); return r; }
      case "docs": return parts[1] === "_sync" ? await docsSync(req) : parts[1] === "_batch" ? await docsBatch(req) : await docsRoute(req, parts.slice(1).map(decodeURIComponent));
      case "users": return await usersRoute(req);
      case "room": return await roomRoute(req, parts[1]);
      case "ai": return await aiRoute(req);
      case "dialer": { const h = DIALER[parts[1]]; if (h) return await h(req, c); break; }
      case "telnyx": return await telnyxRoute(req, parts[1]);
      case "spotify": return await spotifyRoute(req, parts[1]);
      case "followups": return await followupsRoute(req, parts[1]);
      case "cron": return await followupsRoute(req, "cron");
      case "leads": return await leadsRoute(req, parts.slice(1), c);
      case "book": return await bookingRoute(req, parts.slice(1));
      case "quote": return await quoteRoute(req, parts.slice(1));
      case "cal": return await calRoute(req, parts[1]);
      case "config": return json({ snapClientId: ctx.env.HP_SNAP_CLIENT_ID || "" }, 200);
      case "health": return await health(ctx.env);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error("api", req.method, "/" + parts.join("/"), e.status || 500, e.message || e);
    return new Response(JSON.stringify({ error: e.message || "Server error", ...(e.code ? { code: e.code } : {}), ...(e.feature ? { feature: e.feature } : {}) }), { status: e.status || 500, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
}
