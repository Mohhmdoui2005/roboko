# Roboko Tournament Platform

Event operations for a robotics tournament: qualification rounds, knockout bracket,
jury scoring, test-room sessions, lunch claims, and a public live display — one
Next.js app backed by Supabase (Postgres + Auth + Realtime).

```
roboko/
├── tournament-app/     # the Next.js application (this is the project)
│   ├── src/app/        # routes per role: admin, orga, jury, participant, live
│   ├── src/components/ # shared UI (scanner, countdown, bracket, sync badge)
│   ├── src/lib/        # supabase clients, offline queue, QR, theme
│   ├── scripts/        # SQL migrations (run in order) + verify/seed scripts
│   ├── worker/         # service-worker background-sync hook
│   └── design.md       # locked design system (Terminal + Ember themes)
```

## Roles

| Route | Role | What they do |
|---|---|---|
| `/admin/*` | ADMIN | Command center: teams, Phase 1, knockout, leaderboard, lunch, QR codes, test room, users, theme switcher |
| `/orga/*` | ORGA | Field stations: lunch-badge scanner, robot test-session scanner |
| `/jury` | JURY | Arena scoring console (locked to their assigned arena) |
| `/participant` | PARTICIPANT | Test-session countdown, team testing QR, GET READY alerts |
| `/live`, `/bracket` | public | Venue display: standings or bracket, realtime, no login |

Auth is Supabase Auth; the role lives in `app_metadata.role` (JWT claim, no DB
lookup). `src/middleware.ts` gates every route by role.

## Tournament flow

1. **Phase 1 — qualification.** `generate_phase1_matches()` builds floor(3N/2)
   matches from the current roster (circle method: 3 opponents each across
   3 subphases × 4 arenas; odd N → one team plays 2, optimal). D-day no-shows:
   delete absent teams first, then regenerate — every match stays
   present-vs-present, zero walkovers. Admin publishes matches; jury scores
   max 3 rounds (`submit_match_round` — round 3 always finishes: most wins
   or draw, nulls allowed throughout).
2. **Warnings.** 3 warnings per team **per round** — the 3rd auto-forfeits the
   current round server-side. Counters reset every recorded round. Jury can
   also remove warnings (a recorded forfeit stands).
3. **Knockout.** Top-16 seeds → shuffled → published 15-match bracket
   (R16 → QF → SF → Final → Champion). Knockout keeps the decisive round 4
   (win/loss only, all-null rounds 1–3 unlock it) so the bracket always gets
   a winner. Winners advance automatically via
   trigger; `knockout_live` flips the venue screen.
4. **Test room.** Orga scans a robot's `ROBOT_TEST` QR → 5-minute session in the
   least-loaded of Test 1–8. Quota: **2 sessions per team, lifetime** — the 3rd
   scan is rejected with an exhausted message. Replays dedupe; double-scans
   never double-book.
5. **Lunch.** Badges are HMAC-signed `PERSON_LUNCH` payloads. Admin sets the
   start time + broadcasts; orga scans claim exactly once per person
   (replays return the original timestamp).
6. **Live display.** Leaderboard or bracket with exactly 2 Realtime channels,
   render-dedupe via visible signature, 30 s poll fallback, Wake Lock.

## Offline-first

Jury scoring, warnings, and lunch claims go through an IndexedDB mutation
queue (`src/lib/queuedRpc.ts`): attempt now when online, enqueue with the same
`request_id` on failure, replay oldest-first on reconnect. Every critical RPC
dedupes on `p_request_id`, so retries are at-most-once by construction.
`SyncBadge` shows pending counts with a manual Retry fallback (iOS has no
Background Sync).

## Themes

Two switchable themes, one tap, persisted per browser: **Terminal**
(dark ops-console, default) and **Ember** (daylight pit-lane custom theme).
Admin gets a segmented switcher; every other role gets a compact switcher in
the top bar. System documented in `tournament-app/design.md`.

## Getting started

```bash
cd tournament-app
npm install
npm run dev        # http://localhost:3000
```

Copy `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `QR_SECRET_KEY`.

## Database setup (Supabase SQL editor, in order)

1. `scripts/phase1_setup.sql` — core schema + jury RPCs
2. `scripts/generate_phase1_matches.sql` — generator + leaderboard
3. `scripts/lunch_setup.sql` — lunch claims + broadcast
4. `scripts/knockout_setup.sql` — bracket engine
5. `scripts/offline_setup.sql` — `request_id` idempotency ledger
6. `scripts/warning_update.sql` — decrement + 3-warning forfeit + per-round reset
7. `scripts/testing_setup.sql` — test-room table + session RPCs
8. `scripts/add_qr_columns.sql` then `node scripts/generate_qrs.js` — QR payloads

Seed staff logins: `node scripts/seed_test_accounts.js`
(`admin@` / `orga@` / `jury@` / `participant@test.com`, password `Roboko123!`).

Verify (self-cleaning, safe to run): `verify_phase1_matches.js`,
`verify_knockout.js`, `verify_lunch.js`, `verify_offline.js`,
`verify_warnings.js`, `verify_testing.js`, `verify_rls.js`.

## Tech

Next.js 16 (App Router) · React 19 · Supabase · TanStack Query · `idb` ·
`html5-qrcode` / `qrcode.react` · Tailwind v4 · PWA (Workbox).
