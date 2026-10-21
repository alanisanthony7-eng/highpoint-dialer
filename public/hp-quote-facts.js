/* Quote facts: what a client says on a call, turned into quoter values (birthday, age, height and weight, tobacco,
   sex, state, years left on the mortgage, IUL goal). Plain functions with no page needed, so the same rules run in the
   copilot (public/hp-copilot.js), the quoter (public/desk-app.js, public/hp-pop.js) and the tests (test/quote-facts.mjs).
   Each parser answers only on a clear statement and returns null otherwise: "I'm in my sixties" fills nothing.
   `prev` is the agent's line just before, so a bare answer ("March 4th, 1958") counts when it answers the question. */
(() => {
  "use strict";
  const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ORDS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  const ONE9 = "one|two|three|four|five|six|seven|eight|nine";
  const TEEN = "ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
  const TENW = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
  const W99 = `(?:(?:${TENW})(?:[\\s-]+(?:${ONE9}))?|${TEEN}|${ONE9})`;
  const ORDW = `(?:(?:twenty|thirty)[\\s-]+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth`;
  const MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const FILLER = "(?:(?:um+|uh+|oh|well|so|yeah|yes|sure|okay|ok|it'?s|i'?m|i am|im|about|around|like|maybe|roughly|probably)[,\\s]+)*";

  // "67", "sixty seven", "sixty-seven" -> 67
  function num99(s) {
    const t = String(s ?? "").trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
    if (/^\d+$/.test(t)) return +t;
    const [a, b, c] = t.split(" ");
    if (c) return null;
    if (TENS[a] != null) { if (!b) return TENS[a]; const o = ONES[b]; return o >= 1 && o <= 9 ? TENS[a] + o : null; }
    return !b && ONES[a] != null ? ONES[a] : null;
  }
  // "4", "4th", "fourth", "twenty-first" -> day of the month
  function dayOf(s) {
    const t = String(s).trim().toLowerCase().replace(/-/g, " ");
    const d = t.match(/^(\d{1,2})(?:st|nd|rd|th)?$/); if (d) return +d[1];
    const [a, b] = t.split(/\s+/);
    if (b) return TENS[a] && ORDS[b] && ORDS[b] < 10 ? TENS[a] + ORDS[b] : null;
    return ORDS[a] ?? null;
  }
  // "1958", "nineteen fifty eight", "two thousand five" -> a year
  function yearOf(s) {
    const t = String(s).trim().toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
    if (/^\d{4}$/.test(t)) return +t;
    let m = t.match(/^(nineteen|twenty) (.+)$/); if (m) { const n = num99(m[2]); return n == null ? null : (m[1] === "nineteen" ? 1900 : 2000) + n; }
    m = t.match(/^two thousand(?: and)?(?: (.+))?$/); if (m) { const n = m[1] ? num99(m[1]) : 0; return n == null ? null : 2000 + n; }
    return null;
  }
  const pad2 = (n) => String(n).padStart(2, "0");

  /* ---------- birthday and age (age last birthday, the same number every carrier uses) ---------- */
  // -> { age } for a real date that has passed, else { err: "bad" | "future" }
  function checkDob(p, now = new Date()) {
    const m = +p?.m, d = +p?.d, y = +p?.y;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1000 && String(p.y).length === 4)) return { err: "bad" };
    const b = new Date(y, m - 1, d);
    if (b.getFullYear() !== y || b.getMonth() !== m - 1 || b.getDate() !== d) return { err: "bad" }; // 2/31 doesn't roll over into March
    if (b > now) return { err: "future" };
    let age = now.getFullYear() - y;
    if (now < new Date(now.getFullYear(), m - 1, d)) age--;
    return age > 120 ? { err: "bad" } : { age };
  }
  const dobAge = (p, now) => { const r = checkDob(p, now); return r.age > 0 && r.age < 120 ? r.age : null; };
  // two-digit years: "58" is 1958, "05" is 2005 (nobody quoted is born in the future)
  const fullYear = (y, now = new Date()) => (String(y).length === 2 ? (+y > now.getFullYear() % 100 ? 1900 : 2000) + +y : +y);

  const DAY = `(\\d{1,2}(?:st|nd|rd|th)?|${ORDW})`;
  const YEAR = `((?:19|20)\\d{2}|(?:nineteen|twenty)[\\s-]+${W99}|two thousand(?:[\\s-]+and)?(?:[\\s-]+(?:${TEEN}|${ONE9}))?)`;
  const DOB_MD = new RegExp(`\\b(${MONTH})\\.?\\s+(?:the\\s+)?${DAY}(?:\\s*,\\s*|\\s+)(?:of\\s+)?${YEAR}\\b`, "i");
  const DOB_DM = new RegExp(`\\b(?:the\\s+)?${DAY}\\s+(?:of\\s+)?(${MONTH})\\.?(?:\\s*,\\s*|\\s+)${YEAR}\\b`, "i");
  const DOB_NUM = /\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/;
  const DOB_CTX = /\b(?:born|birthday|birth ?date|date of birth|d\.?\s?o\.?\s?b\.?)\b/i;
  // -> { m, d, y } (strings, MM / DD / YYYY) or null
  function parseDob(text, prev = "", now = new Date()) {
    const t = String(text || "");
    if (!DOB_CTX.test(t) && !DOB_CTX.test(prev || "")) return null; // a date with no birthday in sight is something else
    let m, d, y, x;
    if ((x = t.match(DOB_MD))) { m = MON[x[1].slice(0, 3).toLowerCase()]; d = dayOf(x[2]); y = yearOf(x[3]); }
    else if ((x = t.match(DOB_DM))) { d = dayOf(x[1]); m = MON[x[2].slice(0, 3).toLowerCase()]; y = yearOf(x[3]); }
    else if ((x = t.match(DOB_NUM))) { m = +x[1]; d = +x[2]; y = fullYear(x[3], now); }
    if (!m || !d || !y) return null;
    const p = { m: pad2(m), d: pad2(d), y: String(y) };
    return checkDob(p, now).age != null ? p : null;
  }

  const AGE_NUM = `(\\d{2}|${W99})`;
  const AGE_STOP = /^\s*(?:%|percent|pounds?|lbs?|dollars?|bucks|grand|thousand|hundred|k\b|minutes?|mins?|miles?|hours?|days?|weeks?|months?|years?\s+(?:ago|back|in|since|on|left|now|of)|feet|foot|ft\b|inch|inches|degrees|times|or\b|to\b|\/|-\s*\d)/i;
  const AGE_IF = /\b(?:when|if|until|till|once|by the time|before|after)\s*$/i;
  const okAge = (n) => (n >= 18 && n <= 99 ? n : null);
  function parseAge(text, prev = "") {
    const t = String(text || "");
    let x;
    // "I'm 67", "I'm sixty-seven years old", "I am actually 67 years old"
    const re = new RegExp(`\\b(?:i'?m|i am|im)\\s+(?:(?:only|just|now|actually|about|around)\\s+)?${AGE_NUM}\\b`, "gi");
    while ((x = re.exec(t))) {
      const n = num99(x[1]), after = t.slice(x.index + x[0].length), before = t.slice(0, x.index);
      if (AGE_IF.test(before) || /\b(?:going to|gonna|will)\s*$/i.test(before)) continue;
      if (/^\s*years?\s+old\b/i.test(after) || !AGE_STOP.test(after)) { if (okAge(n)) return n; }
    }
    if ((x = t.match(new RegExp(`\\b(?:i'?m|i am|im)\\b([^.,;!?]{0,24}?)\\b${AGE_NUM}\\s+years?\\s+old\\b`, "i"))) && !/going to|gonna|will be/i.test(x[1])) { const n = okAge(num99(x[2])); if (n) return n; }
    if ((x = t.match(new RegExp(`\\b(?:i|i've|i have)\\s+(?:just\\s+|recently\\s+)?turned\\s+${AGE_NUM}\\b`, "i")))) { const n = okAge(num99(x[1])); if (n) return n; }
    // the answer to "How old are you?"
    if (/\bhow old\b|\byour age\b|\bage are you\b/i.test(prev || "") && (x = t.match(new RegExp(`^\\s*${FILLER}${AGE_NUM}(?:\\s+years?(?:\\s+old)?)?\\s*(?:[.!,]|$|\\band\\b|\\bbut\\b)`, "i")))) return okAge(num99(x[1]));
    return null;
  }

  /* ---------- height and weight ---------- */
  const INCHW = "eleven|ten|nine|eight|seven|six|five|four|three|two|one|zero";
  const FTW = { four: 4, five: 5, six: 6, seven: 7 };
  const inchOf = (s) => { const n = num99(s); return n != null && n >= 0 && n <= 11 ? n : null; };
  const WTW = `(?:one|two|three)\\s+(?:hundred(?:\\s+(?:and\\s+)?${W99})?|${W99})`;
  const wtOf = (s) => {
    const t = String(s).toLowerCase().trim();
    if (/^\d{2,3}$/.test(t)) return +t;
    const m = t.match(/^(one|two|three)\s+(?:hundred(?:\s+(?:and\s+)?(.+))?|(.+))$/); if (!m) return null;
    const rest = m[2] || m[3]; const n = rest ? num99(rest) : 0;
    return n == null ? null : ONES[m[1]] * 100 + n;
  };
  const okWt = (n) => (n >= 80 && n <= 500 ? n : null);
  const H_ASK = /\btall\b|\bheight\b/i, W_ASK = /\bweigh/i;
  // -> { ft, inch, lb } with whatever was said, or null
  function parseHW(text, prev = "") {
    const t = String(text || ""), out = {};
    let x, hEnd = -1;
    const setH = (ft, inch, m) => { if (ft >= 4 && ft <= 7 && inch != null) { out.ft = ft; out.inch = inch; hEnd = m.index + m[0].length; return true; } return false; };
    // 5'10", 5 foot 10, 5 ft 10 in, 6 feet
    if ((x = t.match(/\b([4-7])\s*(?:'|’|ft\.?|foot|feet)(?:\s*(?:and\s+)?(\d{1,2})(?!\d)\s*(?:"|”|''|in\.?\b|inch(?:es)?\b)?)?/i))) setH(+x[1], x[2] != null ? inchOf(x[2]) : 0, x);
    // five foot ten, six feet
    else if ((x = t.match(new RegExp(`\\b(four|five|six|seven)\\s+(?:foot|feet)(?:[\\s,]+(?:and\\s+)?(${INCHW}|\\d{1,2})(?!\\d)\\b(?:\\s+inch(?:es)?)?)?`, "i")))) setH(FTW[x[1].toLowerCase()], x[2] ? inchOf(x[2]) : 0, x);
    // "I'm five ten", or "five ten" when the agent asked how tall
    else if ((x = t.match(new RegExp(`\\b(?:i'?m|i am|im)\\s+(?:about\\s+|around\\s+)?(four|five|six|[4-6])[\\s-]+(${INCHW}|\\d{1,2})(?!\\d)\\b(?!\\s*(?:minutes?|miles?|years?|dollars?|bucks|pounds?|lbs?|%|percent))`, "i"))) || (H_ASK.test(prev || "") && (x = t.match(new RegExp(`^\\s*${FILLER}(four|five|six|[4-6])[\\s-]+(${INCHW}|\\d{1,2})(?!\\d)\\b`, "i"))))) setH(FTW[x[1].toLowerCase()] || +x[1], inchOf(x[2]), x);
    // weight: "190 pounds", "I weigh about 190", or a bare number right after the height / when the agent asked
    if ((x = t.match(new RegExp(`\\b(\\d{2,3}|${WTW})\\s*(?:pounds|lbs?\\b|lb\\.)`, "i")))) { const n = okWt(wtOf(x[1])); if (n) out.lb = n; }
    else if ((x = t.match(new RegExp(`\\bweigh(?:s|t is|t's)?\\s+(?:(?:about|around|like|maybe|roughly|probably|close to|almost|over|under)\\s+)*(\\d{2,3}|${WTW})\\b`, "i")))) { const n = okWt(wtOf(x[1])); if (n) out.lb = n; }
    else if (hEnd >= 0 || W_ASK.test(prev || "")) {
      const rest = hEnd >= 0 ? t.slice(hEnd) : t;
      if ((x = rest.match(new RegExp(`(?:^|[\\s,]|\\band\\b)\\s*(?:(?:about|around|like|maybe|roughly|probably|i weigh|weigh)\\s+)*(\\d{3}|${WTW})\\b(?!\\s*(?:dollars?|bucks|a month|per month|years?|thousand|k\\b))`, "i")))) { const n = okWt(wtOf(x[1])); if (n) out.lb = n; }
    }
    return Object.keys(out).length ? out : null;
  }
  const hwText = (h) => [h.ft != null ? `${h.ft}'${h.inch ?? 0}"` : "", h.lb != null ? `${h.lb} lbs` : ""].filter(Boolean).join(", ");

  /* ---------- tobacco / nicotine ---------- */
  const T_ASK = /tobacco|nicotine|smok|cigar|vape|vaping|chew|dip\b/i;
  const NIC_OF = [[/\bcigars?\b/i, "cigar", "cigars"], [/\bpipe\b/i, "pipe", "pipe"], [/\bchew|\bdip\b|\bdipping\b|\bsnuff\b|\bsnus\b/i, "chew", "chewing tobacco"], [/\bvap(?:e|es|ing)\b|\be-?cig/i, "vape", "vape"], [/\bpatch\b|\bnicotine gum\b|\bthe gum\b|\bzyn\b|\bnicotine pouch/i, "nrt", "nicotine patch or gum"]];
  const SOON = /\b(?:(?:a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|few|couple(?: of)?|\d{1,2})\s+(?:months?|weeks?|days?)\s+ago|last (?:month|week)|this (?:year|month)|recently|just quit)\b/i;
  // -> "Yes", "Yes (vape)", "Yes (quit under a year ago)", "No", "No (quit 5 years ago)", "No (former smoker)", "No (marijuana only)", or null
  function parseTobacco(text, prev = "") {
    const t = String(text || ""), asked = T_ASK.test(prev || "");
    let x;
    if (/\b(?:i\s+(?:only\s+)?)?smoke\s+(?:some\s+|a little\s+)?(?:weed|marijuana|pot|cannabis)\b/i.test(t) && !/\bcigarettes?\b|\btobacco\b/i.test(t)) return "No (marijuana only)";
    if ((x = t.match(/\b(?:quit|stopped|gave up|kicked)\b(?:\s+(?:smoking|cigarettes|tobacco|vaping|dipping|chewing|the cigarettes))?/i)) && (/smok|cigar|tobacco|vap|dip|chew/i.test(x[0]) || asked)) {
      const rest = t.slice(x.index);
      if (SOON.test(rest)) return "Yes (quit under a year ago)";
      const y = rest.match(/\b(\d{1,2}|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|couple(?: of)?|few)\s+years?\s+ago\b/i) || rest.match(/\b(?:in|back in|since)\s+((?:19|20)\d{2})\b/);
      if (y) return `No (quit ${/^\d{4}$/.test(y[1]) ? "in " + y[1] : y[0].replace(/^a /i, "a ")})`;
      if (/\blast year\b/i.test(rest)) return "No (quit last year)";
      return "No (former smoker)";
    }
    const nic = (s) => NIC_OF.find(([re]) => re.test(s));
    if (/\b(?:i|still|i do)\s+(?:still\s+)?(?:smoke|vape|chew|dip)\b|\bi'?m a smoker\b|\bpacks? a day\b|\b(?:a few|some) cigarettes\b/i.test(t)) { const n = nic(t); return n ? `Yes (${n[2]})` : "Yes"; } // before "No", so "I don't smoke but I vape" is tobacco
    if (/\b(?:i\s+)?used to\s+(?:smoke|vape|chew|dip)\b/i.test(t)) return "No (former smoker)";
    if (/\b(?:don'?t|do not|never|haven'?t|have not|didn'?t|i'?m not a|not a)\s+(?:ever\s+|really\s+)?(?:smoke[sd]?|smoker|use (?:any )?(?:tobacco|nicotine)|used (?:any )?(?:tobacco|nicotine)|vape|chew|dip)\b|\bnon-?smoker\b|\bno (?:tobacco|nicotine|cigarettes)\b/i.test(t)) return "No";
    if (asked && /^\s*(?:no|nope|never|nah|not at all|none)\b/i.test(t)) return "No";
    if (asked && /^\s*(?:yes|yeah|yep|yup|i do|sometimes|occasionally|a little|socially)\b/i.test(t)) { const n = nic(t) || nic(prev); return n ? `Yes (${n[2]})` : "Yes"; }
    return null;
  }
  // the quoter's nicotine type for a tobacco answer
  const nicOf = (v) => { const s = String(v || ""); if (!/^yes/i.test(s)) return /marijuana/i.test(s) ? "mj" : "none"; const n = NIC_OF.find(([, , lab]) => s.includes(`(${lab})`)); return n ? n[1] : "cig"; };

  /* ---------- sex (only when the client says it; never guessed from a voice) ---------- */
  function parseSex(text, prev = "") {
    const t = String(text || "");
    let x = t.match(/\b(?:i'?m|i am|im)\s+(?:a\s+)?(female|woman|lady|male|man|guy|gentleman)\b(?!\s+(?:of|who|that)\b)/i);
    if (!x && /\bmale or female\b|\bfemale or male\b|\bgender\b|\b(?:your|the) sex\b/i.test(prev || "")) x = t.match(new RegExp(`^\\s*${FILLER}(?:a\\s+)?(female|woman|lady|male|man|guy|gentleman)\\b`, "i"));
    if (!x) return null;
    return /^(?:female|woman|lady)$/i.test(x[1]) ? "F" : "M";
  }

  /* ---------- state, from what they say or a ZIP code ---------- */
  const STATE = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "washington d.c.": "DC", "washington dc": "DC", "d.c.": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", "west virginia": "WV", washington: "WA", "washington state": "WA", wisconsin: "WI", wyoming: "WY" };
  const STATE_RE = Object.keys(STATE).sort((a, b) => b.length - a.length).map((s) => s.replace(/\./g, "\\.").replace(/ /g, "\\s+")).join("|");
  const stOf = (s) => STATE[String(s).toLowerCase().replace(/\s+/g, " ")] || null;
  const S_LIVE = new RegExp(`\\b(?:i'?m|i am|im|we'?re|we are|i|we)\\s+(?:(?:currently|still|now|actually)\\s+)?(?:(?:live|living|reside|residing|located|based|stay|staying)\\s+)?(?:(?:down|up|out|over|back)\\s+)?(?:here\\s+)?in\\s+(?:the state of\\s+)?(${STATE_RE})(?![\\w'])`, "i");
  const S_HERE = new RegExp(`\\b(?:here in|(?:i|we)\\s+(?:just\\s+)?moved\\s+(?:down\\s+|up\\s+|out\\s+)?to)\\s+(${STATE_RE})(?![\\w'])`, "i");
  const S_ASK = /\bwhat state\b|\bwhich state\b|\bwhere (?:do|are) you (?:live|living|located|calling from|at)\b|\bwhere are you located\b/i;
  // ZIP code -> state, by the first three digits
  const ZIP3 = [[5, 5, "NY"], [10, 27, "MA"], [28, 29, "RI"], [30, 38, "NH"], [39, 49, "ME"], [50, 54, "VT"], [55, 55, "MA"], [56, 59, "VT"], [60, 69, "CT"], [70, 89, "NJ"], [100, 149, "NY"], [150, 196, "PA"], [197, 199, "DE"], [200, 200, "DC"], [201, 201, "VA"], [202, 205, "DC"], [206, 219, "MD"], [220, 246, "VA"], [247, 268, "WV"], [270, 289, "NC"], [290, 299, "SC"], [300, 319, "GA"], [320, 349, "FL"], [350, 369, "AL"], [370, 385, "TN"], [386, 397, "MS"], [398, 399, "GA"], [400, 427, "KY"], [430, 459, "OH"], [460, 479, "IN"], [480, 499, "MI"], [500, 528, "IA"], [530, 549, "WI"], [550, 567, "MN"], [569, 569, "DC"], [570, 577, "SD"], [580, 588, "ND"], [590, 599, "MT"], [600, 629, "IL"], [630, 658, "MO"], [660, 679, "KS"], [680, 693, "NE"], [700, 714, "LA"], [716, 729, "AR"], [733, 733, "TX"], [730, 749, "OK"], [750, 799, "TX"], [800, 816, "CO"], [820, 831, "WY"], [832, 838, "ID"], [840, 847, "UT"], [850, 865, "AZ"], [870, 884, "NM"], [885, 885, "TX"], [889, 898, "NV"], [900, 961, "CA"], [967, 968, "HI"], [970, 979, "OR"], [980, 994, "WA"], [995, 999, "AK"]];
  const zipState = (z) => { const s = String(z || ""); if (!/^\d{5}$/.test(s)) return null; const n = +s.slice(0, 3); return (ZIP3.find(([a, b]) => n >= a && n <= b) || [])[2] || null; };
  // -> { state: "FL" } or { state: "FL", zip: "33101" }, or null
  function parseState(text, prev = "") {
    const t = String(text || "");
    let x = t.match(/\bzip(?:\s*code)?(?:\s+is|'s|\s*:)?\s+(\d(?:\s?\d){4})(?!\s?\d)/i) || (/\bzip\b/i.test(prev || "") ? t.match(/(?:^|\D)(\d(?:\s?\d){4})(?!\s?\d)/) : null);
    if (x) { const zip = x[1].replace(/\s/g, ""), st = zipState(zip); if (st) return { state: st, zip }; }
    if ((x = t.match(S_LIVE)) || (x = t.match(S_HERE))) { const st = stOf(x[1]); if (st) return { state: st }; }
    if (S_ASK.test(prev || "") && (x = t.match(new RegExp(`^\\s*${FILLER}(?:(?:i'?m|we'?re|i live|we live)\\s+)?(?:in\\s+)?(${STATE_RE})(?![\\w'])`, "i")))) { const st = stOf(x[1]); if (st) return { state: st }; }
    return null;
  }

  /* ---------- mortgage: years left (picks the term length) ---------- */
  const YR_NUM = `(\\d{1,2}|${W99})`;
  function parseYearsLeft(text, prev = "") {
    const t = String(text || ""), ctx = /mortgage|loan|house|home|note|pay(?:ing)?\s+(?:it\s+|that\s+)?off|paid off|left on it/i.test(t + " " + (prev || ""));
    let x = t.match(new RegExp(`\\b${YR_NUM}\\s+(?:more\\s+)?years?\\s+(?:left|to go|remaining)\\b`, "i")) || t.match(new RegExp(`\\bpaid off in\\s+(?:about\\s+|around\\s+)?${YR_NUM}\\s+years?\\b`, "i")) || t.match(new RegExp(`\\b${YR_NUM}[\\s-]+years?\\s+(?:left\\s+)?on\\s+(?:the\\s+|my\\s+|our\\s+)?(?:mortgage|loan|note|house)\\b`, "i"));
    if (!x || !ctx) return null;
    const n = num99(x[1]);
    return n >= 1 && n <= 40 ? n : null;
  }
  // the shortest term that covers the years left
  const termFor = (years, terms = [10, 15, 20, 25, 30]) => terms.find((t) => t >= years) || terms[terms.length - 1];

  /* ---------- IUL: what it's mostly for ---------- */
  const G_ASK = /protection|retirement|cash value|both/i;
  function parseGoal(text, prev = "") {
    const t = String(text || "");
    const ret = /\bretire(?:ment)?(?: income)?\b|\btax[- ]free income\b|\bcash value\b|\bbuild (?:up )?(?:money|savings|cash)\b/i.test(t), prot = /\bprotect(?:ion|ing)?\b|\bdeath benefit\b|\bcover(?:age)? for (?:my )?family\b|\bif something happens\b/i.test(t);
    if ((ret && prot) || (G_ASK.test(prev || "") && /^\s*(?:(?:um|uh|oh|well|i'?d say|probably|definitely|honestly)[,\s]+)*both\b/i.test(t))) return "Protection + retirement income";
    if (ret) return "Retirement income / cash value";
    if (prot && /\b(?:mostly|mainly|just|only|really|more)\b|^\s*(?:protection|the death benefit)\b/i.test(t)) return "Protection";
    return null;
  }
  const focusOf = (goal) => (/\+|both/i.test(goal) ? "balanced" : /retire|cash/i.test(goal) ? "cash" : /protect/i.test(goal) ? "protection" : null);

  const api = { num99, dayOf, yearOf, checkDob, dobAge, fullYear, parseDob, parseAge, parseHW, hwText, parseTobacco, nicOf, parseSex, parseState, zipState, parseYearsLeft, termFor, parseGoal, focusOf, STATE };
  if (typeof window !== "undefined") window.HP_QFACTS = api;
  globalThis.HP_QFACTS = api;
})();
