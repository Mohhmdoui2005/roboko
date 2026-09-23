import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'

// POST /api/admin/delete-team { team_id: string }
// FK-safe team removal (service role, bypasses RLS). Client-side deletes
// cannot do this: matches.team1_id/team2_id (and robots/profiles team refs)
// block the teams-row delete with a RESTRICT violation, so dependents must
// go first — in this order:
//
//   1. REFUSE when IN_PROGRESS/COMPLETED matches reference the team.
//      Live history is never silently deleted (regenerate Phase 1 /
//      unpublish knockout first).
//   2. match_rounds → notifications → PENDING/PUBLISHED matches (qual + KO).
//      bracket_nodes pointing at removed KO matches are nulled (republish
//      knockout afterwards to rebuild a clean bracket).
//   3. test_sessions of the team's robots → robots.
//   4. profiles.team_id = NULL (participant accounts are kept, just unlinked).
//   5. the team row itself.

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin } = gate

  let team_id: string | undefined
  try {
    team_id = (await req.json() as { team_id?: string }).team_id
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!team_id) return NextResponse.json({ error: 'team_id is required' }, { status: 400 })

  const fail = (step: string, message: string) =>
    NextResponse.json({ error: `Delete failed at ${step}: ${message}` }, { status: 500 })

  try {
    // ── Team exists? ────────────────────────────────────────────────────
    const { data: team, error: teamErr } = await admin
      .from('teams')
      .select('id,name')
      .eq('id', team_id)
      .maybeSingle()
    if (teamErr) return fail('lookup', teamErr.message)
    if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    const teamName = (team as { name: string }).name

    const teamRef = `team1_id.eq.${team_id},team2_id.eq.${team_id}`

    // ── 1. Live history blocks the delete ───────────────────────────────
    const { data: started, error: startedErr } = await admin
      .from('matches')
      .select('id')
      .or(teamRef)
      .in('status', ['IN_PROGRESS', 'COMPLETED'])
    if (startedErr) return fail('history check', startedErr.message)
    if (started && started.length > 0) {
      return NextResponse.json(
        {
          error: `"${teamName}" has ${started.length} started/completed match(es) — results are never silently deleted. Regenerate Phase 1 (before start) or finish the tournament before removing this team.`,
        },
        { status: 409 }
      )
    }

    // ── 2. Not-started matches (qual + KO) ──────────────────────────────
    const { data: pending, error: pendingErr } = await admin
      .from('matches')
      .select('id,is_knockout')
      .or(teamRef)
      .in('status', ['PENDING', 'PUBLISHED'])
    if (pendingErr) return fail('match lookup', pendingErr.message)
    const pendingIds = ((pending ?? []) as { id: string; is_knockout: boolean }[]).map(m => m.id)
    const koIds = ((pending ?? []) as { id: string; is_knockout: boolean }[])
      .filter(m => m.is_knockout)
      .map(m => m.id)

    if (pendingIds.length > 0) {
      const { error: roundsErr } = await admin
        .from('match_rounds')
        .delete()
        .in('match_id', pendingIds)
      if (roundsErr) return fail('match rounds cleanup', roundsErr.message)

      const { error: notifErr } = await admin
        .from('notifications')
        .delete()
        .in('match_id', pendingIds)
      if (notifErr) return fail('notification cleanup', notifErr.message)

      if (koIds.length > 0) {
        // Bracket nodes may point at these KO matches — null the link so the
        // match rows can go (republish knockout afterwards for a clean bracket).
        const { error: nodesErr } = await admin
          .from('bracket_nodes')
          .update({ match_id: null })
          .in('match_id', koIds)
        if (nodesErr) return fail('bracket unlink', nodesErr.message)
      }

      const { error: matchesErr } = await admin
        .from('matches')
        .delete()
        .in('id', pendingIds)
      if (matchesErr) return fail('match cleanup', matchesErr.message)
    }

    // ── 3. Robots (+ their test sessions) ───────────────────────────────
    const { data: robots, error: robotsErr } = await admin
      .from('robots')
      .select('id')
      .eq('team_id', team_id)
    if (robotsErr) return fail('robot lookup', robotsErr.message)
    const robotIds = ((robots ?? []) as { id: string }[]).map(r => r.id)
    let deletedSessions = 0
    if (robotIds.length > 0) {
      const { data: sessions, error: sessErr } = await admin
        .from('test_sessions')
        .delete()
        .in('robot_id', robotIds)
        .select('id')
      if (sessErr) return fail('test session cleanup', sessErr.message)
      deletedSessions = (sessions ?? []).length

      const { error: robotsDelErr } = await admin
        .from('robots')
        .delete()
        .eq('team_id', team_id)
      if (robotsDelErr) return fail('robot cleanup', robotsDelErr.message)
    }

    // ── 4. Unlink participant profiles (accounts kept) ──────────────────
    const { data: unlinked, error: unlinkErr } = await admin
      .from('profiles')
      .update({ team_id: null })
      .eq('team_id', team_id)
      .select('id')
    if (unlinkErr) return fail('profile unlink', unlinkErr.message)

    // ── 5. The team row ─────────────────────────────────────────────────
    const { error: teamDelErr } = await admin.from('teams').delete().eq('id', team_id)
    if (teamDelErr) return fail('team delete', teamDelErr.message)

    return NextResponse.json({
      status: 'success',
      team_name: teamName,
      deletedMatches: pendingIds.length,
      deletedKnockoutMatches: koIds.length,
      deletedRobots: robotIds.length,
      deletedSessions,
      unlinkedProfiles: (unlinked ?? []).length,
      knockoutNote:
        koIds.length > 0
          ? 'Knockout matches were removed — republish the knockout bracket.'
          : null,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Team deletion failed' },
      { status: 500 }
    )
  }
}
