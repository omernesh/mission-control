import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getDatabase
const mockPrepare = vi.fn()
const mockDb = { prepare: mockPrepare }
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => mockDb),
}))

// Mock calculateTokenCost
vi.mock('@/lib/token-pricing', () => ({
  calculateTokenCost: vi.fn(() => 0.005),
}))

import { ingestClaudiosTokens, type ClaudiosSessionData } from '@/lib/token-ingest'

describe('ingestClaudiosTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 1: returns 0 when given empty array', () => {
    const result = ingestClaudiosTokens([])
    expect(result).toBe(0)
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('Test 2: inserts rows for valid session data', () => {
    const mockGet = vi.fn(() => null) // no existing row
    const mockRun = vi.fn(() => ({ changes: 1 }))
    mockPrepare
      .mockReturnValueOnce({ get: mockGet })   // SELECT check
      .mockReturnValueOnce({ run: mockRun })   // INSERT

    const sessions: ClaudiosSessionData[] = [
      { id: 'sess-abc', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500 },
    ]

    const result = ingestClaudiosTokens(sessions)
    expect(result).toBe(1)
    expect(mockPrepare).toHaveBeenCalledTimes(2)
    // INSERT call should use "claudios:" prefixed session_id
    const insertCall = mockPrepare.mock.calls[1][0] as string
    expect(insertCall).toContain('INSERT')
    expect(insertCall).toContain('token_usage')
  })

  it('Test 3: deduplicates — does not insert if session_id+model already exists', () => {
    const mockGet = vi.fn(() => ({ id: 1 })) // existing row found
    mockPrepare.mockReturnValue({ get: mockGet })

    const sessions: ClaudiosSessionData[] = [
      { id: 'sess-dup', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500 },
    ]

    const result = ingestClaudiosTokens(sessions)
    expect(result).toBe(0)
    // Only SELECT should be called (no INSERT)
    const prepareCalls = mockPrepare.mock.calls
    expect(prepareCalls.length).toBe(1)
    expect((prepareCalls[0][0] as string).toUpperCase()).toContain('SELECT')
  })

  it('Test 4: skips sessions with zero tokens', () => {
    const sessions: ClaudiosSessionData[] = [
      { id: 'sess-empty', model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0 },
      { id: 'sess-undef', model: 'claude-sonnet-4-6' }, // no token fields
    ]

    const result = ingestClaudiosTokens(sessions)
    expect(result).toBe(0)
    expect(mockPrepare).not.toHaveBeenCalled()
  })

  it('Test 5: session_id is prefixed with "claudios:" to namespace separately from OpenClaw sessions', () => {
    const mockGet = vi.fn(() => null)
    const mockRun = vi.fn(() => ({ changes: 1 }))
    mockPrepare
      .mockReturnValueOnce({ get: mockGet })
      .mockReturnValueOnce({ run: mockRun })

    const sessions: ClaudiosSessionData[] = [
      { id: 'my-session-id', model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50 },
    ]

    ingestClaudiosTokens(sessions)

    // The SELECT check should use "claudios:my-session-id" as the session_id
    const selectArgs = mockGet.mock.calls[0] as unknown[]
    expect(selectArgs[0]).toBe('claudios:my-session-id')
  })
})
