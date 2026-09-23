'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { adminFetch } from '@/lib/adminApi'
import { useAuth } from '@/components/AuthProvider'

interface Match {
  id: string
  arena_id: string
  queue_index: number
  subphase: number | null
  status: string
  team1_id: string | null
  team2_id: string | null
  current_round: number
  warnings_team1: number
  warnings_team2: number
  is_knockout: boolean
  winner_id: string | null
}

interface ArenaGroup {
  arena_id: string
  matches: Match[]
}

interface TeamAccount {
  team_id: string
  team_name: string
  email: string
  password: string
}

export default function AdminPhase1Dashboard() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [matches, setMatches] = useState<Match[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<Record<string, unknown> | null>(null)
  const [publishing, setPublishing] = useState<string | null>(null)
  const [publishingAll, setPublishingAll] = useState(false)
  const [creatingAccounts, setCreatingAccounts] = useState(false)
  const [accounts, setAccounts] = useState<TeamAccount[] | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const fetchAll = useCallback(async (quiet = false) => {
    const [{ data: mData, error: mErr }, { data: tData }] = await Promise.all([
      supabase
        .from('matches')
        .select('id,arena_id,queue_index,subphase,status,team1_id,team2_id,current_round,warnings_team1,warnings_team2,is_knockout,winner_id')
        .eq('is_knockout', false)
        .order('arena_id', { ascending: true })
        .order('queue_index', { ascending: true }),
      supabase.from('teams').select('id,name'),
    ])
    if (mErr) {
      if (!quiet) showToast(`Failed to load matches: ${mErr.message}`, 'error')
      setLoading(false)
      return
    }
    setMatches((mData ?? []) as Match[])
    if (tData) {
      const map: Record<string, string> = {}
      tData.forEach(t => { map[t.id] = t.name })
      setTeamNames(map)
    }
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') {
      fetchAll()
      // Jury scores live — repoll so warnings/rounds/status stay correct.
      const t = setInterval(() => fetchAll(true), 10000)
      return () => clearInterval(t)
    }
  }, [authLoading, user, role, fetchAll])

  const handleGenerateMatches = async () => {
    // Full rebuild wipes everything qualitative — guard live results.
    const started = matches.filter(m => m.status !== 'PENDING').length
    if (started > 0 && !window.confirm(
      `Regenerate wipes ${matches.length} qualification match(es), including ${started} already started/completed — those results will be lost. Continue?`
    )) return
    setGenerating(true)
    const { data, error } = await supabase.rpc('generate_phase1_matches')
    if (error) {
      showToast(`Generate failed: ${error.message}`, 'error')
    } else {
      setGenResult((data ?? {}) as Record<string, unknown>)
      const total = (data as { total_matches?: number } | null)?.total_matches
      const teams = (data as { teams?: number } | null)?.teams
      showToast(
        total != null && teams != null
          ? `Phase 1 regenerated — ${total} matches for ${teams} teams, zero walkovers`
          : 'Phase 1 matches generated',
        'success'
      )
      fetchAll()
    }
    setGenerating(false)
  }

  const handlePublish = async (matchId: string) => {
    setPublishing(matchId)
    const { error } = await supabase
      .from('matches')
      .update({ status: 'PUBLISHED' })
      .eq('id', matchId)
    if (error) {
      showToast(`Publish failed: ${error.message}`, 'error')
    } else {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'PUBLISHED' } : m))
    }
    setPublishing(null)
  }

  const handlePublishAll = async () => {
    setPublishingAll(true)
    const { error } = await supabase
      .from('matches')
      .update({ status: 'PUBLISHED' })
      .eq('is_knockout', false)
      .eq('status', 'PENDING')
    if (error) showToast(`Publish all failed: ${error.message}`, 'error')
    else {
      showToast('All pending matches published', 'success')
      fetchAll()
    }
    setPublishingAll(false)
  }

  const handleUnpublish = async (matchId: string) => {
    setPublishing(matchId)
    // Conditional on PUBLISHED: a match the jury just started (IN_PROGRESS)
    // can never be silently pulled back to PENDING.
    const { data, error } = await supabase
      .from('matches')
      .update({ status: 'PENDING' })
      .eq('id', matchId)
      .eq('status', 'PUBLISHED')
      .select('id')
    if (error) {
      showToast(`Unpublish failed: ${error.message}`, 'error')
    } else if (!data || data.length === 0) {
      showToast('Not unpublished — the match is no longer PENDING-published (already live?)', 'error')
    } else {
      setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'PENDING' } : m))
    }
    setPublishing(null)
  }

  const handleUnpublishAll = async () => {
    setPublishingAll(true)
    const { error, count } = await supabase
      .from('matches')
      .update({ status: 'PENDING' })
      .eq('is_knockout', false)
      .eq('status', 'PUBLISHED')
    if (error) showToast(`Unpublish all failed: ${error.message}`, 'error')
    else {
      showToast(`Unpublished ${count ?? 'all published'} match(es) back to PENDING`, 'success')
      fetchAll()
    }
    setPublishingAll(false)
  }

  // ── One PARTICIPANT account per team, unique hard password each ──────────
  // Re-running resets all passwords and returns the new credentials.
  const handleCreateAccounts = async () => {
    const n = Object.keys(teamNames).length
    if (!window.confirm(
      `Create (or reset) participant accounts for all ${n} team(s)?\n\nEach team gets a login + a new unique password. Re-running replaces existing passwords.`
    )) return
    setCreatingAccounts(true)
    try {
      const res = await adminFetch(supabase, '/api/admin/create-team-accounts', {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Account creation failed', 'error')
      } else {
        setAccounts(json.accounts as TeamAccount[])
        showToast(`${json.count} participant accounts ready — save or download the CSV now`, 'success')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Account creation failed', 'error')
    }
    setCreatingAccounts(false)
  }

  const downloadAccountsCsv = () => {
    if (!accounts || accounts.length === 0) return
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
    const csv = ['team_name,email,password',
      ...accounts.map(a => [a.team_name, a.email, a.password].map(esc).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'team-accounts.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // Belt-and-braces: hide any match whose team no longer exists (e.g.
  // leftovers predating the ordered /api/admin/delete-team cleanup).
  // The delete route removes dependents FK-first, so this should normally
  // hide nothing — it exists so a stale row can never linger in the list.
  const visibleMatches = useMemo(
    () =>
      matches.filter(
        m =>
          (!m.team1_id || teamNames[m.team1_id]) &&
          (!m.team2_id || teamNames[m.team2_id])
      ),
    [matches, teamNames]
  )

  // ── Client-side verification: roster-adaptive ──────────────────────────────
  // Target is floor(3N/2): every team 3 vs 3 distinct, except one team at 2
  // when N is odd (arithmetically optimal — see generate_phase1_matches).
  // Orphan matches (deleted teams) are excluded — same list the admin sees.
  const verification = useMemo(() => {
    const rosterN = Object.keys(teamNames).length
    const odd = rosterN % 2 === 1
    const expectedTotal = Math.floor((3 * rosterN) / 2)
    const total = visibleMatches.length
    // Odd rosters accept expectedTotal - 1: the unpatched fallback (3 at 2)
    // when all 3 mutual bye-pairings are already taken (vanishingly rare).
    const totalOk = total === expectedTotal || (odd && total === expectedTotal - 1)
    const pairKey = (a: string | null, b: string | null) =>
      [a ?? '?', b ?? '?'].sort().join('|')
    const all = visibleMatches.map(m => pairKey(m.team1_id, m.team2_id))
    const dupesAll = all.length - new Set(all).size
    const perSub: Record<string, { n: number; dupes: number }> = {}
    for (const m of visibleMatches) {
      const s = `Subphase ${m.subphase ?? '?'}`;
      (perSub[s] ??= { n: 0, dupes: 0 }).n++
    }
    for (const s of Object.keys(perSub)) {
      const keys = visibleMatches
        .filter(m => `Subphase ${m.subphase ?? '?'}` === s)
        .map(m => pairKey(m.team1_id, m.team2_id))
      perSub[s].dupes = keys.length - new Set(keys).size
    }
    const subSizes = Object.values(perSub).map(v => v.n)
    const subSizesOk = subSizes.length === 0 ||
      Math.max(...subSizes) - Math.min(...subSizes) <= 1
    // Per arena: contiguous queues 1..N (sizes follow the roster now)
    const perArena: Record<string, { n: number; queuesOk: boolean; dupes: number }> = {}
    for (const m of visibleMatches) {
      (perArena[m.arena_id] ??= { n: 0, queuesOk: true, dupes: 0 }).n++
    }
    for (const a of Object.keys(perArena)) {
      const am = visibleMatches.filter(m => m.arena_id === a)
      const queues = am.map(m => m.queue_index).sort((x, y) => x - y)
      perArena[a].queuesOk = queues.length > 0 && queues.every((q, i) => q === i + 1)
      const keys = am.map(m => pairKey(m.team1_id, m.team2_id))
      perArena[a].dupes = keys.length - new Set(keys).size
    }
    // Per team: 3 vs 3 distinct each (odd roster: one team at 2, ≤3 in the
    // unpatched fallback — never a walkover, every match has two teams).
    const counts: Record<string, number> = {}
    const opps: Record<string, Set<string>> = {}
    for (const m of visibleMatches) {
      for (const [me, other] of [[m.team1_id, m.team2_id], [m.team2_id, m.team1_id]] as const) {
        if (!me || !other) continue
        counts[me] = (counts[me] ?? 0) + 1
          ; (opps[me] ??= new Set()).add(other)
      }
    }
    const vals = Object.values(counts)
    const short = Object.keys(counts).filter(id => counts[id] < 3).length
    const perTeamOk = odd
      ? Object.keys(counts).every(id =>
          counts[id] <= 3 && counts[id] >= 2 && opps[id].size === counts[id]) && short <= 3
      : Object.keys(counts).every(id => counts[id] === 3 && opps[id].size === 3)
    const perTeam = {
      teams: Object.keys(counts).length,
      min: vals.length ? Math.min(...vals) : 0,
      max: vals.length ? Math.max(...vals) : 0,
      short,
      ok: perTeamOk && Object.keys(counts).length > 0,
    }
    return { rosterN, odd, expectedTotal, total, totalOk, dupesAll, perSub, subSizesOk, perArena, perTeam }
  }, [visibleMatches, teamNames])

  const groupByArena = (list: Match[]): ArenaGroup[] => {
    const groups = new Map<string, Match[]>()
    list.forEach(m => {
      if (!groups.has(m.arena_id)) groups.set(m.arena_id, [])
      groups.get(m.arena_id)!.push(m)
    })
    return Array.from(groups.entries())
      .map(([arena_id, arenaMatches]) => ({ arena_id, matches: arenaMatches }))
      .sort((a, b) => a.arena_id.localeCompare(b.arena_id))
  }

  const statusBadge = (status: string) => {
    const badges: Record<string, string> = {
      PENDING: 'badge-neutral',
      PUBLISHED: 'badge-info',
      IN_PROGRESS: 'badge-warning',
      COMPLETED: 'badge-success',
    }
    return <span className={`badge ${badges[status] || 'badge-neutral'}`}>{status}</span>
  }

  const teamName = (id: string | null) => (id ? teamNames[id] ?? id.slice(0, 8) : '—')

  const hiddenOrphans = matches.length - visibleMatches.length

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading Phase 1 dashboard…
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

  const arenaGroups = groupByArena(visibleMatches)
  const pendingCount = visibleMatches.filter(m => m.status === 'PENDING').length
  const publishedCount = visibleMatches.filter(m => m.status === 'PUBLISHED').length
  const teamsCount = Object.keys(teamNames).length

  return (
    <div className="min-h-screen p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="btn" style={{ minHeight: 40 }}>← Dashboard</Link>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
                Phase 1 Qualification — Admin
              </h1>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Builds from the current roster — floor(3N/2) matches, no walkovers (delete no-shows first) → publish → jury scores in realtime
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn" onClick={() => fetchAll()}
              disabled={generating || publishingAll} style={{ minWidth: 120 }}>
              Refresh
            </button>
            <button className="btn btn-primary" onClick={handleGenerateMatches}
              disabled={generating} style={{ minWidth: 200 }}>
              {generating ? 'Generating…' : 'Generate Phase 1 Matches'}
            </button>
            <button className="btn" onClick={handlePublishAll}
              disabled={publishingAll || pendingCount === 0} style={{ minWidth: 160 }}>
              {publishingAll ? 'Publishing…' : `Publish all (${pendingCount})`}
            </button>
            <button className="btn" onClick={handleUnpublishAll}
              disabled={publishingAll || publishedCount === 0} style={{ minWidth: 160 }}>
              {publishingAll ? '…' : `Unpublish all (${publishedCount})`}
            </button>
          </div>
        </div>

        {toast && (
          <div className={`toast-${toast.type} p-3`} style={{ borderRadius: 8 }} role="alert">
            {toast.message}
          </div>
        )}

        {hiddenOrphans > 0 && (
          <div className="p-3" style={{ borderRadius: 8, border: '1px solid var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface))' }} role="status">
            <span style={{ fontSize: '0.875rem', color: 'var(--color-warning)', fontWeight: 600 }}>
              {hiddenOrphans} match{hiddenOrphans === 1 ? '' : 'es'} hidden — {hiddenOrphans === 1 ? 'it references' : 'they reference'} a deleted team. Regenerate Phase 1 for a clean schedule.
            </span>
          </div>
        )}

        {/* ── Verification (acceptance criterion #1) ── */}
        <div className="card p-6 space-y-4" style={{ borderColor: 'var(--color-accent)' }}>
          {/*<h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-accent)', margin: 0 }}>
            Verification — floor(3N/2) matches, zero repeats, 3 per team (one short if N odd)
          </h3>*/}
          <div className="grid gap-4 sm:grid-cols-5">
            <div className="p-4 sm:col-span-3" style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 4px' }}>TOTAL MATCHES</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: 0 }}>{verification.total}</p>
              <p className="font-mono" style={{ fontSize: '0.75rem', color: verification.totalOk ? 'var(--color-success)' : 'var(--color-danger)', marginTop: 4 }}>
                {verification.totalOk
                  ? `OK — ${verification.expectedTotal} for ${verification.rosterN} teams`
                  : `ERR — expected ${verification.expectedTotal}`}
              </p>
            </div>
            <div className="p-4 sm:col-span-2" style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 4px' }}>REPEATED PAIRINGS (ALL)</p>
              <p style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: 0 }}>{verification.dupesAll}</p>
              <p className="font-mono" style={{ fontSize: '0.75rem', color: verification.dupesAll === 0 ? 'var(--color-success)' : 'var(--color-danger)', marginTop: 4 }}>
                {verification.dupesAll === 0 ? 'OK — zero repeats' : 'ERR — duplicates found'}
              </p>
            </div>
            <div className="p-4 sm:col-span-2" style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 4px' }}>PER SUBPHASE (EVEN SPLIT)</p>
              {Object.entries(verification.perSub).map(([s, v]) => (
                <p key={s} className="font-mono" style={{ fontSize: '0.8rem', margin: '2px 0' }}>
                  {s}: {v.n} · dupes {v.dupes} {v.dupes === 0 ? 'OK' : 'ERR'}
                </p>
              ))}
              {Object.keys(verification.perSub).length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>—</p>
              )}
              {Object.keys(verification.perSub).length > 0 && (
                <p className="font-mono" style={{ fontSize: '0.75rem', color: verification.subSizesOk ? 'var(--color-success)' : 'var(--color-danger)', margin: '4px 0 0' }}>
                  {verification.subSizesOk ? 'OK — even split' : 'ERR — uneven split'}
                </p>
              )}
            </div>
            <div className="p-4 sm:col-span-1" style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 4px' }}>
                {verification.odd ? 'PER TEAM (3, ONE SHORT)' : 'PER TEAM (3 EACH)'}
              </p>
              <p style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
                {verification.perTeam.min}–{verification.perTeam.max}
              </p>
              <p className="font-mono" style={{ fontSize: '0.75rem', color: verification.perTeam.ok ? 'var(--color-success)' : 'var(--color-danger)', marginTop: 4 }}>
                {verification.perTeam.teams === 0
                  ? '—'
                  : verification.perTeam.ok
                    ? verification.odd && verification.perTeam.short > 0
                      ? `OK — ${verification.perTeam.short} short (worst case 1)`
                      : `OK — all ${verification.perTeam.teams} teams at 3`
                    : `ERR — workload off (short: ${verification.perTeam.short})`}
              </p>
            </div>
            <div className="p-4 sm:col-span-2" style={{ background: 'var(--color-bg)', borderRadius: 'var(--radius-card)' }}>
              <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 4px' }}>PER ARENA (QUEUES 1..N)</p>
              {Object.entries(verification.perArena).map(([a, v]) => (
                <p key={a} className="font-mono" style={{ fontSize: '0.8rem', margin: '2px 0' }}>
                  {a}: {v.n} {v.queuesOk ? 'OK' : 'ERR'} · dupes {v.dupes} {v.dupes === 0 ? 'OK' : 'ERR'}
                </p>
              ))}
              {Object.keys(verification.perArena).length === 0 && (
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>—</p>
              )}
            </div>
          </div>
          {genResult && (
            <details>
              <summary style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}>
                Raw generate_phase1_matches() return value
              </summary>
              <pre className="font-mono" style={{
                fontSize: '0.75rem', background: 'var(--color-bg)', padding: 12,
                borderRadius: 8, overflowX: 'auto', marginTop: 8,
              }}>{JSON.stringify(genResult, null, 2)}</pre>
            </details>
          )}
        </div>

        {/* ── Team participant accounts ── */}
        <div className="card p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                Team participant accounts
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                One login per team ({teamsCount} teams) with a unique hard password each.
                Re-running resets all passwords. Passwords are shown once — download the CSV.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary" onClick={handleCreateAccounts}
                disabled={creatingAccounts || teamsCount === 0} style={{ minWidth: 260 }}>
                {creatingAccounts ? 'Creating accounts…' : `Create participant accounts (${teamsCount})`}
              </button>
              {accounts && accounts.length > 0 && (
                <button className="btn" onClick={downloadAccountsCsv} style={{ minWidth: 170 }}>
                  Download CSV
                </button>
              )}
            </div>
          </div>
          {accounts && (
            <div className="overflow-x-auto">
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Team</th>
                    <th>Email (login)</th>
                    <th>Password</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(a => (
                    <tr key={a.team_id}>
                      <td style={{ fontWeight: 600 }}>{a.team_name}</td>
                      <td className="font-mono" style={{ fontSize: '0.8rem' }}>{a.email}</td>
                      <td className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 700 }}>{a.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Matches grouped by arena + queue ── */}
        <div className="space-y-6">
          {arenaGroups.length === 0 ? (
            <div className="card p-12 text-center" style={{ color: 'var(--color-text-tertiary)' }}>
              No qualification matches found. Click <strong>Generate Phase 1 Matches</strong> to build the schedule for {teamsCount} team(s) ({Math.floor((3 * teamsCount) / 2)} matches).
            </div>
          ) : (
            arenaGroups.map(({ arena_id, matches: arenaMatches }) => (
              <div key={arena_id} className="card p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{arena_id}</h2>
                  <span className="badge badge-neutral">{arenaMatches.length} matches</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="ds-table">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>Queue</th>
                        <th style={{ width: 90 }}>Subphase</th>
                        <th>Team 1</th>
                        <th>Team 2</th>
                        <th style={{ width: 120 }}>Status</th>
                        <th style={{ width: 70 }}>Round</th>
                        <th style={{ width: 110 }} title="Current-round warnings — counters reset to 0 every recorded round">Warn T1/T2</th>
                        <th style={{ width: 140 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arenaMatches.map(match => (
                        <tr key={match.id}>
                          <td className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{match.queue_index}</td>
                          <td className="font-mono">{match.subphase ?? '—'}</td>
                          <td style={{ fontWeight: 500 }}>{teamName(match.team1_id)}</td>
                          <td style={{ fontWeight: 500 }}>{teamName(match.team2_id)}</td>
                          <td>{statusBadge(match.status)}</td>
                          <td className="font-mono">{match.current_round ?? 1}</td>
                          <td className="font-mono" style={{ color: 'var(--color-text-tertiary)' }}>
                            {match.warnings_team1 ?? 0} / {match.warnings_team2 ?? 0}
                          </td>
                          <td>
                            {match.status === 'PENDING' ? (
                              <button className="btn btn-primary"
                                onClick={() => handlePublish(match.id)}
                                disabled={publishing === match.id}
                                style={{ minWidth: 110, minHeight: 40 }}>
                                {publishing === match.id ? '…' : 'Publish'}
                              </button>
                            ) : match.status === 'PUBLISHED' ? (
                              <button className="btn"
                                onClick={() => handleUnpublish(match.id)}
                                disabled={publishing === match.id}
                                style={{ minWidth: 110, minHeight: 40 }}>
                                {publishing === match.id ? '…' : 'Unpublish'}
                              </button>
                            ) : (
                              <span className="badge badge-neutral">{match.status}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
