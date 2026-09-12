'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'

interface Team {
  id: string
  name: string
}

export default function AdminTeamsPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [teams, setTeams] = useState<Team[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const fetchTeams = useCallback(async () => {
    const { data, error } = await supabase.from('teams').select('id,name').order('name')
    if (error) {
      showToast(`Failed to load teams: ${error.message}`, 'error')
    } else {
      setTeams((data ?? []) as Team[])
      setDrafts(Object.fromEntries(((data ?? []) as Team[]).map(t => [t.id, t.name])))
    }
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') {
      fetchTeams()
    } else if (!authLoading) {
      setLoading(false)
    }
  }, [authLoading, user, role, fetchTeams])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(t => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
  }, [teams, search])

  const handleSave = async (id: string) => {
    const name = (drafts[id] ?? '').trim()
    if (!name) {
      showToast('Name cannot be empty', 'error')
      return
    }
    const original = teams.find(t => t.id === id)?.name
    if (name === original) return
    setSavingId(id)
    const { error } = await supabase.from('teams').update({ name }).eq('id', id)
    if (error) {
      showToast(`Save failed: ${error.message}`, 'error')
    } else {
      setTeams(prev => prev.map(t => (t.id === id ? { ...t, name } : t)))
      showToast(`Saved as "${name}" — now live everywhere`, 'success')
    }
    setSavingId(null)
  }

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) return
    if (teams.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      showToast('A team with that name already exists', 'error')
      return
    }
    setAdding(true)
    const { data, error } = await supabase.from('teams').insert({ name }).select('id,name').single()
    if (error) {
      showToast(`Add failed: ${error.message}`, 'error')
    } else if (data) {
      const team = data as Team
      setTeams(prev => [...prev, team].sort((a, b) => a.name.localeCompare(b.name)))
      setDrafts(prev => ({ ...prev, [team.id]: team.name }))
      setNewName('')
      showToast(`Team "${team.name}" added`, 'success')
    }
    setAdding(false)
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete team "${name}"? Matches referencing it will keep the ID but show a short fallback.`)) return
    setSavingId(id)
    const { error } = await supabase.from('teams').delete().eq('id', id)
    if (error) {
      showToast(`Delete failed: ${error.message}`, 'error')
    } else {
      setTeams(prev => prev.filter(t => t.id !== id))
      showToast(`Team "${name}" deleted`, 'success')
    }
    setSavingId(null)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading teams…
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
    <div className="min-h-screen p-6" style={{ background: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="btn" style={{ minHeight: 40 }}>← Dashboard</Link>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Teams — Admin</h1>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 8 }}>
              Rename a team once — every screen (live, jury, bracket, leaderboard, phase 1) reads from the{' '}
              <code className="font-mono">teams</code> table, so e.g. Team 11 → “The Predators” updates everywhere instantly.
            </p>
          </div>
          <span className="badge badge-neutral">{teams.length} teams</span>
        </div>

        {toast && (
          <div className={toast.type === 'success' ? 'toast-success' : 'toast-danger'}
            style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500 }} role="alert">
            {toast.type === 'success' ? 'OK — ' : 'ERR — '} {toast.message}
          </div>
        )}

        {/* Add + search */}
        <div className="card p-4 flex flex-col sm:flex-row gap-3">
          <input className="input" placeholder="New team name, e.g. The Predators"
            value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }} />
          <button className="btn btn-primary" onClick={handleAdd} disabled={adding || !newName.trim()}
            style={{ minWidth: 160 }}>
            {adding ? 'Adding…' : 'Add team'}
          </button>
          <input className="input" placeholder="Search teams…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        {/* List */}
        <div className="card card-emphasized overflow-hidden">
          <div className="overflow-x-auto">
            <table className="ds-table">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>ID</th>
                  <th>Display name (live everywhere)</th>
                  <th style={{ width: 220, textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const dirty = (drafts[t.id] ?? '') !== t.name
                  return (
                    <tr key={t.id}>
                      <td className="font-mono" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>
                        {t.id.slice(0, 8)}
                      </td>
                      <td>
                        <input className="input" value={drafts[t.id] ?? ''}
                          onChange={e => setDrafts(prev => ({ ...prev, [t.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') handleSave(t.id) }}
                          style={{ minHeight: 40, borderColor: dirty ? 'var(--color-accent)' : undefined }} />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className="flex gap-2 justify-center">
                          <button className="btn btn-primary" disabled={!dirty || savingId === t.id}
                            onClick={() => handleSave(t.id)} style={{ minHeight: 48, minWidth: 90 }}>
                            {savingId === t.id ? '…' : 'Save'}
                          </button>
                          <button className="btn btn-danger" disabled={savingId === t.id}
                            onClick={() => handleDelete(t.id, t.name)} style={{ minHeight: 48 }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                      No teams found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
