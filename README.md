# Highpoint Desk + Highpoint Dialer (Cloudflare)

Your CRM desk and the Highpoint Dialer, running on Cloudflare Pages' free plan:
- Pages serves the site.
- Pages Functions run the backend.
- A D1 database stores everything.

Twilio carries the calls.

## What's in here

| Path | What it is |
|---|---|
| `public/` | The desk (index.html, desk-app.js), the dialer (hp-dialer.js/.css), the Spotify player, and `boot.js` (sign-in screen + data layer) |
| `functions/api/[[path]].js` | One entry point for every `/api/*` request |
| `src/lib/auth.mjs` | Highpoint accounts: email + password, 30-day sessions, admin emails, team code |
| `src/desk.mjs` | Leads, appointments and call logs (private per login); crew cards and settings (shared); lobby presence; Highpoint Bot |
| `src/dialer/*` | The Twilio dialer: browser phone, 1–3 line power dial, local numbers, voicemail drop, recordings, live transcripts, analytics, texting, DNC |
| `src/lib/store.mjs` | Key/value storage with safe concurrent writes, on D1 |
| `test/cf-sim.mjs` | 30 end-to-end checks run locally (`npm test`) |

## One-time setup (about 10 minutes, free)

1. **Create a Cloudflare account** at dash.cloudflare.com/sign-up. The free plan is enough.
2. **Create the database.** Go to **Storage & Databases → D1 SQL Database → Create**. Name it `highpoint` and leave the rest as is.
3. **Create the site.**
   - Go to **Workers & Pages → Create → Pages → Connect to Git → GitHub** and pick `alanisanthony7-eng/highpoint-dialer`.
   - Framework preset: **None**. Build command: *(leave empty)*. Build output directory: `public`.
   - Click **Save and Deploy**.
4. **Connect the database to the site.** Copy the D1 database's **Database ID** (on its page in Cloudflare) and paste it into `wrangler.toml` in this repo, or send it to Claude to do it. This file controls the site's database connection, so the dashboard's Bindings page is read-only.
5. **Add settings.** In the Pages project, go to **Settings → Variables and secrets → Add** and choose type **Secret** for each one:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | from the Twilio console |
| `TWILIO_AUTH_TOKEN` | from the Twilio console |
| `HP_ADMIN_EMAILS` | your email (comma-separate more admins) |
| `HP_INVITE_CODE` | a team code agents type when they create an account, e.g. `HIGHPOINT2026` |
| `HP_PUBLIC_URL` | your site address, e.g. `https://highpoint-dialer.pages.dev` |
| `ANTHROPIC_API_KEY` | *(optional)* turns on Highpoint Bot and call summaries |

6. **Redeploy.** Go to **Deployments → ⋯ on the latest → Retry deployment** so the settings take effect.
7. **Open your site, then click Create account.** Use the admin email. Admin emails don't need the team code.
8. **Turn on the dialer.** Open Highpoint Dialer and press **Connect Twilio**, then buy numbers in **Number groups**.

The database tables are created automatically on the first visit.

## Agents
Agents open the site, click **Create account**, and enter the team code. Each login sees only its own leads.

If someone forgets their password, an admin can reset it by signing in and running this in the browser console:

```
fetch('/api/auth/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'agent@x.com'})}).then(r=>r.json()).then(console.log)
```

That returns a temporary password to give the agent.

## Free-plan limits (Cloudflare, as of 2025; check their pricing page)
- Pages Functions: 100,000 requests a day.
- D1: 5 million reads and 100,000 writes a day, and 5 GB of storage.

A small agency stays well inside these.

## Moving leads over
Leads saved in the old Netlify site can't be read while that account is paused. Re-import your CSVs in **Import leads**. Every column in a CSV is kept on the lead's profile.

## Compliance notes (not legal advice)
- Only call leads who gave consent, and scrub against the National DNC.
- Florida and several other states require all-party consent to record. Turn on the recording notice in dialer settings, or have agents say it.
