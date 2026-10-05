// Voicemail greetings + voicemail drop
//  GET    /api/dialer/vm                 my greetings
//  POST   /api/dialer/vm/upload?name=    body: audio/wav (recorded in the browser)
//  DELETE /api/dialer/vm?id=
//  POST   /api/dialer/vm/drop            {greeting, sid?, session?, now?}
//  GET    /api/dialer/vm/audio?k=&exp=&sig=   (signed, for Twilio <Play>)
import { wrap, json, bad, requireUser, store, getJ, setJ, listKeys, checkSigned, patchCallBySid } from "../lib/hp.mjs";
import { dropVoicemail, childOf, sess, updSess } from "../lib/calls.mjs";
import { randomUUID } from "node:crypto";

export default wrap(async (req, ctx) => {
  const u = new URL(req.url); const action = u.pathname.split("/").pop();

  if (action === "audio") {
    if (!checkSigned(req)) return new Response("Expired link", { status: 403 });
    const k = u.searchParams.get("k");
    const data = await store("vm").get(k, { type: "arrayBuffer" });
    if (!data) return new Response("Not found", { status: 404 });
    return new Response(data, { headers: { "content-type": "audio/wav", "cache-control": "private, max-age=3600" } });
  }

  const user = await requireUser(req);

  if (req.method === "GET" && action === "vm") {
    const keys = await listKeys("vmmeta", user.identity + "/");
    const list = (await Promise.all(keys.map((k) => getJ("vmmeta", k)))).filter(Boolean).sort((a, b) => b.at - a.at);
    return json({ greetings: list });
  }

  if (action === "upload") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength < 2000) return bad("That recording is empty.");
    if (buf.byteLength > 4_000_000) return bad("Keep greetings under about 60 seconds.");
    const head = new TextDecoder().decode(new Uint8Array(buf.slice(0, 12)));
    if (!head.startsWith("RIFF") || !head.includes("WAVE")) return bad("Upload a WAV file (the recorder does this for you).");
    const id = randomUUID().slice(0, 12); const key = `${user.identity}/${id}`;
    const sec = +(u.searchParams.get("sec") || 0);
    await store("vm").set(key, buf);
    const meta = { key, id, name: (u.searchParams.get("name") || "Voicemail").slice(0, 40), sec, at: Date.now() };
    await setJ("vmmeta", key, meta);
    return json({ ok: true, greeting: meta });
  }

  if (req.method === "DELETE") {
    const key = `${user.identity}/${u.searchParams.get("id")}`;
    await store("vm").delete(key); await store("vmmeta").delete(key);
    return json({ ok: true });
  }

  if (action === "listen") { // agent previews their own greeting
    const key = `${user.identity}/${u.searchParams.get("id")}`;
    const data = await store("vm").get(key, { type: "arrayBuffer" });
    return data ? new Response(data, { headers: { "content-type": "audio/wav" } }) : bad("Not found", 404);
  }

  if (action === "drop") {
    const b = await req.json();
    const gkey = b.greeting?.includes("/") ? b.greeting : `${user.identity}/${b.greeting}`;
    if (!gkey.startsWith(user.identity + "/")) return bad("Use one of your own greetings.", 403);
    if (!(await getJ("vmmeta", gkey))) return bad("Record a voicemail greeting first.");

    if (b.session) { // multi-line
      const v = await sess(user.identity, b.session);
      if (!v?.connected) return bad("No call is connected.");
      const line = v.calls[v.connected] || {};
      const atBeep = /machine_end/.test(line.answeredBy || "");
      if (atBeep || b.now) {
        await dropVoicemail(v.connected, gkey);
        const sid = v.connected;
        await updSess(user.identity, b.session, (v) => { if (v.calls[sid]) { v.calls[sid].vmDropped = gkey; v.calls[sid].result = "Left voicemail"; } v.connected = null; v.freedAt = Date.now(); return v; });
        await patchCallBySid(sid, (c) => { c.vmDropped = gkey; c.disposition = "Left voicemail"; return c; });
        return json({ ok: true, dropped: true });
      }
      await updSess(user.identity, b.session, (v) => { if (v.calls[v.connected]) v.calls[v.connected].vmPending = gkey; return v; });
      return json({ ok: true, pending: true });
    }

    if (!b.sid) return bad("No call to drop into.");
    const rec = await patchCallBySid(b.sid, (c) => c);
    if (!rec || rec.agent !== user.identity) return bad("Call not found", 404);
    const child = rec.childSid || (await childOf(b.sid));
    if (!child) return bad("The other side isn't connected yet.");
    if (/machine_end/.test(rec.answeredBy || "") || b.now) {
      await dropVoicemail(child, gkey);
      await patchCallBySid(b.sid, (c) => { c.vmDropped = gkey; c.disposition = "Left voicemail"; return c; });
      return json({ ok: true, dropped: true });
    }
    await patchCallBySid(b.sid, (c) => { c.vmPending = gkey; return c; });
    return json({ ok: true, pending: true });
  }
  return bad("Unknown action", 404);
});

export const config = { path: ["/api/dialer/vm", "/api/dialer/vm/*"] };
