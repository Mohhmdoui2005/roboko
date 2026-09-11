import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomInt } from 'crypto'

// POST /api/admin/create-team-accounts
// Creates (or resets) one PARTICIPANT auth account per team, each with a
// fresh unique hard password, and returns the credentials for the admin to
// save/distribute. Caller must be signed in as ADMIN (checked via JWT).
const PASSWORD_LEN = 14
// Unambiguous alphabet: no 0/O, 1/l/I — typable on phones.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function genPassword(): string {
  let s = ''
  for (let i = 0; i < PASSWORD_LEN; i++) s += CHARSET[randomInt(CHARSET.length)]
  return s
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'team'
}

interface TeamRow {
  id: string
  name: string
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return NextResponse.json({ error: 'Server misconfigured (missing Supabase keys)' }, { status: 500 })
  }

  // ── Caller must be ADMIN ─────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const anon = createClient(url, anonKey)
  const {
    data: { user: caller },
    error: callerErr,
  } = await anon.auth.getUser(token)
  if (callerErr || !caller) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
  if ((caller.app_metadata as { role?: string } | null)?.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── All teams ────────────────────────────────────────────────────────
  const { data: teams, error: teamsErr } = await admin
    .from('teams')
    .select('id,name')
    .order('name')
  if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 })
  if (!teams || teams.length === 0) {
    return NextResponse.json({ error: 'No teams found — enter team names first' }, { status: 400 })
  }

  // ── Existing auth users, keyed by email (paginated) ──────────────────
  const byEmail = new Map<string, { id: string; app_metadata: Record<string, unknown> }>()
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const users = data.users || []
    users.forEach((u) => {
      if (u.email) {
        byEmail.set(u.email.toLowerCase(), {
          id: u.id,
          app_metadata: (u.app_metadata as Record<string, unknown>) || {},
        })
      }
    })
    if (users.length < 100) break
    page++
  }

  // ── One account per team (small batches to stay fast) ────────────────
  const createOne = async (team: TeamRow) => {
    const email = `${slugify(team.name)}-${String(team.id).slice(0, 6)}@teams.local`
    const password = genPassword()
    const existing = byEmail.get(email)
    let userId: string
    if (!existing) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role: 'PARTICIPANT' },
        user_metadata: { full_name: team.name, team_id: team.id },
      })
      if (error) throw new Error(`${team.name}: ${error.message}`)
      userId = data.user.id
    } else {
      userId = existing.id
      const { error } = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        app_metadata: { ...existing.app_metadata, role: 'PARTICIPANT' },
        user_metadata: { full_name: team.name, team_id: team.id },
      })
      if (error) throw new Error(`${team.name}: ${error.message}`)
    }
    // Link the profile row to the team (participant dashboard reads this).
    const { error: profErr } = await admin.from('profiles').upsert({
      id: userId,
      role: 'PARTICIPANT',
      name: team.name,
      team_id: team.id,
      assigned_arena: null,
    })
    if (profErr) throw new Error(`${team.name} profile: ${profErr.message}`)
    return { team_id: team.id, team_name: team.name, email, password }
  }

  try {
    const accounts = []
    const rows = teams as TeamRow[]
    for (let i = 0; i < rows.length; i += 6) {
      const batch = await Promise.all(rows.slice(i, i + 6).map(createOne))
      accounts.push(...batch)
    }
    return NextResponse.json({ accounts, count: accounts.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Account creation failed' },
      { status: 500 }
    )
  }
}
