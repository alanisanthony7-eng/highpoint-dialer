// "Add to list" and "Add to dialer" counting (public/hp-lists.js): who gets added, who's skipped and why.
await import("../public/hp-lists.js");
const L = globalThis.hpLists;

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const NOW = Date.UTC(2026, 9, 20, 18);
const leads = new Map(Object.entries({
  a: { id: "a", phone: "(305) 555-0101", stage: "new" },
  b: { id: "b", phone: "13055550102", stage: "contacted" },
  c: { id: "c", phone: "3055550103", dnc: true },
  d: { id: "d", phone: "3055550104", scrub: { blocked: true, at: NOW - 2 * 864e5 } },
  e: { id: "e", phone: "3055550105", scrub: { blocked: true, at: NOW - 45 * 864e5 } },
  f: { id: "f", phone: "555-0106" },
  g: { id: "g", phone: "3055550107", stage: "sold" },
  h: { id: "h", phone: "3055550108", stage: "lost" },
  i: { id: "i", phone: "3055550109", stage: "appointment" },
}));

// why the dialer leaves a lead out
ok(L.dialSkip(leads.get("a"), NOW) === "" && L.dialSkip(leads.get("b"), NOW) === "", "dialSkip: a 10-digit number (or 1 + 10) can be dialed");
ok(L.dialSkip(leads.get("c"), NOW) === "dnc", "dialSkip: Do Not Call");
ok(L.dialSkip(leads.get("d"), NOW) === "scrub", "dialSkip: a DNC or litigator hit in the last 30 days");
ok(L.dialSkip(leads.get("e"), NOW) === "", "dialSkip: an old scrub hit (over 30 days) is checked again, not skipped");
ok(L.dialSkip(leads.get("f"), NOW) === "noPhone", "dialSkip: no full phone number");
ok(L.dialSkip(leads.get("g"), NOW) === "closed" && L.dialSkip(leads.get("h"), NOW) === "closed", "dialSkip: sold and not interested");
ok(L.dialSkip(undefined, NOW) === "missing", "dialSkip: a lead that's gone");

// Add to dialer: skips with reasons, duplicates, the cap
const all = [...leads.keys()];
let r = L.tally([...all, "a", "zz"], { have: ["b"], leads, skip: L.dialSkip, now: NOW });
ok(r.add.join() === "a,e,i" && r.added === 3, "tally (dialer): only dialable new leads are added");
ok(r.already === 1 && r.dnc === 1 && r.scrub === 1 && r.noPhone === 1 && r.closed === 2 && r.missing === 1, "tally (dialer): every skip has a reason");
r = L.tally(["a", "e", "i"], { have: ["b", "x"], leads, skip: L.dialSkip, cap: 4, now: NOW });
ok(r.added === 2 && r.overCap === 1, "tally (dialer): past the campaign cap the rest are counted, not added");
ok(L.summary({ added: 37, already: 3, dnc: 1, scrub: 0, noPhone: 2, closed: 0, overCap: 0 }, "Oct 20 · FB") === "Added 37 to “Oct 20 · FB” · 3 already there · 1 Do Not Call · 2 no phone number", "summary: zero counts are left out");
ok(L.summary({ added: 4880, already: 0, overCap: 120 }, "Big", { cap: 5000, what: "campaign" }) === "Added 4,880 to “Big” · 120 not added (5,000 max per campaign)", "summary: over the cap");

// Add to list: no DNC skipping, only duplicates
r = L.tally(["a", "c", "g", "c", "b"], { have: new Set(["b"]), leads });
ok(r.add.join() === "a,c,g" && r.already === 1 && r.dnc === 0, "tally (list): Do Not Call and sold leads can be put on a list; duplicates can't");

// hand-picked list membership
const list = { kind: "picked", ids: ["a", "c", "gone"] };
ok(L.isPicked(list) && !L.isPicked({ kind: "smart", filter: { batchId: "b1" } }) && !L.isPicked(null), "isPicked: only hand-picked lists");
ok(L.members(list).has("c") && L.members(list) === L.members(list) && L.members({ kind: "smart" }).size === 0, "members: a cached Set of the ids");
ok(L.liveCount(list.ids, leads) === 2, "liveCount: deleted leads don't count");
