import type { SupabaseClient } from '@supabase/supabase-js'

// Returns a usable access token: refreshes first when the stored session is
// expired or expiring within 60 s (Supabase rejects stale JWTs, which used
// to surface as a bare "Invalid session" from /api/admin/*).
export async function getFreshAccessToken(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) return null
  if (session.expires_at && session.expires_at * 1000 < Date.now() + 60000) {
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (!error && data.session) return data.session.access_token
      // Refresh failed (e.g. refresh token rotated away) — fall through with
      // the stale token so the server can answer "expired, sign in again".
    } catch {
      // fall through
    }
  }
  return session.access_token
}

// Authenticated fetch for /api/admin/*: attaches a fresh token and retries
// once after a forced refresh when the server answers 401.
export async function adminFetch(
  supabase: SupabaseClient,
  input: string,
  init: RequestInit = {},
  retried = false
): Promise<Response> {
  const token = await getFreshAccessToken(supabase)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token ?? ''}`)
  const res = await fetch(input, { ...init, headers })
  if (res.status === 401 && !retried && token) {
    try {
      const { data, error } = await supabase.auth.refreshSession()
      if (!error && data.session) return adminFetch(supabase, input, init, true)
    } catch {
      // fall through with the original 401
    }
  }
  return res
}
