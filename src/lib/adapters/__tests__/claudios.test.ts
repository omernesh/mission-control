import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock eventBus before importing adapter
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

import { ClaudiosAdapter, mapSessionStatus } from '../claudios'
import { eventBus } from '@/lib/event-bus'

const mockBroadcast = vi.mocked(eventBus.broadcast)

describe('mapSessionStatus()', () => {
  it('maps inactive session to offline', () => {
    expect(mapSessionStatus({ status: 'inactive', last_activity: null })).toBe('offline')
    expect(mapSessionStatus({ status: 'inactive', last_activity: new Date().toISOString() })).toBe('offline')
  })

  it('maps active session with no last_activity to error (stalled)', () => {
    expect(mapSessionStatus({ status: 'active', last_activity: null })).toBe('error')
  })

  it('maps active session with recent activity (<3min) to busy', () => {
    const recent = new Date(Date.now() - 60_000).toISOString() // 1 min ago
    expect(mapSessionStatus({ status: 'active', last_activity: recent })).toBe('busy')
  })

  it('maps active session with activity >=3min and <10min to idle', () => {
    const stale = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min ago
    expect(mapSessionStatus({ status: 'active', last_activity: stale })).toBe('idle')
  })

  it('maps active session with activity >=10min to error (stalled)', () => {
    const veryStale = new Date(Date.now() - 11 * 60_000).toISOString() // 11 min ago
    expect(mapSessionStatus({ status: 'active', last_activity: veryStale })).toBe('error')
  })
})

describe('ClaudiosAdapter', () => {
  let adapter: ClaudiosAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new ClaudiosAdapter()
  })

  it('framework is claudios', () => {
    expect(adapter.framework).toBe('claudios')
  })

  describe('register()', () => {
    it('emits agent.created with framework claudios', async () => {
      await adapter.register({ agentId: 'agent-1', name: 'TestAgent', framework: 'claudios' })
      expect(mockBroadcast).toHaveBeenCalledWith('agent.created', expect.objectContaining({
        id: 'agent-1',
        name: 'TestAgent',
        framework: 'claudios',
        status: 'online',
      }))
    })
  })

  describe('heartbeat()', () => {
    it('calls session manager and broadcasts agent.status_changed per session', async () => {
      const sessions = [
        { id: 's1', nickname: 'worker', hostname: 'SIMPC', cwd: 'D:/proj', status: 'active', last_activity: new Date().toISOString(), started_at: '', ended_at: null, created_at: '' },
        { id: 's2', nickname: 'idle-worker', hostname: 'SIMPC', cwd: 'D:/proj2', status: 'inactive', last_activity: null, started_at: '', ended_at: null, created_at: '' },
      ]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ sessions }),
      }))

      await adapter.heartbeat({ agentId: 'any', status: 'any' })

      expect(mockBroadcast).toHaveBeenCalledTimes(2)
      expect(mockBroadcast).toHaveBeenCalledWith('agent.status_changed', expect.objectContaining({ id: 's1', status: 'busy' }))
      expect(mockBroadcast).toHaveBeenCalledWith('agent.status_changed', expect.objectContaining({ id: 's2', status: 'offline' }))

      vi.unstubAllGlobals()
    })

    it('handles Session Manager unreachable gracefully', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
      await expect(adapter.heartbeat({ agentId: 'any', status: 'any' })).resolves.toBeUndefined()
      expect(mockBroadcast).not.toHaveBeenCalled()
      vi.unstubAllGlobals()
    })
  })

  describe('getAssignments()', () => {
    it('flattens tasks from ACP sessions and filters to pending', async () => {
      const acpSessions = [
        { id: 's1', tasks: [
          { jobId: 'j1', task: 'do thing', status: 'pending' },
          { jobId: 'j2', task: 'running thing', status: 'running' },
        ]},
        { id: 's2', tasks: [
          { jobId: 'j3', task: 'another thing', status: 'pending' },
        ]},
      ]
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => acpSessions,
      }))

      const result = await adapter.getAssignments('agent-1')
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ taskId: 'j1', description: 'do thing', priority: 3 })
      expect(result[1]).toMatchObject({ taskId: 'j3', description: 'another thing', priority: 3 })

      vi.unstubAllGlobals()
    })

    it('returns empty array when ACP is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
      const result = await adapter.getAssignments('agent-1')
      expect(result).toEqual([])
      vi.unstubAllGlobals()
    })
  })

  describe('reportTask()', () => {
    it('broadcasts task.updated', async () => {
      await adapter.reportTask({ taskId: 't1', agentId: 'a1', progress: 50, status: 'in_progress' })
      expect(mockBroadcast).toHaveBeenCalledWith('task.updated', expect.objectContaining({
        id: 't1',
        agentId: 'a1',
        progress: 50,
        status: 'in_progress',
        framework: 'claudios',
      }))
    })
  })

  describe('disconnect()', () => {
    it('broadcasts agent.status_changed with offline', async () => {
      await adapter.disconnect('agent-1')
      expect(mockBroadcast).toHaveBeenCalledWith('agent.status_changed', expect.objectContaining({
        id: 'agent-1',
        status: 'offline',
        framework: 'claudios',
      }))
    })
  })
})
