'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'
import BracketViz from '@/components/BracketViz'

interface Seed {
  seed: number
  team_id: string
  name: string
  wins: number
  matches_played: number
}

// Fisher–Yates with a cryptographically secure random source
function secureShuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  const rand = new Uint32Array(a.length)
  crypto.getRandomValues(rand)
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function AdminKnockoutPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [order, setOrder] = useState<Seed[]>([])
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [unpublishing, setUnpublishing] = useState(false)
  const [publishInfo, setPublishInfo] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [bracketKey, setBracketKey] = useState(0)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const computeTop16 = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('get_knockout_seeds')
    if (error) {
      showToast(`Top-16 failed: ${error.message}`, 'error')
    } else {
      const rows = (data ?? []) as Seed[]
      setSeeds(rows)
      setOrder(rows)
    }
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') computeTop16()
  }, [authLoading, user, role, computeTop16])

  const handleShuffle = () => {
    setOrder(prev => secureShuffle(prev))
    showToast('Seeds shuffled (crypto.getRandomValues)', 'success')
  }

  const handlePublish = async () => {
    if (order.length !== 16) {
      showToast('Need exactly 16 seeds to publish', 'error')
      return
    }
    setPublishing(true)
    const { data, error } = await supabase.rpc('publish_knockout_bracket', {
      p_seeds: order.map(s => s.team_id),
    })
    if (error) {
      showToast(`Publish failed: ${error.message}`, 'error')
    } else {
      const r = data as { nodes: number; matches: number }
      setPublishInfo(`Bracket live: ${r.nodes} nodes, ${r.matches} matches across 3 arenas.`)
      showToast('Knockout bracket published', 'success')
      setBracketKey(k => k + 1) // remount viz for a fresh fetch (realtime keeps it live after)
    }
    setPublishing(false)
  }

  const handleUnpublish = async () => {
    if (!window.confirm('Take the knockout bracket down? It will disappear from live/bracket screens. Refused automatically if any KO match already started.')) {
      return
    }
    setUnpublishing(true)
    const { data, error } = await supabase.rpc('unpublish_knockout_bracket')
    if (error) {
      showToast(`Unpublish failed: ${error.message}`, 'error')
    } else {
      const r = data as { removed_matches: number }
      setPublishInfo(null)
      showToast(`Bracket taken down (${r.removed_matches ?? 0} matches removed)`, 'success')
      setBracketKey(k => k + 1) // remount viz for a fresh (empty) fetch
    }
    setUnpublishing(false)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading knockout dashboard…
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
    <div className="min-h-screen p-6"
      style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Knockout Dashboard</h1>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Top 16 → shuffle → confirm &amp; publish. Winners advance server-side.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button className="btn" style={{ minHeight: 48 }} onClick={computeTop16}>Compute Top 16</button>
            <button className="btn" style={{ minHeight: 48 }} onClick={handleShuffle} disabled={order.length !== 16}>
              Shuffle Seed
            </button>
            <button className="btn btn-primary" onClick={handlePublish}
              disabled={publishing || unpublishing || order.length !== 16} style={{ minWidth: 190 }}>
              {publishing ? 'Publishing…' : 'Confirm & Publish'}
            </button>
            <button className="btn btn-danger" onClick={handleUnpublish}
              disabled={publishing || unpublishing} style={{ minWidth: 170 }}>
              {unpublishing ? 'Taking down…' : 'Take down bracket'}
            </button>
          </div>
        </div>

        {toast && (
          <div className={`toast-${toast.type} p-3`} style={{ borderRadius: 8 }} role="alert">
            {toast.message}
          </div>
        )}
        {publishInfo && (
          <div className="p-3" style={{ borderRadius: 8, border: '1px solid var(--color-success)', color: 'var(--color-success)', fontSize: '0.9rem' }}>
            {publishInfo}
          </div>
        )}

        {/* Seed order */}
        <div className="card p-6 space-y-3">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            Final seed order ({order.length}/16)
          </h2>
          {order.length !== 16 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
              Compute the Top 16 first.
            </p>
          ) : (
            <ol className="grid gap-2 sm:grid-cols-2"
              style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {order.map((s, i) => (
                <li key={s.team_id} className="flex items-center gap-3 p-2"
                  style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
                  <span className="font-mono" style={{
                    width: 32, textAlign: 'center', fontWeight: 700,
                    color: 'var(--color-accent-text)',
                  }}>{i + 1}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{s.name}</span>
                  <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                    {s.wins}W · seed {s.seed}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', margin: 0 }}>
            R16 pairs consecutive seeds (1v2, 3v4, …) in the order shown. Shuffle uses
            crypto.getRandomValues (CSPRNG).
          </p>
        </div>

        {/* Live bracket */}
        <div className="space-y-3">
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Bracket</h2>
          <BracketViz key={bracketKey} />
        </div>
      </div>
    </div>
  )
}
