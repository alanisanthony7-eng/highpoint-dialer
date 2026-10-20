// National DNC, state DNC and TCPA-litigator scrubbing through The Blacklist Alliance
// (https://blacklist-alliance.readme.io). Off until BLACKLIST_ALLIANCE_KEY is set. Each number's result is kept
// for 30 days (the National DNC must be re-checked at least every 31 days), so repeat checks don't cost anything.
import { getStore } from "./store.mjs";

const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
export const scrubOn = () => !!String(env("BLACKLIST_ALLIANCE_KEY") || "").trim();
const kv = () => getStore("hpd-scrub");
const TTL = 30 * 864e5;
export const SCRUB_DEFAULTS = { on: true, litigators: true, federal: true, state: true, other: true };
const STATE = (c) => String(c).replace(/-dnc$/, "").replace(/(^|-)([a-z])/g, (a, b, x) => (b ? " " : "") + x.toUpperCase());

// one number -> { status: good | litigator | federal | state | blocked | error, why, codes, at }
export async function scrub(num, { fresh = false } = {}) {
  const n = String(num || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (n.length !== 10) return { status: "error", why: "That isn't a valid US phone number." };
  if (!fresh) { const c = await kv().get(n, { type: "json" }).catch(() => null); if (c && Date.now() - c.at < TTL) return { ...c, cached: true }; }
  let r, j;
  try {
    r = await fetch(`https://api.blacklistalliance.net/lookup?key=${encodeURIComponent(String(env("BLACKLIST_ALLIANCE_KEY")).trim())}&phone=${n}&ver=v1&resp=json`, { headers: { accept: "application/json" } });
    j = await r.json().catch(() => ({}));
  } catch { return { status: "error", why: "Couldn't reach the DNC scrubbing service." }; }
  if (r.status === 403) return { status: "error", why: "The DNC scrubbing key isn't valid. An admin needs to check BLACKLIST_ALLIANCE_KEY in Cloudflare.", badKey: true };
  if (r.status === 422) return { status: "error", why: "That isn't a valid US phone number." };
  if (!r.ok) return { status: "error", why: "The DNC scrubbing service didn't answer." };
  const msg = String(j.message || ""), codes = (Array.isArray(j.code) ? j.code : String(j.code || "").split(",")).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  let status = "good", why = "";
  if (/^good$/i.test(msg) && !codes.length) status = "good";
  else if (codes.some((c) => /plaintiff|attorney|litig/.test(c))) { status = "litigator"; why = "This number belongs to a known TCPA litigator or their attorney."; }
  else if (/federal/i.test(msg) || codes.includes("federal-dnc")) { status = "federal"; why = "This number is on the National Do Not Call Registry."; }
  else if (/statednc/i.test(msg) || codes.some((c) => /-dnc$/.test(c))) { const st = codes.find((c) => /-dnc$/.test(c) && c !== "federal-dnc"); status = "state"; why = `This number is on the ${st ? STATE(st) + " " : "state "}Do Not Call list.`; }
  else if (/good/i.test(msg)) status = "good";
  else { status = "blocked"; why = /suppress/i.test(msg) ? "This number is on your suppression list." : codes.includes("gov") ? "This is a government number." : "This number is flagged as anti-telemarketing."; }
  const out = { status, why, codes, at: Date.now(), wireless: j.wireless === 1 || j.wireless === "1" };
  await kv().setJSON(n, out).catch(() => {});
  return out;
}
// which results stop a call, given the admin's settings
export function blockWhy(res, s = SCRUB_DEFAULTS) {
  const set = { ...SCRUB_DEFAULTS, ...(s || {}) };
  if (res.status === "litigator" && set.litigators) return res.why;
  if (res.status === "federal" && set.federal) return res.why;
  if (res.status === "state" && set.state) return res.why;
  if (res.status === "blocked" && set.other) return res.why;
  return null;
}
