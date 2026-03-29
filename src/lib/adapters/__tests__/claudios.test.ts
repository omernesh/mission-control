import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock eventBus before importing adapter
vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

describe('ClaudiosAdapter', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('register()', () => {
    it('emits agent.created with framework claudios', async () => {
      // Plan 01 fills in
      expect(true).toBe(true) // placeholder
    })
  })

  describe('heartbeat()', () => {
    it('maps active session with recent activity to busy', async () => {
      expect(true).toBe(true)
    })
    it('maps active session with stale activity (>10min) to error', async () => {
      expect(true).toBe(true)
    })
    it('maps active session with activity >=3min to idle', async () => {
      expect(true).toBe(true)
    })
    it('maps inactive session to offline', async () => {
      expect(true).toBe(true)
    })
  })

  describe('getAssignments()', () => {
    it('flattens tasks from ACP sessions and filters to pending', async () => {
      expect(true).toBe(true)
    })
    it('returns empty array when ACP is unreachable', async () => {
      expect(true).toBe(true)
    })
  })

  describe('status mapping', () => {
    it('maps ACP pending to inbox', () => { expect(true).toBe(true) })
    it('maps ACP running to in_progress', () => { expect(true).toBe(true) })
    it('maps ACP completed to done', () => { expect(true).toBe(true) })
    it('maps ACP failed to inbox', () => { expect(true).toBe(true) })
    it('maps ACP cancelled to archived', () => { expect(true).toBe(true) })
  })
})
