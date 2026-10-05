// One entry point for every /api/* request on Cloudflare Pages.
import { authRoute } from "../../src/lib/auth.mjs";
import { docsRoute, docsBatch, usersRoute, roomRoute, aiRoute } from "../../src/desk.mjs";
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

const DIALER = { setup, token, voice, events, power, numbers, vm, calls, sms };
const json = (b, s) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequest(ctx) {
  const req = ctx.request;
  globalThis.__ENV = ctx.env;
  globalThis.__ORIGIN = new URL(req.url).origin;
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const c = { waitUntil: (p) => ctx.waitUntil(p) };
  try {
    switch (parts[0]) {
      case "auth": return await authRoute(req, parts[1]);
      case "docs": return parts[1] === "_batch" ? await docsBatch(req) : await docsRoute(req, parts.slice(1).map(decodeURIComponent));
      case "users": return await usersRoute(req);
      case "room": return await roomRoute(req, parts[1]);
      case "ai": return await aiRoute(req);
      case "dialer": { const h = DIALER[parts[1]]; if (h) return await h(req, c); break; }
      case "telnyx": return await telnyxRoute(req, parts[1]);
      case "config": return json({ snapClientId: ctx.env.HP_SNAP_CLIENT_ID || "" }, 200);
      case "health": return json({ ok: true, db: !!ctx.env.DB, twilio: !!(ctx.env.TWILIO_ACCOUNT_SID && ctx.env.TWILIO_AUTH_TOKEN), telnyx: !!ctx.env.TELNYX_API_KEY }, 200);
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    return json({ error: e.message || "Server error" }, e.status || 500);
  }
}
