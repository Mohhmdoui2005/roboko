'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function AdminLunchPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [current, setCurrent] = useState<string | null>(null)
  const [claimed, setClaimed] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [push, setPush] = useState(true)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const fetchState = useCallback(async () => {
    const [{ data: ts }, { data: n }] = await Promise.all([
      supabase.from('tournament_state').select('lunch_start_time').limit(1).single(),
      supabase.rpc('get_lunch_claim_count'),
    ])
    if (ts) {
      setCurrent(ts.lunch_start_time ?? null)
      setDraft(prev => prev || toLocalInput(ts.lunch_start_time))
    }
    if (typeof n === 'number') setClaimed(n)
  }, [supabase])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') fetchState()
  }, [authLoading, user, role, fetchState])

  const handleSave = async () => {
    if (!draft) {
      showToast('Pick a lunch start time first', 'error')
      return
    }
    setSaving(true)
    const iso = new Date(draft).toISOString()
    const { data, error } = await supabase.rpc('broadcast_lunch_start', {
      p_start_time: iso,
      p_push: push,
    })
    if (error) {
      showToast(`Save failed: ${error.message}`, 'error')
    } else {
      const r = data as { lunch_start_time: string; notified_teams: number; broadcast_pushed: boolean }
      setCurrent(r.lunch_start_time)
      setResult(push
        ? `Lunch starts ${new Date(r.lunch_start_time).toLocaleString()} — broadcast pushed to ${r.notified_teams} teams (participants pick it up on their 10 s poll).`
        : `Lunch starts ${new Date(r.lunch_start_time).toLocaleString()} — no broadcast sent.`)
      showToast('Lunch start time saved', 'success')
    }
    setSaving(false)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading lunch control…
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
      <div className="max-w-xl mx-auto space-y-6">
        <div className="pb-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Lunch Control</h1>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            Current start: <strong style={{ color: 'var(--color-text-primary)' }}>
              {current ? new Date(current).toLocaleString() : 'not set'}
            </strong>
            {' '}· claimed so far: <strong style={{ color: 'var(--color-text-primary)' }}>{claimed ?? '…'}</strong>
          </p>
        </div>

        {toast && (
          <div className={`toast-${toast.type} p-3`} style={{ borderRadius: 8 }} role="alert">
            {toast.message}
          </div>
        )}

        <div className="card p-6 space-y-4">
          <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
            Lunch start time
            <input type="datetime-local" className="input" style={{ marginTop: 6 }}
              value={draft} onChange={e => setDraft(e.target.value)} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.9rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={push} onChange={e => setPush(e.target.checked)}
              style={{ width: 20, height: 20, accentColor: 'var(--color-accent)' }} />
            Push broadcast notification
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
              (one row per team — participants see it on their 10 s poll)
            </span>
          </label>
          <button className="btn btn-primary" style={{ width: '100%' }}
            onClick={handleSave} disabled={saving || !draft}>
            {saving ? 'Saving…' : 'Set lunch start time'}
          </button>
          {result && (
            <p style={{ fontSize: '0.85rem', color: 'var(--color-success)', margin: 0 }}>{result}</p>
          )}
        </div>
      </div>
    </div>
  )
}
