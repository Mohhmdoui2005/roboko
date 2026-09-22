'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { setTheme, THEMES, useTheme } from '@/lib/theme'

interface MatchRow {
  id: string
  arena_id: string
  status: string
  is_knockout: boolean
  team1_id: string | null
  team2_id: string | null
  winner_id: string | null
}

const NAV = [
  { label: 'Dashboard', href: '/admin', active: true },
  { label: 'Teams', href: '/admin/teams', active: false },
  { label: 'Phase 1', href: '/admin/phase1', active: false },
  { label: 'Knockout', href: '/admin/knockout', active: false },
  { label: 'Leaderboard', href: '/admin/leaderboard', active: false },
  { label: 'Lunch', href: '/admin/lunch', active: false },
  { label: 'QR Codes', href: '/admin/qr-codes', active: false },
  { label: 'Testing', href: '/admin/testing', active: false },
  { label: 'Users', href: '/admin/users', active: false },
]

const TOOLS = [
  { title: 'Teams', desc: 'Rename teams — live everywhere', href: '/admin/teams', tag: 'TM' },
  { title: 'Phase 1', desc: 'Generate 54 qual matches + publish', href: '/admin/phase1', tag: 'P1' },
  { title: 'Knockout', desc: 'Top-16 seeds → bracket', href: '/admin/knockout', tag: 'KO' },
  { title: 'Leaderboard', desc: 'Standings + refresh', href: '/admin/leaderboard', tag: 'LB' },
  { title: 'Lunch', desc: 'Start time + broadcast', href: '/admin/lunch', tag: 'LU' },
  { title: 'QR Codes', desc: 'Robot QR grid + print', href: '/admin/qr-codes', tag: 'QR' },
  { title: 'Test Room', desc: 'Arena occupancy + override', href: '/admin/testing', tag: 'TR' },
  { title: 'Users', desc: 'Accounts, roles + delete', href: '/admin/users', tag: 'US' },
]

export default function AdminDashboard() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamCount, setTeamCount] = useState(0)
  const [knockoutLive, setKnockoutLive] = useState(false)
  const [lunchCount, setLunchCount] = useState<number | null>(null)
  const [activeSessions, setActiveSessions] = useState(0)
  const theme = useTheme()

  const fetchAll = useCallback(async () => {
    const [
      { data: teams },
      { data: mData },
      { data: state },
      { data: lunch },
      { data: sessions },
    ] = await Promise.all([
      supabase.from('teams').select('id,name'),
      supabase.from('matches').select('id,arena_id,status,is_knockout,team1_id,team2_id,winner_id').limit(500),
      supabase.from('tournament_state').select('knockout_live').limit(1).maybeSingle(),
      supabase.rpc('get_lunch_claim_count'),
      supabase.rpc('get_active_sessions'),
    ])
    if (teams) {
      setTeamCount(teams.length)
    }
    if (mData) setMatches(mData as MatchRow[])
    if (state) setKnockoutLive(Boolean((state as { knockout_live?: boolean }).knockout_live))
    if (typeof lunch === 'number') setLunchCount(lunch)
    if (Array.isArray(sessions)) setActiveSessions(sessions.length)
    setLoading(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [supabase])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') {
      fetchAll()
      const t = setInterval(fetchAll, 10000)
      return () => clearInterval(t)
    }
    if (!authLoading) setLoading(false)
  }, [authLoading, user, role, fetchAll])

  const stats = useMemo(() => {
    const qual = matches.filter(m => !m.is_knockout)
    const ko = matches.filter(m => m.is_knockout)
    const byStatus = (list: MatchRow[], s: string) => list.filter(m => m.status === s).length
    return {
      qualTotal: qual.length,
      qualCompleted: byStatus(qual, 'COMPLETED'),
      qualPublished: byStatus(qual, 'PUBLISHED'),
      qualInProgress: byStatus(qual, 'IN_PROGRESS'),
      qualPending: byStatus(qual, 'PENDING'),
      koTotal: ko.length,
      koCompleted: byStatus(ko, 'COMPLETED'),
      koLive: byStatus(ko, 'IN_PROGRESS') + byStatus(ko, 'PUBLISHED'),
    }
  }, [matches])

  const emailPrefix = user?.email?.split('@')[0] ?? 'Admin'
  const displayName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)

  const total = stats.qualTotal + stats.koTotal
  const done = stats.qualCompleted + stats.koCompleted
  const operational = teamCount > 0 || matches.length > 0

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading Roboko command center…
      </div>
    )
  }
  if (!user || role !== 'ADMIN') {
    return (
      <div className="min-h-screen p-8 text-center"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Admin access required.
      </div>
    )
  }

  return (
    <div className="min-h-screen p-3 sm:p-5 lg:p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="w-full mx-auto flex flex-col lg:flex-row gap-5" style={{ maxWidth: 'var(--layout-wide)' }}>

        {/* ── Sidebar ── */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col justify-between p-5"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
          <div className="space-y-6">
            <div className="flex items-center gap-2 p-3"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
                  Hello, {displayName}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Admin account</p>
              </div>
            </div>

            <nav aria-label="Admin sections" className="space-y-1">
              <p className="text-xs font-semibold uppercase px-3 pb-1"
                style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.08em' }}>Command</p>
              {NAV.map(n => (
                <Link key={n.label} href={n.href}
                  className="flex items-center gap-3 px-3 py-2 text-sm font-medium"
                  style={n.active
                    ? { background: 'var(--color-raised)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }
                    : { color: 'var(--color-text-tertiary)', border: '1px solid transparent', borderRadius: 'var(--radius-card)' }}>
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="mt-6 p-4 text-left"
            style={{ background: 'var(--color-bg)', border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-card)' }}>
            <p className="text-xs font-bold" style={{ color: knockoutLive ? 'var(--color-accent-text)' : 'var(--color-info)' }}>
              {knockoutLive ? 'KNOCKOUT LIVE' : 'QUALIFICATION'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              {done}/{total} done · lunch {lunchCount ?? '…'} · testing {activeSessions}
            </p>
            <Link href="/live" className="btn w-full mt-3" style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              Open live screen
            </Link>
          </div>
        </aside>

        {/* ── Main workspace ── */}
        <main className="flex-1 flex flex-col gap-5 min-w-0">
          {/* Compact status for <lg (sidebar hidden): same signal, one row */}
          <div className="lg:hidden card p-4 flex items-center justify-between gap-3">
            <p className="text-xs font-bold" style={{ color: knockoutLive ? 'var(--color-accent-text)' : 'var(--color-info)' }}>
              {knockoutLive ? 'KNOCKOUT LIVE' : 'QUALIFICATION'}
            </p>
            <p className="text-xs font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
              {done}/{total} done · lunch {lunchCount ?? '…'} · testing {activeSessions}
            </p>
          </div>
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
                Command Center
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Tournament status and every admin tool.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div role="group" aria-label="Interface theme" className="flex items-center gap-1 p-1"
                style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
                {THEMES.map(t => (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    aria-pressed={theme === t.id} className="btn font-mono"
                    style={{
                      minHeight: 48, padding: '0 0.8rem', fontSize: '0.75rem',
                      ...(theme === t.id
                        ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent-text)' }
                        : { borderColor: 'transparent', color: 'var(--color-text-tertiary)' }),
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <Link href="/live" className="btn" style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Live screen</Link>
              <Link href="/bracket" className="btn" style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Bracket</Link>
              <button onClick={fetchAll} className="btn btn-primary" style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Refresh</button>
            </div>
          </header>

          {/* ── Row 1: status — Stat-Led, dark paper, no gradient fill ── */}
          <section className="grid grid-cols-1 md:grid-cols-12 gap-5">
            <div className="bento__lead md:col-span-12 card p-6 flex flex-col justify-between relative overflow-hidden min-h-52 reveal">
              <div className="flex items-center justify-between relative">
                <div className="section-head">
                  <span className="section-head__label">Live</span>
                  <h2 className="section-head__title" style={{ fontSize: '1.25rem' }}>Tournament status</h2>
                  <span className="term-prompt text-xs" style={{ color: 'var(--color-text-tertiary)' }}>&gt; roboko --status</span>
                </div>
                <span className="text-xs font-bold px-3 py-1 rounded-full font-mono"
                  style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  {total} matches
                </span>
              </div>
              <div className="my-2 relative">
                <div className="flex items-baseline gap-1.5">
                  <span className="stat-hero__number">{done}</span>
                  <span className="stat-hero__qualifier">/ {total} done · {stats.qualPending} qual pending</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 pt-1 relative">
                <Link href="/admin/phase1" className="btn flex-1 text-center"
                  style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  Phase 1 · {stats.qualPending} pending
                </Link>
                <Link href="/admin/knockout" className="btn btn-primary flex-1 text-center"
                  style={{ minHeight: 48, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  Knockout · {stats.koTotal || 'setup'}
                </Link>
              </div>
            </div>
          </section>

          {/* ── Row 2: ops + control center, side by side ── */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-6 p-5 flex flex-col justify-between"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Ops</h3>
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Live counts</span>
              </div>
              <p className="text-left text-xs font-medium mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
                Meals claimed
              </p>
              <p className="text-left font-bold leading-none"
                style={{ fontSize: '2.5rem', color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontVariantNumeric: 'tabular-nums' }}>
                {lunchCount ?? '…'}
              </p>
              <div className="space-y-1.5 text-xs pt-3 mt-3"
                style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                <div className="flex items-center justify-between">
                  <span>Testing active</span>
                  <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{activeSessions}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Teams</span>
                  <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{teamCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Qual pending</span>
                  <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>{stats.qualPending}</span>
                </div>
              </div>
              <Link href="/admin/lunch" className="btn w-full mt-4" style={{ minHeight: 48, fontSize: '0.8rem' }}>
                Open lunch control
              </Link>
            </div>

            <div className="lg:col-span-6 p-6 flex flex-col justify-between"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base" style={{ color: 'var(--color-text-primary)' }}>Control Center</h3>
                <span className={`badge ${operational ? 'badge-success' : 'badge-neutral'}`}>{operational ? 'OPERATIONAL' : 'STANDBY'}</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Every admin tool — one tap.</p>
              <div className="mt-4" style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))' }}>
                {TOOLS.map(t => (
                  <Link key={t.title} href={t.href}
                    className="flex items-center justify-between p-3"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', textDecoration: 'none' }}>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--color-accent-text)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '2px 6px' }}>{t.tag}</span>
                      <span>
                        <span className="block text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>{t.title}</span>
                        <span className="block text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t.desc}</span>
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
