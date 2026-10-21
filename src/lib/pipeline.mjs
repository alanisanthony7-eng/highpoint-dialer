// Product-line detection for lead imports (IUL, mortgage protection, final expense).
// Used by tests and kept in lockstep with the import screen in public/desk-app.js.

export const PIPELINES = { FE: "Final Expense", MP: "Mortgage Protection", IUL: "IUL" };

export function prodFrom(s) {
  s = String(s || "").toLowerCase();
  if (/\b(fe|fex)\b|final\s*expense|burial|funeral|whole\s*life|senior\s*life/.test(s)) return "FE";
  if (/\b(mp)\b|mortgage|piti|home\s*protect|house\s*payment/.test(s)) return "MP";
  if (/\biul\b|index(?:ed)?|universal\s*life|cash\s*value/.test(s)) return "IUL";
  return "";
}

const HINTS = {
  IUL: {
    header: /\b(iul|indexed|index(?:ed)?\s*universal|cash\s*value|accumulation|illustration|cap\b|floor\b)\b/i,
    value: /\b(iul|indexed\s*universal|index\s*universal|cash\s*value|iul\s*lead)\b/i,
  },
  MP: {
    header: /\b(mortgage|mp\b|piti|lender|loan\s*(?:amount|balance|term)|home\s*(?:value|owner)|house\s*payment|ltv|property)\b/i,
    value: /\b(mortgage\s*protect|mp\s*lead|\bpiti\b|home\s*protect)\b/i,
  },
  FE: {
    header: /\b(final\s*expense|fex?\b|burial|funeral|whole\s*life|face\s*amount|graded|guaranteed\s*issue)\b/i,
    value: /\b(final\s*expense|fex?\b|burial|funeral|whole\s*life)\b/i,
  },
};

function bump(scores, reasons, k, n, why) {
  scores[k] += n;
  if (why && reasons[k].length < 4 && !reasons[k].includes(why)) reasons[k].push(why);
}

export function detectPipeline({ headers = [], rows = [], filename = "", map = [] } = {}) {
  const scores = { FE: 0, MP: 0, IUL: 0 };
  const reasons = { FE: [], MP: [], IUL: [] };
  const file = String(filename || "");
  const fromFile = prodFrom(file);
  if (fromFile) bump(scores, reasons, fromFile, 4, file);

  headers.forEach((h, i) => {
    const text = String(h || "").trim();
    const mapped = map[i];
    if (mapped === "mortgageBalance" || mapped === "lender") bump(scores, reasons, "MP", 3, text || mapped);
    for (const [k, hint] of Object.entries(HINTS)) {
      if (text && hint.header.test(text)) bump(scores, reasons, k, 3, text);
    }
    const p = prodFrom(text);
    if (p) bump(scores, reasons, p, 2, text);
  });

  for (const row of rows.slice(0, 40)) {
    for (const cell of row || []) {
      const v = String(cell || "").trim();
      if (!v) continue;
      const p = prodFrom(v);
      if (p) bump(scores, reasons, p, 1);
      for (const [k, hint] of Object.entries(HINTS)) {
        if (hint.value.test(v)) bump(scores, reasons, k, 1);
      }
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0];
  const second = ranked[1][1];
  if (!bestScore) return { pipeline: "", confidence: 0, scores, reasons: [], guess: "" };
  if (bestScore < 2 || bestScore === second) return { pipeline: "", confidence: 0.3, scores, reasons: reasons[best], guess: best };
  return { pipeline: best, confidence: bestScore >= 6 ? 0.9 : 0.65, scores, reasons: reasons[best], guess: best };
}

export function uniqueName(name, existing = []) {
  const base = String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!base) return "";
  const have = new Set(existing.map((x) => String(x).toLowerCase()));
  if (!have.has(base.toLowerCase())) return base;
  for (let n = 2; n < 200; n++) {
    const c = `${base} (${n})`;
    if (!have.has(c.toLowerCase())) return c;
  }
  return `${base} ${Date.now().toString(36)}`;
}

export function normPipeline(v) {
  const s = String(v || "").trim().toUpperCase();
  return PIPELINES[s] ? s : "";
}
