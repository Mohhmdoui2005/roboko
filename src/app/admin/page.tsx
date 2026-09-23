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

const TOOLS = [
  { title: 'Teams', desc: 'Rename teams — live everywhere', href: '/admin/teams', tag: 'TM' },
  { title: 'Phase 1', desc: 'Generate qual matches + publish', href: '/admin/phase1', tag: 'P1' },
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
    <div className="h-dvh overflow-hidden p-3 sm:p-4 flex flex-col"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="w-full h-full mx-auto flex flex-col gap-3 min-h-0" style={{ maxWidth: 'var(--layout-wide)' }}>

        {/* ── Header ── */}
        <header className="flex items-center justify-between gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div>
              <h1 className="text-lg font-bold tracking-tight"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}>
                Command Center
              </h1>
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                Tournament status and every admin tool.
              </p>
            </div>
            <span className={`badge ${knockoutLive ? 'badge-success' : 'badge-info'}`}>
              {knockoutLive ? 'KNOCKOUT LIVE' : 'QUALIFICATION'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div role="group" aria-label="Interface theme" className="flex items-center gap-1 p-1"
              style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
              {THEMES.map(t => (
                <button key={t.id} onClick={() => setTheme(t.id)}
                  aria-pressed={theme === t.id} className="btn font-mono"
                  style={{
                    minHeight: 40, padding: '0 0.7rem', fontSize: '0.72rem',
                    ...(theme === t.id
                      ? { borderColor: 'var(--color-accent)', color: 'var(--color-accent-text)' }
                      : { borderColor: 'transparent', color: 'var(--color-text-tertiary)' }),
                  }}>
                  {t.label}
                </button>
              ))}
            </div>
            <Link href="/live" className="btn" style={{ minHeight: 40, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Live screen</Link>
            <Link href="/bracket" className="btn" style={{ minHeight: 40, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Bracket</Link>
            <button onClick={fetchAll} className="btn btn-primary" style={{ minHeight: 40, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>Refresh</button>
          </div>
        </header>

        {/* ── Status strip ── */}
        <section className="card px-4 py-2 flex items-center gap-x-5 gap-y-1 flex-wrap shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="stat-hero__number" style={{ fontSize: '1.6rem' }}>{done}</span>
            <span className="stat-hero__qualifier">/ {total} done</span>
          </div>
          <div className="flex items-center gap-3 font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
            <span>Qual pending <strong style={{ color: 'var(--color-text-primary)' }}>{stats.qualPending}</strong></span>
            <span>KO <strong style={{ color: 'var(--color-text-primary)' }}>{stats.koTotal || 'setup'}</strong></span>
            <span>Lunch <strong style={{ color: 'var(--color-text-primary)' }}>{lunchCount ?? '…'}</strong></span>
            <span>Testing <strong style={{ color: 'var(--color-text-primary)' }}>{activeSessions}</strong></span>
            <span>Teams <strong style={{ color: 'var(--color-text-primary)' }}>{teamCount}</strong></span>
          </div>
          <div className="flex items-center gap-2 ms-auto">
            <Link href="/admin/phase1" className="btn text-center"
              style={{ minHeight: 40, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
              Phase 1
            </Link>
            <Link href="/admin/knockout" className="btn btn-primary text-center"
              style={{ minHeight: 40, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
              Knockout
            </Link>
          </div>
        </section>

        {/* ── Main: ops + control center ── */}
        <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-4 p-4 hidden lg:flex flex-col min-h-0"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm" style={{ color: 'var(--color-text-primary)' }}>Ops</h3>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Live counts</span>
            </div>
            <p className="text-left text-xs font-medium mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
              Meals claimed
            </p>
            <p className="text-left font-bold leading-none"
              style={{ fontSize: '2.25rem', color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', fontVariantNumeric: 'tabular-nums' }}>
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
            <Link href="/admin/lunch" className="btn w-full mt-auto" style={{ minHeight: 44, fontSize: '0.8rem' }}>
              Open lunch control
            </Link>
          </div>

          {/* Compact ops strip for <lg (sidebar gone): same signal, one row */}
          <div className="lg:hidden card px-4 py-2 flex items-center gap-4 flex-wrap shrink-0">
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Lunch <strong className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{lunchCount ?? '…'}</strong>
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Testing <strong className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{activeSessions}</strong>
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Teams <strong className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{teamCount}</strong>
            </span>
            <Link href="/admin/lunch" className="btn ms-auto" style={{ minHeight: 40, fontSize: '0.75rem' }}>
              Lunch control
            </Link>
          </div>

          <div className="lg:col-span-8 p-4 flex flex-col min-h-0"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)' }}>
            <div className="flex items-center justify-between shrink-0">
              <h3 className="font-bold text-base" style={{ color: 'var(--color-text-primary)' }}>Control Center</h3>
              <span className={`badge ${operational ? 'badge-success' : 'badge-neutral'}`}>{operational ? 'OPERATIONAL' : 'STANDBY'}</span>
            </div>
            <p className="text-xs mt-1 shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>Every admin tool — one tap.</p>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 content-start">
              {TOOLS.map(t => (
                <Link key={t.title} href={t.href}
                  className="flex items-center gap-2 px-2.5 py-2"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', textDecoration: 'none' }}>
                  <span className="font-mono text-xs font-bold shrink-0" style={{ color: 'var(--color-accent-text)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '2px 6px' }}>{t.tag}</span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold leading-snug" style={{ color: 'var(--color-text-primary)' }}>{t.title}</span>
                    <span className="hidden sm:block text-xs leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>{t.desc}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
