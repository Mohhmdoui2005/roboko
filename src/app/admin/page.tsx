'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'

interface MatchRow {
  id: string
  arena_id: string
  status: string
  is_knockout: boolean
  team1_id: string | null
  team2_id: string | null
  winner_id: string | null
}

interface BoardRow {
  team_id: string
  team_name?: string
  wins: number
  matches_played: number
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
]

const TOOLS = [
  { title: 'Teams', desc: 'Rename teams — live everywhere', href: '/admin/teams', icon: '✏️' },
  { title: 'Phase 1', desc: 'Generate 54 qual matches + publish', href: '/admin/phase1', icon: '🗂️' },
  { title: 'Knockout', desc: 'Top-16 seeds → bracket', href: '/admin/knockout', icon: '🏆' },
  { title: 'Leaderboard', desc: 'Standings + refresh', href: '/admin/leaderboard', icon: '📊' },
  { title: 'Lunch', desc: 'Start time + broadcast', href: '/admin/lunch', icon: '🍽️' },
  { title: 'QR Codes', desc: 'Robot QR grid + print', href: '/admin/qr-codes', icon: '🔳' },
  { title: 'Test Room', desc: 'Arena occupancy + override', href: '/admin/testing', icon: '🤖' },
]

export default function AdminDashboard() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teamCount, setTeamCount] = useState(0)
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [knockoutLive, setKnockoutLive] = useState(false)
  const [lunchCount, setLunchCount] = useState<number | null>(null)
  const [activeSessions, setActiveSessions] = useState(0)
  const [board, setBoard] = useState<BoardRow[]>([])

  const fetchAll = useCallback(async () => {
    const [
      { data: teams },
      { data: mData },
      { data: state },
      { data: lunch },
      { data: sessions },
      { data: leaders },
    ] = await Promise.all([
      supabase.from('teams').select('id,name'),
      supabase.from('matches').select('id,arena_id,status,is_knockout,team1_id,team2_id,winner_id').limit(500),
      supabase.from('tournament_state').select('knockout_live').limit(1).maybeSingle(),
      supabase.rpc('get_lunch_claim_count'),
      supabase.rpc('get_active_sessions'),
      supabase.rpc('get_phase1_leaderboard'),
    ])
    if (teams) {
      setTeamCount(teams.length)
      const map: Record<string, string> = {}
      teams.forEach((t: { id: string; name: string }) => { map[t.id] = t.name })
      setTeamNames(map)
    }
    if (mData) setMatches(mData as MatchRow[])
    if (state) setKnockoutLive(Boolean((state as { knockout_live?: boolean }).knockout_live))
    if (typeof lunch === 'number') setLunchCount(lunch)
    if (Array.isArray(sessions)) setActiveSessions(sessions.length)
    if (Array.isArray(leaders)) setBoard((leaders as BoardRow[]).slice(0, 3))
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

  const arenaBars = useMemo(() => {
    const arenas = ['Arena A', 'Arena B', 'Arena C', 'Arena D']
    const bars = arenas.map(a => ({
      label: a.replace('Arena ', 'A'),
      value: matches.filter(m => !m.is_knockout && m.arena_id === a).length,
    }))
    bars.push(
      { label: 'KO', value: stats.koTotal },
      { label: 'Teams', value: teamCount },
      { label: 'Lunch', value: lunchCount ?? 0 },
    )
    const max = Math.max(1, ...bars.map(b => b.value))
    return bars.map(b => ({ ...b, h: Math.round((b.value / max) * 100) }))
  }, [matches, stats.koTotal, teamCount, lunchCount])

  const recent = useMemo(() => {
    const done = matches.filter(m => m.status === 'COMPLETED').slice(-5).reverse()
    const fallback = matches.slice(-5).reverse()
    return (done.length > 0 ? done : fallback).slice(0, 5)
  }, [matches])

  const nameOf = (id: string | null) => (id ? teamNames[id] ?? id.slice(0, 8) : '—')
  const emailPrefix = user?.email?.split('@')[0] ?? 'Admin'
  const displayName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1)

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

  const pill: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 9999,
  }
  const card: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 24,
  }

  return (
    <div className="min-h-screen p-3 sm:p-5 lg:p-7" style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-[1440px] mx-auto flex flex-col gap-6">

        {/* ── Top navigation ── */}
        <header className="w-full flex items-center justify-between gap-4 py-2 px-1">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ border: '2px solid var(--color-accent)', background: 'var(--color-surface)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>Roboko</span>
            <span className="badge badge-neutral hidden sm:inline-flex">ADMIN</span>
          </div>
          <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-full px-2" style={pill}>
            {NAV.map(n => (
              <Link key={n.label} href={n.href}
                className="px-4 py-1.5 rounded-full text-xs font-medium tracking-wide transition"
                style={n.active
                  ? { background: 'var(--color-border)', color: 'var(--color-text-primary)' }
                  : { color: 'var(--color-text-tertiary)' }}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className={`badge ${knockoutLive ? 'badge-success' : 'badge-info'}`}>
              {knockoutLive ? '● KNOCKOUT LIVE' : 'QUALIFICATION'}
            </span>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
              style={{ background: 'var(--color-border)', color: 'var(--color-text-primary)' }}>
              {displayName.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* ── Greeting + controls ── */}
        <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 py-1">
          <h1 className="text-2xl lg:text-3xl font-normal" style={{ color: 'var(--color-text-primary)' }}>
            Hello, {displayName}
          </h1>
          <div className="flex items-center gap-2">
            <Link href="/live" className="btn" style={{ minHeight: 40 }}>Live screen</Link>
            <Link href="/bracket" className="btn" style={{ minHeight: 40 }}>Bracket</Link>
            <button onClick={fetchAll} className="btn btn-primary" style={{ minHeight: 40 }}>Refresh</button>
          </div>
        </section>

        {/* ── Grid ── */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-8 flex flex-col gap-5">

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Tournament status — Total Balance analogue */}
              <section className="md:col-span-7 p-6 flex flex-col justify-between" style={card}>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Tournament Status</span>
                    <span className="badge badge-neutral">{stats.qualTotal + stats.koTotal} matches</span>
                  </div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
                    {stats.qualCompleted + stats.koCompleted}
                    <span className="text-2xl font-light" style={{ color: 'var(--color-text-tertiary)' }}> / {stats.qualTotal + stats.koTotal} done</span>
                  </div>
                  {/* Capsule nodes */}
                  <div className="relative mt-8 mb-6 py-2 px-1 flex items-center justify-between">
                    <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-[38px] rounded-full z-0"
                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
                    <div className="relative z-10 w-20 h-20 rounded-full flex flex-col items-center justify-center text-center"
                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{stats.qualCompleted}</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Qual done</span>
                    </div>
                    <div className="relative z-20 w-24 h-24 rounded-full flex flex-col items-center justify-center text-center"
                      style={{
                        background: 'var(--color-accent)', color: '#04110b',
                        boxShadow: '0 0 20px -3px rgba(0,217,146,0.4)',
                      }}>
                      <span className="text-sm font-bold">{knockoutLive ? stats.koLive : stats.qualInProgress + stats.qualPublished}</span>
                      <span className="text-[11px] font-medium">{knockoutLive ? 'Knockout' : 'Live now'}</span>
                    </div>
                    <div className="relative z-10 w-20 h-20 rounded-full flex flex-col items-center justify-center text-center"
                      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                      <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{teamCount}</span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Teams</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4 pt-2">
                  <Link href="/admin/phase1" className="btn btn-primary" style={{ textDecoration: 'none' }}>Phase 1 · {stats.qualPending} pending</Link>
                  <Link href="/admin/knockout" className="btn" style={{ textDecoration: 'none' }}>Knockout · {stats.koTotal || 'setup'}</Link>
                </div>
              </section>

              {/* Top teams — Investments analogue */}
              <section className="md:col-span-5 p-6 flex flex-col justify-between" style={card}>
                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Top Teams</h3>
                    <Link href="/admin/leaderboard" className="badge badge-info" style={{ textDecoration: 'none' }}>Leaderboard ↗</Link>
                  </div>
                  <div className="mt-4 flex flex-col gap-2.5">
                    {board.length === 0 && (
                      <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No standings yet — generate Phase 1 first.</p>
                    )}
                    {board.map((r, i) => (
                      <div key={r.team_id}
                        className="flex items-center justify-between p-3 rounded-2xl"
                        style={i === 0
                          ? { background: 'var(--color-accent)', color: '#04110b', boxShadow: '0 0 20px -3px rgba(0,217,146,0.4)' }
                          : { background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            style={i === 0 ? { background: 'rgba(0,0,0,0.85)', color: 'var(--color-accent)' } : { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                            {i + 1}
                          </div>
                          <div>
                            <div className="text-xs font-bold" style={{ color: i === 0 ? '#04110b' : 'var(--color-text-primary)' }}>
                              {r.team_name ?? teamNames[r.team_id] ?? r.team_id.slice(0, 8)}
                            </div>
                            <div className="text-[10px]" style={{ color: i === 0 ? 'rgba(0,0,0,0.7)' : 'var(--color-text-tertiary)' }}>
                              {r.matches_played} played
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold" style={{ color: i === 0 ? '#04110b' : 'var(--color-accent-text)' }}>{r.wins}W</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span className="badge badge-neutral">Lunch {lunchCount ?? '…'} claimed</span>
                  <span className="badge badge-neutral">Testing {activeSessions} active</span>
                </div>
              </section>
            </div>

            {/* Match flow — Cashflow analogue */}
            <section className="p-6 flex flex-col justify-between" style={card}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Match Flow</span>
                  <div className="mt-1 text-2xl font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    {stats.qualTotal} qual · {stats.koTotal} KO
                  </div>
                </div>
                <span className="badge badge-neutral">per arena + ops</span>
              </div>
              <div className="mt-8 relative pt-8 pb-2">
                <div className="pl-8 flex flex-col justify-between h-36" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="w-full" style={{ borderBottom: '1px dashed var(--color-border)' }} />
                  <div className="w-full" style={{ borderBottom: '1px dashed var(--color-border)' }} />
                  <div className="w-full" style={{ borderBottom: '1px dashed var(--color-border)' }} />
                </div>
                <div className="absolute inset-x-0 bottom-0 pl-10 pr-4 h-36 flex items-end justify-between gap-3">
                  {arenaBars.map((b, i) => (
                    <div key={b.label} className="relative flex flex-col items-center flex-1">
                      {i === 0 && (
                        <div className="absolute -top-7 px-2.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-accent)', color: 'var(--color-accent-text)' }}>
                          {b.value}
                        </div>
                      )}
                      <div className="w-8 rounded-2xl flex items-center justify-center"
                        style={i === 0
                          ? { height: `${Math.max(12, b.h)}%`, minHeight: 48, background: 'linear-gradient(to top, rgba(0,217,146,0.4), var(--color-accent))' }
                          : { height: `${Math.max(8, b.h)}%`, minHeight: 24, background: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
                      <span className="text-[10px] mt-1 font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>

          {/* ── Right column ── */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            {/* Control center — AI Assistant analogue */}
            <section className="p-6 flex flex-col justify-between" style={card}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>✦ Control Center</h3>
                <span className="badge badge-success">OPERATIONAL</span>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text-tertiary)' }}>Every admin tool — one tap.</p>
              <div className="grid grid-cols-1 gap-2 mt-4">
                {TOOLS.map(t => (
                  <Link key={t.title} href={t.href}
                    className="flex items-center justify-between p-3 rounded-2xl transition"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', textDecoration: 'none' }}>
                    <span className="flex items-center gap-3">
                      <span style={{ fontSize: '1.1rem' }}>{t.icon}</span>
                      <span>
                        <span className="block text-xs font-bold" style={{ color: 'var(--color-text-primary)' }}>{t.title}</span>
                        <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{t.desc}</span>
                      </span>
                    </span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>→</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Recent activity — Transactions analogue */}
            <section className="p-6 flex flex-col flex-1 justify-between" style={card}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Recent Matches</h3>
                <Link href="/admin/phase1" className="badge badge-neutral" style={{ textDecoration: 'none' }}>View all ↗</Link>
              </div>
              <div className="flex flex-col" style={{ borderTop: '1px solid var(--color-border)' }}>
                {recent.length === 0 && (
                  <p className="text-xs py-4" style={{ color: 'var(--color-text-tertiary)' }}>No matches yet.</p>
                )}
                {recent.map(m => (
                  <div key={m.id} className="py-2.5 flex items-center justify-between"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
                        {m.is_knockout ? 'KO' : m.arena_id.replace('Arena ', 'A')}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--color-text-primary)' }}>
                        {nameOf(m.team1_id)} <span style={{ color: 'var(--color-text-tertiary)' }}>vs</span> {nameOf(m.team2_id)}
                      </div>
                    </div>
                    <span className={`badge ${m.status === 'COMPLETED' ? 'badge-success' : m.status === 'IN_PROGRESS' ? 'badge-warning' : m.status === 'PUBLISHED' ? 'badge-info' : 'badge-neutral'}`}>
                      {m.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
