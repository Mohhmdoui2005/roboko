import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireAdmin } from '@/lib/adminAuth'

// POST /api/admin/generate-testing-qrs
// Ensures one robot per team (36 teams → 36 robots), creating missing robots
// named "<Team> Robot", then backfills any missing ROBOT_TEST qr_payloads.
// Service role: admin writes bypass RLS, and the whole ensure step is atomic
// from the caller's point of view (read → create → backfill → summary).

interface TeamRow {
  id: string
  name: string
}

interface RobotRow {
  id: string
  name: string
  team_id: string | null
  qr_payload: string | null
}

export async function POST(req: Request) {
  const gate = await requireAdmin(req)
  if (gate instanceof Response) return gate
  const { admin } = gate

  try {
    const { data: teams, error: teamsErr } = await admin
      .from('teams')
      .select('id,name')
      .order('name')
    if (teamsErr) throw new Error(`teams: ${teamsErr.message}`)
    const teamRows = (teams ?? []) as TeamRow[]
    if (teamRows.length === 0) {
      return NextResponse.json({ error: 'No teams found — add teams first' }, { status: 400 })
    }

    const { data: robots, error: robotsErr } = await admin
      .from('robots')
      .select('id,name,team_id,qr_payload')
    if (robotsErr) throw new Error(`robots: ${robotsErr.message}`)
    const robotRows = (robots ?? []) as RobotRow[]
    const teamIdsWithRobot = new Set(
      robotRows.filter(r => r.team_id).map(r => r.team_id as string)
    )

    // 1. One robot per team — create whichever are missing.
    // qr_payload is NOT NULL, so the payload rides along in the insert
    // (id is UUID — generated here so the payload can reference it).
    let created = 0
    for (const team of teamRows) {
      if (teamIdsWithRobot.has(team.id)) continue
      const robotId = randomUUID()
      const payload = JSON.stringify({ domain: 'ROBOT_TEST', robot_id: robotId })
      const { error } = await admin.from('robots').insert({
        id: robotId,
        name: `${team.name} Robot`,
        team_id: team.id,
        qr_payload: payload,
      })
      if (error) throw new Error(`create robot for "${team.name}": ${error.message}`)
      created++
    }

    // 2. Backfill any missing payloads (newly created + legacy rows).
    const { data: fresh, error: freshErr } = await admin
      .from('robots')
      .select('id,qr_payload')
    if (freshErr) throw new Error(`robots reload: ${freshErr.message}`)
    let backfilled = 0
    for (const robot of ((fresh ?? []) as { id: string; qr_payload: string | null }[])) {
      if (!robot.qr_payload) {
        const payload = JSON.stringify({ domain: 'ROBOT_TEST', robot_id: robot.id })
        const { error } = await admin
          .from('robots')
          .update({ qr_payload: payload })
          .eq('id', robot.id)
        if (error) throw new Error(`payload for robot ${robot.id.slice(0, 8)}: ${error.message}`)
        backfilled++
      }
    }

    return NextResponse.json({
      status: 'success',
      teams: teamRows.length,
      robots: (fresh ?? []).length,
      created,
      backfilled,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Testing QR generation failed' },
      { status: 500 }
    )
  }
}
