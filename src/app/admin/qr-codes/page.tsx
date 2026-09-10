'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { QRCodeSVG } from 'qrcode.react'

interface Robot {
  id: string
  name: string
  team_id?: string
  qr_payload: string | null
  teams?: { name: string } | null
}

export default function AdminQRCodesPage() {
  const [robots, setRobots] = useState<Robot[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const supabase = createClient()

  const loadRobots = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('robots')
      .select('id, name, qr_payload, teams(name)')
      .order('name')
    if (!error && data) setRobots(data as unknown as Robot[])
    setLoading(false)
  }

  useEffect(() => { loadRobots() }, [])

  const handleEnsurePayloads = async () => {
    setGenerating(true)
    setStatusMsg('Generating missing QR payloads…')
    try {
      let updatedCount = 0
      for (const robot of robots) {
        if (!robot.qr_payload) {
          const payload = JSON.stringify({ domain: 'ROBOT_TEST', robot_id: robot.id })
          const { error } = await supabase.from('robots').update({ qr_payload: payload }).eq('id', robot.id)
          if (!error) updatedCount++
        }
      }
      setStatusMsg(`Updated ${updatedCount} robot(s) with QR payloads.`)
      await loadRobots()
    } catch (err: any) {
      setStatusMsg('Error: ' + (err?.message || err))
    } finally {
      setGenerating(false)
    }
  }

  const downloadSVG = (robotName: string, elementId: string) => {
    const svg = document.getElementById(elementId)
    if (!svg) return
    const svgData = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${robotName.replace(/\s+/g, '_')}_QR.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" style={{ background: 'var(--color-bg)', minHeight: '100vh' }}>

      {/* ── Header ── */}
      <div
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 print:hidden"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em', fontFamily: 'var(--font-heading)', margin: 0 }}>
            Robot QR Codes
          </h1>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            Pre-generated scannable payloads · <code style={{ fontFamily: 'var(--font-mono)' }}>domain: "ROBOT_TEST"</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={handleEnsurePayloads}
            disabled={generating}
            className="btn btn-primary"
          >
            {generating ? 'Processing…' : 'Backfill Missing QRs'}
          </button>
          <button
            onClick={() => window.print()}
            className="btn"
          >
            Print Sheet
          </button>
        </div>
      </div>

      {/* ── Status banner ── */}
      {statusMsg && (
        <div
          className="toast-success print:hidden"
          style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500 }}
        >
          {statusMsg}
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
          Loading robots…
        </div>
      ) : robots.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>
          No robots found in database.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {robots.map((robot) => {
            const payload = robot.qr_payload || JSON.stringify({ domain: 'ROBOT_TEST', robot_id: robot.id })
            const svgId = `qr-svg-${robot.id}`
            return (
              <div
                key={robot.id}
                className="card"
                style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', pageBreakInside: 'avoid' }}
              >
                <div style={{ width: '100%', marginBottom: 12 }}>
                  <h3 style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {robot.name}
                  </h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {robot.teams?.name ? `Team: ${robot.teams.name}` : `ID: ${robot.id.slice(0, 8)}…`}
                  </p>
                </div>

                {/* White bg for QR contrast */}
                <div style={{ padding: 10, background: '#fff', borderRadius: 6, marginBottom: 12 }}>
                  <QRCodeSVG id={svgId} value={payload} size={150} level="M" includeMargin={false} />
                </div>

                <button
                  onClick={() => downloadSVG(robot.name, svgId)}
                  className="btn print:hidden"
                  style={{ minHeight: 36, padding: '0 0.875rem', fontSize: '0.8125rem', width: '100%' }}
                >
                  Download SVG
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
