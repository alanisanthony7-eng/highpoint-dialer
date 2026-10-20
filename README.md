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
| `public/hp-pop.js` | Call tools: the script, the quoter and the live call in one side panel on the right (Alt+S, Alt+Q, Alt+L). The page makes room for it; tools stack with draggable dividers, and any tool can pop out into its own window or stay on top of other apps (Chrome and Edge). They follow the client on the call: the script fills in names and the quoter's prices and tracks where you are, and the quoter fills itself from what the client says once they agree to recording. With a profile open, the call controls become a slim bar along its bottom. |
| `functions/api/[[path]].js` | One entry point for every `/api/*` request |
| `src/lib/auth.mjs` | Highpoint accounts: email + password, 30-day sessions, admin emails, team code |
| `src/desk.mjs` | Leads, appointments and call logs (private per login); crew cards and settings (shared); lobby presence; Highpoint Bot |
| `src/dialer/*` | The Twilio dialer: browser phone, 1–3 line power dial, local numbers, voicemail drop, recordings, live transcripts, analytics, texting, DNC |
| `src/lib/store.mjs` | Key/value storage with safe concurrent writes, on D1 |
| `src/lib/team.mjs` | Plans, Stripe billing, early access, invite links and the admin Team panel's API |
| `src/lib/spotify.mjs` | Spotify per agent: each login connects its own Spotify account |
| `test/cf-sim.mjs`, `test/billing.mjs` | End-to-end checks run locally (`npm test`) |

## Local development

Use Node 22 or newer (`node:sqlite` is required), then:

```powershell
npm install
npx playwright install chromium
npm run local
```

The desk prints its local URL. It starts at port 8788 and automatically tries the next free port; set `PORT` to require a specific one. Local data is stored in `.local/highpoint.sqlite` and survives restarts. To start an empty database with the development login `boss@hp.com` / `password2`, run `npm run local:demo`. The seed is local-only and never runs in Cloudflare.

Spotify and Stripe stay in the desk (Music in the top bar, Billing under Account). They only connect when the matching keys are in the environment you start `npm run local` from: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `STRIPE_SECRET_KEY`. Without those keys, Music and Billing still open, but they show as not set up. On Cloudflare, add the same names as Pages secrets and redeploy. `/api/health` reports `spotify` and `stripe` as true once they are present.

Delete `.local/highpoint.sqlite` (and its `-wal`/`-shm` companions) to reset local data. Run `npm test` for the fast API suite, `npm run test:smoke` for the real Chromium sign-in/navigation checks, or `npm run test:all` for both. Browser smoke tests use a disposable database and never touch your local account.

### Appearance

Use **Account → Appearance** to switch instantly between Midnight (default), Modern Light, Miami and Halloween. Executive is the owner look and only appears for admins. The choice is saved in the browser and restored before the desk renders. For previews and screenshot automation, append `?theme=midnight`, `?theme=modern-light`, `?theme=miami`, `?theme=halloween` or `?theme=executive` to the local URL.

Run `npm run test:themes` to verify every theme at desktop and mobile sizes and write screenshots to `test/artifacts/`.

Locally, put Cloudflare-style keys in `.dev.vars` (same names as Pages secrets). `npm run local` loads that file automatically. On the machine where Wrangler is signed in, `npx wrangler pages secret list --project-name highpoint-dialer` lists the live secret names.

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
| `ANTHROPIC_API_KEY` | *(optional, unused on the live site)* old Claude fallback. Highpoint Bot now uses Cloudflare Workers AI |
| `STRIPE_SECRET_KEY` | *(optional)* turns on paid plans (see Plans and billing) |
| `RESEND_API_KEY`, `HP_EMAIL_FROM` | *(optional)* emails: forgot-password links and invites (see Email) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | *(optional)* lets each agent connect their own Spotify (see Spotify) |

6. **Redeploy.** Go to **Deployments → ⋯ on the latest → Retry deployment** so the settings take effect.
7. **Open your site, then click Create account.** Use the admin email. Admin emails don't need the team code.
8. **Turn on the dialer.** Open Highpoint Dialer and press **Connect Twilio**, then buy numbers in **Number groups**.

The database tables are created automatically on the first visit.

## Agents
Agents open the site, click **Create account**, and enter the team code. Each login sees only its own leads.

With email set up (below), agents reset their own password from **Forgot your password?** on the sign-in screen. Without it, an admin can reset a password by signing in and running this in the browser console:

```
fetch('/api/auth/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'agent@x.com'})}).then(r=>r.json()).then(console.log)
```

That returns a temporary password to give the agent.

## Do Not Call and litigator scrubbing
Before every call, the dialer can check the number against the National Do Not Call Registry, state DNC lists and known TCPA litigators, through The Blacklist Alliance.
1. Open an account at The Blacklist Alliance. For National DNC results, the account also needs your FTC Subscription Account Number (SAN) on file.
2. Add the API key in Cloudflare as the secret `BLACKLIST_ALLIANCE_KEY`, then redeploy.
3. Pick what to block in **Highpoint Dialer → Do not call**.
- Each number's result is saved for 30 days, so repeat checks cost nothing. The National DNC has to be rechecked at least every 31 days.
- New imports are checked automatically, and **Scrub all my leads** checks the whole book. Flagged leads are skipped by the dialer and marked on their profile.
- If the check can't run, the call doesn't go through. Your own Do Not Call list, calling hours and the 24-hour attempt cap still apply on top.
- This isn't legal advice. Whether consented leads may be called despite the National DNC is a question for your compliance advisor.

## Automatic text follow-ups
Each agent can turn these on in **Highpoint Dialer → Inbox & settings → Automatic texts** and edit the wording:
- After a no-answer or voicemail, a text a few minutes later (10 by default) and another at 9:30 the next morning, in the client's time zone. Each client gets this at most once a day.
- Appointment reminders, the day before and an hour before.
- Texts go out from the agent's local number. They only send during the client's calling hours, never to Do Not Call or flagged numbers, and "Reply STOP to opt out." is added to every one. They're skipped when the client texts back, is reached on a later call, or the appointment moves.
- Texts work on Twilio or Telnyx. Your business needs A2P 10DLC registration with that provider, or US carriers block business texts.
- Scheduled texts send while anyone has the desk open. To send them on time overnight too, add a secret `HP_CRON_SECRET` in Cloudflare. Then have a free cron service (for example cron-job.org) call `https://highpoint-dialer.pages.dev/api/cron?key=YOUR_SECRET` every 5 minutes.

## Lead posting URLs (real-time leads from vendors)

On **Import leads**, each agent can make a secret posting URL per lead vendor (or for their own website form) and send it to the vendor with **Copy setup for the vendor**. Leads posted there land in that agent's CRM within seconds:

- JSON (one lead, an array, or `{"leads": [...]}`, up to 100 per request), form posts, XML, or a GET with a query string. Common field names (`first_name`, `phone_number`, `cell`, `dob`, `zip`...) are matched automatically; anything else is kept on the lead under **From the lead form**.
- TrustedForm certificate, Jornaya LeadiD, consent language and IP address are saved with the lead.
- A lead whose phone is already in the CRM isn't added twice; it's reported to the vendor as `duplicate` and a note goes on the existing client.
- With scrubbing on, every posted number is checked against the National DNC, state DNC and litigator lists on arrival and flagged so it can't be dialed.
- Admins can make team URLs that hand leads out round robin between the agents they pick.
- Agents can turn on a **New lead** automatic text (Highpoint Dialer → Inbox & settings → Automatic texts) that goes out right away. Only use it for vendors that collect consent to text.
- Each URL takes up to 600 leads an hour. **New secret URL** replaces a leaked URL; the old one stops working at once.

## Booking link and Google Calendar

On **Calendar**, each agent has a booking link (`/book/their-name`) to send clients in a text, email or voicemail. Clients pick an open time on a simple page made for phones, enter their details and agree to be called, and get a confirmation with add-to-calendar buttons and a cancel link.

- Open times come from the agent's weekly hours, call length, break between calls, earliest booking and how far ahead to show, minus their desk appointments.
- **Busy times from Google Calendar:** paste the calendar's *Secret address in iCal format* (Google Calendar → Settings → your calendar → Integrate calendar). Busy events (including repeating ones) are blocked; event details are never shown. Outlook and Apple calendar links work too.
- A booking adds the client to the CRM (or updates them if their number is already there) in the Appointment stage with their consent recorded, puts the call on the desk calendar, emails the client and the agent (with `RESEND_API_KEY`), and schedules the reminder texts if those are on.
- **Desk appointments in Google Calendar:** *Make my calendar link* gives a private `.ics` link of appointments and callbacks. In Google Calendar choose **Other calendars → + → From URL**. Google refreshes subscribed calendars every few hours.

## Email
Password reset links and emailed invites go through Resend (resend.com, free for small volumes).
1. Create a Resend account and add your domain (for example highpointfinancial.co) under **Domains**, then add the DNS records it shows.
2. Create an API key and add it in Cloudflare as the secret `RESEND_API_KEY`.
3. Add `HP_EMAIL_FROM`, for example `Highpoint Desk <desk@highpointfinancial.co>`, then redeploy.
Until the domain is verified, Resend only delivers to the email you signed up to Resend with.

## Security
- **Two-step verification:** each agent can turn it on in **Account menu → Security** using an authenticator app. They get 10 one-time recovery codes. If an agent loses their phone, an admin can turn it off for them in **Team → Agents**.
- Signing in with two-step on takes the password plus a 6-digit code. Each code works once, and five wrong tries means starting the sign-in over.

## Plans and billing
| Plan | Price | Includes |
|---|---|---|
| Early Access | $40/mo | Everything, while early access is open |
| Base | $50/mo | CRM (with calendar and lead import), client list, quoter, health screener, call scripts |
| Pro | $75/mo | Base, plus Highpoint Bot and the IUL illustrator |
| Full Access | $150/mo | Everything: the dialer, live transcripts and Copilot, crew lobby and games, Spotify |

- Admins change prices, what Base and Pro include, the free trial, and early access in **Team → Plans and billing**. The site and the server both enforce each plan.
- To charge: in Stripe, go to **Developers → API keys** and copy the secret key. Add it in Cloudflare as the secret `STRIPE_SECRET_KEY`, redeploy, then turn on **Require payment**. The site creates the products, prices and payment webhook in Stripe on the first checkout.
- Agents pick a plan at checkout and switch plans in **Billing**. Stripe prorates the difference. **Manage card and invoices** opens Stripe's portal.
- **End early access** stops new Early Access sign-ups. It moves early members to the plan you pick from their next renewal, or lets them keep $40.
- Until payment is required, agents get whatever plan their admin sets. Everyone starts on Full Access, so nobody loses anything.
- **Dialer minutes:** Full Access includes 2,000 a month and Early Access 1,000. Admins can change this, and a blank means no limit. A minute is counted for each connected call, rounded up. Agents see their minutes on the dialer and in Billing. When the minutes run out, dialing stops until the month resets, unless **Bill extra minutes** is on. Then Stripe charges each extra minute on the agent's next bill, through a usage meter the site creates for you. Limits only apply once payment is required. Admins and agents with free access are never limited.

## Spotify
Each agent connects their own Spotify account to their login. With Spotify Premium, music plays inside the desk: their playlists, controls, and a pause when a call starts. Spotify Free accounts and agents who haven't connected get Spotify's embedded player.

Setup, once:
1. At developer.spotify.com, create an app. The app's owner needs Premium.
2. Add the redirect URI `https://highpoint-dialer.pages.dev/api/spotify/callback` and select **Web API** and **Web Playback SDK**.
3. Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in Cloudflare as secrets, then redeploy.
4. Spotify keeps new apps in development mode, which allows only a few people (5 per app for apps made after February 2026). Add each agent's Spotify email under the app's **User Management**.

## Free-plan limits (Cloudflare, as of 2025; check their pricing page)
- Pages Functions: 100,000 requests a day.
- D1: 5 million reads and 100,000 writes a day, and 5 GB of storage.

A small agency stays well inside these.

## Production checks, logs and backups

- Open `/api/health` after each deploy. `ok: true` and `db: "ok"` mean D1 answered a query. The other booleans only report whether optional service settings are present; they never expose secrets.
- Read server errors in Cloudflare **Workers & Pages → highpoint-dialer → Logs**. API failures include the method, route and status without request bodies or credentials.
- Before schema or billing changes, export D1:

```powershell
npx wrangler d1 export highpoint --remote --output backup-YYYY-MM-DD.sql
```

- Keep exports encrypted and access-controlled because they contain client and account data. Cloudflare secrets are not stored in D1; keep a separate inventory of required secret names.
- To restore after a database loss, create a new D1 database, import the reviewed SQL export with Wrangler, update `database_id` in `wrangler.toml`, and redeploy. Test that process against a non-production database first.

## Moving leads over
Leads saved in the old Netlify site can't be read while that account is paused. Re-import your CSVs in **Import leads**. Every column in a CSV is kept on the lead's profile.

## Compliance notes (not legal advice)
- Only call leads who gave consent, and scrub against the National DNC.
- Florida and several other states require all-party consent to record. Turn on the recording notice in dialer settings, or have agents say it.
- Recording consent: the Highpoint Copilot does nothing with a call until the agent taps **Client agreed** after the disclosure. Each agreement is logged on the call. **Client declined** (or *withdrew consent* during the call) stops recording at Twilio, deletes what was captured, and sets the call to no transcript.
- Sensitive numbers (SSN, bank routing and account, card, Medicare ID, numbers spoken as words) are hidden in transcripts, call notes and anything sent to Highpoint Bot. The same rules run on the server (`src/lib/redact.mjs`) and in the browser (`public/hp-copilot.js`).
- Browser-line calls and "My phone" calls run the same Do Not Call, calling-hours and 24-hour attempt checks as the voice webhook (`/calls/check`). If the check can't run, the call doesn't go through.
- Copilot flags phrases for the agent to double-check before saving: government affiliation, guarantees, pressure, guaranteed returns, free/no-cost claims, replacing a policy, and requests for SSN or bank numbers. Flags never block a call.
- A value already on file is never replaced by a guess. Every change Copilot saves is written to the client's audit trail with its source.
- Not solved in code: whether the disclosure wording and all-party-consent handling are right for each state (get legal review), recording terms in your carrier and phone contracts, data-retention agreements with the transcription and AI vendors, and HIPAA/GLBA obligations for health and financial details.
- Calls to your own cell: save your cell number in Phone settings. The desk rings your cell first, and when you answer it connects the lead inside the same recorded call, with the same recording notice and transcription as browser calls. Cell calls work on Twilio numbers only for now; on Telnyx, "My phone" opens your computer's phone app and the call isn't recorded. Without a saved number, "My phone" opens your computer's phone app, and the dialer says that call isn't recorded. Calls not placed through the desk can't be recorded.
