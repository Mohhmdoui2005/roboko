import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

// Reads the JWT expiry claim WITHOUT verifying (verification happens via
// getUser above) — only used to pick a helpful error message.
function tokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()
  } catch {
    return false
  }
}

// Guards an /api/admin/* route: caller must present a valid session JWT for
// an ADMIN user. Returns the service-role client + caller, or a JSON error
// Response to return directly.
export async function requireAdmin(
  req: Request
): Promise<{ admin: SupabaseClient; caller: User } | Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: 'Server misconfigured (missing Supabase keys)' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const anon = createClient(url, anonKey)
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token)
  if (error || !user) {
    // Tell an expired session apart from a garbage token so the UI can
    // advise "sign in again" instead of a cryptic "invalid session".
    return Response.json(
      { error: tokenExpired(token) ? 'Session expired — sign out and sign in again' : 'Invalid session' },
      { status: 401 }
    )
  }
  if ((user.app_metadata as { role?: string } | null)?.role !== 'ADMIN') {
    return Response.json({ error: 'Admin only' }, { status: 403 })
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return { admin, caller: user }
}

export async function listAllUsers(admin: SupabaseClient) {
  const all: { id: string; email?: string; app_metadata: Record<string, unknown> }[] = []
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw new Error(error.message)
    const users = data.users || []
    users.forEach((u) =>
      all.push({ id: u.id, email: u.email, app_metadata: (u.app_metadata as Record<string, unknown>) || {} })
    )
    if (users.length < 100) break
    page++
  }
  return all
}

export const MANAGED_ROLES = ['ADMIN', 'ORGA', 'JURY', 'PARTICIPANT'] as const
