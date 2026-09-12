'use client'
// Hallmark · genre: atmospheric · macrostructure: Stat-Led · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import BracketSvg, { type BracketNode, type BracketMatch } from '@/components/BracketSvg'
import { visibleSignature, type LiveSnapshot } from '@/lib/liveSig'

interface BoardRow {
  team_id: string
  name: string
  matches_played: number
  wins: number
}

// Realtime event → visible paint budget: 500 ms debounce + ~100 ms fetch.
const DEBOUNCE_MS = 500
// Realtime disconnected → poll this often (and only then).
const FALLBACK_POLL_MS = 30000

export default function LivePage() {
  const supabase = useMemo(() => createClient(), [])
  const [knockoutLive, setKnockoutLive] = useState(false)
  const [board, setBoard] = useState<BoardRow[]>([])
  const [nodes, setNodes] = useState<BracketNode[]>([])
  const [koMatches, setKoMatches] = useState<Record<string, BracketMatch>>({})
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [connected, setConnected] = useState(false)
  const [fallback, setFallback] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)

  const sigRef = useRef<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)
  const subsRef = useRef({ matches: false, bracket: false })

  // ── Full refresh, applied ONLY on visible change ──────────────────────────
  const refresh = useCallback(async () => {
    const [{ data: ts }, { data: lb }, { data: n }, { data: km }, { data: t }] = await Promise.all([
      supabase.from('tournament_state').select('knockout_live').limit(1).single(),
      supabase.rpc('get_phase1_leaderboard'),
      supabase.from('bracket_nodes').select('id,ko_stage,position,match_id,next_node_id'),
      supabase.from('matches').select('id,team1_id,team2_id,winner_id,status').eq('is_knockout', true),
      supabase.from('teams').select('id,name'),
    ])
    if (!mountedRef.current) return

    const koLive = (ts as { knockout_live: boolean } | null)?.knockout_live ?? false
    // Phase 1: list ALL teams (36), not just the top 16 — the leaderboard
    // RPC already returns every team ordered by wins.
    const boardRows = ((lb ?? []) as BoardRow[])
    const nodeRows = ((n ?? []) as BracketNode[])
    const matchMap: Record<string, BracketMatch> = {}
    ;(((km ?? []) as BracketMatch[])).forEach(m => { matchMap[m.id] = m })

    // Include live qualification matches in the signature (status/winner only)
    const { data: qm } = await supabase
      .from('matches')
      .select('id,status,team1_id,team2_id,winner_id')
      .eq('is_knockout', false)
      .in('status', ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'])
    if (!mountedRef.current) return
    const allMatches = [
      ...(((qm ?? []) as BracketMatch[])),
      ...Object.values(matchMap),
    ]

    const snap: LiveSnapshot = {
      knockoutLive: koLive,
      matches: allMatches,
      board: boardRows,
      nodes: nodeRows.map(x => ({ id: x.id, match_id: x.match_id })),
    }
    if (visibleSignature(snap) === sigRef.current) return // nothing visible changed

    sigRef.current = visibleSignature(snap)
    setKnockoutLive(koLive)
    setBoard(boardRows)
    setNodes(nodeRows)
    setKoMatches(matchMap)
    if (t) {
      const map: Record<string, string> = {}
      t.forEach(x => { map[x.id] = x.name })
      setTeamNames(map)
    }
    setLastUpdate(new Date().toLocaleTimeString())
  }, [supabase])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { refresh() }, DEBOUNCE_MS)
  }, [refresh])

  const startFallback = useCallback(() => {
    setFallback(true)
    if (pollRef.current) return
    pollRef.current = setInterval(() => { refresh() }, FALLBACK_POLL_MS)
  }, [refresh])

  const stopFallback = useCallback(() => {
    setFallback(false)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  // ── Subscriptions: exactly two channels ───────────────────────────────────
  // 1) matches filtered to visible statuses  2) bracket_nodes (advancement)
  useEffect(() => {
    mountedRef.current = true
    refresh()

    const onStatus = (which: 'matches' | 'bracket', ok: boolean) => {
      if (!mountedRef.current) return
      subsRef.current[which] = ok
      const bothUp = subsRef.current.matches && subsRef.current.bracket
      setConnected(bothUp)
      // Partially blind (either channel down) counts as disconnected → poll.
      if (bothUp) stopFallback()
      else startFallback()
    }

    const chMatches = supabase
      .channel('live-matches')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'matches',
          filter: 'status=in.(PUBLISHED,IN_PROGRESS,COMPLETED)',
        },
        () => scheduleRefresh()
      )
      .subscribe(status => onStatus('matches', status === 'SUBSCRIBED'))

    const chBracket = supabase
      .channel('live-bracket')
      .on(
        'postgres_changes',
          { event: '*', schema: 'public', table: 'bracket_nodes' },
        () => scheduleRefresh()
      )
      .subscribe(status => onStatus('bracket', status === 'SUBSCRIBED'))

    const onVisible = () => { if (!document.hidden) scheduleRefresh() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
      supabase.removeChannel(chMatches)
      supabase.removeChannel(chBracket)
    }
  }, [supabase, refresh, scheduleRefresh, startFallback, stopFallback])

  // ── Screen Wake Lock: keep the venue display awake ────────────────────────
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    let cancelled = false
    const request = async () => {
      try {
        if ('wakeLock' in navigator) {
          lock = await (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock.request('screen')
          if (cancelled && lock) { lock.release().catch(() => {}) ; lock = null }
        }
        // No iOS fallback video: optional per spec, skipped to keep the page lean.
      } catch {
        // Wake Lock denied/unavailable (battery saver, iOS) — page works regardless.
      }
    }
    request()
    return () => {
      cancelled = true
      if (lock) lock.release().catch(() => {})
    }
  }, [])

  return (
    <div className="min-h-screen p-4 sm:p-8"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      {/* CSS-only pulse — no JS animation loops anywhere on this page */}
      <style>{`@keyframes live-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>

      <div className="max-w-6xl mx-auto space-y-6">
        <div className="surface-grid flex items-start justify-between gap-4 px-4 py-4 -mx-4 sm:-mx-8"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="section-head">
            <span className="section-head__label">{knockoutLive ? 'Knockout stage' : 'Qualification'} · venue display</span>
            <h1 className="section-head__title" style={{ fontSize: '2rem', fontWeight: 800, margin: 0 }}>
              {knockoutLive ? 'Knockout Stage' : 'Qualification'}
            </h1>
            <p className="stat-hero__qualifier">
              {lastUpdate ? `updated ${lastUpdate}` : 'loading…'}
              {fallback ? ' · reconnecting (30 s poll)' : ''}
            </p>
          </div>
          <span className="badge badge-success" style={{ fontSize: '0.9rem', padding: '0.5rem 1rem' }}>
            <span style={{
              display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
              background: connected ? 'var(--color-success)' : 'var(--color-warning)',
              marginRight: 8,
              animation: connected ? 'live-pulse 1.8s ease-in-out infinite' : 'none',
            }} />
            {connected ? 'LIVE' : fallback ? 'POLLING' : 'CONNECTING'}
          </span>
        </div>

        {!knockoutLive ? (
          <>
            {board.length > 0 && (
              <div>
                <p className="stat-hero__number">{board[0].wins}</p>
                <p className="stat-hero__qualifier">
                  wins lead · {board[0].name} · {board.length} teams
                </p>
              </div>
            )}
          <div className="overflow-x-auto card p-2 sm:p-4">
            <table className="ds-table" style={{ fontSize: '1.05rem' }}>
              <thead>
                <tr><th style={{ width: 60 }}>#</th><th>Team</th>
                  <th style={{ width: 110 }}>Played</th><th style={{ width: 100 }}>Wins</th></tr>
              </thead>
              <tbody>
                {board.map((r, i) => (
                  <tr key={r.team_id}>
                    <td className="font-mono" style={{ color: 'var(--color-text-primary)', fontSize: '1.2rem' }}>{i + 1}</td>
                    <td style={{ fontWeight: 700, color: 'var(--color-text-primary)', fontSize: '1.15rem' }}>{r.name}</td>
                    <td className="font-mono" style={{ fontSize: '1.1rem' }}>{r.matches_played}</td>
                    <td className="font-mono" style={{
                      fontSize: '1.2rem', fontWeight: 800,
                      color: r.wins > 0 ? 'var(--color-success)' : undefined,
                    }}>{r.wins}</td>
                  </tr>
                ))}
                {board.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: 'center', padding: '3rem' }}>
                    Standings appear once matches complete.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          </>
        ) : (
          <div className="overflow-x-auto card p-2">
            <BracketSvg nodes={nodes} matches={koMatches} teamNames={teamNames} />
          </div>
        )}
        <footer className="font-mono" style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
          roboko · live · {connected ? 'subscribed: matches + bracket' : 'polling fallback'} · renders only on visible change
        </footer>
      </div>
    </div>
  )
}
