import { eventBus } from '@/lib/event-bus'
import { claudiosConfig } from '@/lib/claudios-config'
import type { FrameworkAdapter, AgentRegistration, HeartbeatPayload, TaskReport, Assignment } from './adapter'

interface SessionManagerSession {
  id: string
  nickname: string
  hostname: string
  cwd: string
  status: 'active' | 'inactive'
  started_at: string
  ended_at: string | null
  created_at: string
  last_activity: string | null
}

interface AcpTask {
  jobId: string
  task: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

interface AcpSession {
  id: string
  tasks?: AcpTask[]
}

/**
 * Maps a Session Manager session to one of 4 states (per CONTEXT.md locked decision):
 * - inactive => offline
 * - active + last_activity < 3min ago => busy
 * - active + last_activity >= 3min and < 10min => idle
 * - active + last_activity >= 10min (or null) => error (stalled)
 */
export function mapSessionStatus(
  session: Pick<SessionManagerSession, 'status' | 'last_activity'>
): 'busy' | 'idle' | 'error' | 'offline' {
  if (session.status === 'inactive') return 'offline'
  if (session.status !== 'active') return 'offline'
  // active session — check last_activity age
  if (!session.last_activity) return 'error' // active with no activity = stalled
  const ageMs = Date.now() - new Date(session.last_activity).getTime()
  if (ageMs >= claudiosConfig.stalledThresholdMs) return 'error' // stalled
  if (ageMs >= claudiosConfig.idleThresholdMs) return 'idle'
  return 'busy'
}

export class ClaudiosAdapter implements FrameworkAdapter {
  readonly framework = 'claudios'

  async register(agent: AgentRegistration): Promise<void> {
    eventBus.broadcast('agent.created', {
      id: agent.agentId,
      name: agent.name,
      framework: this.framework,
      status: 'online',
      ...(agent.metadata ?? {}),
    })
  }

  async heartbeat(_payload: HeartbeatPayload): Promise<void> {
    try {
      const res = await fetch(`${claudiosConfig.sessionManagerUrl}/sessions`, {
        signal: AbortSignal.timeout(claudiosConfig.fetchTimeoutMs),
      })
      if (!res.ok) return
      const data = await res.json() as { sessions: SessionManagerSession[] }
      const sessions = data.sessions ?? []

      for (const session of sessions) {
        const mappedStatus = mapSessionStatus(session)
        eventBus.broadcast('agent.status_changed', {
          id: session.id,
          status: mappedStatus,
          metrics: {
            hostname: session.hostname,
            cwd: session.cwd,
            nickname: session.nickname,
          },
          framework: this.framework,
        })
      }
    } catch {
      // Graceful degradation — Session Manager may be temporarily unreachable
    }
  }

  async reportTask(report: TaskReport): Promise<void> {
    eventBus.broadcast('task.updated', {
      id: report.taskId,
      agentId: report.agentId,
      progress: report.progress,
      status: report.status,
      output: report.output,
      framework: this.framework,
    })
  }

  async getAssignments(_agentId: string): Promise<Assignment[]> {
    try {
      const res = await fetch(`${claudiosConfig.acpUrl}/acp/sessions`, {
        signal: AbortSignal.timeout(claudiosConfig.fetchTimeoutMs),
      })
      if (!res.ok) return []
      const sessions = await res.json() as AcpSession[]
      return sessions
        .flatMap(s => s.tasks || [])
        .filter(t => t.status === 'pending')
        .map(t => ({
          taskId: t.jobId,
          description: t.task,
          priority: 3,
        }))
    } catch {
      // Graceful degradation — ACP may be temporarily unreachable
      return []
    }
  }

  async disconnect(agentId: string): Promise<void> {
    eventBus.broadcast('agent.status_changed', {
      id: agentId,
      status: 'offline',
      framework: this.framework,
    })
  }
}
