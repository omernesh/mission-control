import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
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
      } catch (err) {
        console.error('[claudios] action=sessions:', err)
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
      } catch (err) {
        console.error('[claudios] action=metrics:', err)
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
      } catch (err) {
        console.error('[claudios] action=tasks:', err)
        return NextResponse.json({ tasks: [], error: 'ACP unreachable' })
      }
    }

    case 'gsd': {
      try {
        const [projectsRes, statusRes] = await Promise.all([
          fetch(`${claudiosConfig.claudiosApiUrl}/api/projects`, { signal: AbortSignal.timeout(3000) }),
          fetch(`${claudiosConfig.claudiosApiUrl}/api/projects/status`, { signal: AbortSignal.timeout(3000) }),
        ])
        const projects = projectsRes.ok ? await projectsRes.json() : { phases: [], state: null }
        const status = statusRes.ok ? await statusRes.json() : null
        return NextResponse.json({ projects, status })
      } catch (err) {
        console.error('[claudios] action=gsd:', err)
        return NextResponse.json({
          projects: { phases: [], state: null },
          status: null,
          error: 'Claudios API unreachable',
        })
      }
    }

    case 'memories': {
      const sub = request.nextUrl.searchParams.get('sub') || 'graph'
      const days = request.nextUrl.searchParams.get('days') || '30'
      const urlMap: Record<string, string> = {
        graph: `${claudiosConfig.claudiosApiUrl}/api/memories/graph`,
        timeline: `${claudiosConfig.claudiosApiUrl}/api/memories/timeline?days=${days}`,
        clusters: `${claudiosConfig.claudiosApiUrl}/api/memories/clusters`,
      }
      const url = urlMap[sub] || urlMap.graph
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`Claudios API returned ${res.status}`)
        const data = await res.json()

        if (sub === 'graph') {
          // Unwrap Cytoscape data wrapping to reagraph-compatible flat format
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawNodes: any[] = data.nodes || []
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rawEdges: any[] = data.edges || []
          const nodes = rawNodes.map((n: { data: { id: string; label: string; type: string; salience: number; accessCount: number; clusterId: number; content: string; x: number; y: number } }) => ({
            id: n.data.id,
            label: n.data.label,
            type: n.data.type,
            salience: n.data.salience,
            content: n.data.content,
            fill: n.data.salience > 0.7 ? '#cba6f7' : n.data.salience > 0.4 ? '#89b4fa' : '#6c7086',
            size: 4 + n.data.salience * 6,
          }))
          const edges = rawEdges.map((e: { data: { id: string; source: string; target: string; similarity: number } }) => ({
            id: e.data.id,
            source: e.data.source,
            target: e.data.target,
          }))
          return NextResponse.json({ nodes, edges, clusters: data.clusters || [], cachedAt: data.cachedAt })
        }

        // timeline / clusters: pass through raw JSON
        return NextResponse.json(data)
      } catch (err) {
        console.error('[claudios] action=memories:', err)
        return NextResponse.json({ nodes: [], edges: [], clusters: [], error: 'Claudios API unreachable' })
      }
    }

    case 'standups': {
      const q = request.nextUrl.searchParams.get('q')
      const limit = request.nextUrl.searchParams.get('limit') || '20'
      const offset = request.nextUrl.searchParams.get('offset') || '0'
      const params = new URLSearchParams({ limit, offset })
      if (q) params.set('q', q)
      try {
        const res = await fetch(`${claudiosConfig.claudiosApiUrl}/api/standups?${params}`, {
          signal: AbortSignal.timeout(3000),
        })
        if (!res.ok) throw new Error(`Claudios API returned ${res.status}`)
        return NextResponse.json(await res.json())
      } catch (err) {
        console.error('[claudios] action=standups:', err)
        return NextResponse.json({ reports: [], total: 0, error: 'Claudios API unreachable' })
      }
    }

    case 'skills': {
      // Try Claudios API first; fall back to local filesystem read of %USERPROFILE%/.claude/skills/
      try {
        const res = await fetch(`${claudiosConfig.claudiosApiUrl}/api/skills`, {
          signal: AbortSignal.timeout(3000),
        })
        if (res.ok) {
          return NextResponse.json(await res.json())
        }
      } catch (err) {
        console.error('[claudios] action=skills (api):', err)
        // Fall through to filesystem read
      }

      try {
        const userProfile = process.env.USERPROFILE || process.env.HOME || ''
        const skillsDir = path.join(userProfile, '.claude', 'skills')
        if (!fs.existsSync(skillsDir)) {
          return NextResponse.json({ skills: [], total: 0, source: 'filesystem' })
        }
        const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
        const skills = entries
          .filter(e => e.isDirectory())
          .map(e => {
            const skillMdPath = path.join(skillsDir, e.name, 'SKILL.md')
            let description = ''
            if (fs.existsSync(skillMdPath)) {
              const content = fs.readFileSync(skillMdPath, 'utf8')
              // Extract first non-empty line after frontmatter as description
              const lines = content.split('\n').filter(l => l.trim())
              const descLine = lines.find(l => !l.startsWith('---') && !l.startsWith('#'))
              description = descLine?.trim() ?? ''
            }
            return { name: e.name, path: path.join(skillsDir, e.name), description }
          })
        return NextResponse.json({ skills, total: skills.length, source: 'filesystem' })
      } catch (err) {
        console.error('[claudios] action=skills (filesystem):', err)
        return NextResponse.json({ skills: [], total: 0, error: 'Skills directory unreadable' })
      }
    }

    case 'token-sync': {
      try {
        const res = await fetch(`${claudiosConfig.sessionManagerUrl}/sessions`, {
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) throw new Error(`Session Manager returned ${res.status}`)
        const data = await res.json() as Array<{
          id: string
          model?: string
          inputTokens?: number
          outputTokens?: number
          totalTokens?: number
          status?: string
        }>
        const sessions = Array.isArray(data) ? data : []
        const { ingestClaudiosTokens } = await import('@/lib/token-ingest')
        const synced = ingestClaudiosTokens(sessions.map(s => ({
          id: s.id,
          model: s.model,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          status: s.status,
        })))
        return NextResponse.json({ synced, total: sessions.length })
      } catch (err) {
        console.error('[claudios] action=token-sync:', err)
        return NextResponse.json({ synced: 0, total: 0, error: 'Session Manager unreachable' })
      }
    }

    default:
      return NextResponse.json(
        { error: 'Unknown action. Use: sessions, metrics, tasks, gsd, memories, standups, skills, token-sync' },
        { status: 400 }
      )
  }
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const action = request.nextUrl.searchParams.get('action')

  switch (action) {
    case 'command': {
      const { sessionId, command } = body as { sessionId?: string; command?: string }
      if (!sessionId || !command) {
        return NextResponse.json({ error: 'Missing sessionId or command' }, { status: 400 })
      }
      try {
        const res = await fetch(
          `${claudiosConfig.claudiosApiUrl}/api/sessions/${encodeURIComponent(sessionId)}/command`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command }),
            signal: AbortSignal.timeout(10_000),
          }
        )
        if (!res.ok) throw new Error(`Claudios returned ${res.status}`)
        return NextResponse.json(await res.json())
      } catch (err) {
        console.error('[claudios] action=command:', err)
        return NextResponse.json({ error: 'Command execution failed' }, { status: 502 })
      }
    }
    case 'task-status': {
      const { taskId, newStatus } = body as { taskId?: number; newStatus?: string }
      if (taskId === undefined || taskId === null || !newStatus) {
        return NextResponse.json({ error: 'Missing taskId or newStatus' }, { status: 400 })
      }
      try {
        const res = await fetch(
          `${claudiosConfig.acpUrl}/acp/tasks/${taskId}/status`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
            signal: AbortSignal.timeout(5000),
          }
        )
        if (!res.ok) throw new Error(`ACP returned ${res.status}`)
        return NextResponse.json({ ok: true, persisted: 'acp+mc' })
      } catch (err) {
        console.error('[claudios] action=task-status:', err)
        return NextResponse.json({ ok: true, persisted: 'mc-only', warning: 'ACP unreachable' })
      }
    }

    default:
      return NextResponse.json({ error: 'Unknown POST action. Use: command, task-status' }, { status: 400 })
  }
}
