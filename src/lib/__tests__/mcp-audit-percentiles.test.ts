import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- DB mock setup ---
const mockAll = vi.fn((): any[] => [])
const mockGet = vi.fn((): any => null)
const mockRun = vi.fn((): any => ({ lastInsertRowid: 1 }))
const mockPrepare = vi.fn(() => ({ all: mockAll, get: mockGet, run: mockRun }))

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({ prepare: mockPrepare }),
}))

import { getMcpLatencyPercentiles } from '@/lib/mcp-audit'

describe('getMcpLatencyPercentiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrepare.mockReturnValue({ all: mockAll, get: mockGet, run: mockRun })
  })

  it('returns zeros and empty perTool when no calls exist', () => {
    mockAll.mockReturnValue([])
    const result = getMcpLatencyPercentiles(24, 1)
    expect(result.p50).toBe(0)
    expect(result.p95).toBe(0)
    expect(result.p99).toBe(0)
    expect(result.sampleSize).toBe(0)
    expect(result.perTool).toEqual([])
  })

  it('returns correct percentile values for 100 sorted calls', () => {
    // 100 calls with duration_ms = 1..100
    const rows = Array.from({ length: 100 }, (_, i) => ({
      duration_ms: i + 1,
      tool_name: 'read_file',
      mcp_server: 'filesystem',
    }))
    mockAll.mockReturnValue(rows)

    const result = getMcpLatencyPercentiles(24, 1)
    // p50 = index Math.ceil(50/100 * 100) - 1 = 49 → value 50
    expect(result.p50).toBe(50)
    // p95 = index Math.ceil(95/100 * 100) - 1 = 94 → value 95
    expect(result.p95).toBe(95)
    // p99 = index Math.ceil(99/100 * 100) - 1 = 98 → value 99
    expect(result.p99).toBe(99)
    expect(result.sampleSize).toBe(100)
  })

  it('returns single value for all percentiles when only one call exists', () => {
    const rows = [{ duration_ms: 42, tool_name: 'write_file', mcp_server: 'filesystem' }]
    mockAll.mockReturnValue(rows)

    const result = getMcpLatencyPercentiles(24, 1)
    expect(result.p50).toBe(42)
    expect(result.p95).toBe(42)
    expect(result.p99).toBe(42)
    expect(result.sampleSize).toBe(1)
  })

  it('respects time window by passing correct cutoff to query', () => {
    mockAll.mockReturnValue([])
    const before = Math.floor(Date.now() / 1000) - 2 * 3600
    getMcpLatencyPercentiles(2, 1)
    const after = Math.floor(Date.now() / 1000) - 2 * 3600
    // The prepared statement should have been called with a timestamp in that range
    expect(mockPrepare).toHaveBeenCalled()
    // The second argument to all() should be a timestamp close to `since`
    const callArgs = mockAll.mock.calls[0] as unknown as [number, number]
    const passedSince = callArgs[1]
    expect(passedSince).toBeGreaterThanOrEqual(before - 1)
    expect(passedSince).toBeLessThanOrEqual(after + 1)
  })

  it('includes per-tool percentile breakdown', () => {
    // Mix of two tools
    const rows = [
      { duration_ms: 10, tool_name: 'read_file', mcp_server: 'filesystem' },
      { duration_ms: 20, tool_name: 'read_file', mcp_server: 'filesystem' },
      { duration_ms: 30, tool_name: 'read_file', mcp_server: 'filesystem' },
      { duration_ms: 100, tool_name: 'write_file', mcp_server: 'filesystem' },
      { duration_ms: 200, tool_name: 'write_file', mcp_server: 'filesystem' },
    ]
    mockAll.mockReturnValue(rows)

    const result = getMcpLatencyPercentiles(24, 1)
    // Overall should use all 5 values
    expect(result.sampleSize).toBe(5)
    // Per-tool breakdown should exist
    expect(result.perTool.length).toBeGreaterThan(0)
    const readTool = result.perTool.find(t => t.toolName === 'read_file')
    expect(readTool).toBeDefined()
    expect(readTool!.calls).toBe(3)
    // read_file values sorted: [10, 20, 30] → p50 = 20
    expect(readTool!.p50).toBe(20)
    const writeTool = result.perTool.find(t => t.toolName === 'write_file')
    expect(writeTool).toBeDefined()
    expect(writeTool!.calls).toBe(2)
  })
})
