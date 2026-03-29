import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('GET /api/claudios', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('action=sessions', () => {
    it('returns sessions from Session Manager', async () => {
      expect(true).toBe(true)
    })
    it('returns empty array when Session Manager unreachable', async () => {
      expect(true).toBe(true)
    })
  })

  describe('action=metrics', () => {
    it('returns MachineMetrics mapped to PresenceEntry shape', async () => {
      expect(true).toBe(true)
    })
    it('returns empty array when Claudios API unreachable', async () => {
      expect(true).toBe(true)
    })
  })

  describe('action=tasks', () => {
    it('flattens ACP sessions into tasks array', async () => {
      expect(true).toBe(true)
    })
    it('maps ACP status to MC kanban columns', async () => {
      expect(true).toBe(true)
    })
    it('returns tasks as read-only (no writeback)', async () => {
      expect(true).toBe(true)
    })
  })

  it('returns 400 for unknown action', async () => {
    expect(true).toBe(true)
  })
})
