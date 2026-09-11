// Pure presentational bracket tree. No fetching, no subscriptions, no timers —
// all data comes in via props, so it can render anywhere (admin viz, /live,
// /bracket) without duplicating SVG logic or leaking resources.

export interface BracketNode {
  id: string
  ko_stage: number
  position: number
  match_id: string | null
  next_node_id: string | null
}

export interface BracketMatch {
  id: string
  team1_id: string | null
  team2_id: string | null
  winner_id: string | null
  status: string
}

export const BRACKET_STAGES = [
  { stage: 16, label: 'Round of 16' },
  { stage: 8, label: 'Quarterfinals' },
  { stage: 4, label: 'Semifinals' },
  { stage: 2, label: 'Final' },
  { stage: 1, label: 'Champion' },
]

const COL_W = 200
const ROW_H = 62
const TOP = 30
const LEFT = 10

// Vertical center of a node: each node centers over its R16 leaf slots.
// Node (stage s, position p) covers leaves [p*k, p*k + k) with k = 16/s.
function slotY(stage: number, position: number): number {
  if (stage === 16) return TOP + position * ROW_H + ROW_H / 2
  if (stage === 1) return TOP + 4 * ROW_H // aligned with the Final
  const k = 16 / stage
  return TOP + (position * k + k / 2) * ROW_H
}

export default function BracketSvg({
  nodes,
  matches,
  teamNames,
}: {
  nodes: BracketNode[]
  matches: Record<string, BracketMatch>
  teamNames: Record<string, string>
}) {
  const name = (id: string | null) => (id ? teamNames[id] ?? id.slice(0, 8) : 'TBD')
  const finalNode = nodes.find(n => n.ko_stage === 2)
  const finalMatch = finalNode && finalNode.match_id ? matches[finalNode.match_id] ?? null : null
  const championId = finalMatch?.status === 'COMPLETED' ? finalMatch.winner_id : null

  const height = TOP * 2 + 8 * ROW_H
  const width = LEFT * 2 + BRACKET_STAGES.length * COL_W

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: 900, width: '100%', height: 'auto' }}
      role="img" aria-label="Knockout bracket">
      {BRACKET_STAGES.map((s, ci) => (
        <text key={`h-${s.stage}`} x={LEFT + ci * COL_W + 8} y={16}
          style={{ fill: 'var(--color-text-tertiary)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {s.label}
        </text>
      ))}

      {nodes.filter(n => n.next_node_id).map(n => {
        const parent = nodes.find(p => p.id === n.next_node_id)
        if (!parent) return null
        const ci = BRACKET_STAGES.findIndex(s => s.stage === n.ko_stage)
        const pi = BRACKET_STAGES.findIndex(s => s.stage === parent.ko_stage)
        const x1 = LEFT + ci * COL_W + COL_W - 14
        const y1 = slotY(n.ko_stage, n.position)
        const x2 = LEFT + pi * COL_W + 6
        const y2 = slotY(parent.ko_stage, parent.position)
        const mx = (x1 + x2) / 2
        return (
          <path key={`c-${n.id}`} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            fill="none" stroke="var(--color-border)" strokeWidth={1.5} />
        )
      })}

      {nodes.map(n => {
        const ci = BRACKET_STAGES.findIndex(s => s.stage === n.ko_stage)
        const x = LEFT + ci * COL_W
        const y = slotY(n.ko_stage, n.position) - ROW_H / 2 + 4
        const m = n.match_id ? matches[n.match_id] : null

        if (n.ko_stage === 1) {
          return (
            <g key={n.id}>
              <rect x={x} y={y} width={COL_W - 20} height={ROW_H - 8} rx={8}
                fill="none" stroke="var(--color-warning)" strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={x + 12} y={y + 24} style={{ fill: 'var(--color-warning)', fontSize: 22 }}>🏆</text>
              <text x={x + 42} y={y + 28}
                style={{ fill: 'var(--color-text-primary)', fontSize: 12, fontWeight: 700 }}>
                {championId ? name(championId) : 'TBD'}
              </text>
            </g>
          )
        }

        const t1win = m?.winner_id != null && m.winner_id === m?.team1_id
        const t2win = m?.winner_id != null && m.winner_id === m?.team2_id
        return (
          <g key={n.id}>
            <rect x={x} y={y} width={COL_W - 20} height={ROW_H - 8} rx={8}
              fill="var(--color-surface)" stroke="var(--color-border)" strokeWidth={1} />
            <text x={x + 10} y={y + 20}
              style={{ fill: t1win ? 'var(--color-success)' : 'var(--color-text-primary)', fontSize: 11.5, fontWeight: t1win ? 700 : 500 }}>
              {t1win ? '✓ ' : ''}{name(m?.team1_id ?? null)}
            </text>
            <text x={x + 10} y={y + 38}
              style={{ fill: t2win ? 'var(--color-success)' : 'var(--color-text-secondary)', fontSize: 11.5, fontWeight: t2win ? 700 : 500 }}>
              {t2win ? '✓ ' : ''}{name(m?.team2_id ?? null)}
            </text>
            <text x={x + COL_W - 34} y={y + 20}
              style={{ fill: 'var(--color-text-tertiary)', fontSize: 9 }}>
              {m ? (m.status === 'COMPLETED' ? 'FT' : m.status === 'IN_PROGRESS' ? 'LIVE' : `#${n.position + 1}`) : '—'}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
