/* Highpoint Copilot — listens to the dialer's live transcript, fills the client profile as the call goes,
   catches callbacks and promises, flags objections with your talking points, remembers personal details for next
   time, and hides SSN / bank / card numbers. Works offline with built-in rules; uses Highpoint Bot when it's available. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const D = () => window.hpDesk, DL = () => window.hpDialer;
  const toast = (m) => (window.hpDesk?.toast || console.log)(m);
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16l20-8-6 10-4-3-3 4v-5"/><path d="M12 15l10-7"/></svg>';
  const QI = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 7h4v4c0 3-1.5 5-4 6l-.7-1.2C7.8 15 8.5 13.6 8.6 12H7zm7 0h4v4c0 3-1.5 5-4 6l-.7-1.2c1.5-.8 2.2-2.2 2.3-3.8H14z"/></svg>';

  /* ============ sensitive-number redaction (same rules as src/lib/redact.mjs on the server) ============ */
  const NUMWORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";
  const WORDRUN = new RegExp(`\\b${NUMWORD}(?:[\\s,-]+${NUMWORD}){6,}\\b`, "gi");
  function redact(s) {
    s = String(s ?? "");
    // 9 digits = SSN or bank routing; 11-19 = account or card. 10 digits is a phone number and stays.
    s = s.replace(/\b(?:\d[\s-]?){8,18}\d\b/g, (m) => { const n = m.replace(/\D/g, "").length; if (n === 10) return m; return n === 9 ? "[SSN / routing # hidden]" : "[account # hidden]"; });
    s = s.replace(WORDRUN, "[number hidden]");
    s = s.replace(/\b[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y]{2}\d{2}\b/gi, "[Medicare # hidden]");
    s = s.replace(/(\b(?:social security number|social security #|my social|ssn|account(?: number| #)?|routing(?: number| #)?|card(?: number| #)?|cvv|cvc|security code|pin)\b[^0-9\[\]]{0,25})((?:\d[\s-]?){2,8}\d)\b/gi, (m, a) => a + "[hidden]");
    return s;
  }
  window.hpRedact = redact;

  /* ============ what we capture ============ */
  const FIELDS = {
    consent: { label: "Recording disclosure", ask: "Read the recording disclosure.", nosave: true },
    age: { label: "Age", core: "age", ask: "How old are you, and what's your date of birth?" },
    dob: { label: "Date of birth", core: "dob", ask: "Can I get your date of birth?" },
    tobacco: { label: "Tobacco use", ask: "Have you used any tobacco or nicotine in the last 12 months?" },
    health: { label: "Health conditions", ask: "Any health conditions, or hospital stays in the last few years?" },
    meds: { label: "Medications", ask: "What medications do you take right now?" },
    hw: { label: "Height / weight", ask: "About how tall are you, and what do you weigh?" },
    beneficiary: { label: "Beneficiary", ask: "Who would you want as your beneficiary?" },
    coverage: { label: "Coverage wanted", ask: "How much would you want to leave behind?" },
    budget: { label: "Monthly budget", ask: "What monthly amount would feel comfortable?" },
    existing: { label: "Existing coverage", ask: "Do you have any life insurance right now, through work or on your own?" },
    draft: { label: "Draft date", ask: "What day does your Social Security or pension check come in?" },
    concern: { label: "Main concern" },
    decision: { label: "Decision involves" },
    mortgageBalance: { label: "Mortgage balance", core: "mortgageBalance", num: true, ask: "About how much is left on the mortgage?" },
    mortgagePayment: { label: "Mortgage payment", core: "mortgagePayment", num: true, ask: "What's the monthly mortgage payment?" },
    lender: { label: "Lender", core: "lender", ask: "Who's the mortgage with?" },
    goal: { label: "IUL goal", ask: "Is this mostly for protection, retirement income, or both?" },
  };
  const ORDER = ["consent", "age", "dob", "tobacco", "health", "meds", "hw", "beneficiary", "coverage", "budget", "existing", "draft", "mortgageBalance", "mortgagePayment", "lender", "goal", "concern", "decision"];
  const CHECK = {
    FE: ["consent", "age", "tobacco", "health", "meds", "hw", "beneficiary", "coverage", "budget", "existing", "draft"],
    MP: ["consent", "age", "tobacco", "health", "meds", "mortgageBalance", "mortgagePayment", "lender", "beneficiary", "budget", "existing"],
    IUL: ["consent", "age", "tobacco", "health", "goal", "budget", "beneficiary", "existing"],
  };
  const SHORT = { consent: "Disclosure", age: "Age / DOB", dob: "DOB", tobacco: "Tobacco", health: "Health", meds: "Meds", hw: "Ht / wt", beneficiary: "Beneficiary", coverage: "Coverage", budget: "Budget", existing: "Current policy", draft: "Draft date", mortgageBalance: "Balance", mortgagePayment: "Payment", lender: "Lender", goal: "Goal" };

  /* ============ objections → your talking points (edit freely) ============ */
  const OBJ = [
    { id: "price", label: "Price / budget", re: /\b(too (?:expensive|much)|can'?t afford|money'?s tight|tight budget|fixed income|don'?t want to (?:spend|pay) more than|can'?t (?:spend|pay) more than|that'?s a lot)\b/i,
      tips: ["Agree first: \"Smart. It has to fit comfortably.\"", "Show a smaller face amount that fits the budget. Even $8–10k covers a basic service.", "Ask: \"If we kept it under that number, would it feel comfortable?\""] },
    { id: "family", label: "Wants to talk to family", re: /\b(?:talk|discuss|go over|run it by|check with|think it over with|talk it over with)\b[^.?!]{0,20}\bmy\s+(wife|husband|spouse|daughter|son|kids|children|family|partner)\b/i,
      tips: ["Good idea. Invite them in: \"When can we get you both on the phone?\"", "Set the callback day and time before you hang up.", "Text the quote so they see the same numbers you do."] },
    { id: "think", label: "Wants to think about it", re: /\b(think about it|let me think|not ready|need (?:some )?time|sleep on it)\b/i,
      tips: ["Ask what part they want to think over: the price, the amount, or the company?", "Repeat their reason back in their own words.", "Offer to see if they'd qualify first, with no obligation."] },
    { id: "covered", label: "Says they're already covered", re: /\b(already (?:have|got) (?:coverage|insurance|a policy|life insurance)|i'?m (?:already )?covered)\b/i,
      tips: ["Ask how much, and whether it ends at retirement or a certain age.", "Work coverage usually ends when the job does. Confirm.", "Position this as filling the gap, not replacing it."] },
    { id: "trust", label: "Trust / scam worry", re: /\b(scam|how did you get my (?:number|info)|don'?t give (?:out )?(?:my )?information over the phone|is this legit)\b/i,
      tips: ["Slow down. Give your name, agency and license number.", "Invite them to verify you with the state Department of Insurance.", "No pressure. Offer a callback after they check."] },
    { id: "mail", label: "Send it in the mail", re: /\b(mail me|send (?:me )?(?:something|it|info|information) in the mail|put it in the mail)\b/i,
      tips: ["Offer to text or email the quote right now while you're both on the line.", "Ask what they'd look for in it, and answer that now."] },
    { id: "ni", label: "Not interested", re: /\b(not interested|no thanks|take me off|stop calling)\b/i,
      tips: ["Acknowledge, then one question: \"Was it the timing, or the coverage itself?\"", "If they say stop calling, mark Do not call."] },
  ];

  /* ============ helpers ============ */
  const W = { five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, "twenty five": 25, "twenty-five": 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
  const money = (n) => "$" + Math.round(n).toLocaleString();
  const cap = (s) => String(s || "").replace(/^./, (c) => c.toUpperCase());
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const COND = [[/high blood pressure|hypertension/i, "High blood pressure"], [/type\s*(?:2|two) diabetes/i, "Type 2 diabetes"], [/type\s*(?:1|one) diabetes/i, "Type 1 diabetes"], [/(?<!type\s*(?:1|2|one|two)\s*)diabet/i, "Diabetes"], [/\bcopd\b|emphysema/i, "COPD"], [/heart attack/i, "Heart attack"], [/congestive heart failure|\bchf\b/i, "Congestive heart failure"], [/\bstroke\b/i, "Stroke"], [/\bcancer\b/i, "Cancer"], [/kidney|dialysis/i, "Kidney disease"], [/\boxygen\b/i, "On oxygen"], [/high cholesterol|cholesterol/i, "High cholesterol"], [/\basthma\b/i, "Asthma"], [/a-?fib|atrial fibrillation/i, "AFib"], [/neuropathy/i, "Neuropathy"], [/sleep apnea/i, "Sleep apnea"], [/depression|anxiety/i, "Depression / anxiety"], [/alzheimer|dementia/i, "Dementia"], [/hepatitis/i, "Hepatitis"], [/arthritis/i, "Arthritis"], [/\bstent/i, "Heart stent"]];
  const MEDS = ["metformin", "insulin", "lantus", "humalog", "ozempic", "jardiance", "trulicity", "lisinopril", "losartan", "amlodipine", "metoprolol", "carvedilol", "hydrochlorothiazide", "furosemide", "lasix", "atorvastatin", "lipitor", "simvastatin", "rosuvastatin", "crestor", "eliquis", "xarelto", "warfarin", "plavix", "clopidogrel", "albuterol", "symbicort", "advair", "spiriva", "gabapentin", "levothyroxine", "synthroid", "omeprazole", "sertraline", "prednisone", "nitroglycerin"];

  function when(txt, base = new Date()) {
    const t = txt.toLowerCase(); let d = new Date(base); d.setSeconds(0, 0); let hasDate = false, hasTime = false;
    if (/\btonight\b/.test(t)) { d.setHours(19, 0); return { at: +d, exact: true }; }
    if (/\btoday\b/.test(t)) hasDate = true;
    if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); hasDate = true; }
    const wd = DAYS.findIndex((x) => new RegExp("\\b" + x + "\\b").test(t));
    if (wd >= 0) { let add = (wd - d.getDay() + 7) % 7; if (add === 0) add = 7; d.setDate(d.getDate() + add); hasDate = true; }
    if (/\bnext week\b/.test(t) && wd < 0) { d.setDate(d.getDate() + 7); hasDate = true; }
    const tm = t.match(/\b(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|in the morning|in the evening|in the afternoon)?/);
    if (tm) { let h = +tm[1]; const m = +(tm[2] || 0), ap = tm[3] || ""; if (/p|evening|afternoon/.test(ap) && h < 12) h += 12; else if (/a|morning/.test(ap) && h === 12) h = 0; else if (!ap && h >= 1 && h <= 7) h += 12; if (h <= 23) { d.setHours(h, m); hasTime = true; } }
    if (!hasDate && !hasTime) return null;
    if (!hasTime) d.setHours(10, 0);
    if (!hasDate && +d < Date.now()) d.setDate(d.getDate() + 1);
    return { at: +d, exact: hasTime };
  }
  const fmtWhen = (at) => new Date(at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const toLocalInput = (at) => { const d = new Date(at); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  /* ============ compliance watch: phrases the agent should double-check (flags only, never blocks the call) ============ */
  const RISKY = [
    { label: "Government affiliation", re: /\b(?:i'?m|we'?re|this is|i am)\s+(?:calling\s+)?(?:from|with)\s+(?:the\s+)?(?:medicare|social security|government|federal|the state|the county)\b|\bofficial (?:program|benefit|enrollment|notice)\b/i, tip: "Don't suggest a government program or affiliation. Say you're a licensed agent with Highpoint Financial." },
    { label: "Guarantee", re: /\b(?:guaranteed (?:approval|acceptance|coverage|to qualify)|can'?t be denied|you'?re (?:guaranteed|approved)|everyone (?:gets|qualifies)|no way you'?ll be denied)\b/i, tip: "Only use 'guaranteed' for a guaranteed-issue product, in the carrier's approved wording." },
    { label: "Pressure", re: /\b(?:today only|last chance|act now|offer (?:expires|ends)|rates are going up|(?:you )?(?:have|need) to decide (?:right )?(?:now|tonight|today)|don'?t wait)\b/i, tip: "Give them time. Pressure can void a sale and damage trust." },
    { label: "Guaranteed returns", re: /\b(?:guaranteed (?:returns?|growth|gains?)|never lose (?:money|any)|no risk at all|(?:always|will) beat the (?:market|stock market))\b/i, tip: "IUL has a floor, not a guaranteed return. Explain caps, fees and what the illustration assumes." },
    { label: "Free / no-cost claim", re: /\b(?:it'?s|this is) (?:completely )?free\b|\bno cost to you\b|\bcosts? you nothing\b/i, tip: "Only say free or no cost if that's true for this product." },
    { label: "Replacing a policy", re: /\b(?:cancel|replace|drop|switch out|get rid of)\s+(?:your|the)\s+(?:current\s+|existing\s+|old\s+|work\s+)?(?:policy|coverage|plan|insurance)\b/i, tip: "Replacing coverage needs the state replacement forms. Don't say to cancel until the new policy is in force." },
    { label: "Sensitive numbers requested", re: /\b(?:read|give|tell|provide|share|say|need|what(?:'?s| is)|what are)\b[^.?!]{0,25}\b(?:social security|ssn|routing|bank account|account number|card number|cvv|debit card|credit card)\b/i, tip: "Don't take SSN, bank or card numbers on this call. Use the carrier's secure application." },
  ];
  /* a health answer is only kept when it's about the client, not a family member, and not negated ("no diabetes") */
  const FAMILY = /\b(?:my|his|her|their|our)\s+(?:mother|mom|father|dad|brother|sister|husband|wife|aunt|uncle|grand(?:ma|pa|mother|father)|son|daughter|sibling|cousin|friend|neighbor|parents|family|kids|children|partner|boyfriend|girlfriend)\b/i;
  const NEG = /\b(?:no|not|never|without|don'?t have|do not have|haven'?t had|didn'?t have|doesn'?t have|negative for|free of|ruled out)\b/i;
  const clauseBefore = (tx, i) => { const pre = tx.slice(0, i); return pre.slice(Math.max(pre.lastIndexOf(","), pre.lastIndexOf(";"), pre.lastIndexOf("."), pre.lastIndexOf("?"), pre.lastIndexOf("!")) + 1); };

  /* ============ extraction (runs on every transcript update, in the browser, no network) ============ */
  function extract(lines, skip = () => false) {
    const F = {}, tasks = [], objs = [], mem = [], conflicts = {}, flags = [];
    const set = (k, value, i, conf = "high") => {
      if (value == null || value === "") return;
      const prev = F[k]; if (prev && prev.value !== value && ["budget", "coverage", "beneficiary", "age"].includes(k)) conflicts[k] = prev.value;
      F[k] = { value, line: i, conf, quote: lines[i]?.text || "" };
    };
    const addTask = (t) => { const key = t.kind + ":" + t.label; if (!tasks.some((x) => x.key === key)) tasks.push({ ...t, key }); };
    lines.forEach((ln, i) => {
      if (skip(i)) return;
      const tx = ln.text || "", lt = tx.toLowerCase(), lead = ln.who === "Lead";
      const prevQ = (lines[i - 1]?.who === "Agent" ? lines[i - 1].text : "").toLowerCase();
      if (!lead) {
        if (/\b(?:call|line)\s+(?:may|might|will|is going to)\s+be\s+recorded|\b(?:is being|being) recorded\b|recorded for quality/i.test(tx)) set("consent", "Read", i);
        const p = tx.match(/\b(?:i'?ll|i will|let me|i can|i'?m going to)\s+(?:send|text|email|mail)\s+(?:you\s+)?(?:over\s+)?(?:the\s+|a\s+|your\s+)?(quote|information|info|application|rates|numbers|details|illustration)\b[^.?!]*/i);
        if (p) { const w = when(p[0]); addTask({ kind: "promise", label: `Send the ${p[1].toLowerCase()}`, at: w?.at || Date.now() + 2 * 36e5, exact: !!w, line: i, quote: tx }); }
        const cb = tx.match(/\bi'?ll\s+(?:call|give you a call|ring)\s+(?:you\s+)?(?:back\s+)?[^.?!]*/i);
        if (cb) { const w = when(cb[0]); if (w) addTask({ kind: "callback", label: "Callback", at: w.at, exact: w.exact, line: i, quote: tx, promise: true }); }
        for (const r of RISKY) if (r.re.test(tx) && !flags.some((f) => f.label === r.label)) flags.push({ label: r.label, tip: r.tip, line: i, quote: tx });
        return;
      }
      // ---- lead lines ----
      let m;
      if ((m = tx.match(/\b(?:i'?m|i am)\s+(\d{2})\b(?!\s*(?:pounds|lbs|percent|%|dollars|years? (?:ago|in)))/i)) || (m = tx.match(/\b(\d{2})\s+years?\s+old\b/i))) { const a = +m[1]; if (a >= 18 && a <= 99) set("age", a, i); }
      if ((m = tx.match(/\bborn\s+(?:on\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i)) && MON[m[1].slice(0, 3).toLowerCase()]) { const mo = MON[m[1].slice(0, 3).toLowerCase()]; set("dob", `${String(mo).padStart(2, "0")}/${String(m[2]).padStart(2, "0")}/${m[3]}`, i); if (!F.age) { const b = new Date(+m[3], mo - 1, +m[2]), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), mo - 1, +m[2])) a--; set("age", a, i, "med"); } }
      else if ((m = tx.match(/\bborn\s+(?:on\s+)?(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i))) set("dob", `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3].length === 2 ? "19" + m[3] : m[3]}`, i);
      // tobacco
      if ((m = tx.match(/\b(?:quit|stopped|gave up)\s+(?:smoking|cigarettes|tobacco|vaping)(?:\s+(?:about|around)?\s*([\w-]+\s+years?\s+ago))?/i))) set("tobacco", "No" + (m[1] ? ` (quit ${m[1]})` : " (former smoker)"), i);
      else if (/\b(?:don'?t|do not|never|haven'?t)\s+(?:smoke|smoked|use tobacco|use nicotine|vape)/i.test(tx)) set("tobacco", "No", i);
      else if (/\b(?:i|still)\s+(?:smoke|vape|chew|dip)\b|\bi'?m a smoker\b|\bpack a day\b/i.test(tx)) set("tobacco", "Yes", i);
      else if (/tobacco|nicotine|smok/.test(prevQ) && /^\s*(?:no|nope|never|nah)\b/i.test(tx)) set("tobacco", "No", i);
      // health
      const conds = COND.filter(([re]) => { const m0 = re.exec(tx); return !!m0 && !FAMILY.test(clauseBefore(tx, m0.index)) && !NEG.test(clauseBefore(tx, m0.index)); }).map(([, n]) => n);
      if (conds.length) { const since = tx.match(/since\s+(\d{4})/i); const ctl = /\bcontrolled\b|under control/i.test(tx); const prev = F.health && F.health.value !== "None reported" ? F.health.value.split("; ") : []; const add = conds.map((c, j) => c + (j === conds.length - 1 && (since || ctl) ? ` (${[since && "since " + since[1], ctl && "controlled"].filter(Boolean).join(", ")})` : "")); set("health", [...new Set([...prev, ...add])].join("; "), i); }
      else if (/health|condition|medical/.test(prevQ) && /^\s*(?:no|none|nope|nothing|i'?m healthy|pretty healthy)\b/i.test(tx)) set("health", "None reported", i);
      const meds = MEDS.filter((x) => new RegExp("\\b" + x + "\\b", "i").test(tx)).map(cap);
      if (meds.length) { const prev = F.meds ? F.meds.value.split(", ") : []; set("meds", [...new Set([...prev, ...meds])].join(", "), i); }
      else if (/medication|meds|pills/.test(prevQ) && /^\s*(?:no|none|nope|nothing)\b/i.test(tx)) set("meds", "None", i);
      // height / weight
      const ht = tx.match(/\b(\d)\s*(?:foot|feet|ft|')\s*,?\s*(\d{1,2})?\b/i), wt = tx.match(/\b(\d{2,3})\s*(?:pounds|lbs?)\b/i);
      if (ht || wt) { const old = F.hw?.value || ""; const h = ht ? `${ht[1]}'${ht[2] || 0}"` : (old.match(/\d'\d+"/) || [""])[0]; const w = wt ? `${wt[1]} lbs` : (old.match(/\d+ lbs/) || [""])[0]; set("hw", [h, w].filter(Boolean).join(", "), i); }
      // beneficiary
      const REL = "daughter|son|wife|husband|spouse|grandson|granddaughter|sister|brother|niece|nephew|mother|father|partner|fianc[eé]e?";
      if ((m = tx.match(new RegExp(`\\bmy\\s+(${REL})(?:,?\\s+([A-Z][a-z]+))?\\s+(?:would|will|should|is going to|is)\\s+(?:be\\s+)?(?:my|the)\\s+beneficiary`, "i"))) || (m = tx.match(new RegExp(`\\bbeneficiary\\s+(?:would|will|should)\\s+be\\s+my\\s+(${REL})(?:,?\\s+([A-Z][a-z]+))?`, "i"))) || (m = tx.match(new RegExp(`\\bleave\\s+(?:it|everything|the money)\\s+to\\s+my\\s+(${REL})(?:,?\\s+([A-Z][a-z]+))?`, "i")))) {
        const nm = m[2] && /^[A-Z][a-z]+$/.test(m[2]) && !/^(Would|Will|Should|Is|And|But)$/.test(m[2]) ? m[2] : ""; set("beneficiary", nm ? `${nm} (${m[1].toLowerCase()})` : cap(m[1].toLowerCase()), i);
      }
      // existing coverage
      const ex = tx.match(/()\b(?:policy|coverage|life insurance|insurance)\s+(?:through|from|with|at)\s+(?:my\s+)?((?:old\s+)?(?:job|work|employer|union|the va|[A-Z][\w&]+(?:\s+[A-Z][\w&]+)?))/i);
      const isExisting = !!ex || /\b(?:already have|i have|i've got|got)\b[^.?!]{0,20}\b(?:a policy|coverage|life insurance)\b/i.test(tx);
      if (ex) { const ends = /\b(?:might|may|will|could)\s+(?:end|stop|lapse|go away)|\bends?\s+when|\bexpires?\b/i.test(tx); const amt = tx.match(/\$\s?\d[\d,]*(?:\s?k\b)?/i) || tx.match(/\b(?:\w+[- ])?thousand\b/i); set("existing", `${amt ? amt[0].replace(/\s/g, "") + " " : ""}through ${ex[2].toLowerCase().replace(/^the /, "")}${ends ? " (may end)" : ""}`, i); if (ends) addTask({ kind: "reminder", label: "Check when their current policy ends", at: null, exact: false, line: i, quote: tx }); }
      else if (/insurance|coverage|policy/.test(prevQ) && /^\s*(?:no|none|nope|nothing|not right now)\b/i.test(tx)) set("existing", "None", i);
      // monthly budget
      if ((m = tx.match(/(?:\$\s?(\d{2,3})|\b(thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b)(?:\s*dollars)?\s*(?:a|per|each|every)\s*month/i))) { const n = m[1] ? +m[1] : W[m[2].toLowerCase()]; const max = /more than|no more|at most|max|over|afford|tight|top/i.test(tx); set("budget", `${money(n)}/mo${max ? " max" : ""}`, i); }
      // coverage wanted
      if (!isExisting) for (const sn of tx.split(/(?<=[.?!])\s+/)) {
        if (/\bmonth|mortgage|owe\b/i.test(sn)) continue;
        if ((m = sn.match(/\$\s?(\d{1,3}(?:,\d{3})+|\d{4,7})/)) && /leave|coverage|policy|want|around|about|maybe|need|enough|cover/i.test(tx)) set("coverage", money(+m[1].replace(/,/g, "")), i);
        else if ((m = sn.match(/\b(five|six|seven|eight|nine|ten|twelve|fifteen|twenty[- ]five|twenty|thirty|forty|fifty)\s+thousand\b/i)) || (m = sn.match(/\b(\d{1,3})\s?(?:k|thousand)\b/i))) set("coverage", money((W[m[1].toLowerCase().replace("-", " ")] || +m[1]) * 1000), i);
      }
      if (/pay off (?:the |my )?(?:house|mortgage|home)/i.test(tx)) set("concern", "Paying off the mortgage for family", i);
      else if (/funeral|burial|cremation|final expense/i.test(tx) && /kids|children|family|daughter|son|burden|leave|stuck|wife|husband/i.test(tx)) set("concern", "Funeral costs; not leaving them to family", i);
      // mortgage protection
      if ((m = tx.match(/\$?\s?(\d{2,3}(?:,\d{3})+|\d{5,7})\b[^.?!]{0,30}\b(?:left on|owe|balance|on the (?:house|mortgage))/i)) || (m = tx.match(/\b(?:owe|left on the mortgage|balance is)\D{0,12}\$?\s?(\d{2,3}(?:,\d{3})+|\d{5,7})/i))) set("mortgageBalance", +m[1].replace(/,/g, ""), i);
      if ((m = tx.match(/(?:payment|mortgage)\D{0,20}\$?\s?(\d{3,4}(?:,\d{3})?)\s*(?:a|per)\s*month/i))) set("mortgagePayment", +m[1].replace(/,/g, ""), i);
      if ((m = tx.match(/\b(Rocket(?: Mortgage)?|Wells Fargo|Chase|Bank of America|Mr\.? Cooper|PennyMac|Freedom Mortgage|U\.?S\.? Bank|Truist|Navy Federal|Quicken)\b/))) { if (/mortgage|loan|lender|house|home/i.test(tx + " " + prevQ)) set("lender", m[1], i); }
      if (/retire(?:ment)? income|tax[- ]free income|cash value|build (?:up )?(?:money|savings)/i.test(tx)) set("goal", /protect|family|death benefit/i.test(tx) ? "Protection + retirement income" : "Retirement income / cash value", i, "med");
      // draft date
      if ((m = tx.match(/\b(?:comes?|gets? (?:paid|deposited)|deposits?|hits?)\b[^.?!]{0,20}?\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i)) || ((/social security|check|paid|draft|pension|deposit/.test(prevQ)) && (m = tx.match(/\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/i)))) { const n = +m[1]; const sfx = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"; set("draft", `Around the ${n}${sfx}${/social security/i.test(prevQ + tx) ? " (Social Security)" : ""}`, i); }
      // who's involved in the decision + objections
      for (const o of OBJ) { const mm = tx.match(o.re); if (mm) { objs.push({ ...o, line: i, quote: tx }); if (o.id === "family") { set("decision", cap(mm[1].toLowerCase()), i); addTask({ kind: "followup", label: `Follow up after they talk with their ${mm[1].toLowerCase()}`, at: null, exact: false, line: i, quote: tx, fam: true }); } } }
      // callbacks the lead asked for
      if ((m = tx.match(/\b(?:call|reach|try|catch)\s+(?:me|us|back|her|him)\b[^.?!]*/i)) || (m = tx.match(/\b(?:how about|what about|can you do)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)[^.?!]*/i))) { const w = when(m[0]); if (w) addTask({ kind: "callback", label: "Callback", at: w.at, exact: w.exact, line: i, quote: tx }); }
      if (/\bsend\s+me\s+(?:the|a|some|that)\s+(?:quote|info|information|rates|application)/i.test(tx)) addTask({ kind: "task", label: "Send the quote they asked for", at: Date.now() + 2 * 36e5, exact: false, line: i, quote: tx });
      if ((m = tx.match(/\bafter\s+(?:my|the|our)\s+(vacation|trip|surgery|holidays?|first of the month|first)\b/i))) addTask({ kind: "followup", label: `Follow up after the ${m[1].toLowerCase()}`, at: null, exact: false, line: i, quote: tx });
      // things worth remembering
      if ((m = tx.match(/\b(?:i|we)\s+(?:really\s+)?(?:love|enjoy|like)\s+(?:to\s+)?([a-z][a-z' ]{2,40}?)(?=[,.!;]|\s+(?:so|but|and|now|too|because)\b|$)/i)) && !/insurance|policy|idea|that|it\b/i.test(m[1]) && !/^(?:talk|think|get|know|see|have|go|do|make|keep|pay|wait|check|ask|hear|look|start|buy|leave|discuss|spend|be)\b/i.test(m[1]) && !/\bwould\s*$/i.test(tx.slice(0, m.index + 2))) mem.push({ text: `Enjoys ${m[1].trim()}`, line: i });
      if ((m = tx.match(/\b(?:just|recently)\s+retired(?:\s+in\s+([A-Z][a-z]+|\d{4}))?/i))) mem.push({ text: `Recently retired${m[1] ? " (" + m[1] + ")" : ""}`, line: i });
      if ((m = tx.match(/\bmy\s+(grandkids|grandchildren|grandson|granddaughter|dog|cat|church|garden|boat)\b/i))) mem.push({ text: `Mentions their ${m[1].toLowerCase()}`, line: i });
      if (/\b(?:widow|widower|lost my (?:wife|husband)|passed away)\b/i.test(tx)) mem.push({ text: "Recently lost someone close; be gentle", line: i });
    });
    // a callback covers the "talk to family" follow-up
    if (tasks.some((t) => t.kind === "callback" && t.at)) { for (let k = tasks.length - 1; k >= 0; k--) if (tasks[k].fam) tasks.splice(k, 1); const cb = tasks.find((t) => t.kind === "callback"); if (F.decision && cb) cb.label = `Callback with ${F.decision.value.toLowerCase()} on the line`; }
    const seen = new Set();
    return { F, tasks, objs, mem: mem.filter((m2) => !seen.has(m2.text) && seen.add(m2.text)), conflicts, flags };
  }

  /* ============ state ============ */
  const CP = { cur: null, pending: lsGet("hpc.pending", []).filter((s) => Date.now() - (s.endedAt || s.startedAt || 0) < 864e5), tab: lsGet("hpc.tab", "live"), openQuote: null, lastKeys: new Set(), modal: null };
  // On this device we keep only the review fields: no transcript lines, no quotes, nothing older than a day.
  const scrub = (a) => (a ? { ...a, quote: "" } : a);
  const savePending = () => lsSet("hpc.pending", CP.pending.slice(-20).map((s) => ({ ...s, lines: [], ai: s.ai === "running" ? "" : s.ai, ex: s.ex && { ...s.ex, F: Object.fromEntries(Object.entries(s.ex.F).map(([k, v]) => [k, scrub(v)])), tasks: s.ex.tasks.map(scrub), objs: s.ex.objs.map(scrub), flags: (s.ex.flags || []).map(scrub) } })));
  const lead = (id) => D()?.leads.get(id);
  const prodOf = (l) => (CHECK[l?.product] ? l.product : "FE");
  function onFile(l, k) {
    if (!l) return "";
    const f = FIELDS[k]; if (f.core) { const v = l[f.core]; return v ? (f.num ? money(v) : String(v)) : ""; }
    const v = l.fields?.[f.label]; return v && !/^sample-/i.test(v) ? String(v) : "";
  }
  function newSession(leadId) {
    const l = lead(leadId);
    return { id: "c" + Date.now().toString(36), leadId, name: l ? D().fullName(l) : "Lead", first: l?.first || "", product: prodOf(l), startedAt: Date.now(), endedAt: 0, lines: [], skips: [], paused: false, state: "live", redacted: 0, ex: null, edits: {}, ai: "", summary: "", sel: {}, consent: "none", from: 0, rawLen: 0, consentAt: 0, imported: false };
  }
  function ingest(s, lines) {
    let hid = 0;
    s.lines = lines.map((x) => { const r = redact(x.text); if (r !== x.text) hid++; return { who: x.who, text: r, t: x.t }; });
    s.redacted = hid;
    const skip = (i) => s.skips.some(([a, b]) => i >= a && (b == null || i < b));
    s.ex = extract(s.lines, skip);
    // where the call is in the FEX script (agent lines only; see hp-fex-script.js)
    s.fex = window.HP_FEX_TRACK && window.HP_FEX ? window.HP_FEX_TRACK.track(s.lines, window.HP_FEX.stages) : null;
  }

  /* ============ events from the dialer ============ */
  window.addEventListener("hp:callstart", () => {
    setTimeout(() => {
      const id = DL()?.liveLead || D()?.currentId?.(); if (!id) return;
      if (CP.cur && CP.cur.state === "live" && CP.cur.leadId !== id) finalize(CP.cur);
      if (!CP.cur || CP.cur.leadId !== id || CP.cur.state !== "live") { CP.cur = newSession(id); CP.lastKeys = new Set(); }
      CP.tab = "live"; schedule();
    }, 50);
  });
  window.addEventListener("hp:tx", (e) => {
    const { leadId, lines } = e.detail || {}; if (!leadId || !Array.isArray(lines)) return;
    let s = CP.cur && CP.cur.leadId === leadId && CP.cur.state !== "done" ? CP.cur : null;
    if (!s) { const p = CP.pending.find((x) => x.leadId === leadId && Date.now() - x.endedAt < 8000); if (p) { if (p.consent === "agreed" && lines.length >= p.rawLen) { ingest(p, lines.slice(p.from)); p.rawLen = lines.length; savePending(); schedule(); } return; } }
    if (!s) { if (!DL()?.busy) return; s = CP.cur = newSession(leadId); CP.lastKeys = new Set(); }
    if (s.consent === "declined" || s.state === "review") return;
    if (lines.length < s.rawLen) return;
    s.rawLen = lines.length; // until the client agrees we only count lines: nothing is read or kept
    if (s.consent !== "agreed") { schedule(); return; }
    ingest(s, lines.slice(s.from)); aiNotes(s); schedule();
  });
  window.addEventListener("hp:callend", () => {
    const s = CP.cur; if (!s) return;
    if (s.consent !== "agreed") { s.lines = []; s.ex = null; CP.cur = null; schedule(); return; }
    if (s.state !== "live") return;
    s.state = "ending"; schedule(); setTimeout(() => finalize(s), 1800);
  });
  window.addEventListener("hp:profile", () => schedule(true));

  function finalize(s) {
    if (s.state === "done" || s.state === "review") return;
    s.endedAt = Date.now(); s.state = "review"; if (CP.cur === s) CP.cur = null;
    if (s.consent !== "agreed" || !s.ex || s.lines.length < 3) { s.state = "done"; schedule(); return; }
    // what's selected for saving by default
    for (const k of Object.keys(s.ex.F)) { if (FIELDS[k]?.nosave) continue; const l = lead(s.leadId); const was = onFile(l, k); s.sel["f:" + k] = s.ex.F[k].conf === "high" || !was; }
    s.ex.tasks.forEach((t, i) => (s.sel["t:" + i] = !!t.at));
    s.ex.mem.forEach((m, i) => (s.sel["m:" + i] = true));
    s.summary = localSummary(s);
    clearTimeout(s.aiNotes?.timer); if (s.aiNotes) s.aiNotes.busy = false;
    CP.pending = [...CP.pending.filter((x) => x.id !== s.id), s]; savePending();
    if (s.lines.length >= 6) aiPass(s); // Highpoint Bot writes the summary (the local one stays if it can't)
    schedule();
    setTimeout(() => { if (!DL()?.busy && DL()?.profileId === s.leadId && !CP.modal && s.state === "review") openModal(s.id); }, 300);
  }

  function localSummary(s) {
    const F = s.ex.F, v = (k) => F[k]?.value, first = s.first || "The client";
    const P = { FE: "final expense", MP: "mortgage protection", IUL: "IUL" }[s.product];
    const bits = [`${first} is looking at ${P} coverage${v("concern") ? ", mainly for " + v("concern").split(";")[0].toLowerCase() : ""}.`];
    const want = [v("coverage") && `about ${v("coverage")} in coverage`, v("budget") && `a budget of ${v("budget")}`].filter(Boolean);
    if (want.length) bits.push(`Wants ${want.join(" with ")}.`);
    const facts = [v("age") && `Age ${v("age")}`, v("tobacco") && `tobacco: ${v("tobacco").toLowerCase()}`, v("health") && `health: ${v("health").toLowerCase()}`, v("beneficiary") && `beneficiary ${v("beneficiary")}`].filter(Boolean);
    if (facts.length) bits.push(facts.join("; ") + ".");
    if (v("existing") && v("existing") !== "None") bits.push(`Has ${v("existing")}.`);
    const objs = [...new Set(s.ex.objs.map((o) => o.label.toLowerCase()))]; if (objs.length) bits.push(`Objections: ${objs.join(", ")}.`);
    const cb = s.ex.tasks.find((t) => t.kind === "callback" && t.at); if (cb) bits.push(`Next step: ${cb.label.toLowerCase()}, ${fmtWhen(cb.at)}.`);
    return bits.join(" ");
  }

  // Highpoint Bot on the server (/api/ai); only ever sees the redacted transcript
  async function bot(system, prompt) {
    const r = await fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, messages: [{ role: "user", content: prompt }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Highpoint Bot isn't available"), { code: j.code, status: r.status });
    return JSON.parse((String(j.text || "").match(/\{[\s\S]*\}/) || ["{}"])[0]);
  }
  async function aiPass(s) {
    if (!s.lines.length || s.ai === "running") return;
    s.ai = "running"; schedule();
    const tx = s.lines.map((l) => `${l.who === "Agent" ? "Agent" : "Client"}: ${l.text}`).join("\n").slice(-20000);
    try {
      const j = await bot("You write CRM notes for a licensed life insurance agent. Reply with JSON only.", `You are the call copilot for a licensed life insurance agent at Highpoint Financial (final expense, mortgage protection, IUL). Read this call transcript and return ONLY a JSON object, no prose, with:
"summary": 2-3 plain sentences for the CRM (client's situation, what they want, objections, the agreed next step),
"memory": up to 4 short personal details worth remembering for rapport next call (hobbies, family, life events), never health, SSN or bank details,
"next_step": one short line.
Never include Social Security, bank, card or account numbers. Transcript:
"""${tx}"""`);
      if (j.summary) s.summary = redact(String(j.summary).trim());
      if (Array.isArray(j.memory)) j.memory.slice(0, 4).forEach((t) => { const text = redact(String(t)).trim(); if (text && !s.ex.mem.some((m) => m.text.toLowerCase() === text.toLowerCase())) { s.ex.mem.push({ text, ai: true }); s.sel["m:" + (s.ex.mem.length - 1)] = true; } });
      s.ai = "done";
    } catch (e) { s.ai = ["unavailable", "bad_key", "no_credit", "plan", "billing"].includes(e.code) ? "off" : ""; }
    savePending(); schedule();
  }

  /* ============ notes during the call: suggestions you add with one tap ============
     From the call itself (what the copilot heard: needs, coverage, beneficiary, objections, callbacks, personal
     details) and from Highpoint Bot, which reads the redacted conversation every so often and writes short notes. */
  const NOTE_KEYS = ["concern", "coverage", "budget", "beneficiary", "existing", "decision", "health", "meds", "tobacco", "age", "hw", "draft", "mortgageBalance", "mortgagePayment", "lender", "goal"];
  const nid = (t) => { let h = 0; for (const c of String(t).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) | 0; return "n" + (h >>> 0).toString(36); };
  function suggestions(s, l) {
    if (!s?.ex) return [];
    const out = [], add = (text, src) => { text = redact(String(text || "").trim()); if (text && !out.some((x) => x.text.toLowerCase() === text.toLowerCase())) out.push({ id: nid(text), text, src }); };
    for (const t of s.aiNotes?.items || []) add(t, "ai");
    for (const k of NOTE_KEYS) { const f = s.ex.F[k]; if (f && FIELDS[k] && f.value != null && f.value !== "") add(`${FIELDS[k].label}: ${f.value}`, "call"); }
    for (const o of s.ex.objs || []) add(`Objection: ${o.label.toLowerCase()}`, "call");
    for (const t of s.ex.tasks || []) { const k = { callback: "Callback", promise: "You promised", followup: "Follow-up", reminder: "Reminder" }[t.kind] || "To-do", lab = String(t.label || ""); add(`${k}${lab && lab.toLowerCase() !== k.toLowerCase() ? ": " + lab : ""}${t.at ? " · " + fmtWhen(t.at) : ""}`, "call"); }
    for (const m of s.ex.mem || []) add(m.text, "call");
    const st = (s.noteState = s.noteState || {});
    return out.filter((x) => !st[x.id]);
  }
  function addNotes(s, items) {
    const st = (s.noteState = s.noteState || {});
    const lines = items.map((x) => { st[x.id] = "added"; return "• " + x.text; });
    if (!lines.length) return;
    s.notes = (s.notes ? s.notes.replace(/\s*$/, "") + "\n" : "") + lines.join("\n");
    if (s.state !== "live") savePending();
  }
  // Highpoint Bot reads along: after enough new talk, at most every 25 seconds, up to 30 times a call
  function aiNotes(s) {
    const a = (s.aiNotes = s.aiNotes || { at: 0, seen: 0, busy: false, n: 0, items: [], status: "" });
    if (s.consent !== "agreed" || s.state !== "live" || a.busy || a.status === "off" || a.n >= 30) return;
    if (s.lines.filter((x) => x.who === "Lead").length < 2 || s.lines.length - a.seen < 4) return;
    const wait = 25000 - (Date.now() - a.at);
    if (wait > 0) { clearTimeout(a.timer); a.timer = setTimeout(() => aiNotes(s), wait + 100); return; }
    a.busy = true; a.at = Date.now(); a.n++; const upto = s.lines.length;
    const tx = s.lines.slice(-90).map((l) => `${l.who === "Agent" ? "Agent" : "Client"}: ${l.text}`).join("\n").slice(-9000);
    const prod = { FE: "final expense", MP: "mortgage protection", IUL: "IUL" }[s.product] || "life insurance";
    bot("You write short CRM notes for a licensed life insurance agent during a live call. Reply with JSON only.",
      `This is a ${prod} call with ${s.first || "the client"}. Write up to 6 short notes (each under 120 characters) the agent would want in the client's file: who they are, what they want and why, money and coverage details, health and lifestyle facts the client stated, objections, and agreed next steps. Only what the client actually said or agreed to. Never include Social Security, bank, card, Medicare or account numbers.\nReturn {"notes":["..."]}.\n\nTranscript so far:\n"""${tx}"""`)
      .then((j) => { if (Array.isArray(j.notes)) { a.items = j.notes.map((t) => redact(String(t || "").replace(/^[-•*\s]+/, "").trim())).filter((t) => t && t.length <= 200).slice(0, 6); a.status = "ok"; a.seen = upto; } })
      .catch((e) => { a.status = ["unavailable", "bad_key", "no_credit", "plan", "billing"].includes(e.code) ? "off" : "err"; a.seen = upto; })
      .finally(() => { a.busy = false; schedule(); if (s.state === "live" && s.lines.length - upto >= 4) aiNotes(s); });
  }

  /* ============ saving to the client ============ */
  async function save(s) {
    const d = D(), l = lead(s.leadId); if (!l) { toast("That client isn't in your CRM anymore"); return drop(s); }
    const patch = {}, fields = { ...(l.fields || {}) }; let n = 0; const audit = [];
    for (const k of ORDER) {
      const f = s.ex.F[k]; if (!f || FIELDS[k].nosave || !s.sel["f:" + k]) continue;
      const val = s.edits[k] ?? f.value; if (val === "" || val == null) continue;
      const was = onFile(l, k); if (f.conf === "med" && was && !(k in s.edits) && String(val) !== was) continue; // a guess never replaces a value already on file
      audit.push({ at: Date.now(), field: FIELDS[k].label, from: was, to: String(val), source: f.conf === "med" ? "worked out from context" : "stated on the call" });
      if (FIELDS[k].core) patch[FIELDS[k].core] = FIELDS[k].num || k === "age" ? Number(String(val).replace(/[^\d.]/g, "")) || val : val; else fields[FIELDS[k].label] = String(val);
      n++;
    }
    patch.fields = fields;
    const memNew = s.ex.mem.filter((m, i) => s.sel["m:" + i]).map((m) => ({ text: m.text, at: s.endedAt }));
    const old = l.copilot || {};
    patch.copilot = { memory: [...(old.memory || []), ...memNew].filter((m, i, a) => a.findIndex((x) => x.text.toLowerCase() === m.text.toLowerCase()) === i).slice(-30), lastSummary: s.summary, lastCallAt: s.endedAt, calls: (old.calls || 0) + 1, consentAt: s.consentAt || null, consentNote: s.imported ? "Agent confirmed the disclosure on an imported call" : (s.consentAt ? "Client agreed on a live call" : ""), audit: [...(old.audit || []), ...audit].slice(-200) };
    const notes = redact(String(s.notes || "").trim());
    patch.notes = d.addNoteObj(l, "Copilot summary: " + s.summary + (notes ? "\n\nCall notes:\n" + notes : ""));
    let appts = 0;
    for (const [i, t] of s.ex.tasks.entries()) {
      if (!s.sel["t:" + i]) continue; const at = s.edits["t:" + i] ?? t.at; if (!at) continue;
      await d.putAppt({ leadId: l.id, leadName: d.fullName(l), title: `${t.label} · ${d.fullName(l)}`, at, dur: t.kind === "callback" ? 30 : 15, type: t.kind === "callback" ? "Callback" : "Task", note: t.quote ? "From the call: \"" + t.quote.slice(0, 200) + "\"" : "", done: false, createdAt: Date.now() });
      if (t.kind === "callback") patch.callbackAt = at; appts++;
    }
    await d.patchLead(l.id, patch);
    toast(`Saved to ${d.fullName(l)}: ${n} field${n === 1 ? "" : "s"}${appts ? `, ${appts} follow-up${appts === 1 ? "" : "s"} on your calendar` : ""}`);
    drop(s, true);
  }
  function drop(s, saved) { s.state = "done"; CP.pending = CP.pending.filter((x) => x.id !== s.id); savePending(); if (CP.modal === s.id) closeModal(); if (!saved) toast("Call notes discarded"); schedule(true); }
  function later(s) { if (CP.modal === s.id) closeModal(); s.later = true; savePending(); toast("Saved for review. Find it in the Copilot button at the bottom."); schedule(true); }

  /* ============ recording consent: the gate ============ */
  // Nothing from the call is read or kept until the agent records that the client agreed. Before that we only count lines.
  function agree(s) {
    if (s.consent !== "none") return;
    s.consent = "agreed"; s.from = s.rawLen; s.consentAt = Date.now(); s.state = "live";
    Promise.resolve(DL()?.recordConsent?.("agreed")).then((ok) => { if (!ok) toast("Consent saved on this screen. The server didn't confirm it, so check the call log."); }).catch(() => {});
    toast("Copilot is listening. Nothing before this point is captured.");
    schedule(true);
  }
  async function decline(s) {
    if (s.consent === "declined") return;
    s.consent = "declined"; s.state = "declined";
    s.lines = []; s.ex = null; s.summary = ""; s.edits = {}; s.sel = {}; s.redacted = 0; s.ai = "";
    CP.pending = CP.pending.filter((x) => x.id !== s.id); savePending();
    if (CP.modal === s.id) closeModal();
    schedule(true);
    let ok = false; try { ok = !!(await DL()?.recordConsent?.("declined")); } catch {}
    toast(ok ? "Client declined. Copilot is off, recording is stopped and this call's notes are erased." : "Copilot is off and this call's notes are erased on this screen. Confirm with the desk that recording is stopped.");
  }

  /* ============ rendering ============ */
  let raf = 0, force = false;
  function schedule(f) { force = force || !!f; if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const ff = force; force = false; render(ff); }); }
  function render(f) {
    renderSlot(f); renderPill();
    window.dispatchEvent(new Event("hp:copilot"));
    if (CP.modal) { const s = CP.pending.find((x) => x.id === CP.modal); const box = $("#hpcModal .hpc"); if (s && box && (f || !box.contains(document.activeElement))) { box.innerHTML = reviewHTML(s, true); wireReview(box, s); } }
  }
  function renderSlot(f) {
    const slot = $("#hpfCopilot"); if (!slot) return;
    const pid = DL()?.profileId; const l = lead(pid); if (!l) { slot.innerHTML = ""; return; }
    const live = CP.cur && CP.cur.leadId === pid ? CP.cur : null;
    const rev = !live && CP.pending.filter((x) => x.leadId === pid && !x.later).slice(-1)[0];
    if (!f && slot.contains(document.activeElement) && document.activeElement.matches("input,textarea,select")) return;
    const keep = $(".hpc-body", slot)?.scrollTop || 0;
    if (rev) {
      const keys = ORDER.filter((k) => rev.ex.F[k] && !FIELDS[k].nosave), secs = Math.max(0, Math.round((rev.endedAt - rev.startedAt) / 1000));
      slot.innerHTML = `<div class="hpc">${head("review", "Review")}<div class="hpc-stats"><div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}</b><span>Talk</span></div><div><b>${keys.length}</b><span>Fields</span></div><div><b>${rev.ex.tasks.length}</b><span>To-dos</span></div></div><p class="hpc-mini">${esc(rev.summary)}</p><div class="hpc-acts"><button type="button" class="btn primary" data-open>Review and save</button><button type="button" class="btn" data-act="later">Later</button><button type="button" class="btn danger" data-act="drop">Discard</button></div></div>`;
      $("[data-open]", slot).onclick = () => openModal(rev.id); wireReview($(".hpc", slot), rev); return;
    }
    if (live && live.consent !== "agreed") { slot.innerHTML = `<div class="hpc">${consentHTML(live)}</div>`; wireLive(slot, live, l); return; }
    slot.innerHTML = `<div class="hpc">${liveHTML(live, l)}</div>`; wireLive(slot, live, l);
    const b = $(".hpc-body", slot); if (b) b.scrollTop = keep;
  }
  function head(state, label) {
    return `<div class="hpc-h"><b>${ICON}Copilot</b><span class="hpc-st" data-s="${state}"><i></i>${label}</span></div>`;
  }
  // Where the live call is in the FEX script: the stage, a progress strip and the next line to say.
  function stageHTML(fx, l) {
    const S = window.HP_FEX.stages, n = S.length;
    const head = fx.done ? "Script complete" : fx.stage < 0 ? "Waiting for the intro" : `Stage ${fx.stage + 1} of ${n} · ${esc(fx.title)}`;
    const segs = S.map((st, i) => `<i class="${i < fx.stage ? "done" : i === fx.stage ? "now" : ""}" title="${esc(st.title)}"></i>`).join("");
    const fill = (t) => esc(t.length > 170 ? t.slice(0, 169).trimEnd() + "…" : t).replace(/\{name\}/g, esc(l.first || "them")).replace(/\{address\}/g, esc(l.address || "address"));
    const nx = fx.next ? `<div class="hpc-next"><span>Next${fx.next.stage !== fx.stage ? " · " + esc(S[fx.next.stage].title) : ""}</span>“${fill(fx.next.text)}”</div>` : "";
    return `<div class="hpc-stage"><div class="hpc-stage-h"><b>${head}</b><em>${fx.pct}%</em></div><div class="hpc-segs" style="grid-template-columns:repeat(${n},1fr)">${segs}</div>${nx}</div>`;
  }
  function liveHTML(s, l) {
    const prod = s?.product || prodOf(l);
    const st = !s ? ["idle", "Idle"] : s.paused ? ["paused", "Paused"] : s.state === "ending" ? ["review", "Wrapping up"] : ["live", "Listening"];
    const ex = s?.ex || { F: {}, tasks: [], objs: [], mem: [], conflicts: {} };
    const tab = CP.tab;
    const sugg = suggestions(s, l);
    const tabs = [["live", "Live", Object.keys(ex.F).length], ["notes", "Notes", sugg.length], ["mem", "Memory", (l.copilot?.memory?.length || 0) + ex.mem.length], ["tasks", "Tasks", ex.tasks.length]];
    let body = "";
    if (tab === "live") {
      if (s && prod === "FE" && window.HP_FEX && window.HP_FEX_TRACK) body += stageHTML(s.fex || window.HP_FEX_TRACK.track([], window.HP_FEX.stages), l);
      const obj = ex.objs[ex.objs.length - 1];
      const fresh = obj && s && s.lines.length - obj.line <= 6;
      if (fresh) body += `<div class="hpc-alert"><b>Objection · ${esc(obj.label)}</b><ul>${obj.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
      const sett = DL()?.settings || {};
      const fl = ex.flags?.[ex.flags.length - 1]; if (s && fl && s.lines.length - fl.line <= 6) body += `<div class="hpc-alert bad"><b>Check this wording · ${esc(fl.label)}</b>${esc(fl.tip)}</div>`;
      if (s?.redacted) body += `<div class="hpc-alert info"><b>Sensitive info hidden</b>${s.redacted} number${s.redacted === 1 ? "" : "s"} (SSN, bank or card) kept out of the transcript and notes. Take payment details on the carrier's secure application.</div>`;
      const list = CHECK[prod].filter((k) => k !== "consent"); // consent is handled by the gate above
      const have = (k) => (k === "age" ? ex.F.age || ex.F.dob || onFile(l, "age") || onFile(l, "dob") : ex.F[k] || onFile(l, k));
      const got = list.filter(have).length;
      const missing = list.find((k) => !have(k));
      if (s && missing && FIELDS[missing].ask && !fresh) body += `<div class="hpc-ask"><span>Ask next</span>${esc(FIELDS[missing].ask)}</div>`;
      body += `<div class="hpc-sec">${prod === "FE" ? "Final expense" : prod === "MP" ? "Mortgage protection" : "IUL"} app <em>${got}/${list.length}</em></div><div class="hpc-bar"><i style="width:${Math.round((got / list.length) * 100)}%"></i></div>
        <div class="hpc-chk">${list.map((k) => `<span class="${ex.F[k] || (k === "age" && ex.F.dob) ? "ok" : have(k) ? "file" : "need"}" title="${ex.F[k] ? "Heard on this call" : have(k) ? "Already on file" : "Still needed"}">${ex.F[k] || (k === "age" && ex.F.dob) ? "✓ " : have(k) ? "• " : ""}${SHORT[k]}</span>`).join("")}</div>`;
      const keys = ORDER.filter((k) => ex.F[k] && k !== "consent");
      if (keys.length) {
        body += `<div class="hpc-sec">Heard on this call <em>${keys.length}</em></div><div class="hpc-fields">${keys.map((k) => { const f = ex.F[k]; const isNew = !CP.lastKeys.has(k + f.value); const was = onFile(l, k); const conf = ex.conflicts[k]; return `<div class="hpc-f ${isNew ? "new" : ""}"><span>${esc(FIELDS[k].label)}</span><b><i class="hpc-dot ${f.conf === "med" ? "med" : ""}" title="${f.conf === "med" ? "Worked out from context. Double-check." : "Stated directly"}"></i>${esc(FIELDS[k].num ? money(f.value) : f.value)}${conf ? `<small>Changed from ${esc(conf)}</small>` : was && was !== String(f.value) && !(FIELDS[k].num && money(f.value) === was) ? `<small>On file: ${esc(was)}</small>` : ""}</b><button class="hpc-src" data-q="${k}" title="Show where this came from" aria-label="Show where ${esc(FIELDS[k].label)} came from">${QI}</button>${CP.openQuote === k ? `<div class="hpc-quote">"${esc(f.quote)}"</div>` : ""}</div>`; }).join("")}</div>`;
        CP.lastKeys = new Set(keys.map((k) => k + ex.F[k].value));
      } else if (s) body += `<p class="hpc-empty">Listening. Client details show up here as they come up in the conversation.</p>`;
      else body += `<p class="hpc-empty">Copilot starts listening when the call connects. It fills in the profile, catches callbacks and promises, and flags objections as you talk.</p><button type="button" class="btn" data-import style="justify-self:start">Paste a transcript from another dialer</button>`;
    } else if (tab === "notes") {
      if (!s) body += `<p class="hpc-empty">Notes for the call start here when it connects: type your own, and add the ones Copilot suggests from what the client says with one tap.</p>`;
      else {
        const a = s.aiNotes || {};
        body += `<div class="hpc-sec">Your notes</div><textarea class="hpc-notes" data-notes rows="5" placeholder="Type notes for this call, or add suggestions below" aria-label="Notes for this call">${esc(s.notes || "")}</textarea>`;
        body += `<div class="hpc-sec">Suggested from this call <span style="display:flex;gap:8px;align-items:center">${a.busy ? "<em>Highpoint Bot is reading…</em>" : ""}${sugg.length > 1 ? `<button type="button" class="hpc-addall" data-addall>Add all</button>` : ""}</span></div>`;
        body += sugg.length ? `<ul class="hpc-sugg">${sugg.map((x) => `<li><button type="button" class="ok" data-nadd="${x.id}" aria-label="Add to notes" title="Add to notes">✓</button><span>${esc(x.text)}</span>${x.src === "ai" ? `<i title="Written by Highpoint Bot from the conversation">AI</i>` : ""}<button type="button" data-nno="${x.id}" aria-label="Dismiss" title="Dismiss">✕</button></li>`).join("")}</ul>`
          : `<p class="hpc-empty">${Object.keys(s.noteState || {}).length ? "All caught up. New suggestions show up as the client talks." : "Listening. Suggestions show up here as the client talks."}${a.status === "off" ? " (Highpoint Bot is off, so these come from what Copilot heard.)" : ""}</p>`;
        body += `<p class="hpc-empty">Your notes save to the client's file with the call summary.</p>`;
      }
    } else if (tab === "mem") {
      const old = (l.copilot?.memory || []).slice().reverse();
      body += ex.mem.length ? `<div class="hpc-sec">New this call</div><ul class="hpc-mem">${ex.mem.map((m) => `<li class="new">${esc(m.text)}</li>`).join("")}</ul>` : "";
      body += `<div class="hpc-sec">What to remember</div>` + (old.length ? `<ul class="hpc-mem">${old.map((m) => `<li>${esc(m.text)}<time>${new Date(m.at).toLocaleDateString()}</time></li>`).join("")}</ul>` : `<p class="hpc-empty">Nothing saved yet. Personal details from calls (hobbies, family, life events) land here so you can pick up where you left off.</p>`);
      if (l.copilot?.lastSummary) body += `<div class="hpc-sec">Last call</div><div class="hpc-sum">${esc(l.copilot.lastSummary)}</div>`;
      const facts = ["beneficiary", "coverage", "budget", "decision", "concern"].map((k) => [k, onFile(l, k)]).filter(([, v]) => v);
      if (facts.length) body += `<div class="hpc-fields">${facts.map(([k, v]) => `<div class="hpc-f"><span>${esc(FIELDS[k].label)}</span><b>${esc(v)}</b><i></i></div>`).join("")}</div>`;
    } else {
      body += ex.tasks.length ? `<div class="hpc-list">${ex.tasks.map((t) => taskRow(t)).join("")}</div><p class="hpc-empty">These save to your calendar when you review the call.</p>` : `<p class="hpc-empty">Callbacks, promises ("I'll text you the quote tonight") and follow-ups get caught here as they come up.</p>`;
      const up = [...(D()?.appts?.values?.() || [])].filter((a) => a.leadId === l.id && !a.done && a.at > Date.now()).sort((a, b) => a.at - b.at).slice(0, 4);
      if (up.length) body += `<div class="hpc-sec">Already scheduled</div><div class="hpc-list">${up.map((a) => `<div class="hpc-task"><span></span><div><span class="k">${esc(a.type || "Appt")}</span>${esc(fmtWhen(a.at))}</div></div>`).join("")}</div>`;
    }
    return `${head(...st)}<div class="hpc-tabs" role="tablist">${tabs.map(([k, t, n]) => `<button type="button" role="tab" data-ct="${k}" aria-selected="${tab === k}">${t}${n ? `<span class="n">${n}</span>` : ""}</button>`).join("")}</div>
      <div class="hpc-body" style="display:flex;flex-direction:column;gap:9px">${body}</div>
      ${s ? `<div class="hpc-foot"><span>${s.lines.length} lines heard</span><span style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" id="hpcPause">${s.paused ? "Resume listening" : "Pause listening"}</button><button type="button" data-consent="declined">Client withdrew consent</button></span></div>` : ""}`;
  }
  function consentHTML(s) {
    if (s.consent === "declined") return `${head("paused", "Off for this call")}<div class="hpc-body" style="display:flex;flex-direction:column;gap:9px"><div class="hpc-alert bad"><b>Client declined recording</b>Copilot is off for this call. Recording has been stopped and nothing from the call was kept.</div></div>`;
    return `${head("idle", "Waiting for consent")}<div class="hpc-body" style="display:flex;flex-direction:column;gap:9px"><div class="hpc-alert"><b>Read the disclosure first</b>"This call may be recorded for quality and training. Do you agree to continue?"<br>Copilot stays off until the client says yes. Nothing from this call is captured before then.</div><div class="hpc-acts"><button type="button" class="btn primary" data-consent="agreed">Client agreed</button><button type="button" class="btn danger" data-consent="declined">Client declined</button></div></div>`;
  }
  function taskRow(t, i, s) {
    const kind = { callback: "Callback", promise: "You promised", task: "Task", followup: "Follow-up", reminder: "Reminder" }[t.kind] || "Task";
    const pk = t.kind === "promise" || t.promise ? "promise" : "";
    const at = s ? s.edits["t:" + i] ?? t.at : t.at;
    const whenTxt = at ? `${fmtWhen(at)}${t.exact ? "" : " · confirm the time"}` : "Needs a date";
    return `<div class="hpc-task">${s ? `<input type="checkbox" data-sel="t:${i}" ${s.sel["t:" + i] ? "checked" : ""} aria-label="Save ${esc(t.label)}">` : "<span></span>"}<div><span class="k ${pk}">${kind}</span>${esc(t.label)}</div>${s ? `<input type="datetime-local" data-at="${i}" value="${at ? toLocalInput(at) : ""}" aria-label="When">` : `<span class="when ${at && t.exact ? "" : "need"}">${esc(whenTxt)}</span>`}</div>`;
  }
  function reviewHTML(s, modal) {
    const ex = s.ex, l = lead(s.leadId), keys = ORDER.filter((k) => ex.F[k] && !FIELDS[k].nosave);
    const secs = Math.max(0, Math.round((s.endedAt - s.startedAt) / 1000));
    return `<div class="hpc-h"><b>${ICON}Call complete</b>${modal ? `<button class="hpc-x" type="button" data-close aria-label="Close">✕</button>` : `<span class="hpc-st" data-s="review"><i></i>Review</span>`}</div>
      ${modal ? `<div style="font-weight:700">${esc(s.name)} <span class="hpc-ai">· ${new Date(s.endedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>` : ""}
      <div class="hpc-stats"><div><b>${s.imported ? "—" : Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0")}</b><span>${s.imported ? "Imported" : "Talk time"}</span></div><div><b>${keys.length}</b><span>Fields</span></div><div><b>${ex.tasks.length}</b><span>To-dos</span></div></div>
      <div class="hpc-sec">Summary ${s.ai === "running" ? "<em>Highpoint Bot is writing…</em>" : s.ai === "done" ? "<em>by Highpoint Bot</em>" : s.ai !== "off" && s.lines.length ? `<button type="button" class="hpc-ai" data-act="polish" title="Sends the redacted transcript to Highpoint Bot" style="cursor:pointer;background:none;border:0;color:inherit;font:inherit;text-decoration:underline">Polish with Highpoint Bot</button>` : ""}</div>
      <textarea class="hpc-sum" data-sum rows="4" aria-label="Call summary">${esc(s.summary)}</textarea>
      ${(() => { const left = suggestions(s, l); return `<div class="hpc-sec">Your notes ${left.length ? `<button type="button" class="hpc-addall" data-addall>Add ${left.length} suggestion${left.length === 1 ? "" : "s"}</button>` : ""}</div><textarea class="hpc-notes" data-revnotes rows="${Math.min(10, Math.max(3, (s.notes || "").split("\n").length + 1))}" placeholder="Notes for the client's file" aria-label="Your notes">${esc(s.notes || "")}</textarea>`; })()}
      <p class="hpc-empty">Recording consent: ${s.imported ? "the agent confirmed the disclosure on an imported call" : s.consentAt ? "the client agreed on this call at " + new Date(s.consentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "not recorded"}.</p>
      ${(s.ex.flags || []).length ? `<div class="hpc-alert bad"><b>Compliance check</b><ul>${s.ex.flags.map((f) => `<li><b>${esc(f.label)}.</b> ${esc(f.tip)}${f.quote ? ` <em>"${esc(f.quote.slice(0, 160))}"</em>` : ""}</li>`).join("")}</ul>Review the wording before saving. Flags do not block anything.</div>` : ""}
      ${keys.length ? `<div class="hpc-sec">Save to client file <em>${keys.filter((k) => s.sel["f:" + k]).length}/${keys.length}</em></div><div class="hpc-fields" style="gap:0">${keys.map((k) => { const f = ex.F[k]; const was = onFile(l, k); const v = s.edits[k] ?? (FIELDS[k].num ? f.value : f.value); return `<div class="hpc-pick"><input type="checkbox" data-sel="f:${k}" ${s.sel["f:" + k] ? "checked" : ""} aria-label="Save ${esc(FIELDS[k].label)}"><span>${esc(FIELDS[k].label)}${f.conf === "med" ? " ·<br>check" : ""}</span><input type="text" data-ed="${k}" value="${esc(v)}">${was && was !== String(v) && !(FIELDS[k].num && money(v) === was) ? `<span class="was">Replaces: ${esc(was)}</span>` : ""}</div>`; }).join("")}</div>` : ""}
      ${ex.tasks.length ? `<div class="hpc-sec">Add to calendar</div><div class="hpc-list">${ex.tasks.map((t, i) => taskRow(t, i, s)).join("")}</div>` : ""}
      ${ex.mem.length ? `<div class="hpc-sec">Remember for next time</div><div class="hpc-fields" style="gap:0">${ex.mem.map((m, i) => `<label class="hpc-pick" style="grid-template-columns:auto minmax(0,1fr)"><input type="checkbox" data-sel="m:${i}" ${s.sel["m:" + i] ? "checked" : ""}><b style="font-weight:500">${esc(m.text)}</b></label>`).join("")}</div>` : ""}
      ${s.redacted ? `<p class="hpc-empty">${s.redacted} sensitive number${s.redacted === 1 ? " was" : "s were"} hidden and won't be saved.</p>` : ""}
      <div class="hpc-acts"><button type="button" class="btn primary" data-act="save">Save to ${esc(s.first || "client")}'s file</button><button type="button" class="btn" data-act="later">Review later</button><button type="button" class="btn danger" data-act="drop">Discard</button></div>`;
  }

  function wireLive(slot, s, l) {
    $$("[data-ct]", slot).forEach((b) => (b.onclick = () => { CP.tab = b.dataset.ct; lsSet("hpc.tab", CP.tab); schedule(true); }));
    $$("[data-q]", slot).forEach((b) => (b.onclick = () => { CP.openQuote = CP.openQuote === b.dataset.q ? null : b.dataset.q; schedule(true); }));
    $$("[data-consent]", slot).forEach((b) => (b.onclick = () => (b.dataset.consent === "agreed" ? agree(s) : decline(s))));
    const im = $("[data-import]", slot); if (im) im.onclick = () => openImport(l);
    if (s) {
      const ta = $("[data-notes]", slot); if (ta) { ta.oninput = () => { s.notes = ta.value; }; ta.onblur = () => schedule(true); }
      const list = () => suggestions(s, l);
      $$("[data-nadd]", slot).forEach((b) => (b.onclick = () => { const x = list().find((y) => y.id === b.dataset.nadd); if (x) { addNotes(s, [x]); schedule(true); } }));
      $$("[data-nno]", slot).forEach((b) => (b.onclick = () => { (s.noteState = s.noteState || {})[b.dataset.nno] = "no"; schedule(true); }));
      const all = $("[data-addall]", slot); if (all) all.onclick = () => { addNotes(s, list()); schedule(true); };
    }
    const p = $("#hpcPause", slot);
    if (p) p.onclick = () => { s.paused = !s.paused; if (s.paused) s.skips.push([s.lines.length, null]); else { const last = s.skips[s.skips.length - 1]; if (last) last[1] = s.lines.length; } toast(s.paused ? "Copilot paused. Nothing is captured until you resume." : "Copilot listening again"); schedule(true); };
  }
  function wireReview(box, s) {
    $$("[data-sel]", box).forEach((c) => (c.onchange = () => { s.sel[c.dataset.sel] = c.checked; savePending(); }));
    $$("[data-ed]", box).forEach((c) => (c.onchange = () => { s.edits[c.dataset.ed] = c.value.trim(); s.sel["f:" + c.dataset.ed] = true; savePending(); }));
    $$("[data-at]", box).forEach((c) => (c.onchange = () => { const v = c.value ? +new Date(c.value) : null; s.edits["t:" + c.dataset.at] = v; s.ex.tasks[+c.dataset.at].exact = true; if (v) s.sel["t:" + c.dataset.at] = true; savePending(); }));
    const sum = $("[data-sum]", box); if (sum) sum.onchange = () => { s.summary = redact(sum.value.trim()); savePending(); };
    const rn = $("[data-revnotes]", box); if (rn) rn.onchange = () => { s.notes = redact(rn.value); savePending(); };
    const aa = $("[data-addall]", box); if (aa) aa.onclick = () => { if (rn) s.notes = redact(rn.value); addNotes(s, suggestions(s, lead(s.leadId))); savePending(); box.innerHTML = reviewHTML(s, !!box.closest("#hpcModal")); wireReview(box, s); };
    $$("[data-act]", box).forEach((b) => (b.onclick = async () => { const a = b.dataset.act; if (a === "save") { b.disabled = true; try { await save(s); } catch (e) { toast("Couldn't save: " + (e.message || e)); b.disabled = false; } } else if (a === "later") later(s); else if (a === "polish") { b.disabled = true; aiPass(s); } else drop(s); }));
    const x = $("[data-close]", box); if (x) x.onclick = closeModal;
  }

  /* ============ other dialers: paste a transcript (WAVV, ReadyMode, a recording's text) ============ */
  function parseTranscript(raw, label = "Agent") {
    const me = new RegExp("^(?:" + String(label).replace(/[^\w ]/g, "").trim() + "|agent|rep|advisor|me|you)$", "i");
    const out = [];
    for (const row of String(raw || "").split(/\r?\n/)) {
      const t = row.replace(/^\s*\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*-?\s*/, "").trim();
      if (!t || /^\d+$/.test(t) || /-->/.test(t)) continue; // subtitle numbering and timing lines
      const m = t.match(/^([A-Za-z][A-Za-z0-9 ._'-]{0,24}):\s*(.+)$/);
      if (m) out.push({ who: me.test(m[1].trim()) ? "Agent" : "Lead", text: m[2].trim() });
      else if (out.length) out[out.length - 1].text += " " + t;
      else out.push({ who: "Lead", text: t });
    }
    return out.map((x, i) => ({ ...x, t: i }));
  }
  function openImport(l) {
    if (CP.cur && CP.cur.leadId === l.id && CP.cur.state !== "done") { toast("Finish the live call first"); return; }
    $("#hpcImport")?.remove();
    const m = document.createElement("div"); m.id = "hpcImport"; m.className = "hpc-modal";
    m.innerHTML = `<div class="hpc" role="dialog" aria-label="Paste a transcript">
      <div class="hpc-h"><b>${ICON}Paste a transcript</b><button class="hpc-x" type="button" data-imp-close aria-label="Close">✕</button></div>
      <p class="hpc-mini">From WAVV, ReadyMode or another dialer. Copilot cleans it the same way as a live call, and only the review fields are kept.</p>
      <label class="hpc-mini">Label for your lines<input id="hpcImpLabel" value="Agent" style="width:100%;margin-top:4px"></label>
      <textarea id="hpcImpText" rows="8" style="width:100%;margin-top:8px" aria-label="Transcript text" placeholder="Agent: Hi Margaret, this is...&#10;Margaret: ..."></textarea>
      <label class="hpc-pick" style="grid-template-columns:auto minmax(0,1fr);margin-top:8px"><input type="checkbox" id="hpcImpConsent"><b style="font-weight:500">The recording disclosure was read and the client agreed on this call.</b></label>
      <div class="hpc-acts"><button type="button" class="btn primary" data-imp-go>Build review</button><button type="button" class="btn" data-imp-close>Cancel</button></div>
    </div>`;
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    document.body.append(m);
    $$("[data-imp-close]", m).forEach((b) => (b.onclick = () => m.remove()));
    $("[data-imp-go]", m).onclick = () => {
      if (!$("#hpcImpConsent", m).checked) { toast("Confirm the disclosure and consent first"); return; }
      const lines = parseTranscript($("#hpcImpText", m).value, $("#hpcImpLabel", m).value.trim() || "Agent");
      if (lines.length < 3) { toast("That transcript is too short to use"); return; }
      const now = Date.now(), s = newSession(l.id);
      Object.assign(s, { imported: true, consent: "agreed", consentAt: now, state: "live", startedAt: now, endedAt: now, rawLen: lines.length, from: 0 });
      ingest(s, lines); m.remove(); finalize(s);
    };
  }

  /* floating "calls to review" button + review window */
  function renderPill() {
    const pend = CP.pending.filter((s) => s.state === "review" && (s.later || s.leadId !== DL()?.profileId));
    let pill = $("#hpcPill");
    if (!pend.length || CP.modal) { pill?.remove(); return; }
    if (!pill) { pill = document.createElement("button"); pill.id = "hpcPill"; pill.type = "button"; pill.className = "hpc-pill"; document.body.append(pill); pill.onclick = () => openModal(pend[0]?.id); }
    pill.innerHTML = `${ICON}Calls to review <b>${pend.length}</b>`;
    pill.onclick = () => { const p2 = CP.pending.filter((s) => s.state === "review" && (s.later || s.leadId !== DL()?.profileId)); if (p2[0]) openModal(p2[0].id); };
  }
  function openModal(id) {
    const s = CP.pending.find((x) => x.id === id); if (!s) return;
    closeModal(); CP.modal = id;
    const m = document.createElement("div"); m.id = "hpcModal"; m.className = "hpc-modal"; m.innerHTML = `<div class="hpc" role="dialog" aria-label="Review call with ${esc(s.name)}">${reviewHTML(s, true)}</div>`;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    document.body.append(m); wireReview($(".hpc", m), s);
    document.addEventListener("keydown", escClose);
  }
  function escClose(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() { $("#hpcModal")?.remove(); CP.modal = null; document.removeEventListener("keydown", escClose); schedule(); }

  /* for the pop-outs (public/hp-pop.js): what the copilot has heard, and the same consent buttons as the profile */
  window.hpCopilot = {
    session(leadId) {
      if (CP.cur && (!leadId || CP.cur.leadId === leadId)) return CP.cur;
      return leadId ? CP.pending.filter((x) => x.leadId === leadId).slice(-1)[0] || null : null;
    },
    agree() { if (CP.cur) agree(CP.cur); },
    decline() { if (CP.cur) decline(CP.cur); },
    FIELDS, OBJ, CHECK,
  };

  // restore unreviewed calls from earlier
  CP.pending.forEach((s) => { if (s.state !== "review") s.state = "review"; s.later = true; });
  setInterval(() => { if (CP.cur?.state === "live") schedule(); }, 5000);
  const boot = () => schedule(true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
