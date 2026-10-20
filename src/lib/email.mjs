// Email through Resend (https://resend.com). Off until RESEND_API_KEY is set; HP_EMAIL_FROM picks the sender
// (a domain verified in Resend, e.g. "Highpoint Desk <desk@highpointfinancial.co>").
const env = (k, d = "") => globalThis.__ENV?.[k] ?? d;
export const emailOn = () => !!String(env("RESEND_API_KEY") || "").trim();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// A plain, branded email: a heading, a few paragraphs, one button.
export function layout({ title, paras = [], button, after = [] }) {
  const p = (t) => `<p style="margin:0 0 14px;font:15px/1.55 -apple-system,Segoe UI,Arial,sans-serif;color:#2b3445">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f9;padding:28px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
  <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:14px;border:1px solid #e3e7ef" cellpadding="0" cellspacing="0">
  <tr><td style="padding:22px 28px 6px;font:800 13px/1 -apple-system,Segoe UI,Arial,sans-serif;letter-spacing:.18em;color:#1d3a73">HIGHPOINT FINANCIAL</td></tr>
  <tr><td style="padding:10px 28px 8px"><h1 style="margin:0 0 14px;font:700 21px/1.3 -apple-system,Segoe UI,Arial,sans-serif;color:#0f1a2e">${esc(title)}</h1>
  ${paras.map(p).join("")}
  ${button ? `<p style="margin:20px 0 22px"><a href="${esc(button.url)}" style="display:inline-block;background:#2f5296;color:#fff;text-decoration:none;font:700 15px -apple-system,Segoe UI,Arial,sans-serif;padding:12px 22px;border-radius:10px">${esc(button.label)}</a></p>` : ""}
  ${after.map((t) => `<p style="margin:0 0 10px;font:13px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#6b7486">${t}</p>`).join("")}
  </td></tr><tr><td style="padding:12px 28px 22px;font:12px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#97a0b1">Highpoint Desk · Sent because of activity on your account.</td></tr></table>
  </td></tr></table></body></html>`;
  const text = [title, "", ...paras.map((t) => t.replace(/<[^>]+>/g, "")), button ? `${button.label}: ${button.url}` : "", ...after.map((t) => t.replace(/<[^>]+>/g, ""))].filter((x) => x !== undefined).join("\n");
  return { html, text };
}

export async function sendEmail({ to, subject, html, text }) {
  const key = String(env("RESEND_API_KEY") || "").trim();
  if (!key) return { ok: false, skipped: true };
  const from = String(env("HP_EMAIL_FROM") || "").trim() || "Highpoint Desk <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, text }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("email failed", r.status, j?.message || j); return { ok: false, error: j?.message || "Email failed" }; }
    return { ok: true, id: j.id };
  } catch (e) { console.error("email failed", e); return { ok: false, error: e.message }; }
}
