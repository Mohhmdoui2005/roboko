'use client'
// Hallmark · genre: atmospheric · macrostructure: Long Document · theme: Terminal · design-system: design.md · designed-as-app

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Before React hydrates on the phone (slow dev-server chunks over Wi-Fi),
  // the form is plain HTML: pressing "Sign in" does a native GET submit,
  // which reloads /login with a bare "?" and never calls handleLogin.
  // Keep the button disabled until hydration so the tap can't fire early.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    // Mobile keyboards often auto-capitalize or append spaces — Supabase treats
    // "Admin@test.com " as a different login, so normalize before sending.
    const cleanEmail = email.trim()

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
      if (error) throw new Error(error.message)
      if (!data.session) {
        throw new Error('Signed in but no session was returned. Check your connection and retry.')
      }

      const role = data.session.user.app_metadata?.role
      const target =
        role === 'ADMIN' ? '/admin'
        : role === 'ORGA' ? '/orga'
        : role === 'JURY' ? '/jury'
        : '/participant'
      router.refresh()
      window.location.assign(target)
      // Safety net: if we are still on /login 12 s later (e.g. the phone's
      // browser rejected the session cookie and middleware bounced us back),
      // re-enable the form with a hint instead of hanging on "Signing in…" forever.
      setTimeout(() => {
        if (window.location.pathname === '/login') {
          setIsLoading(false)
          setError(
            'Login reached the server but this browser did not stay signed in (session cookie was not stored). ' +
            'Clear site data for this site in the phone browser settings and retry.'
          )
        }
      }, 12000)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid login credentials')
      setIsLoading(false)
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-sm space-y-8">
        {/* ── Brand mark · Long Document: stacked head, terminal voice ── */}
        <div className="space-y-3">
          <p className="term-prompt text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&gt; roboko --signin</p>
          <div className="section-head">
            <span className="section-head__label">Staff and participant access</span>
            <h1 className="section-head__title" style={{ fontSize: '1.5rem' }}>
              Roboko
            </h1>
          </div>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Sign in to your account
          </p>
        </div>

        {/* ── Form card ── */}
        <div className="card card-emphasized p-6 space-y-5">
          {/* method="post" is a safety net only: if JS never hydrates, the
              browser falls back to POST (no credentials leaked in the URL
              as with GET) instead of appending "?" to /login. */}
          <form className="space-y-4" method="post" onSubmit={handleLogin}>
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@event.com"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="password"
                style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div
                className="toast-danger px-4 py-3 rounded-lg text-sm font-medium"
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !hydrated}
              className="btn btn-primary w-full"
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in…' : hydrated ? 'Sign in' : 'Loading…'}
            </button>
            {/* Shown only when JS is disabled / stripped: explains the reload. */}
            <noscript>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                JavaScript is required to sign in. Please enable it and reload this page.
              </p>
            </noscript>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
          Roboko · Staff &amp; Participant Access
        </p>
      </div>
    </div>
  )
}
