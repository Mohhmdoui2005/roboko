import { NextResponse } from 'next/server'
import { createHmac, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/adminAuth'

// Lunch badge issuance (service role — the HMAC secret must never reach the
// browser). Badges are generic: each gets a lightweight auth account plus a
// holder `profiles` row named "Lunch Badge NNN" whose lunch_qr_payload the
// scanner claims against.
//
// Why real auth accounts? profiles.id is a FK to auth.users, so holder rows
// cannot exist on their own. Badge accounts carry
// app_metadata { role: 'PARTICIPANT', lunch_badge: true } and are filtered
// out of the Users management list; their passwords are random and never
// shared (badges are QR-only, nobody logs in with them).
//
// Single-use is enforced by claim_person_lunch (unique lunch_claims.user_id):
// the first scan claims, any second scan returns ALREADY_CLAIMED with the
// original timestamp — the orga scanner already flashes exactly that.

const BADGE_PREFIX = 'Lunch Badge'
const MAX_BATCH = 200

// Same construction as scripts/generate_qrs.js (server only ever compares the
// full payload string against the stored row — exact match = authentic).
function signLunchPayload(userId: string): string {
  const key = process.env.QR_SECRET_KEY || 'supersecretkey123'
  const base = { domain: 'PERSON_LUNCH', user_id: userId }
  const serialized = JSON.stringify(base)
  const sig = createHmac('sha256', key).update(serialized).digest('hex')
  return JSON.stringify({ ...base, sig })
}

interface BadgeRow {
  id: string
  name: string
  lunch_qr_payload: string | null
}

async function listBadges(admin: SupabaseClient): Promise<BadgeRow[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id,name,lunch_qr_payload')
    .like('name', `${BADGE_PREFIX}%`)
    .order('name')
  if (error) throw new Error(error.message)
  return (data ?? []) as BadgeRow[]
}

function nextBadgeNumber(existing: BadgeRow[]): number {
  let max = 0
  for (const b of existing) {
    const m = /(\d+)\s*$/.exec(b.name)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return Math.max(max + 1, existing.length + 1)
}

const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function randomPassword(): string {
  const buf = randomBytes(24)
  let s = ''
  for (const byte of buf) s += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
  return s
}

// GET /api/admin/generate-lunch-badges → all issued badges (for reprint)
export async function GET(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  try {
    return NextResponse.json({ badges: await listBadges(gate.admin) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list badges' },
      { status: 500 }
    )
  }
}

// POST /api/admin/generate-lunch-badges { count } → issues `count` new badges
export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin } = gate

  let count: number
  try {
    count = Number((await req.json() as { count?: number }).count)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    return NextResponse.json(
      { error: `count must be an integer between 1 and ${MAX_BATCH}` },
      { status: 400 }
    )
  }

  try {
    let n = nextBadgeNumber(await listBadges(admin))
    const badges: BadgeRow[] = []
    for (let i = 0; i < count; i++) {
      // Find a free badge number (email must be unique — bump past clashes).
      let created: { id: string; name: string } | null = null
      for (let attempt = 0; attempt < 25 && !created; attempt++, n++) {
        const name = `${BADGE_PREFIX} ${String(n).padStart(3, '0')}`
        const email = `lunch-badge-${String(n).padStart(3, '0')}@badges.local`
        const { data, error: userErr } = await admin.auth.admin.createUser({
          email,
          password: randomPassword(),
          email_confirm: true,
          app_metadata: { role: 'PARTICIPANT', lunch_badge: true },
          user_metadata: { full_name: name },
        })
        if (userErr) {
          if (/already exists|already registered|duplicate/i.test(userErr.message)) continue
          throw new Error(`${name}: ${userErr.message}`)
        }
        created = { id: data.user.id, name }
      }
      if (!created) throw new Error('Could not find a free badge number (too many clashes)')

      const payload = signLunchPayload(created.id)
      const { error: profErr } = await admin.from('profiles').upsert({
        id: created.id,
        role: 'PARTICIPANT',
        name: created.name,
        team_id: null,
        assigned_arena: null,
        lunch_qr_payload: payload,
      })
      if (profErr) {
        // Don't orphan the auth account — best-effort rollback.
        await admin.auth.admin.deleteUser(created.id).catch(() => {})
        throw new Error(`${created.name}: ${profErr.message}`)
      }
      badges.push({ id: created.id, name: created.name, lunch_qr_payload: payload })
      n++
    }
    return NextResponse.json({ badges, count: badges.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Badge generation failed' },
      { status: 500 }
    )
  }
}
