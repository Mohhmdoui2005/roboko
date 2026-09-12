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

export default function ParticipantDashboard() {
  const { user, teamId, isLoading } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [teamNotifs, setTeamNotifs] = useState<TeamNotification[]>([])
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(new Set())
  const [robots, setRobots] = useState<TeamRobot[]>([])
  const [loadingRobots, setLoadingRobots] = useState(true)
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
  }, [supabase])

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
                    onExpired={fetchActiveSession}
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