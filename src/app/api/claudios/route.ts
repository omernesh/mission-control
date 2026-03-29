import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { claudiosConfig } from '@/lib/claudios-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface MachineMetrics {
  machineId: string
  cpuPercent: number
  ramPercent: number
  ramFreeMb: number
  ramTotalMb: number
  diskFreeGb: number | null
  diskTotalGb: number | null
  platform: string
  recordedAt: string
}

/**
 * Infer machine online status from metrics age.
 * > 5min stale = offline, > 90s stale = idle, otherwise online.
 */
function inferMachineStatus(m: MachineMetrics): 'online' | 'idle' | 'offline' {
  const ageMs = Date.now() - new Date(m.recordedAt).getTime()
  if (ageMs > 5 * 60 * 1000) return 'offline' // stale > 5min
  if (ageMs > 90_000) return 'idle' // stale > 90s (metrics TTL)
  return 'online'
}

/**
 * Map ACP task status to MC Kanban column.
 * Read-only mirror — ACP has no PATCH endpoint for task status writeback.
 */
function mapAcpStatus(status: string): string {
  switch (status) {
    case 'pending':   return 'inbox'
    case 'running':   return 'in_progress'
    case 'completed': return 'done'
    case 'failed':    return 'inbox'
    case 'cancelled': return 'archived'
    default:          return 'inbox'
  }
}

/**
 * GET /api/claudios?action=sessions|metrics|tasks
 *
 * Proxy route that fetches from Claudios services and returns MC-compatible shapes.
 *
 * action=sessions  — raw Session Manager sessions
 * action=metrics   — machine metrics mapped to PresenceEntry shape (nodes-panel compatible)
 * action=tasks     — read-only ACP task mirror (no writeback — ACP lacks PATCH endpoint)
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const action = request.nextUrl.searchParams.get('action') || 'sessions'

  switch (action) {
    case 'sessions': {
      try {
        const res = await fetch(`${claudiosConfig.sessionManagerUrl}/sessions`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) throw new Error(`Session Manager returned ${res.status}`)
        const data = await res.json()
        return NextResponse.json(data)
      } catch {
        return NextResponse.json({ sessions: [], error: 'Session Manager unreachable' })
      }
    }

    case 'metrics': {
      try {
        const res = await fetch(`${claudiosConfig.claudiosApiUrl}/api/machines/metrics`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) throw new Error(`Claudios API returned ${res.status}`)
        const data = await res.json() as { machines: MachineMetrics[] }
        const machines: MachineMetrics[] = data.machines ?? []

        const mapped = machines.map(m => ({
          id: m.machineId,
          clientId: `claudios-${m.machineId}`,
          displayName: m.machineId,
          platform: m.platform,
          version: '',
          roles: ['claudios-worker'],
          connectedAt: new Date(m.recordedAt).getTime(),
          lastActivity: new Date(m.recordedAt).getTime(),
          host: m.machineId,
          status: inferMachineStatus(m),
          // Extra fields for metrics display (beyond PresenceEntry base shape)
          cpuPercent: m.cpuPercent,
          ramPercent: m.ramPercent,
          ramFreeMb: m.ramFreeMb,
          ramTotalMb: m.ramTotalMb,
          diskFreeGb: m.diskFreeGb,
          diskTotalGb: m.diskTotalGb,
        }))

        return NextResponse.json({ nodes: mapped })
      } catch {
        return NextResponse.json({ nodes: [], error: 'Claudios API unreachable' })
      }
    }

    case 'tasks': {
      try {
        const res = await fetch(`${claudiosConfig.acpUrl}/acp/sessions`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) throw new Error(`ACP returned ${res.status}`)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sessions = await res.json() as any[]

        // NOTE: Read-only mirror. ACP has no PATCH endpoint for task status — MC cannot write back.
        // Per CONTEXT.md discussion: bidirectional writeback descoped to read-only mirror.
        // Future: if ACP adds PATCH /acp/sessions/:id/tasks/:jobId/status, writeback can be added.
        const tasks = sessions.flatMap((s: { id: string; tasks?: { jobId: string; task: string; status: string }[] }) =>
          (s.tasks || []).map(t => ({
            ...t,
            sessionId: s.id,
            mcStatus: mapAcpStatus(t.status),
          }))
        )

        return NextResponse.json({ tasks })
      } catch {
        return NextResponse.json({ tasks: [], error: 'ACP unreachable' })
      }
    }

    default:
      return NextResponse.json(
        { error: 'Unknown action. Use: sessions, metrics, tasks' },
        { status: 400 }
      )
  }
}
