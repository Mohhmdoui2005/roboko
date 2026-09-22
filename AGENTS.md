<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Roboko Tournament — agent guide

Next.js 16 (webpack build) + React 19 + Supabase (`@supabase/ssr`, `@supabase/supabase-js`)
+ TanStack Query 5 + Tailwind v4 + `next-pwa`. App lives in `tournament-app/`
(`npm run dev|build|start|lint` from there; dev binds `0.0.0.0`).

## Roles / auth (JWT claims, no DB fetch)
- Roles: `ADMIN | ORGA | JURY | PARTICIPANT`, stored in `user.app_metadata.role`
  (+ `assigned_arena`, `team_id`). `AuthProvider` (`src/components/AuthProvider.tsx`)
  reads claims only; `/` (`src/app/page.tsx`) redirects by role.
- `src/middleware.ts`: public = `/`, `/live`, `/login`, `/api/*`, assets.
  Uses `getSession()` (cookie JWT parse, no DB). `/admin` → ADMIN,
  `/orga` → ORGA|ADMIN, `/jury` → JURY|ADMIN (+ORGA tolerated in UI guard),
  `/participant` → PARTICIPANT|ADMIN.
- `/api/admin/*` guarded by `requireAdmin()` (`src/lib/adminAuth.ts`): Bearer token
  → `getUser(token)` → must be ADMIN → service-role client. Client side always
  sends a fresh token via `adminFetch()` (`src/lib/adminApi.ts`, refreshes when
  expiring < 60 s, retries once on 401).

## Routes
- Public/venue: `/live` (stat-led leaderboard/bracket, wake-lock), `/bracket`
  (static wrapper over `BracketViz`), `/login`, `/style-guide`.
- `/admin/*`: `page.tsx` (command center), `teams`, `phase1` (generate 54 qual
  matches + publish), `knockout` (top-16 seeds → `bracket_nodes`), `leaderboard`,
  `lunch`, `qr-codes`, `testing`, `users`. Layout: `src/app/admin/layout.tsx`.
- `/orga/*`: portal + `lunch` + `testing` QR scanner stations.
- `/jury/page.tsx`: per-arena scoring console. `/participant/page.tsx`: profile +
  test-session countdown + team `ROBOT_TEST` QR. APIs: `/api/admin/users`,
  `/api/admin/create-team-accounts`.

## Tournament logic (server is source of truth)
- Phase 1 qual: best-of-4 rounds. Rounds 1–3 allow `win/loss` (`1/0`) or
  `null/null`; round 4 is decisive win/loss only (server-enforced in
  `scripts/phase1_setup.sql:submit_match_round`). Round 4 unlocks when rounds
  1–3 are all `null/null`. First to 2 round-wins completes the match
  (`COMPLETED` + `winner_id`); `current_round` auto-advances server-side —
  **never compute it client-side**.
- Warnings: `increment_warning` / `decrement_warning` per team per match, 3rd
  warning forfeits the current round (see `scripts/warning_update.sql`).
- Knockout: `tournament_state.knockout_live` flips `/live` from leaderboard to
  `BracketSvg`; advancement via `bracket_nodes.next_node_id`.
- Notifications: `notify_next_match_on_round2()` trigger notifies the next arena
  match's teams (`GET_READY`). Jury polls arena notifs every 5 s; participants
  poll team notifs every 10 s.
- Key RPCs: `submit_match_round`, `increment_warning`, `decrement_warning`,
  `get_phase1_leaderboard`, `get_lunch_claim_count`, `get_active_sessions`,
  `get_my_active_session`, `get_server_time`. SQL setup order:
  `phase1_setup.sql` → `generate_phase1_matches.sql` (+ `knockout_setup.sql`,
  `lunch_setup.sql`, `offline_setup.sql`, `testing_setup.sql`); verify with
  `scripts/verify_*.js`, `seed_test_accounts.js`, `generate_qrs.js`.

## Offline-first mutations (must preserve this contract)
- `src/lib/mutationQueue.ts` (IndexedDB `tournament-mutations`, `request_id`
  key, oldest-first replay, max 5 attempts) → `src/lib/queuedRpc.ts` →
  `useQueuedRpc`/`useSyncEngine` (`src/lib/useQueuedRpc.ts`) → `SyncBadge`
  (`src/components/SyncBadge.tsx`) + service-worker fan-out (`worker/index.js`,
  `public/sw.js`).
- Rules: every mutation generates one `request_id` per attempt and reuses it on
  replay; server dedupes (`already_processed`/`duplicate` = success, treat as
  `sent`). `toWirePayload()` maps bare `request_id` → `p_request_id` (PostgREST
  needs the `p_` prefix — sending bare `request_id` breaks with PGRST202).
  Network failure → enqueue + optimistic success; server rejection → rollback
  (registered per `request_id`, must never throw). `SyncBadge` pending count +
  manual Retry is the iOS fallback (no Background Sync there).
- PWA (`next.config.mjs`): `reloadOnOnline: false` (never yank scoring state);
  precache only `/login` + `/live`; Supabase REST GETs network-first (5 min),
  POSTs never cached.

## Realtime vs polling (do not "unify")
- Jury: exactly one arena-filtered `matches` channel (`arena_id=eq.<arena>`).
- Live (`src/app/live/page.tsx`): exactly two channels (`matches` visible-status
  filter + `bracket_nodes`), 500 ms debounce, `visibleSignature()`
  (`src/lib/liveSig.ts` — pure, Node-importable) gates renders; 30 s poll only
  when a channel drops; tab-visible refresh; Wake Lock best-effort.
- Participant/orga/jury-notifs: polling only (5–10 s), no realtime.
- Keep all hooks above early-return guards in client pages (React hook-order
  crash otherwise — see note in `jury/page.tsx`).

## QR codes (`src/lib/qr.ts`)
- Two domains only: `ROBOT_TEST {robot_id}` and `PERSON_LUNCH {user_id, sig}`
  (HMAC-SHA256 over canonical JSON with server secret). Parse with
  `parseQRScanPayload()` / `processScannedCode()`; never accept unknown domains.

## Design system (read `design.md` before emitting UI)
- Tokens in `globals.css` (+ `tokens.css`): `var(--color-bg/surface/raised/
  border/accent/accent-text/text-primary/secondary/tertiary/success/warning/
  danger/info)`, paper/ink/rule aliases, `var(--font-display/body/mono)`,
  48 px touch targets, `.btn/.card/.badge/.ds-table/.surface-grid` grammar.
  **Never hard-code hex in components.**
- Themes: Terminal (default `:root`) + Ember (`[data-theme="ember"]`), via
  `src/lib/theme.ts` + pre-paint init in `src/app/layout.tsx`, persisted as
  `localStorage:roboko-theme`. Token-driven components flip with no logic change.
- Families: venue pages (`/live`, `/bracket`) = Stat-Led; app pages
  (`/admin*`, `/orga*`, `/jury`, `/participant`) = Bento Grid, no enrichment;
  content pages (`/login`, `/style-guide`) = Long Document. Display: Chakra
  Petch 700; Body: Archivo 400; Mono: IBM Plex Mono. Keep the
  `// Hallmark · genre: atmospheric · macrostructure: …` header on pages.
