Paste this into Netlify's agent after the `highpoint-dialer` files are committed to the repo (folder `highpoint-dialer/`):

---

Integrate the Highpoint Dialer that's in the `highpoint-dialer/` folder of this repo into the site. Don't redesign anything.

1. Copy `highpoint-dialer/netlify/functions/dialer-*.mjs` into `netlify/functions/`, and `highpoint-dialer/netlify/lib/*.mjs` into `netlify/lib/`. Keep the relative imports (`../lib/hp.mjs`, `../lib/calls.mjs`) working.
2. Copy `highpoint-dialer/public/hp-dialer.js`, `hp-dialer.css` and `spotify-dock.js` into the same static folder that serves `/desk-app.js`, so they're served at `/hp-dialer.js` and `/hp-dialer.css`.
3. Add `"@netlify/blobs": ">=8.2.0"` to package.json dependencies.
4. Apply the edits in `highpoint-dialer/patches/desk-app.patch` to the site's `desk-app.js`. If hunks don't apply cleanly because the file changed, make the same changes by hand:
   - expose `window.hpDesk` (leads, dialQueue, fullName, normPhone, fmtPhone, toast, patchLead, renderDialer, openDrawer, currentId, setCurrent, callStart, callStop, autoLog, calls, appts, putAppt, addNoteObj, stageName, STAGES, PROD, go, dispoDirect) right before the quoting-engines section
   - in `buildRecords()` (CSV import), keep every column that isn't mapped to a CRM field in `lead.fields[columnHeader]` instead of dropping it
   - route the `#dcStart` button through `window.hpDialer.dialLead(l)` when `window.hpDialer.ready`
   - in `dispo()`, call `window.hpDialer?.onDispo(l.id,lab,note)` and spread `window.hpDialer?.meta(l.id)` into the `logCall` payload
   - dispatch `hp:leadchange` at the end of `renderDialer()`
   - load `/hp-dialer.css` and `/hp-dialer.js` once from desk-app.js
5. Rename the remaining visible "WAVV dialer" labels (sidebar nav, landing page tile "WAVV dialer / Power-dial your pipeline", crumb) to "Highpoint Dialer". Leave the WAVV sync code in place; the dialer hides it once Twilio is connected.
6. Make sure no redirect in netlify.toml or _redirects catches `/api/dialer/*`. The new functions declare their own `config.path`.
7. Don't add or change any environment variables; the owner sets TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, HP_ADMIN_EMAILS and HP_PUBLIC_URL.
8. Build and confirm `/api/dialer/setup` returns 401 when signed out (not 404).
