'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import { useQueuedRpc } from '@/lib/useQueuedRpc'
import SyncBadge from '@/components/SyncBadge'

const QRScanner = dynamic(() => import('@/components/QRScanner'), { ssr: false })

type Flash =
  | { kind: 'success'; title: string; detail: string }
  | { kind: 'duplicate'; title: string; detail: string; claimedAt: string }
  | { kind: 'error'; title: string; detail: string }

interface ClaimResult {
  status: 'success' | 'duplicate' | 'error'
  code: string
  message: string
  user_id?: string
  user_name?: string | null
  claimed_at?: string | null
}

export default function OrgaLunchPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [scannerOpen, setScannerOpen] = useState(true)
  const [count, setCount] = useState<number | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [lastMs, setLastMs] = useState<number | null>(null)
  const [scans, setScans] = useState(0)
  const [manual, setManual] = useState('')
  const busyRef = useRef(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Claimed count, polled every 10 s ───────────────────────────────────────
  const fetchCount = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_lunch_claim_count')
    if (!error) setCount(data as number)
  }, [supabase])

  useEffect(() => {
    if (!user) return
    fetchCount()
    const t = setInterval(fetchCount, 10000)
    return () => clearInterval(t)
  }, [user, fetchCount])

  const showFlash = useCallback((f: Flash) => {
    setFlash(f)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 2600)
  }, [])

  // ── Claim via TanStack queued mutation, timed ──────────────────────────────
  // Offline: optimistic QUEUED flash, auto-sync on reconnect (same payload +
  // same request_id replays → server returns success/duplicate, never double).
  const claimMutation = useQueuedRpc<{ p_payload: string; request_id?: string }, ClaimResult>({
    endpoint: 'claim_person_lunch',
    onOptimistic: () => {},
    onRollback: () => {},
    onSettled: (result) => {
      const ms = Math.round(performance.now() - scanStartRef.current)
      setLastMs(ms)
      setScans(s => s + 1)
      busyRef.current = false
      if ('error' in result) {
        showFlash({ kind: 'error', title: 'SCAN FAILED', detail: result.error.message })
      } else if (result.queued) {
        showFlash({
          kind: 'success',
          title: '✓ QUEUED',
          detail: 'Offline — will sync automatically when back online. Use Retry if it stays queued.',
        })
      } else {
        const r = result.data
        if (r.status === 'success') {
          showFlash({
            kind: 'success',
            title: '✓ CLAIMED',
            detail: `${r.user_name ?? 'Participant'} · ${r.claimed_at ? new Date(r.claimed_at).toLocaleTimeString() : ''} · ${ms} ms`,
          })
        } else if (r.status === 'duplicate') {
          showFlash({
            kind: 'duplicate',
            title: 'ALREADY CLAIMED',
            detail: `${r.user_name ?? 'Participant'} · first claimed at`,
            claimedAt: r.claimed_at ?? 'unknown',
          })
        } else {
          showFlash({ kind: 'error', title: r.code || 'REJECTED', detail: r.message })
        }
      }
      fetchCount()
    },
  })

  const scanStartRef = useRef(0)
  const claim = useCallback((raw: string) => {
    if (busyRef.current) return
    busyRef.current = true
    scanStartRef.current = performance.now()
    claimMutation.mutate({ p_payload: raw })
  }, [claimMutation])

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading lunch station…
      </div>
    )
  }
  if (!user || (role !== 'ORGA' && role !== 'ADMIN')) {
    return (
      <div className="min-h-screen p-8 text-center"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Orga access required. Please sign in with an orga account.
      </div>
    )
  }

  return (
    <div className="min-h-screen p-5 space-y-6" style={{ background: 'var(--color-bg)' }}>
      <div className="max-w-xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Lunch Station <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>— Orga</span></h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              Scan lunch badges · count polls every 10 s
              {lastMs !== null && <> · last scan {lastMs} ms ({scans} scans)</>}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setScannerOpen(true)}>
            Open scanner
          </button>
        </div>

        {/* Offline queue: auto-syncs; Retry is the iOS fallback */}
        <SyncBadge onDead={() => showFlash({
          kind: 'error', title: 'QUEUED CLAIM REJECTED',
          detail: 'A queued scan was rejected after reconnect. Rescan the badge.',
        })} />

        {/* Claimed count */}
        <div className="card p-6 text-left">
          <p style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: 0 }}>
            Meals claimed
          </p>
          <p style={{ fontSize: '3rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', margin: 0 }}>
            {count ?? '…'}
          </p>
        </div>

        {/* Manual fallback (camera-less testing) */}
        <details className="card p-4">
          <summary style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)', cursor: 'pointer' }}>
            Manual payload entry (no camera)
          </summary>
          <textarea className="input font-mono" rows={3} value={manual}
            onChange={e => setManual(e.target.value)}
            placeholder='Paste full PERSON_LUNCH payload JSON…'
            style={{ marginTop: 8, fontSize: '0.75rem', padding: '0.5rem' }} />
          <button className="btn btn-primary" style={{ marginTop: 8 }}
            onClick={() => { if (manual.trim()) claim(manual.trim()) }}>
            Claim manually
          </button>
        </details>
      </div>

      {scannerOpen && (
        <QRScanner
          title="Scan Lunch Badge"
          subtitle={<>Point camera at a <code style={{ fontFamily: 'var(--font-mono)' }}>PERSON_LUNCH</code> payload</>}
          onScan={claim}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {/* Full-screen flash */}
      {flash && (
        <div onClick={() => setFlash(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 12, padding: 24, textAlign: 'center', cursor: 'pointer',
            background: flash.kind === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            color: 'var(--color-accent-ink)',
          }} role="alert">
          <p style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, color: 'inherit' }}>{flash.title}</p>
          <p style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: 'inherit' }}>{flash.detail}</p>
          {flash.kind === 'duplicate' && (
            <p className="font-mono" style={{ fontSize: '1.6rem', fontWeight: 700, margin: 0, color: 'inherit' }}>
              {new Date(flash.claimedAt).toLocaleString()}
            </p>
          )}
          <p style={{ fontSize: '0.8rem', margin: '12px 0 0', opacity: 0.7, color: 'inherit' }}>tap to dismiss</p>
        </div>
      )}
    </div>
  )
}
