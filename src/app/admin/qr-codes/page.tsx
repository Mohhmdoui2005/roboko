'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { adminFetch } from '@/lib/adminApi'
import { QRCodeSVG } from 'qrcode.react'

interface Robot {
  id: string
  name: string
  team_id?: string
  qr_payload: string | null
  teams?: { name: string } | null
}

interface LunchBadge {
  id: string
  name: string
  lunch_qr_payload: string | null
}

export default function AdminQRCodesPage() {
  const supabase = useMemo(() => createClient(), [])
  const [printOnly, setPrintOnly] = useState<null | 'lunch' | 'testing'>(null)

  // ── Lunch badges ──
  const [badges, setBadges] = useState<LunchBadge[]>([])
  const [badgesLoading, setBadgesLoading] = useState(true)
  const [lunchCount, setLunchCount] = useState('50')
  const [generatingLunch, setGeneratingLunch] = useState(false)
  const [lunchMsg, setLunchMsg] = useState('')

  // ── Testing (robot) QRs ──
  const [robots, setRobots] = useState<Robot[]>([])
  const [robotsLoading, setRobotsLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  // Reset the print filter after the print dialog closes.
  useEffect(() => {
    const reset = () => setPrintOnly(null)
    window.addEventListener('afterprint', reset)
    return () => window.removeEventListener('afterprint', reset)
  }, [])

  const printSection = useCallback((which: 'lunch' | 'testing') => {
    setPrintOnly(which)
    setTimeout(() => window.print(), 50)
  }, [])

  const loadBadges = useCallback(async () => {
    setBadgesLoading(true)
    try {
      const res = await adminFetch(supabase, '/api/admin/generate-lunch-badges')
      const json = await res.json()
      if (res.ok) setBadges((json.badges ?? []) as LunchBadge[])
      else setLunchMsg('Error: ' + (json.error || res.statusText))
    } catch (e) {
      setLunchMsg('Error: ' + (e instanceof Error ? e.message : 'network error'))
    } finally {
      setBadgesLoading(false)
    }
  }, [supabase])

  const loadRobots = useCallback(async () => {
    setRobotsLoading(true)
    const { data, error } = await supabase
      .from('robots')
      .select('id, name, qr_payload, teams(name)')
      .order('name')
    if (!error && data) setRobots(data as unknown as Robot[])
    setRobotsLoading(false)
  }, [supabase])

  useEffect(() => { loadBadges() }, [loadBadges])
  useEffect(() => { loadRobots() }, [loadRobots])

  const handleGenerateLunch = async () => {
    const count = Number(lunchCount)
    if (!Number.isInteger(count) || count < 1 || count > 200) {
      setLunchMsg('Enter a whole number between 1 and 200.')
      return
    }
    setGeneratingLunch(true)
    setLunchMsg(`Generating ${count} lunch badge(s)…`)
    try {
      const res = await adminFetch(supabase, '/api/admin/generate-lunch-badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      const json = await res.json()
      if (!res.ok) {
        setLunchMsg('Error: ' + (json.error || res.statusText))
      } else {
        setLunchMsg(`Issued ${json.count} lunch badge(s) — single-use, cut up & hand out.`)
        await loadBadges()
      }
    } catch (e) {
      setLunchMsg('Error: ' + (e instanceof Error ? e.message : 'network error'))
    } finally {
      setGeneratingLunch(false)
    }
  }

  const handleEnsurePayloads = async () => {
    setGenerating(true)
    setStatusMsg('Ensuring one robot per team + QR payloads…')
    try {
      const res = await adminFetch(supabase, '/api/admin/generate-testing-qrs', {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok) {
        setStatusMsg('Error: ' + (json.error || res.statusText))
      } else {
        setStatusMsg(
          `${json.teams} team(s) → ${json.robots} robot(s) ` +
          `(${json.created} created, ${json.backfilled} payload(s) backfilled).`
        )
        await loadRobots()
      }
    } catch (e) {
      setStatusMsg('Error: ' + (e instanceof Error ? e.message : 'network error'))
    } finally {
      setGenerating(false)
    }
  }

  const downloadSVG = (fileName: string, elementId: string) => {
    const svg = document.getElementById(elementId)
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${fileName.replace(/\s+/g, '_')}_QR.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-10" style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>

      {/* ── Header ── */}
      <div
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 print:hidden"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <div className="flex items-center gap-3">
            <Link href="/admin" className="btn" style={{ minHeight: 40 }}>← Dashboard</Link>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em', fontFamily: 'var(--font-heading)', margin: 0 }}>
              QR Codes
            </h1>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Lunch badges for catering · robot test codes for the test room
          </p>
        </div>
      </div>

      {/* ══ Section 1 — Lunch badges ══ */}
      <section className={printOnly === 'testing' ? 'print:hidden' : ''} aria-label="Lunch QR codes">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 print:hidden"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', margin: 0 }}>
              Lunch QR Codes
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              Generic single-use badges · <code style={{ fontFamily: 'var(--font-mono)' }}>domain: "PERSON_LUNCH"</code>.
              First scan claims the meal — a second scan flashes ALREADY CLAIMED.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input font-mono"
              type="number"
              min={1}
              max={200}
              value={lunchCount}
              onChange={e => setLunchCount(e.target.value)}
              placeholder="How many?"
              aria-label="How many lunch QR codes to generate"
              style={{ minHeight: 48, width: 130 }}
            />
            <button
              onClick={handleGenerateLunch}
              disabled={generatingLunch}
              className="btn btn-primary"
              style={{ minHeight: 48 }}
            >
              {generatingLunch ? 'Generating…' : 'Generate lunch QRs'}
            </button>
            <button onClick={() => printSection('lunch')} className="btn" style={{ minHeight: 48 }}>
              Print lunch badges
            </button>
          </div>
        </div>

        {lunchMsg && (
          <div
            className="toast-success print:hidden"
            style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, marginTop: 12 }}
          >
            {lunchMsg}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {badgesLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              Loading lunch badges…
            </div>
          ) : badges.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              No lunch badges yet — enter how many you want above and generate.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-5">
              {badges.map(b => {
                if (!b.lunch_qr_payload) return null
                const svgId = `lunch-qr-${b.id}`
                return (
                  <div
                    key={b.id}
                    className="card sm:col-span-3 lg:col-span-2"
                    style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', pageBreakInside: 'avoid' }}
                  >
                    {/* White bg for QR contrast */}
                    <div style={{ padding: 10, background: 'var(--color-qr-paper)', borderRadius: 6, marginBottom: 12 }}>
                      <QRCodeSVG id={svgId} value={b.lunch_qr_payload} size={150} level="M" includeMargin={false} />
                    </div>
                    <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-primary)', margin: 0 }}>
                      {b.name}
                    </h3>
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '2px 0 12px' }}>
                      single-use lunch badge
                    </p>
                    <button
                      onClick={() => downloadSVG(b.name, svgId)}
                      className="btn print:hidden"
                      style={{ minHeight: 48, padding: '0 0.875rem', fontSize: '0.8125rem', width: '100%' }}
                    >
                      Download SVG
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ══ Section 2 — Testing (robot) QRs ══ */}
      <section className={printOnly === 'lunch' ? 'print:hidden' : ''} aria-label="Testing QR codes">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 print:hidden"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)', margin: 0 }}>
              Testing QR Codes
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              One code per team — generate creates any missing robots, then fills every payload · <code style={{ fontFamily: 'var(--font-mono)' }}>domain: "ROBOT_TEST"</code>
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={handleEnsurePayloads}
              disabled={generating}
              className="btn btn-primary"
              style={{ minHeight: 48 }}
            >
              {generating ? 'Processing…' : 'Generate testing QRs'}
            </button>
            <button onClick={() => printSection('testing')} className="btn" style={{ minHeight: 48 }}>
              Print testing QRs
            </button>
          </div>
        </div>

        {statusMsg && (
          <div
            className="toast-success print:hidden"
            style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500, marginTop: 12 }}
          >
            {statusMsg}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {robotsLoading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              Loading robots…
            </div>
          ) : robots.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
              No robots found in database.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-5">
              {robots.map(robot => {
                const payload = robot.qr_payload || JSON.stringify({ domain: 'ROBOT_TEST', robot_id: robot.id })
                const svgId = `qr-svg-${robot.id}`
                const teamName = robot.teams?.name ?? `ID: ${robot.id.slice(0, 8)}…`
                return (
                  <div
                    key={robot.id}
                    className="card sm:col-span-3 lg:col-span-2"
                    style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', pageBreakInside: 'avoid' }}
                  >
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '0 0 12px' }}>
                      {robot.name}
                    </p>

                    {/* White bg for QR contrast */}
                    <div style={{ padding: 10, background: 'var(--color-qr-paper)', borderRadius: 6, marginBottom: 12 }}>
                      <QRCodeSVG id={svgId} value={payload} size={150} level="M" includeMargin={false} />
                    </div>

                    {/* Team name under the QR */}
                    <h3 style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--color-text-primary)', margin: 0 }}>
                      {teamName}
                    </h3>
                    <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '2px 0 12px' }}>
                      scanned by orga to open a test session
                    </p>

                    <button
                      onClick={() => downloadSVG(robot.name, svgId)}
                      className="btn print:hidden"
                      style={{ minHeight: 48, padding: '0 0.875rem', fontSize: '0.8125rem', width: '100%' }}
                    >
                      Download SVG
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
