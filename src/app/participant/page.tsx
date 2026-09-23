'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { QRCodeSVG } from 'qrcode.react'
import Countdown from '@/components/Countdown'

interface Profile {
  id: string
  name?: string
  team_id?: string | null
}

interface TeamRobot {
  id: string
  name: string
  qr_payload: string | null
}

interface ActiveSession {
  session_id: string
  robot_id: string
  robot_name: string
  ends_at: string
}

interface TeamNotification {
  id: string
  message: string
  type: string | null
  created_at: string
  match_id: string | null
}

interface TeamMatch {
  id: string
  arena_id: string
  queue_index: number
  subphase: number | null
  status: string
  team1_id: string | null
  team2_id: string | null
  current_round: number | null
  winner_id: string | null
}

interface TeamMatchRound {
  match_id: string
  round_number: number
  team1_result: number | null
  team2_result: number | null
}

export default function ParticipantDashboard() {
  const { user, teamId, isLoading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [teamNotifs, setTeamNotifs] = useState<TeamNotification[]>([])
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set())
  const [robots, setRobots] = useState<TeamRobot[]>([])
  const [loadingRobots, setLoadingRobots] = useState(true)
  const [teamMatches, setTeamMatches] = useState<TeamMatch[]>([])
  const [matchRounds, setMatchRounds] = useState<TeamMatchRound[]>([])
  const [teamsMap, setTeamsMap] = useState<Record<string, string>>({})
  const [loadingMatches, setLoadingMatches] = useState(true)
  const [timeUp, setTimeUp] = useState(false)
  // offsetMs: Date.now() − serverNow — corrects for device clock drift
  const [offsetMs, setOffsetMs] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const notifPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const supabase = createClient()

  // ── Load profile once (real columns: id, name, team_id) ──────────────────
  const loadProfile = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('id, name, team_id')
      .eq('id', user.id)
      .single()
    if (data) setProfile(data)
    setLoadingProfile(false)
  }, [user, supabase])

  // ── Get server time once on mount — compute clock offset ─────────────────
  const syncServerTime = useCallback(async () => {
    const before = Date.now()
    const { data } = await supabase.rpc('get_server_time')
    const after = Date.now()
    // Contract is {now}, but tolerate a bare timestamptz scalar (legacy shape).
    const nowRaw = typeof data === 'string' ? data : (data as { now?: string } | null)?.now
    if (nowRaw) {
      const serverNow = new Date(nowRaw).getTime()
      // Use midpoint of the round-trip to estimate the server time
      const midpoint = (before + after) / 2
      setOffsetMs(midpoint - serverNow)
    }
  }, [supabase])

  // ── Poll active session every 10 s — no Realtime ─────────────────────────
  const fetchActiveSession = useCallback(async () => {
    const { data } = await supabase.rpc('get_my_active_session')
    setActiveSession(data ?? null)
    // A fresh session clears any earlier time-up alert.
    if (data) setTimeUp(false)
  }, [supabase])

  // ── Session hit zero: unmissable leave-the-room alert ────────────────────
  const handleSessionExpired = useCallback(() => {
    setTimeUp(true)
    try { navigator.vibrate(200) } catch { /* unsupported — visual alert stands */ }
    fetchActiveSession()
  }, [fetchActiveSession])

  // ── Team robot(s): their ROBOT_TEST QR is what the test room scans ───────
  const fetchRobots = useCallback(async (tid: string | null | undefined) => {
    if (!tid) {
      setRobots([])
      setLoadingRobots(false)
      return
    }
    const { data } = await supabase
      .from('robots')
      .select('id,name,qr_payload')
      .eq('team_id', tid)
      .order('name')
    if (data) setRobots(data as TeamRobot[])
    setLoadingRobots(false)
  }, [supabase])

  // ── My qualification matches: published only (publish is the release gate).
  // Polled every 10 s like everything else here — intentionally no realtime.
  const fetchTeamMatches = useCallback(async (tid: string) => {
    const [{ data: mData }, { data: tData }] = await Promise.all([
      supabase
        .from('matches')
        .select('id,arena_id,queue_index,subphase,status,team1_id,team2_id,current_round,winner_id')
        .or(`team1_id.eq.${tid},team2_id.eq.${tid}`)
        .eq('is_knockout', false)
        .in('status', ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'])
        .order('subphase', { ascending: true })
        .order('queue_index', { ascending: true }),
      supabase.from('teams').select('id,name'),
    ])
    const list = (mData ?? []) as TeamMatch[]
    setTeamMatches(list)
    if (tData) {
      const map: Record<string, string> = {}
      ;(tData as { id: string; name: string }[]).forEach(t => { map[t.id] = t.name })
      setTeamsMap(map)
    }
    if (list.length > 0) {
      const { data: rData } = await supabase
        .from('match_rounds')
        .select('match_id,round_number,team1_result,team2_result')
        .in('match_id', list.map(m => m.id))
        .order('round_number', { ascending: true })
      if (rData) setMatchRounds(rData as TeamMatchRound[])
    } else {
      setMatchRounds([])
    }
    setLoadingMatches(false)
  }, [supabase])

  // ── GET READY alerts: poll notifications for MY team every 10 s ───────────
  // Server trigger fires on round-2 submit of the preceding arena match, so
  // worst case the banner lands ~10 s after the trigger — per acceptance.
  const fetchTeamNotifs = useCallback(async () => {
    if (!teamId) return
    const { data } = await supabase
      .from('notifications')
      .select('id,message,type,created_at,match_id')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(3)
    if (data) setTeamNotifs(data as TeamNotification[])
  }, [supabase, teamId])

  useEffect(() => {
    if (isLoading || !user) {
      if (!isLoading) setLoadingProfile(false)
      return
    }

    loadProfile()
    syncServerTime()
    fetchActiveSession()
    fetchTeamNotifs()

    // 10 000 ms polling — intentionally no Supabase realtime subscription
    pollRef.current = setInterval(fetchActiveSession, 10000)
    notifPollRef.current = setInterval(fetchTeamNotifs, 10000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (notifPollRef.current) clearInterval(notifPollRef.current)
    }
  }, [user, isLoading, loadProfile, syncServerTime, fetchActiveSession, fetchTeamNotifs])

  // Robots load once the team is known (profile row first, JWT fallback).
  const profileTeamId = profile?.team_id ?? null
  useEffect(() => {
    fetchRobots(profileTeamId ?? teamId)
  }, [profileTeamId, teamId, fetchRobots])

  // Matches load the same way — published qual matches + their rounds,
  // refreshed every 10 s so results land without a reload.
  const effectiveTeamId = profileTeamId ?? teamId ?? null
  useEffect(() => {
    if (!user || !effectiveTeamId) {
      if (!isLoading) setLoadingMatches(false)
      return
    }
    fetchTeamMatches(effectiveTeamId)
    const t = setInterval(() => fetchTeamMatches(effectiveTeamId), 10000)
    return () => clearInterval(t)
  }, [user, isLoading, effectiveTeamId, fetchTeamMatches])

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading || loadingProfile) {
    return (
      <div
        className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}
      >
        Loading participant profile…
      </div>
    )
  }

  if (!user) {
    return (
      <div
        className="min-h-screen p-8 text-center"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}
      >
        Please sign in to view your participant dashboard.
      </div>
    )
  }

  const visibleNotif = teamNotifs.find(n => !dismissedNotifs.has(n.id)) ?? null

  // ── Match presentation from MY team's perspective ────────────────────────
  const oppName = (m: TeamMatch) => {
    const oppId = m.team1_id === effectiveTeamId ? m.team2_id : m.team1_id
    return oppId ? teamsMap[oppId] ?? oppId.slice(0, 8) : 'TBD'
  }
  const roundsFor = (matchId: string) =>
    matchRounds.filter(r => r.match_id === matchId)
  const roundOutcome = (r: TeamMatchRound, m: TeamMatch): 'Won' | 'Lost' | 'Draw' => {
    const mine = m.team1_id === effectiveTeamId ? r.team1_result : r.team2_result
    const theirs = m.team1_id === effectiveTeamId ? r.team2_result : r.team1_result
    if (mine === 1 && theirs === 0) return 'Won'
    if (mine === 0 && theirs === 1) return 'Lost'
    return 'Draw'
  }
  const matchOutcome = (m: TeamMatch): string => {
    if (m.status === 'COMPLETED') {
      if (!m.winner_id) return 'Draw'
      return m.winner_id === effectiveTeamId ? 'Won' : 'Lost'
    }
    if (m.status === 'IN_PROGRESS') return `Live · round ${m.current_round ?? 1}`
    return 'Scheduled'
  }
  const statusBadgeClass = (status: string) =>
    status === 'COMPLETED' ? 'badge-success'
    : status === 'IN_PROGRESS' ? 'badge-warning'
    : status === 'PUBLISHED' ? 'badge-info' : 'badge-neutral'

  return (
    <div
      className="min-h-screen p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}
    >
      <div className="max-w-2xl mx-auto space-y-8">
        {/* ── Header ── */}
        <div
          className="pb-5"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-heading)',
              color: 'var(--color-text-primary)',
              margin: 0
            }}
          >
            Participant Dashboard
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 6 }}>
            Welcome, {profile?.name || user.email}!
          </p>
        </div>

        {/* ── GET READY alert banner (team notifications, polled every 10 s) ── */}
        {visibleNotif && (
          <div className="p-4 flex items-start gap-3"
            style={{
              borderRadius: 8,
              border: '1px solid var(--color-warning)',
              background: 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface))',
            }} role="alert">
            <span className="font-mono text-xs font-bold" style={{ color: 'var(--color-warning)', border: '1px solid var(--color-warning)', borderRadius: 6, padding: '2px 6px', whiteSpace: 'nowrap' }}>READY</span>
            <div className="flex-1">
              <p style={{ fontWeight: 700, color: 'var(--color-warning)', margin: 0, fontSize: '0.9rem' }}>
                GET READY — YOUR MATCH IS NEXT
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '0.875rem', color: 'var(--color-text-primary)' }}>
                {visibleNotif.message}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                {new Date(visibleNotif.created_at).toLocaleTimeString()} · updates every 10 s
              </p>
            </div>
            <button className="btn" style={{ minHeight: 48 }}
              onClick={() => setDismissedNotifs(prev => new Set(prev).add(visibleNotif.id))}>
              Dismiss
            </button>
          </div>
        )}

        {/* ── TIME'S UP — leave the room (persists until dismissed) ── */}
        {timeUp && !activeSession && (
          <div className="p-5 text-center space-y-3"
            style={{
              borderRadius: 8,
              border: '2px solid var(--color-danger)',
              background: 'color-mix(in srgb, var(--color-danger) 12%, var(--color-surface))',
            }} role="alert">
            <p style={{ fontWeight: 800, color: 'var(--color-danger)', margin: 0, fontSize: '1.5rem' }}>
              TIME'S UP
            </p>
            <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)', fontWeight: 600 }}>
              Your test time is over — please leave the test room now.
            </p>
            <button className="btn" style={{ minHeight: 48 }}
              onClick={() => setTimeUp(false)}>
              Dismiss
            </button>
          </div>
        )}

        {/* ── My Matches (published qualification, polled every 10 s) ── */}
        <div className="card card-emphasized p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              My Matches
            </h2>
            <span className="badge badge-neutral">{teamMatches.length} matches</span>
          </div>

          {loadingMatches ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              Loading matches…
            </div>
          ) : teamMatches.length === 0 ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              No matches published for your team yet — check back after the admin publishes Phase 1.
            </div>
          ) : (
            <div className="space-y-3">
              {teamMatches.map(m => {
                const outcome = matchOutcome(m)
                const outcomeColor =
                  outcome === 'Won' ? 'var(--color-success)'
                  : outcome === 'Lost' ? 'var(--color-danger)'
                  : outcome === 'Draw' ? 'var(--color-text-secondary)'
                  : outcome.startsWith('Live') ? 'var(--color-warning)'
                  : 'var(--color-text-tertiary)'
                return (
                  <div key={m.id} className="p-4 space-y-2"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                        vs {oppName(m)}
                      </p>
                      <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                      {m.arena_id} · Queue #{m.queue_index}{m.subphase ? ` · Subphase ${m.subphase}` : ''}
                    </p>
                    {roundsFor(m.id).length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {roundsFor(m.id).map(r => {
                          const ro = roundOutcome(r, m)
                          return (
                            <span key={r.round_number} className="badge"
                              style={{
                                borderColor: ro === 'Won' ? 'var(--color-success)' : ro === 'Lost' ? 'var(--color-danger)' : 'var(--color-border)',
                                color: ro === 'Won' ? 'var(--color-success)' : ro === 'Lost' ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                                fontSize: '0.75rem', padding: '0.3rem 0.7rem',
                              }}>
                              R{r.round_number} · {ro}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: outcomeColor }}>
                      {outcome}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Active Test Session Countdown ── */}
        <div className={`card ${activeSession ? 'card-live' : 'card-emphasized'} p-6 space-y-4`}>
          <div className="flex items-center justify-between">
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
              Current Test Session
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
              polls every 10 s · no WebSocket
            </span>
          </div>

          {activeSession ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-6 pt-2">
              <div className="flex-1 space-y-1">
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                  Robot: <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{activeSession.robot_name}</span>
                </p>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  Ends at {new Date(activeSession.ends_at).toLocaleTimeString()}
                </p>
              </div>
              <div className="text-center sm:text-right">
                <p style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>
                  Time Remaining
                </p>
                <div style={{ fontSize: '3rem', fontWeight: 700, lineHeight: 1 }}>
                  <Countdown
                    endsAt={activeSession.ends_at}
                    offsetMs={offsetMs}
                    onExpired={handleSessionExpired}
                  />
                </div>
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                  clock offset: {offsetMs > 0 ? '+' : ''}{Math.round(offsetMs)} ms
                </p>
              </div>
            </div>
          ) : (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              No active test session right now.
            </div>
          )}
        </div>

        {/* ── Team Testing QR Code ── */}
        <div className="card p-6 space-y-5">
          <div className="text-left">
            <div className="flex flex-wrap items-center justify-start gap-2">
              <span className="badge badge-info">
                ROBOT_TEST
              </span>
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: '8px 0 0' }}>
              Team Testing QR Code
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5, margin: '6px 0 0' }}>
              Show this at the test room — orga scans it to start your test session.
            </p>
          </div>

          {loadingRobots ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              Loading team QR…
            </div>
          ) : robots.length === 0 ? (
            <div style={{ padding: '2rem 0', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              No robot linked to your team yet — ask an admin.
            </div>
          ) : (
            robots.map((robot) => (
              <div key={robot.id} className="flex flex-col md:flex-row items-center gap-6">
                <div
                  style={{
                    padding: '0.75rem',
                    background: 'var(--color-qr-paper)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  {robot.qr_payload ? (
                    <QRCodeSVG value={robot.qr_payload} size={160} level="H" includeMargin={false} />
                  ) : (
                    <div
                      style={{
                        width: 160,
                        height: 160,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        fontSize: '0.75rem',
                        color: 'var(--color-text-tertiary)',
                        border: '1px dashed var(--color-border)',
                        borderRadius: 4,
                        padding: 8
                      }}
                    >
                      QR not generated for this robot yet.
                    </div>
                  )}
                </div>
                <div className="space-y-2 text-center md:text-left flex-1">
                  <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>
                    {robot.name}
                  </p>
                  <p style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
                    scanned by orga to open /orga/testing sessions
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}