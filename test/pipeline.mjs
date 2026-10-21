import { detectPipeline, prodFrom, uniqueName, normPipeline } from "../src/lib/pipeline.mjs";

const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };

ok(prodFrom("Final Expense - aged") === "FE", "prodFrom recognizes final expense");
ok(prodFrom("MP / PITI leads") === "MP", "prodFrom recognizes mortgage protection");
ok(prodFrom("Indexed Universal Life") === "IUL", "prodFrom recognizes IUL");
ok(prodFrom("first name") === "", "prodFrom ignores ordinary headers");
ok(normPipeline("iul") === "IUL" && !normPipeline("term"), "normPipeline allows only FE/MP/IUL");

const iul = detectPipeline({
  filename: "iul-aged-oct.csv",
  headers: ["First Name", "Last Name", "Phone", "Cash Value", "IUL Type"],
  rows: [["Ann", "Lee", "3055550100", "yes", "Indexed universal"]],
});
ok(iul.pipeline === "IUL" && iul.confidence >= 0.65, "detects IUL from filename, headers, and values");

const mp = detectPipeline({
  headers: ["Name", "Phone", "Mortgage Balance", "PITI", "Lender"],
  map: ["full", "phone", "mortgageBalance", "", "lender"],
  rows: [["Sam Ortiz", "7865550199", "184000", "1420", "Rocket"]],
});
ok(mp.pipeline === "MP", "detects mortgage protection from loan columns");

const fe = detectPipeline({
  headers: ["First", "Last", "Cell", "Face Amount", "Burial Type"],
  rows: [["Ruth", "Cole", "9545550111", "15000", "Funeral / burial"]],
});
ok(fe.pipeline === "FE", "detects final expense from face amount and burial");

const blank = detectPipeline({
  headers: ["First Name", "Last Name", "Phone", "Email", "State"],
  rows: [["Pat", "Ng", "4075550102", "pat@example.com", "FL"]],
});
ok(!blank.pipeline && blank.confidence < 0.5, "generic contact file stays undetected");

ok(uniqueName("Aged FEX Oct", []) === "Aged FEX Oct", "first import keeps its name");
ok(uniqueName("Aged FEX Oct", ["Aged FEX Oct"]) === "Aged FEX Oct (2)", "duplicate import names get a suffix");
ok(uniqueName("  ", ["x"]) === "", "blank names stay blank");
