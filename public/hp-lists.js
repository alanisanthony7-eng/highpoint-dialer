/* Highpoint lists: the counting behind "Add to list" and "Add to dialer" in the Clients bulk bar
   (public/desk-app.js) and the dialer's campaigns (public/hp-dialer.js).
   "My lists" are hand-picked ({kind:"picked", ids}); "Imports" are the smart list made for each CSV ({kind:"smart", filter}).
   Tested in test/lists.mjs. */
(() => {
  "use strict";
  const G = globalThis;
  if (G.hpLists) return;
  const d10 = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
  const CLOSED = ["sold", "lost"];
  const SCRUB_DAYS = 30;
  const isPicked = (list) => list?.kind === "picked";
  const sets = new WeakMap();
  // the ids on a hand-picked list as a Set (cached per ids array, so filtering a big book stays fast)
  function members(list) {
    const ids = Array.isArray(list?.ids) ? list.ids : null;
    if (!ids) return new Set();
    let s = sets.get(ids);
    if (!s) { s = new Set(ids); sets.set(ids, s); }
    return s;
  }
  // why the dialer won't take this lead ("" = it can be dialed)
  function dialSkip(l, now = Date.now()) {
    if (!l) return "missing";
    if (l.dnc) return "dnc";
    if (l.scrub?.blocked && now - (l.scrub.at || 0) < SCRUB_DAYS * 864e5) return "scrub";
    if (d10(l.phone).length !== 10) return "noPhone";
    if (CLOSED.includes(l.stage)) return "closed";
    return "";
  }
  // which of `ids` to add to a set that already holds `have`, with a count for every lead left out
  function tally(ids, { have = [], leads = null, cap = Infinity, skip = null, now = Date.now() } = {}) {
    const on = have instanceof Set ? have : new Set(have), seen = new Set();
    const r = { add: [], added: 0, already: 0, dnc: 0, scrub: 0, noPhone: 0, closed: 0, missing: 0, overCap: 0 };
    let size = on.size;
    for (const id of ids || []) {
      if (typeof id !== "string" || !id || seen.has(id)) continue;
      seen.add(id);
      if (on.has(id)) { r.already++; continue; }
      const l = leads ? (leads.get ? leads.get(id) : leads[id]) : null;
      if (leads && !l) { r.missing++; continue; }
      const why = skip ? skip(l, now) : "";
      if (why) { r[why] = (r[why] || 0) + 1; continue; }
      if (size >= cap) { r.overCap++; continue; }
      r.add.push(id); size++;
    }
    r.added = r.add.length;
    return r;
  }
  const n = (x) => Number(x || 0).toLocaleString("en-US");
  // the one-line result an agent sees: Added 37 to “Oct 20” · 3 already there · 1 Do Not Call
  function summary(r, name, { cap = 0, what = "list" } = {}) {
    const parts = [`Added ${n(r.added)} to “${name}”`];
    if (r.already) parts.push(`${n(r.already)} already there`);
    if (r.dnc) parts.push(`${n(r.dnc)} Do Not Call`);
    if (r.scrub) parts.push(`${n(r.scrub)} failed the DNC check`);
    if (r.noPhone) parts.push(`${n(r.noPhone)} no phone number`);
    if (r.closed) parts.push(`${n(r.closed)} sold or not interested`);
    if (r.overCap) parts.push(`${n(r.overCap)} not added (${cap ? n(cap) + " max" : "full"} per ${what})`);
    return parts.join(" · ");
  }
  // how many of the saved ids are still in the book
  function liveCount(ids, leads) { let c = 0; for (const id of ids || []) if (leads.has(id)) c++; return c; }
  G.hpLists = { isPicked, members, dialSkip, tally, summary, liveCount, CLOSED };
})();
