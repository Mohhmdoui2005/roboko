// Visible-change signature for the live screen.
//
// The realtime stream fires on EVERY match/node event (including warning
// bumps, queue edits, node touches that change nothing on screen). Re-render
// only when something the audience can see changed: match status, teams, or
// winner — plus leaderboard order/score and node→match linkage.
//
// Pure function by design: importable in Node for burst testing, no React.

export interface VisibleMatch {
  id: string
  status: string
  team1_id: string | null
  team2_id: string | null
  winner_id: string | null
}

export interface VisibleBoardRow {
  team_id: string
  wins: number
  matches_played: number
}

export interface VisibleNode {
  id: string
  match_id: string | null
}

export interface LiveSnapshot {
  knockoutLive: boolean
  matches: VisibleMatch[]
  board: VisibleBoardRow[]
  nodes: VisibleNode[]
}

/** Canonical string of everything visible. Cheap: one pass, sorted. */
export function visibleSignature(s: LiveSnapshot): string {
  const m = [...s.matches]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(x => [x.id, x.status, x.team1_id ?? '', x.team2_id ?? '', x.winner_id ?? ''].join('|'))
    .join(';')
  const b = s.board.map(r => [r.team_id, r.wins, r.matches_played].join('|')).join(';')
  const n = [...s.nodes]
    .sort((a, b2) => (a.id < b2.id ? -1 : 1))
    .map(x => [x.id, x.match_id ?? ''].join('|'))
    .join(';')
  return `${s.knockoutLive ? 1 : 0}#${m}#${b}#${n}`
}

/** True when the new snapshot would look different on screen. */
export function shouldRerender(prevSig: string | null, next: LiveSnapshot): { sig: string; render: boolean } {
  const sig = visibleSignature(next)
  return { sig, render: prevSig !== sig }
}
