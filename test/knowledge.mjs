// Knowledge pack: the bot pulls the matching chapter, and training mode adds the coach.
import { pickKnowledge, CORE, CHUNKS } from "../src/lib/hp-knowledge.mjs";

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

ok(/Heart attack/.test(CORE) && /Highpoint Bot/.test(CORE), "core still has Highpoint UW and the bot name");
ok(CHUNKS.some((c) => c.id === "fe-carriers") && CHUNKS.some((c) => c.id === "objections"), "carrier and sales chapters are in the pack");

const hi = pickKnowledge("hi");
ok(/Highpoint Bot/.test(hi) && /Heart attack/.test(hi) && /packet/.test(hi), "a short hello still gets the core plus the call playbook");

const ta = pickKnowledge("What is Transamerica FE Express max face at age 80?");
ok(/FE Express/.test(ta) && /25,000/.test(ta), "a carrier question pulls the public FE Express chapter");

const iul = pickKnowledge("How do I explain an IUL illustration and the cap?");
ok(/illustration/.test(iul) && /not guarantees/.test(iul) && /cap/.test(iul), "an IUL question pulls illustration and cap rules");

const obj = pickKnowledge("They said they need to think about it");
ok(/Think about it/.test(obj) && /isolate/.test(obj.toLowerCase()), "an objection question pulls isolate-then-handle");

const train = pickKnowledge("I already have coverage", { mode: "train" });
ok(/training coach/.test(train) && /debrief/.test(train) && /already have/.test(train.toLowerCase()), "training mode adds the coach and the matching objection");

console.log("done");
