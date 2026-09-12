'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { adminFetch } from '@/lib/adminApi'
import { useAuth } from '@/components/AuthProvider'

interface AccountRow {
  id: string
  email?: string
  role: string
  confirmed: boolean
  last_sign_in: string | null
  created_at: string
  name: string | null
  team_name: string | null
  assigned_arena: string | null
}

interface Team {
  id: string
  name: string
}

const ARENAS = ['Arena A', 'Arena B', 'Arena C', 'Arena D']
const ROLES = ['PARTICIPANT', 'ORGA', 'JURY', 'ADMIN'] as const
// Unambiguous alphabet for the generator: no 0/O, 1/l/I.
const PW_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

const roleBadge = (role: string) => {
  switch (role) {
    case 'ADMIN': return 'badge-danger'
    case 'ORGA': return 'badge-info'
    case 'JURY': return 'badge-warning'
    case 'PARTICIPANT': return 'badge-success'
    default: return 'badge-neutral'
  }
}

export default function AdminUsersPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Add form
  const [fName, setFName] = useState('')
  const [fEmail, setFEmail] = useState('')
  const [fPassword, setFPassword] = useState('')
  const [fRole, setFRole] = useState<(typeof ROLES)[number]>('PARTICIPANT')
  const [fTeam, setFTeam] = useState('')
  const [fArena, setFArena] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)

  // Two-step delete: first click arms, second click (Yes, delete) executes.
  const [armedId, setArmedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 5000)
  }, [])

  const fetchAll = useCallback(async () => {
    try {
      const [uRes, tRes] = await Promise.all([
        adminFetch(supabase, '/api/admin/users'),
        supabase.from('teams').select('id,name').order('name'),
      ])
      const uJson = await uRes.json()
      if (!uRes.ok) {
        showToast(uJson.error || 'Failed to load accounts', 'error')
      } else {
        setAccounts(uJson.users as AccountRow[])
      }
      if (tRes.data) setTeams(tRes.data as Team[])
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to load accounts', 'error')
    }
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') fetchAll()
    else if (!authLoading) setLoading(false)
  }, [authLoading, user, role, fetchAll])

  useEffect(() => () => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
  }, [])

  const armDelete = (id: string) => {
    setArmedId(id)
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    disarmTimer.current = setTimeout(() => setArmedId(null), 20000) // auto-disarm
  }

  const confirmDelete = async () => {
    if (!armedId || deleting) return
    setDeleting(true)
    try {
      const res = await adminFetch(supabase, '/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: armedId }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Delete failed', 'error')
      } else {
        showToast(`Account ${json.deleted} deleted permanently`, 'success')
        setArmedId(null)
        fetchAll()
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
    setDeleting(false)
  }

  const generatePassword = () => {
    const rnd = new Uint32Array(14)
    crypto.getRandomValues(rnd)
    setFPassword(Array.from(rnd, (n) => PW_CHARS[n % PW_CHARS.length]).join(''))
  }

  const handleCreate = async () => {
    setCreating(true)
    setCreated(null)
    try {
      const res = await adminFetch(supabase, '/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fName.trim(),
          email: fEmail.trim(),
          password: fPassword,
          role: fRole,
          team_id: fRole === 'PARTICIPANT' && fTeam ? fTeam : null,
          assigned_arena: fRole === 'JURY' && fArena ? fArena : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error || 'Creation failed', 'error')
      } else {
        setCreated({ email: json.email, password: json.password })
        setFName('')
        setFEmail('')
        setFPassword('')
        setFTeam('')
        setFArena('')
        showToast(`Account ${json.email} created as ${json.role}`, 'success')
        fetchAll()
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Creation failed', 'error')
    }
    setCreating(false)
  }

  const armedAccount = armedId ? accounts.find((a) => a.id === armedId) : null
  const formValid =
    fName.trim().length > 0 &&
    /.+@.+\..+/.test(fEmail.trim()) &&
    fPassword.length >= 8

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading accounts…
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
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-3">
              <Link href="/admin" className="btn" style={{ minHeight: 40 }}>← Dashboard</Link>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Users — Admin</h1>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', marginTop: 8 }}>
              Every registered login. Create accounts with a role, or delete them (two-step, permanent).
            </p>
          </div>
          <span className="badge badge-neutral">{accounts.length} accounts</span>
        </div>

        {toast && (
          <div className={toast.type === 'success' ? 'toast-success' : 'toast-danger'}
            style={{ padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.875rem', fontWeight: 500 }} role="alert">
            {toast.type === 'success' ? 'OK — ' : 'ERR — '} {toast.message}
          </div>
        )}

        {/* ── Armed delete warning (step 2 of 2) ── */}
        {armedAccount && (
          <div className="p-5 space-y-3" role="alert"
            style={{ borderRadius: 12, border: '2px solid var(--color-danger)', background: 'color-mix(in srgb, var(--color-danger) 8%, var(--color-surface))' }}>
            <p style={{ fontWeight: 800, color: 'var(--color-danger)', margin: 0, fontSize: '1rem' }}>
              STEP 2 OF 2 — Permanently delete this account?
            </p>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-primary)', margin: 0 }}>
              <strong>{armedAccount.name || armedAccount.email}</strong>
              {' '}({armedAccount.email} · {armedAccount.role}) — the login <strong>and</strong> profile
              will be removed forever. Signed-in sessions stop working. This cannot be undone.
            </p>
            <div className="flex gap-2 flex-wrap">
              <button className="btn" onClick={() => setArmedId(null)} style={{ minHeight: 48 }}>
                Cancel (keep account)
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}
                disabled={deleting} style={{ minHeight: 48, minWidth: 220 }}>
                {deleting ? 'Deleting…' : 'Yes, delete permanently'}
              </button>
            </div>
          </div>
        )}

        {/* ── Add account ── */}
        <div className="card card-emphasized p-5 space-y-4">
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Add account</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" placeholder="Display name, e.g. Jury Arena C"
              value={fName} onChange={(e) => setFName(e.target.value)} />
            <input className="input" placeholder="Email (login), e.g. jury-c@test.com"
              type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={fEmail} onChange={(e) => setFEmail(e.target.value)} />
            <div className="flex gap-2">
              <input className="input font-mono" placeholder="Password (min 8 chars)"
                type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={fPassword} onChange={(e) => setFPassword(e.target.value)}
                style={{ fontSize: '0.9rem' }} />
              <button className="btn" onClick={generatePassword} style={{ minHeight: 48, whiteSpace: 'nowrap' }}>
                Generate
              </button>
            </div>
            <select className="input" value={fRole}
              onChange={(e) => setFRole(e.target.value as (typeof ROLES)[number])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            {fRole === 'PARTICIPANT' && (
              <select className="input" value={fTeam} onChange={(e) => setFTeam(e.target.value)}>
                <option value="">Link team… (optional)</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            {fRole === 'JURY' && (
              <select className="input" value={fArena} onChange={(e) => setFArena(e.target.value)}>
                <option value="">Assigned arena… (optional)</option>
                {ARENAS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            )}
          </div>
          <button className="btn btn-primary" onClick={handleCreate}
            disabled={creating || !formValid} style={{ minWidth: 200 }}>
            {creating ? 'Creating…' : 'Create account'}
          </button>
          {created && (
            <div className="p-4" role="status"
              style={{ borderRadius: 8, border: '1px solid var(--color-success)', fontSize: '0.875rem' }}>
              <p style={{ fontWeight: 700, color: 'var(--color-success)', margin: '0 0 6px' }}>
                ✓ Account created — copy the password now (shown once)
              </p>
              <p className="font-mono" style={{ margin: 0, color: 'var(--color-text-primary)' }}>
                {created.email} · {created.password}
              </p>
            </div>
          )}
        </div>

        {/* ── Account list ── */}
        <div className="card card-emphasized overflow-hidden">
          <div className="overflow-x-auto">
            <table className="ds-table">
              <thead>
                <tr>
                  <th>Name / Email</th>
                  <th style={{ width: 130 }}>Role</th>
                  <th style={{ width: 160 }}>Team · Arena</th>
                  <th style={{ width: 110 }}>Confirmed</th>
                  <th style={{ width: 150 }}>Last sign-in</th>
                  <th style={{ width: 120 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const isSelf = a.id === user.id
                  const armed = armedId === a.id
                  return (
                    <tr key={a.id} style={armed ? { background: 'color-mix(in srgb, var(--color-danger) 10%, transparent)' } : undefined}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                          {a.name || '—'}
                          {isSelf && <span className="badge badge-info" style={{ marginLeft: 8 }}>you</span>}
                        </div>
                        <div className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                          {a.email}
                        </div>
                      </td>
                      <td><span className={`badge ${roleBadge(a.role)}`}>{a.role}</span></td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {[a.team_name, a.assigned_arena].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="font-mono" style={{ fontSize: '0.8rem' }}>{a.confirmed ? 'yes' : 'no'}</td>
                      <td className="font-mono" style={{ fontSize: '0.75rem' }}>
                        {a.last_sign_in ? new Date(a.last_sign_in).toLocaleString() : 'never'}
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="badge badge-neutral">locked</span>
                        ) : armed ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)', fontWeight: 700 }}>
                            ▲ confirm above
                          </span>
                        ) : (
                          <button className="btn btn-danger" onClick={() => armDelete(a.id)}
                            style={{ minHeight: 48, padding: '0 0.8rem', fontSize: '0.8rem' }}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {accounts.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No accounts found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
