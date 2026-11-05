# Handover: new resort setup guide and timed recording sessions

**Date:** 5 November 2026
**Repo:** `johng123456/qr-code-directions-app`, merged to `main`
**For:** moving the QR Code Directions system to the Providence Claude environment

This file describes three changes made in November 2026, what has to be done to make them live, and how to reproduce them if the Providence copy of the code is not taken from this repo's `main`.

---

## 1. Summary

| # | Change | Why |
|---|---|---|
| 1 | **New resort setup guide.** Built into the admin area at `/admin/guide` and also available as a Word doc. | Nothing explained how to set up a new resort end to end. Now it's beside the screens it describes, so it can't get lost. |
| 2 | **Calibration step added to the guide** (step 12: test drives with recording on, then reading the results). | Each resort should be checked to make sure "Follow me as I go" is accurate enough before guests use it. |
| 3 | **Recording now runs in timed sessions instead of stopping for good on 31 Dec 2026.** | The fixed date would have stopped calibration for every resort set up after December, and it still let a forgotten switch record guests for weeks. |

---

## 2. Steps to make it live (do these on whichever platform runs production)

1. **Deploy the code** from `main` (Vercel deploys on push if the project is connected).
2. **Apply the database migration** `supabase/migrations/0018_diagnostics_sessions.sql`: Supabase → SQL editor → paste the whole file → Run.
   - It needs `0016` and `0017` to have been applied first. Check with `select 1 from pg_proc where proname = 'route_diagnostics_enabled';`, which should return a row.
   - Order doesn't matter: the app works before and after the migration. Until it's applied, the panel behaves the old way, with the 31 Dec 2026 date.
   - It is safe to run twice.
3. **Check the daily cron** is configured on the deployment (`vercel.json` → `/api/cron/keepalive`, daily at 03:00 UTC). It now also deletes recordings older than 30 days. If `CRON_SECRET` is set, it must also be set on the new platform.
4. **Verify** (about 5 minutes):
   - [ ] The admin header shows **Setup guide**, and `/admin/guide` lists 14 steps.
   - [ ] On any resort page, **Record live directions** shows a "for [4 hours]" picker next to **Start recording**.
   - [ ] Start a 1-hour session. The panel shows "Stops by itself at …" in Perth time. Stop it again.
   - [ ] The panel footnote mentions 12 hours and 30 days, and no longer mentions 31 December 2026.

---

## 3. What changed, file by file

### Setup guide (changes 1 and 2)
| File | What it does |
|---|---|
| `lib/guides/new-resort-setup.json` | **The single source of the guide's wording.** Edit this to change the guide. |
| `app/(admin)/admin/(protected)/guide/page.tsx` | The admin page that displays the JSON. |
| `app/(admin)/admin/(protected)/layout.tsx` | Adds the **Setup guide** link to the admin header. |
| `app/(admin)/admin/(protected)/resorts/page.tsx` and `resorts/[resortId]/page.tsx` | Links to the guide from the resorts list and from each resort's page. |
| `docs/New-Resort-Setup-Guide.docx` | Word copy, generated from the JSON. |
| `scripts/build-setup-guide-docx.cjs` | Regenerates the Word copy: `npm i --no-save docx && node scripts/build-setup-guide-docx.cjs lib/guides/new-resort-setup.json docs/New-Resort-Setup-Guide.docx` |

### Timed recording sessions (change 3)
| File | What it does |
|---|---|
| `supabase/migrations/0018_diagnostics_sessions.sql` | Adds `resorts.record_diagnostics_until`. A trigger defaults it to 4 h, caps it at 12 h, and clears it on stop. The database refuses rows after that time. Drops the fixed-date function `route_diagnostics_open_until()`. |
| `app/(admin)/admin/(protected)/resorts/[resortId]/diagnostics/actions.ts` | **Start recording** sends a length (1–12 h). Falls back to the old behaviour if 0018 isn't applied. |
| `lib/navigation/diagnostics-status.ts` | Reads the switch and the end time. A session past its end time counts as off. |
| `components/admin/diagnostics-panel.tsx` | Length picker, "Stops by itself at …" (Perth time), and new footnote. |
| `app/api/cron/keepalive/route.ts` | Also deletes recordings older than 30 days. |
| `README.md` | "Recording what the receiver saw" section rewritten. |

**Values you might want to change:**

| Setting | Value | Where |
|---|---|---|
| Default session length | 4 hours | `0018` trigger, `actions.ts` (`?? 4`), and the panel (`useState(4)`) |
| Maximum session length | 12 hours | `0018` trigger (the one that matters), the zod `max(12)` in `actions.ts`, and the panel's option list |
| Keep recordings for | 30 days | `DIAGNOSTICS_RETENTION_DAYS` in `app/api/cron/keepalive/route.ts` |
| Time zone for "Stops at" | Australia/Perth | `formatUntil()` in `diagnostics-panel.tsx` |

---

## 4. The recording end date: why it existed, and the options

**Background.** "Record live directions" logs each phone position during "Follow me as I go", so the wrong-turn settings can be tuned against real drives. While it's on, **any guest** using Follow-me at that resort is recorded too (no name, device or IP is stored). Migration `0016` (Sept 2026) therefore added a hard stop: no recording at all after **31 Dec 2026**, so a switch left on by mistake couldn't track guests indefinitely.

**The problem.** Calibration is now a step for every new resort and stage. After 31 Dec, nobody can calibrate without a developer editing the database. Before that date, a forgotten switch still records guests for weeks.

### Option A: timed sessions (BUILT, recommended)
This is what's on `main` now. Every recording session gets its own end time (default 4 h, at most 12 h, enforced by the database). Forgetting to stop costs an afternoon at most, and it works indefinitely with no developer involvement. Old recordings are deleted after 30 days.

**If the Providence copy of the code is NOT taken from this repo's `main`,** ask Claude there to reproduce it:

> Read `docs/HANDOVER-2026-11-setup-guide-and-recording-sessions.md` section 4, Option A, and `supabase/migrations/0018_diagnostics_sessions.sql` from johng123456/qr-code-directions-app. Apply the same change to this codebase: per-session end time on `resorts` (`record_diagnostics_until`), trigger enforcing 4 h default / 12 h max / clear on stop, `route_diagnostics_enabled()` checking the end time instead of the fixed date, drop `route_diagnostics_open_until()`, length picker and "Stops by itself at" on the admin panel, and 30-day deletion in the daily cron. Keep the app working whether or not the migration has been applied yet.

### Option B: just move the date (stop-gap only)
If you need recording after 31 Dec 2026 and can't deploy Option A in time, run this in the Supabase SQL editor **instead of 0018** (not as well as):

```sql
create or replace function public.route_diagnostics_open_until()
returns timestamptz language sql immutable
as $$ select timestamptz '2027-06-30 23:59:59+08' $$;
```

This only moves the problem along. A forgotten switch can again record guests until the new date. Prefer Option A.

### Option C: remove the end date entirely (not recommended)
This depends entirely on someone remembering to switch recording off, which is the failure the date was there to prevent. Listed for completeness only.

---

## 5. Known caveats and open items

- **Wrong-turn settings are shared by every resort** and live in code (`lib/navigation/live-route.ts`: 20 m off the line, 3 readings in a row). Calibration measures whether they suit a resort; it doesn't change them. If resorts turn out to need different settings, making them per-resort is the next build.
- **The pass marks in the guide's "Reading the results" are a rule of thumb**, based on the app's own thresholds. Revise them once real drives exist.
- **Privacy:** guests are recorded during an active session. Consider a line in each resort's privacy notice.
- **The guide was written from the code, not from a live walkthrough.** Have the next person who sets up a resort follow it word for word and note anything unclear.
- **Existing wording mismatch (not changed):** the "Master plan on the visitor page" panel says the plan shows "over the satellite view". Visitors actually see only the plan, with no satellite imagery under it.
- The README's example recording queries aren't filtered by resort. The query in the guide (step 12) is.
- Migration `0018` was tested on a scratch Postgres 16 after `0016`/`0017`: default, clamp, expiry, stop, unrelated saves, function dropped, re-run. **It has not yet been run against the live Supabase database.**
