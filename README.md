# Highpoint Dialer

Highpoint Dialer replaces WAVV inside the Highpoint desk. It runs on your Netlify site and uses Twilio as the phone carrier. You pay Twilio directly, with no per-seat dialer fee.

## What it does

| | WAVV | Highpoint Dialer |
|---|---|---|
| Click-to-call from the browser | ✓ | ✓ (headset or laptop mic, no app) |
| Multi-line power dial | up to 3 | 1–3 lines. The first person to say hello connects instantly, so there's no "hello… hello?" delay. |
| Voicemail drop | ✓ | ✓, with **drop-at-beep**: press it early and it waits for the beep. Power mode can leave your voicemail automatically and keep dialing. |
| Answering-machine detection | ✓ | ✓, done in the background so a live person is never kept waiting |
| Second person answers at once | dropped | Plays a message with Highpoint's name and a call-back number, then "press 9 to opt out" (the FCC abandoned-call rule). Abandon rate is tracked, and lines drop to 1 automatically if an agent goes over the limit. |
| Buy local numbers | ✓ | ✓. Search by area code, state or digits. Agents can buy their own (an admin sets the cap). |
| Local presence | ✓ | ✓. Matches the lead's area code, then state, then a neighbouring state. Agents can borrow team numbers. |
| Spam protection | "healthy numbers" | Daily cap per number, a 14-day warm-up for new numbers, a health score (answer rate, quick hang-ups), one-click "Report spam label" that pauses the number and rotates it out, and a Trust Hub checklist (STIR/SHAKEN A, CNAM, Voice Integrity, free caller registry) |
| Calling-hours protection | ✓ | Uses the lead's local time zone, including split area codes. Built-in state rules (FL, OK, MD 8am–8pm with 3 calls in 24h; TX; LA; AL; MS), editable by admins. |
| Do Not Call | ✓ | Shared team list. Press-9 opt-outs, STOP texts and "Do not call" results are added automatically. |
| Recording | ✓ | Dual-channel recordings. Play them in Analytics. |
| Live transcript | ✗ | ✓ while you talk. Saved to the call, so the desk's call summaries can use it. |
| Inbound calls | ✓ | Callbacks ring the agent who owns the number. Missed calls go to voicemail and then the Inbox. |
| Texting | ✓ | ✓ from the same local number, with a threaded inbox |
| Analytics | basic | Dials, conversations, connect rate, appointments, dials per appointment, talk time, abandon rate, best hour to call (heat map), results breakdown, caller-ID performance, team leaderboard, CSV export |
| Campaigns + lead profile | smart lists + contact page | Each CSV import is a campaign. Pick one and power-dial it; the lead's full profile opens the moment they answer (every CSV column, call history with recordings and transcripts, texts, notes, appointments, script, results), with 1/N arrows through the campaign. |
| Agent status | ReadyMode-style | Status in the top bar (Ready, Wrap-up, Break, Lunch, Meeting, Training, Offline) with a timer. Ready starts dialing and anything else pauses after the current call. It shows who is being dialed in the background, keeps a callback reminder chip (oldest due callback and how overdue it is) and a phone status light, and has a lead search box. Productivity report: time in each status, dials per ready hour, % of ready time talking. Campaign progress report. |
| CRM sync | via integration | Native. Every result updates the lead's stage, notes, call count and call history. |

## Setup (about 30 minutes, once)

### 1. Twilio account (you do this)
1. Sign up at twilio.com and **upgrade from trial**. Trial accounts can only call verified numbers.
2. In the Console home, copy the **Account SID** and **Auth Token**.
3. Voice → Settings → General: turn on **Predictive and Generative AI/ML features** if you want live transcripts.

### 2. Add the files to your Netlify project
Copy these into the repo that builds `lighthearted-zabaione-71331b`:

```
netlify/functions/dialer-*.mjs   → netlify/functions/
netlify/lib/*.mjs                → netlify/lib/
public/hp-dialer.js, hp-dialer.css → your static folder (same place desk-app.js lives)
```

Then:
- Add `"@netlify/blobs": ">=8.2.0"` to `dependencies` in your package.json.
- Apply `patches/desk-app.patch` to `desk-app.js`. It's about 15 lines: it exposes the lead list to the dialer and routes "Start call" and the result buttons through it. If your desk-app.js matches the deployed one, you can copy `public/desk-app.js` over it instead.
- If `netlify.toml` has a catch-all redirect such as `/api/*` → one function, make sure it doesn't swallow `/api/dialer/*`. These functions set their own paths.

Prefer not to do this by hand? Paste `NETLIFY_AGENT_PROMPT.md` into Netlify's agent once these files are in your repo.

### 3. Environment variables
In Netlify, go to Site configuration → Environment variables and add these, then redeploy:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | from step 1 |
| `TWILIO_AUTH_TOKEN` | from step 1 |
| `HP_ADMIN_EMAILS` | comma-separated admin emails, e.g. `you@highpointfinancial.co` |
| `HP_PUBLIC_URL` | your live https address, e.g. `https://desk.highpointfinancial.co` (Twilio sends call events here) |

### 4. Connect
Sign in as an admin and open **Highpoint Dialer**, then press **Connect Twilio**. This creates the API key and the voice app and points every number at your site.

### 5. Numbers
Go to the Numbers tab, search an area code and buy. Start with 2–3 numbers per agent in the area codes you call most. New numbers warm up over 14 days with lower daily caps, which is what keeps them clean.

### 6. Keep numbers off "Spam Likely" (do these in Twilio Trust Hub)
1. **Customer Profile** (business verification). This unlocks **SHAKEN/STIR A-attestation**.
2. **SHAKEN/STIR Trust Product**, with every number added to it.
3. **CNAM** so phones show "HIGHPOINT FIN".
4. **Voice Integrity**, which registers your numbers with the T-Mobile, AT&T and Verizon spam engines.
5. Register numbers free at **freecallerregistry.com** (Hiya, First Orion, TNS).
6. For texting: **A2P 10DLC** brand and campaign registration.

Tick them off in the Numbers tab so the team can see the status.

## Compliance notes (not legal advice)
- Only call leads who gave consent, such as through your lead forms. Scrub against the National DNC, which needs a SAN from the FTC; the internal list here doesn't replace it.
- Florida, California, Pennsylvania, Washington and several other states require **all-party consent to record**. Either turn on "Play 'this call may be recorded'" in Settings or have agents say it in the opener.
- State rules are editable in Inbox → Team dialer settings. Have your compliance advisor confirm them.

## Costs (Twilio, pay as you go)
- About $1.15/month per local number.
- A per-minute voice rate, plus small add-ons for recording, answering-machine detection and transcription.
- See twilio.com/voice/pricing for current rates.

A team of 5 agents doing 300 dials a day each usually lands well under the price of 5 WAVV seats, but check against your own volume.

## How it works (for whoever maintains it)
- `dialer-voice`: TwiML for browser calls (caller-ID pick, compliance checks, recording, transcription, answering-machine detection) and for inbound calls (ring the owner, then voicemail).
- `dialer-power`: multi-line sessions. The agent waits in a private conference. Leads are dialed over REST, and the first answer claims the agent through an atomic write (`onlyIfNew`). Later answers get the compliant message.
- `dialer-events`: call progress, answering-machine results (auto voicemail drop), recordings, live transcript lines.
- `dialer-numbers`, `dialer-vm`, `dialer-calls`, `dialer-sms`, `dialer-setup`, `dialer-token`.
- Data lives in Netlify Blobs (stores named `hpd-*`). Every Twilio webhook is checked against Twilio's signature.
- `public/hp-dialer.js` is the in-desk UI. It runs in **preview mode** with simulated calls when the backend isn't there.
