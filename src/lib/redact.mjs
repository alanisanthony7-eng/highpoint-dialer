// Hides Social Security, bank, card and Medicare numbers in call transcripts and anything sent to the AI.
// The same rules run in the browser (public/hp-copilot.js) so nothing sensitive is stored or shown.
const NUMWORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)";
const WORDRUN = new RegExp(`\\b${NUMWORD}(?:[\\s,-]+${NUMWORD}){6,}\\b`, "gi");
export function redact(s) {
  s = String(s ?? "");
  // 9 digits = SSN or bank routing; 11-19 = account or card. 10 digits is a phone number and stays.
  s = s.replace(/\b(?:\d[\s-]?){8,18}\d\b/g, (m) => { const n = m.replace(/\D/g, "").length; if (n === 10) return m; return n === 9 ? "[SSN / routing # hidden]" : "[account # hidden]"; });
  // numbers read out as words ("four four one seven two two ...")
  s = s.replace(WORDRUN, "[number hidden]");
  // Medicare number (MBI), e.g. 1EG4-TE5-MK73
  s = s.replace(/\b[1-9][AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y][AC-HJKMNP-RT-Y0-9]\d-?[AC-HJKMNP-RT-Y]{2}\d{2}\b/gi, "[Medicare # hidden]");
  // shorter numbers right after a sensitive word ("my social is 123 45...", "security code 123")
  s = s.replace(/(\b(?:social security number|social security #|my social|ssn|account(?: number| #)?|routing(?: number| #)?|card(?: number| #)?|cvv|cvc|security code|pin)\b[^0-9\[\]]{0,25})((?:\d[\s-]?){2,8}\d)\b/gi, (m, a) => a + "[hidden]");
  return s;
}
