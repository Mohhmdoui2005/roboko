'use client'
// Hallmark · genre: atmospheric · macrostructure: Bento Grid · theme: Terminal · design-system: design.md · designed-as-app

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/AuthProvider'

interface LeaderboardRow {
  team_id: string
  name: string
  matches_played: number
  wins: number
}

export default function AdminLeaderboardPage() {
  const { user, role, isLoading: authLoading } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_phase1_leaderboard')
    if (error) {
      showToast(`Failed to load leaderboard: ${error.message}`, 'error')
      return
    }
    setRows((data ?? []) as LeaderboardRow[])
    setLoading(false)
  }, [supabase, showToast])

  useEffect(() => {
    if (!authLoading && user && role === 'ADMIN') fetchLeaderboard()
  }, [authLoading, user, role, fetchLeaderboard])

  // Manual refresh: refresh_leaderboard RPC, then re-read the view
  const handleRefresh = async () => {
    setRefreshing(true)
    const { data, error } = await supabase.rpc('refresh_leaderboard')
    if (error) {
      showToast(`Refresh failed: ${error.message}`, 'error')
    } else {
      setLastRefresh(
        (data as { refreshed_at?: string } | null)?.refreshed_at ?? new Date().toISOString()
      )
      await fetchLeaderboard()
      showToast('Leaderboard refreshed', 'success')
    }
    setRefreshing(false)
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm"
        style={{ background: 'var(--color-bg)', color: 'var(--color-text-tertiary)' }}>
        Loading leaderboard…
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between pb-4"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
              Phase 1 Leaderboard
            </h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
              via get_phase1_leaderboard()
              {lastRefresh && <> · last refresh {new Date(lastRefresh).toLocaleTimeString()}</>}
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleRefresh}
            disabled={refreshing} style={{ minWidth: 180 }}>
            {refreshing ? 'Refreshing…' : '↻ Refresh leaderboard'}
          </button>
        </div>

        {toast && (
          <div className={`toast-${toast.type} p-3`} style={{ borderRadius: 8 }} role="alert">
            {toast.message}
          </div>
        )}

        <div className="card p-2 sm:p-4">
          <table className="ds-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>#</th>
                <th>Team</th>
                <th style={{ width: 130 }}>Played</th>
                <th style={{ width: 110 }}>Wins</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.team_id}>
                  <td className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{r.name}</td>
                  <td className="font-mono">{r.matches_played}</td>
                  <td className="font-mono" style={{
                    color: r.wins > 0 ? 'var(--color-success)' : undefined, fontWeight: 700,
                  }}>{r.wins}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>
                  No completed qualification matches yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
