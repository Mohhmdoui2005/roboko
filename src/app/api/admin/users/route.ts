import { NextResponse } from 'next/server'
import { requireAdmin, MANAGED_ROLES } from '@/lib/adminAuth'

// GET    /api/admin/users          → list all accounts + profile linkage
// POST   /api/admin/users          → create account {email,password,role,name,team_id?,assigned_arena?}
// DELETE /api/admin/users          → delete account {user_id} (never self, never the last ADMIN)
export async function GET(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin } = gate
  try {
    const [{ data: teams }, { data: profiles }] = await Promise.all([
      admin.from('teams').select('id,name'),
      admin.from('profiles').select('id,role,name,assigned_arena,team_id'),
    ])
    const teamNames: Record<string, string> = {}
    ;((teams ?? []) as { id: string; name: string }[]).forEach((t) => {
      teamNames[t.id] = t.name
    })
    const profById: Record<string, { name: string | null; team_id: string | null; assigned_arena: string | null }> = {}
    ;((profiles ?? []) as { id: string; name: string | null; team_id: string | null; assigned_arena: string | null }[]).forEach(
      (p) => {
        profById[p.id] = { name: p.name, team_id: p.team_id, assigned_arena: p.assigned_arena }
      }
    )

    const out: {
      id: string
      email?: string
      role: string
      confirmed: boolean
      last_sign_in: string | null
      created_at: string
      name: string | null
      team_name: string | null
      assigned_arena: string | null
    }[] = []
    let page = 1
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) throw new Error(error.message)
      const users = data.users || []
      users.forEach((u) => {
        const prof = profById[u.id]
        out.push({
          id: u.id,
          email: u.email,
          role: ((u.app_metadata as { role?: string }) || {}).role || '(none)',
          confirmed: !!u.email_confirmed_at,
          last_sign_in: u.last_sign_in_at || null,
          created_at: u.created_at,
          name: prof?.name ?? null,
          team_name: prof?.team_id ? teamNames[prof.team_id] ?? prof.team_id.slice(0, 8) : null,
          assigned_arena: prof?.assigned_arena ?? null,
        })
      })
      if (users.length < 100) break
      page++
    }
    out.sort((a, b) => a.role.localeCompare(b.role) || (a.email || '').localeCompare(b.email || ''))
    return NextResponse.json({ users: out, count: out.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list users' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin } = gate
  try {
    const body = await req.json()
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const role = String(body.role || '').toUpperCase()
    const name = String(body.name || '').trim()
    const team_id = body.team_id ? String(body.team_id) : null
    const assigned_arena = body.assigned_arena ? String(body.assigned_arena) : null

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }
    if (!(MANAGED_ROLES as readonly string[]).includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (!name) return NextResponse.json({ error: 'Display name is required' }, { status: 400 })

    // Email already taken?
    let page = 1
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
      if (error) throw new Error(error.message)
      if ((data.users || []).some((u) => (u.email || '').toLowerCase() === email)) {
        return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
      }
      if ((data.users || []).length < 100) break
      page++
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { full_name: name },
    })
    if (error) throw new Error(error.message)

    const { error: profErr } = await admin.from('profiles').upsert({
      id: data.user.id,
      role,
      name,
      team_id: role === 'PARTICIPANT' ? team_id : null,
      assigned_arena: role === 'JURY' ? assigned_arena : null,
    })
    if (profErr) throw new Error(`profile: ${profErr.message}`)

    return NextResponse.json({ id: data.user.id, email, password, role, name })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Account creation failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin, caller } = gate
  try {
    const body = await req.json()
    const userId = String(body.user_id || '')
    if (!userId) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
    if (userId === caller.id) {
      return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
    }

    const { data: target, error: targetErr } = await admin.auth.admin.getUserById(userId)
    if (targetErr || !target.user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const targetRole = ((target.user.app_metadata as { role?: string }) || {}).role

    // Never delete the last ADMIN — that would lock everyone out.
    if (targetRole === 'ADMIN') {
      let adminCount = 0
      let page = 1
      for (;;) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
        if (error) throw new Error(error.message)
        adminCount += (data.users || []).filter(
          (u) => ((u.app_metadata as { role?: string }) || {}).role === 'ADMIN'
        ).length
        if ((data.users || []).length < 100) break
        page++
      }
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: 'Refused: this is the last ADMIN account. Promote someone else first.' },
          { status: 400 }
        )
      }
    }

    const email = target.user.email || userId.slice(0, 8)
    await admin.from('profiles').delete().eq('id', userId) // ignore error: FK cascade may handle it
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) throw new Error(delErr.message)
    return NextResponse.json({ deleted: email })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      { status: 500 }
    )
  }
}
