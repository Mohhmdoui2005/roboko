'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import BracketSvg, { type BracketNode, type BracketMatch } from '@/components/BracketSvg'

interface Node extends BracketNode {
  updated_at: string | null
}

const STAGES = [16, 8, 4, 2, 1]

export default function BracketViz() {
  const supabase = useMemo(() => createClient(), [])
  const [nodes, setNodes] = useState<Node[]>([])
  const [matches, setMatches] = useState<Record<string, BracketMatch>>({})
  const [teamNames, setTeamNames] = useState<Record<string, string>>({})
  const [live, setLive] = useState(false)

  const fetchAll = useCallback(async () => {
    const [{ data: n }, { data: m }, { data: t }] = await Promise.all([
      supabase.from('bracket_nodes').select('id,ko_stage,position,match_id,next_node_id,updated_at'),
      supabase.from('matches').select('id,team1_id,team2_id,winner_id,status').eq('is_knockout', true),
      supabase.from('teams').select('id,name'),
    ])
    if (n) setNodes(n as Node[])
    if (m) {
      const map: Record<string, BracketMatch> = {}
      ;(m as BracketMatch[]).forEach(x => { map[x.id] = x })
      setMatches(map)
    }
    if (t) {
      const map: Record<string, string> = {}
      t.forEach(x => { map[x.id] = x.name })
      setTeamNames(map)
    }
  }, [supabase])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── REALTIME (second and last place it's used): bracket_nodes,
  // one binding per ko_stage filter — node touches (publish + advancement)
  // trigger a refetch; no page refresh needed. ──
  useEffect(() => {
    const channel = supabase.channel('bracket-nodes')
    for (const stage of STAGES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bracket_nodes', filter: `ko_stage=eq.${stage}` },
        () => fetchAll()
      )
    }
    channel.subscribe(status => { if (status === 'SUBSCRIBED') setLive(true) })
    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchAll])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="badge badge-neutral">{nodes.length}/16 nodes</span>
        <span className={`badge ${live ? 'badge-success' : 'badge-neutral'}`}>
          {live ? '● live' : '○ connecting…'}
        </span>
      </div>
      <div className="overflow-x-auto card p-2">
        <BracketSvg nodes={nodes} matches={matches} teamNames={teamNames} />
      </div>
      {nodes.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
          No bracket published yet — admin publishes from the knockout dashboard.
        </p>
      )}
    </div>
  )
}
