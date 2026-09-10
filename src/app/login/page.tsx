'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)

      const role = data.session.user.app_metadata?.role
      router.refresh()
      if (role === 'ADMIN') window.location.href = '/admin'
      else if (role === 'ORGA') window.location.href = '/orga'
      else if (role === 'JURY') window.location.href = '/jury'
      else window.location.href = '/participant'
    } catch (err: any) {
      setError(err.message || 'Invalid login credentials')
      setIsLoading(false)
    }
  }

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: 'var(--color-bg)' }}
    >
      <div className="w-full max-w-sm space-y-8">
        {/* ── Brand mark ── */}
        <div className="text-center space-y-3">
          {/* Signal green hexagon icon */}
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl"
               style={{ border: '2px solid var(--color-accent)', background: 'var(--color-surface)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', lineHeight: 1.1, letterSpacing: '-0.02em', color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
              Tournament Platform
            </h1>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              Sign in to your account
            </p>
          </div>
        </div>

        {/* ── Form card ── */}
        <div className="card card-emphasized p-6 space-y-5">
          <form className="space-y-4" onSubmit={handleLogin}>
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
              disabled={isLoading}
              className="btn btn-primary w-full"
              style={{ width: '100%' }}
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
          Robotics Tournament · Staff &amp; Participant Access
        </p>
      </div>
    </div>
  )
}
