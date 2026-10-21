// The quoter's carrier prices come from real Insurance Toolkits quotes (public/hp-grid.js, built by scripts/build_grid.py).
// Checks: every quote in the grid is reproduced to the cent, in-between faces are estimated within pennies, and holes stay holes.
import { readFileSync } from "node:fs";
globalThis.window = {};
new Function(readFileSync("public/hp-grid.js", "utf8"))();
const G = window.HP_GRID;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const MAP = {
  "CVS (Aetna Accendo)|Accendo Preferred": "accendo.pref", "CVS (Aetna Accendo)|Accendo Standard": "accendo.std", "Aetna (Protection Series)|Protection Series Preferred": "aetna.pref",
  "American Home Life (Patriot Series)|Patriot Series Preferred": "ahl.pref", "American Home Life (Patriot Series)|Patriot Series Standard": "ahl.std",
  "American Home Life (GuideStar 45+)|GuideStar Level": "ahl.gs", "American Home Life (GuideStar 0-44)|GuideStar Level": "ahl.gs",
  "Foresters (PlanRight)|PlanRight Preferred": "for.pref", "Foresters (PlanRight)|PlanRight Standard": "for.std", "AIG (SIWL)|SimpliNow Legacy Max": "aig.siwl", "AIG (GIWL)|Guaranteed Issue": "aig.gi", "Fidelity (RAPIDecision Final Expense)|Level": "fid.level",
  "TruStage (Whole Life - Final Expense - Level)|Whole Life / Final Expense - Level": "tru.level", "TruStage (Whole Life - Final Expense - Guaranteed)|Whole Life / Final Expense - Guaranteed": "tru.gi",
};
const looksId = (s) => /^[A-Za-z0-9]{20,}$/.test(s || "");
const rows = readFileSync("data/toolkits-grid.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
let n = 0, exact = 0, worst = 0; const series = new Map();
for (const r of rows) {
  for (const [c, p, m] of r.q) {
    if (looksId(c) || looksId(p) || m == null) continue;
    const id = MAP[c + "|" + p]; if (!id || r.face > 30000) continue;
    const o = { age: r.age, sex: r.sex === "Male" ? "M" : "F", tob: r.tobacco !== "None", face: r.face };
    const v = G.price(id, o); n++;
    if (v != null && Math.abs(v - m) < 0.006) exact++; else worst = Math.max(worst, v == null ? 999 : Math.abs(v - m));
    const k = id + "|" + o.age + o.sex + o.tob; if (!series.has(k)) series.set(k, { id, o, pts: {} }); series.get(k).pts[r.face] = m;
  }
}
ok(n > 9000 && exact === n, `all ${n.toLocaleString()} real quotes come back to the cent (${exact.toLocaleString()} exact${exact < n ? ", worst off by $" + worst.toFixed(2) : ""})`);
// hold one face out and estimate it from its neighbours: premium is linear between quoted faces
let hn = 0, hsum = 0, hmax = 0;
for (const s of series.values()) for (const f of [10000, 15000, 20000]) {
  if (s.pts[f] == null || s.pts[f - 5000] == null || s.pts[f + 5000] == null) continue;
  const est = (s.pts[f - 5000] + s.pts[f + 5000]) / 2, e = Math.abs(est - s.pts[f]); hn++; hsum += e; hmax = Math.max(hmax, e);
}
ok(hn > 2000 && hsum / hn < 0.5, `a face between two quoted faces is estimated within $${(hsum / hn).toFixed(2)} on average (${hn.toLocaleString()} checks, worst $${hmax.toFixed(2)}; two plans change rate at $20-25k)`);
ok(G.price("ahl.pref", { age: 65, sex: "M", tob: false, face: 12500 }) > G.price("ahl.pref", { age: 65, sex: "M", tob: false, face: 10000 }) && G.price("ahl.pref", { age: 65, sex: "M", tob: false, face: 12500 }) < G.price("ahl.pref", { age: 65, sex: "M", tob: false, face: 15000 }), "a $12,500 price lands between the $10,000 and $15,000 prices");
ok(G.price("aig.siwl", { age: 45, sex: "M", tob: false, face: 10000 }) === null && G.price("aig.siwl", { age: 85, sex: "F", tob: false, face: 10000 }) === null, "ages a plan isn't sold at have no price");
ok(G.price("for.std", { age: 83, sex: "M", tob: false, face: 15000 }) === null && G.maxFace("for.std", { age: 83, sex: "M", tob: false }) === 10000, "a face above what the plan sells at that age has no price (Foresters Standard tops out at $10,000 at 83)");
ok(G.price("nope", { age: 65, sex: "M", tob: false, face: 10000 }) === null, "an unknown plan has no price");
