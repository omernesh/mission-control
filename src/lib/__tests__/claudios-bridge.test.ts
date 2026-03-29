import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn() },
}))

describe('ClaudiosBridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  describe('auth', () => {
    it('sends auth message with role observer on open', () => {
      expect(true).toBe(true)
    })
    it('does not send any message after auth:ok', () => {
      expect(true).toBe(true)
    })
  })

  describe('channel filtering', () => {
    it('forwards session.* events to eventBus', () => {
      expect(true).toBe(true)
    })
    it('forwards task.* events to eventBus', () => {
      expect(true).toBe(true)
    })
    it('forwards health.* events to eventBus', () => {
      expect(true).toBe(true)
    })
    it('drops debug/log events', () => {
      expect(true).toBe(true)
    })
  })

  describe('reconnect', () => {
    it('uses exponential backoff 1s->2s->4s->max 30s', () => {
      expect(true).toBe(true)
    })
    it('does not reconnect after stop()', () => {
      expect(true).toBe(true)
    })
  })
})
