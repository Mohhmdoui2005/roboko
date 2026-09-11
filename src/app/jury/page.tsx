'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { useQueuedRpc } from '@/lib/useQueuedRpc'
import SyncBadge from '@/components/SyncBadge'

// ── Types ────────────────────────────────────────────────────────────────────
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
  winner_id: string | null
}

interface RoundRow {
  id: string
  match_id: string
  round_number: number
  team1_result: number | null
  team2_result: number | null
  pending?: boolean
}

interface Notification {
  id: string
  arena_id: string | null
  team_id: string | null
  match_id: string | null
  message: string
  type: string | null
  created_at: string
}

interface RoundArgs {
  p_match_id: string
  p_request_id?: string
  p_round_number: number
  p_team1_result: number | null
  p_team2_result: number | null
}

interface WarningArgs {
  p_match_id: string
  p_team_id: string
  p_request_id?: string
}

const ARENA_FALLBACK = ['Arena A', 'Arena B', 'Arena C', 'Arena D']

function resultLabel(t1: number | null, t2: number | null): string {
  if (t1 === 1 && t2 === 0) return 'Team 1 wins'
  if (t1 === 0 && t2 === 1) return 'Team 2 wins'
  return 'Null / draw'
}

// ── Component ────────────────────────────────────────────────────────────────
export default function JuryDashboard() {
  const { user, role, arenaId, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])

  // Arena: jury claim first, manual override fallback (admin/dev, missing claim)
  const [arena, setArena] = useState<string | null>(null)
  const [arenaList, setArenaList] = useState<string[]>(ARENA_FALLBACK)
  useEffect(() => {
    if (arenaId) setArena(arenaId)
    else setArena(prev => prev ?? 'Arena A')
  }, [arenaId])

  // Distinct arenas from the DB drive the picker (new arenas appear automatically)
  useEffect(() => {
    supabase.from('matches').select('arena_id').then(({ data }) => {
      if (data && data.length > 0) {
        setArenaList([...new Set(data.map(m => m.arena_id as string))].sort())
      }
    })
  }, [supabase])

  const [matches, setMatches] = useState<Match[]>([])
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phase reuse: same scoring interface serves qualification AND knockout
  // matches — knockout rows just carry phase = KNOCKOUT.
  const [phase, setPhase] = useState<'QUALIFICATION' | 'KNOCKOUT'>('QUALIFICATION')
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [roundsLoading, setRoundsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [warningBusy, setWarningBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null)
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const submitStartRef = useRef<number | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selectedId

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const teamName = useCallback(
    (id: string | null) => (id ? teamNames[id] ?? id.slice(0, 8) : '—'),
    [teamNames]
  )

  // ── Team names (one fetch; names rarely change) ────────────────────────────
  useEffect(() => {
    supabase.from('teams').select('id,name').then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {}
        data.forEach(t => { map[t.id] = t.name })
        setTeamNames(map)
      }
    })
  }, [supabase])

  // ── Initial fetch: this arena's matches for the active phase, by queue ───
  const fetchMatches = useCallback(async (arenaName: string, phaseName: 'QUALIFICATION' | 'KNOCKOUT') => {
    const { data, error } = await supabase
      .from('matches')
      .select('id,arena_id,queue_index,subphase,status,team1_id,team2_id,current_round,warnings_team1,warnings_team2,winner_id')
      .eq('arena_id', arenaName)
      .eq('is_knockout', phaseName === 'KNOCKOUT')
      .order('queue_index', { ascending: true })
    if (error) {
      showToast(`Failed to load matches: ${error.message}`, 'error')
      return
    }
    setMatches(data ?? [])
  }, [supabase, showToast])

  useEffect(() => {
    if (arena && user) {
      setSelectedId(null)
      fetchMatches(arena, phase)
    }
  }, [arena, phase, user, fetchMatches])

  // ── REALTIME (the one place it's worth it): matches of THIS arena only ─────
  // Spec: subscribe filtered to arena_id=eq.<their arena> — nothing else.
  useEffect(() => {
    if (!arena || !user) return
    const channel = supabase
      .channel(`jury-matches-${arena}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: `arena_id=eq.${arena}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: string }
            setMatches(prev => prev.filter(m => m.id !== old.id))
            return
          }
          const incoming = payload.new as Match
          setMatches(prev => {
            const idx = prev.findIndex(m => m.id === incoming.id)
            const merged = idx >= 0
              ? prev.map(m => (m.id === incoming.id ? { ...m, ...incoming } : m))
              : [...prev, incoming]
            return merged.sort((a, b) => a.queue_index - b.queue_index)
          })
          // Latency evidence: submit → realtime echo
          if (submitStartRef.current !== null && incoming.id === selectedIdRef.current) {
            setLastLatencyMs(Date.now() - submitStartRef.current)
            submitStartRef.current = null
          }
          // Keep the open match's rounds fresh (server is source of truth)
          if (incoming.id === selectedIdRef.current) {
            supabase
              .from('match_rounds')
              .select('id,match_id,round_number,team1_result,team2_result')
              .eq('match_id', incoming.id)
              .order('round_number', { ascending: true })
              .then(({ data }) => {
                if (data) setRounds(data as RoundRow[])
              })
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [arena, user, supabase])

  // ── Rounds for the selected match ──────────────────────────────────────────
  const fetchRounds = useCallback(async (matchId: string) => {
    setRoundsLoading(true)
    const { data, error } = await supabase
      .from('match_rounds')
      .select('id,match_id,round_number,team1_result,team2_result')
      .eq('match_id', matchId)
      .order('round_number', { ascending: true })
    if (!error) setRounds((data ?? []) as RoundRow[])
    setRoundsLoading(false)
  }, [supabase])

  useEffect(() => {
    if (selectedId) fetchRounds(selectedId)
    else setRounds([])
  }, [selectedId, fetchRounds])

  // ── Notifications: poll every 5 s for this arena (polling is fine) ─────────
  const fetchNotifs = useCallback(async (arenaName: string) => {
    const { data } = await supabase
      .from('notifications')
      .select('id,arena_id,team_id,match_id,message,type,created_at')
      .eq('arena_id', arenaName)
      .order('created_at', { ascending: false })
      .limit(5)
    if (data) setNotifs(data as Notification[])
  }, [supabase])

  useEffect(() => {
    if (!arena || !user) return
    fetchNotifs(arena)
    const t = setInterval(() => fetchNotifs(arena), 5000)
    return () => clearInterval(t)
  }, [arena, user, fetchNotifs])

  const selected = matches.find(m => m.id === selectedId) ?? null
  const confirmedRounds = rounds.filter(r => !r.pending)

  // Round 4 unlock: rounds 1-3 all submitted AND all null/null
  const round4Unlocked = [1, 2, 3].every(n => {
    const r = confirmedRounds.find(x => x.round_number === n)
    return r && r.team1_result === null && r.team2_result === null
  })
  const round4Done = confirmedRounds.some(r => r.round_number === 4)
  const isCompleted = selected?.status === 'COMPLETED'

  // ── Round submit via TanStack queued mutation ─────────────────────────────
  // Online: RPC now. Offline/net-fail: enqueued + optimistic success kept;
  // same request_id replays → server dedupes (no double scores).
  const roundMutation = useQueuedRpc<RoundArgs, { status: string; current_round?: number }>({
    endpoint: 'submit_match_round',
    onOptimistic: (args) => {
      setRounds(prev => [
        ...prev.filter(r => !(r.round_number === args.p_round_number && r.pending)),
        {
          id: `pending-${args.request_id}`,
          match_id: args.p_match_id,
          round_number: args.p_round_number,
          team1_result: args.p_team1_result,
          team2_result: args.p_team2_result,
          pending: true,
        },
      ])
      setSubmitting(true)
      submitStartRef.current = Date.now()
    },
    onRollback: (args) => {
      setRounds(prev => prev.filter(r => r.id !== `pending-${args.request_id}`))
      submitStartRef.current = null
      setSubmitting(false)
      fetchRounds(args.p_match_id)
    },
    onSettled: (result, args) => {
      setSubmitting(false)
      if ('error' in result) {
        showToast(`Submit failed: ${result.error.message}`, 'error')
      } else if (result.queued) {
        showToast('Offline — score queued, syncs automatically on reconnect', 'success')
      } else {
        showToast(`Round ${args.p_round_number} submitted`, 'success')
        fetchMatches(arena!, phase)
        fetchRounds(args.p_match_id)
      }
    },
  })

  const submitRound = (t1: number | null, t2: number | null) => {
    if (!selected || submitting || isCompleted) return
    const roundNumber = selected.current_round ?? 1
    if (roundNumber > 4) {
      showToast('All rounds for this match are done', 'error')
      return
    }
    if (roundNumber === 4 && (t1 === null || t2 === null)) {
      showToast('Round 4 must be win/loss — no nulls', 'error')
      return
    }
    roundMutation.mutate({
      p_match_id: selected.id,
      p_round_number: roundNumber,
      p_team1_result: t1,
      p_team2_result: t2,
    })
  }

  // ── Warnings via queued mutation (idempotent p_request_id, no doubles) ─────
  const warningMutation = useQueuedRpc<WarningArgs, { warnings_team1: number; warnings_team2: number }>({
    endpoint: 'increment_warning',
    onOptimistic: (args) => {
      const m = matches.find(x => x.id === args.p_match_id)
      if (!m) return
      const field = args.p_team_id === m.team1_id ? 'warnings_team1' : 'warnings_team2'
      setWarningBusy(args.p_team_id)
      setMatches(prev => prev.map(x =>
        x.id === args.p_match_id ? { ...x, [field]: (x[field as keyof Match] as number) + 1 } : x
      ))
    },
    onRollback: (args) => {
      const m = matches.find(x => x.id === args.p_match_id)
      if (!m) return
      const field = args.p_team_id === m.team1_id ? 'warnings_team1' : 'warnings_team2'
      setMatches(prev => prev.map(x =>
        x.id === args.p_match_id ? { ...x, [field]: (x[field as keyof Match] as number) - 1 } : x
      ))
      setWarningBusy(null)
    },
    onSettled: (result, args) => {
      setWarningBusy(null)
      if ('error' in result) {
        showToast(`Warning failed: ${result.error.message}`, 'error')
      } else if (result.queued) {
        showToast('Offline — warning queued', 'success')
      }
    },
  })

  const addWarning = (teamId: string | null) => {
    if (!selected || !teamId || warningBusy) return
    warningMutation.mutate({ p_match_id: selected.id, p_team_id: teamId })
  }

  // NOTE: every hook must run on every render — nothing hook-like may sit
  // below the early-return guards (that crashes React: "more hooks than
  // during the previous render").
  // Replayed-after-reconnect item definitively rejected → roll back + say so
  const handleSyncDead = useCallback((item: { endpoint: string; request_id: string; payload: Record<string, unknown> }) => {
    if (item.endpoint === 'submit_match_round') {
      setRounds(prev => prev.filter(r => r.id !== `pending-${item.request_id}`))
      const rn = (item.payload.p_round_number as number | undefined) ?? '?'
      showToast(`Queued round ${rn} was rejected after reconnect — rolled back`, 'error')
      if (selectedIdRef.current) fetchRounds(selectedIdRef.current)
    } else if (item.endpoint === 'increment_warning') {
      const mid = item.payload.p_match_id as string
      const tid = item.payload.p_team_id as string
      setMatches(prev => prev.map(m => {
        if (m.id !== mid) return m
        const field = tid === m.team1_id ? 'warnings_team1' : 'warnings_team2'
        return { ...m, [field]: Math.max(0, (m[field as keyof Match] as number) - 1) }
      }))
      showToast('Queued warning was rejected after reconnect — rolled back', 'error')
    }
  }, [showToast, fetchRounds])

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading jury console…
      </div>
    )
  }
  if (!user || (role !== 'JURY' && role !== 'ADMIN' && role !== 'ORGA')) {
    return (
      <div className="min-h-screen p-8 text-center"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Jury access required. Please sign in with a jury account.
      </div>
    )
  }

  const visibleNotif = notifs.find(n => !dismissed.has(n.id)) ?? null

  return (
    <div className="min-h-screen p-4 sm:p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-6xl mx-auto space-y-5">

        {/* ── Header + arena switch ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Jury Console</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              Realtime queue · {arena} · {phase === 'KNOCKOUT' ? 'Knockout' : 'Qualification'} · sorted by queue position
              {lastLatencyMs !== null && (
                <span style={{ color: 'var(--color-success)' }}>
                  {' '}· last update in {lastLatencyMs} ms
                </span>
              )}
            </p>
            <div className="flex gap-2" style={{ marginTop: 8 }}>
              {(['QUALIFICATION', 'KNOCKOUT'] as const).map(p => (
                <button key={p} onClick={() => setPhase(p)} className="btn"
                  style={{
                    minHeight: 36, padding: '0 0.8rem', fontSize: '0.8rem',
                    borderColor: phase === p ? 'var(--color-accent)' : undefined,
                    color: phase === p ? 'var(--color-accent-text)' : undefined,
                  }}>
                  {p === 'QUALIFICATION' ? 'Qualification' : 'Knockout'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Arena</span>
            {arenaList.map(a => (
              <button key={a} onClick={() => { setArena(a); setSelectedId(null) }}
                className="btn" style={{
                  minHeight: 40, padding: '0 0.9rem',
                  borderColor: arena === a ? 'var(--color-accent)' : undefined,
                  color: arena === a ? 'var(--color-accent-text)' : undefined,
                }}>
                {a.replace('Arena ', '')}
              </button>
            ))}
          </div>
        </div>

        {/* ── Get Ready banner (arena poll, 5 s) ── */}
        {visibleNotif && (
          <div className="p-4 flex items-start gap-3"
            style={{
              borderRadius: 8, border: '1px solid var(--color-warning)',
              background: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface))',
            }} role="alert">
            <span style={{ fontSize: '1.25rem' }}>🔔</span>
            <div className="flex-1">
              <p style={{ fontWeight: 700, color: 'var(--color-warning)', margin: 0, fontSize: '0.9rem' }}>
                GET READY
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '0.875rem' }}>{visibleNotif.message}</p>
              <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                {new Date(visibleNotif.created_at).toLocaleTimeString()} · polled every 5 s
              </p>
            </div>
            <button className="btn" style={{ minHeight: 40 }}
              onClick={() => setDismissed(prev => new Set(prev).add(visibleNotif.id))}>
              Dismiss
            </button>
          </div>
        )}

        {toast && (
          <div className={`toast-${toast.type} p-3`} style={{ borderRadius: 8 }} role="alert">
            {toast.message}
          </div>
        )}

        {/* Offline queue: auto-syncs; Retry is the iOS fallback */}
        <SyncBadge onDead={handleSyncDead} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* ── Queue ── */}
          <div className="card p-4 space-y-2">
            <h2 style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>
              Match queue · {matches.length}
            </h2>
            {matches.length === 0 && (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>
                No matches for {arena} yet. Admin must generate + publish Phase 1 matches.
              </p>
            )}
            {matches.map(m => (
              <button key={m.id} onClick={() => setSelectedId(m.id)}
                className="w-full text-left p-3"
                style={{
                  borderRadius: 8,
                  border: `1px solid ${m.id === selectedId ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  background: m.id === selectedId
                    ? 'color-mix(in srgb, var(--color-accent) 6%, transparent)' : 'transparent',
                  cursor: 'pointer',
                }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--color-text-primary)' }}>
                    #{m.queue_index}
                  </span>
                  <span className={`badge ${
                    m.status === 'COMPLETED' ? 'badge-success'
                    : m.status === 'IN_PROGRESS' ? 'badge-warning'
                    : m.status === 'PUBLISHED' ? 'badge-info' : 'badge-neutral'}`}>
                    {m.status}
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {teamName(m.team1_id)} <span style={{ color: 'var(--color-text-tertiary)' }}>vs</span> {teamName(m.team2_id)}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                  Round {m.current_round ?? 1} · ⚠ {m.warnings_team1 ?? 0}/{m.warnings_team2 ?? 0}
                  {m.subphase ? ` · Subphase ${m.subphase}` : ''}
                </p>
              </button>
            ))}
          </div>

          {/* ── Selected match ── */}
          <div className="card p-5 space-y-5" style={{ minHeight: 320 }}>
            {!selected ? (
              <p style={{ color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>
                Select a match from the queue to score it.
              </p>
            ) : (
              <>
                <div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                    #{selected.queue_index} · {teamName(selected.team1_id)} vs {teamName(selected.team2_id)}
                  </h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                    Current round: <strong style={{ color: 'var(--color-text-primary)', fontSize: '1rem' }}>
                      {selected.current_round ?? 1}
                    </strong>
                    {' '}· Status: {selected.status}
                    {isCompleted && selected.winner_id && (
                      <> · Winner: <strong style={{ color: 'var(--color-success)' }}>
                        {teamName(selected.winner_id)}
                      </strong></>
                    )}
                  </p>
                </div>

                {/* Round history */}
                <div>
                  <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>
                    Rounds
                  </h3>
                  {roundsLoading ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>Loading rounds…</p>
                  ) : confirmedRounds.length === 0 && !rounds.some(r => r.pending) ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>No rounds submitted yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {rounds.map(r => (
                        <span key={r.id} className="badge"
                          style={{
                            borderColor: r.pending ? 'var(--color-warning)' : 'var(--color-border)',
                            color: r.pending ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                            fontSize: '0.8rem', padding: '0.4rem 0.8rem',
                          }}>
                          R{r.round_number}: {resultLabel(r.team1_result, r.team2_result)}
                          {r.pending ? ' …' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Submit — large touch buttons */}
                {!isCompleted ? (
                  <div className="space-y-2">
                    <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: 0 }}>
                      Submit round {selected.current_round ?? 1} result
                      {round4Unlocked && !round4Done && (
                        <span style={{ color: 'var(--color-warning)' }}> · Round 4 — win/loss only</span>
                      )}
                    </h3>
                    <div className="grid gap-3" style={{ gridTemplateColumns: '1fr' }}>
                      <button className="btn btn-primary"
                        style={{ minHeight: 64, fontSize: '1.05rem' }}
                        disabled={submitting}
                        onClick={() => submitRound(1, 0)}>
                        🏆 {teamName(selected.team1_id)} WINS
                      </button>
                      {!(round4Unlocked || (selected.current_round ?? 1) === 4) && (
                        <button className="btn"
                          style={{ minHeight: 64, fontSize: '1.05rem' }}
                          disabled={submitting}
                          onClick={() => submitRound(null, null)}>
                          ➖ NULL / DRAW
                        </button>
                      )}
                      <button className="btn btn-primary"
                        style={{ minHeight: 64, fontSize: '1.05rem' }}
                        disabled={submitting}
                        onClick={() => submitRound(0, 1)}>
                        🏆 {teamName(selected.team2_id)} WINS
                      </button>
                    </div>
                    {submitting && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-warning)', margin: 0 }}>
                        Submitting… optimistic update shown, rolling back on error.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-4 text-center"
                    style={{ borderRadius: 8, border: '1px solid var(--color-success)' }}>
                    <p style={{ color: 'var(--color-success)', fontWeight: 700, margin: 0 }}>
                      Match completed — {teamName(selected.winner_id)}
                    </p>
                  </div>
                )}

                {/* Warnings */}
                <div className="space-y-2">
                  <h3 style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: 0 }}>
                    Warnings (separate action)
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { id: selected.team1_id, count: selected.warnings_team1 ?? 0 },
                      { id: selected.team2_id, count: selected.warnings_team2 ?? 0 },
                    ] as const).map(w => (
                      <button key={w.id ?? 'x'} className="btn"
                        style={{ minHeight: 56 }}
                        disabled={!w.id || warningBusy !== null}
                        onClick={() => addWarning(w.id)}>
                        ⚠ {teamName(w.id)} ({w.count})
                        {warningBusy === w.id ? ' …' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
