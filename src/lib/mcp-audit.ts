/**
 * MCP Audit — logs and analyzes MCP tool calls per agent.
 *
 * Tracks every tool invocation with success/failure, duration, and error detail.
 * Provides aggregated stats for efficiency dashboards.
 */

import { getDatabase } from '@/lib/db'

export interface McpCallInput {
  agentName?: string
  mcpServer?: string
  toolName?: string
  success?: boolean
  durationMs?: number
  error?: string
  workspaceId?: number
}

export interface McpCallStats {
  totalCalls: number
  successCount: number
  failureCount: number
  successRate: number
  avgDurationMs: number
  toolBreakdown: Array<{
    toolName: string
    mcpServer: string
    calls: number
    successes: number
    failures: number
    avgDurationMs: number
  }>
}

export function logMcpCall(input: McpCallInput): number {
  const db = getDatabase()
  const result = db.prepare(`
    INSERT INTO mcp_call_log (agent_name, mcp_server, tool_name, success, duration_ms, error, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.agentName ?? null,
    input.mcpServer ?? null,
    input.toolName ?? null,
    input.success !== false ? 1 : 0,
    input.durationMs ?? null,
    input.error ?? null,
    input.workspaceId ?? 1,
  )
  return result.lastInsertRowid as number
}

export interface McpLatencyPercentiles {
  p50: number
  p95: number
  p99: number
  sampleSize: number
  perTool: Array<{
    toolName: string
    mcpServer: string
    p50: number
    p95: number
    p99: number
    calls: number
  }>
}

function computePercentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil(pct / 100 * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

export function getMcpLatencyPercentiles(
  hours: number = 24,
  workspaceId: number = 1,
): McpLatencyPercentiles {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const rows = db.prepare(`
    SELECT duration_ms, tool_name, mcp_server
    FROM mcp_call_log
    WHERE workspace_id = ? AND created_at > ? AND duration_ms IS NOT NULL
    ORDER BY duration_ms ASC
  `).all(workspaceId, since) as Array<{ duration_ms: number; tool_name: string | null; mcp_server: string | null }>

  if (rows.length === 0) {
    return { p50: 0, p95: 0, p99: 0, sampleSize: 0, perTool: [] }
  }

  const allDurations = rows.map(r => r.duration_ms)

  // Per-tool grouping
  const toolMap = new Map<string, { durations: number[]; mcpServer: string }>()
  for (const row of rows) {
    const key = `${row.tool_name ?? 'unknown'}::${row.mcp_server ?? 'unknown'}`
    const existing = toolMap.get(key)
    if (existing) {
      existing.durations.push(row.duration_ms)
    } else {
      toolMap.set(key, {
        durations: [row.duration_ms],
        mcpServer: row.mcp_server ?? 'unknown',
      })
    }
  }

  const perTool = Array.from(toolMap.entries()).map(([key, { durations, mcpServer }]) => {
    const toolName = key.split('::')[0]
    const sorted = [...durations].sort((a, b) => a - b)
    return {
      toolName,
      mcpServer,
      p50: computePercentile(sorted, 50),
      p95: computePercentile(sorted, 95),
      p99: computePercentile(sorted, 99),
      calls: sorted.length,
    }
  })

  return {
    p50: computePercentile(allDurations, 50),
    p95: computePercentile(allDurations, 95),
    p99: computePercentile(allDurations, 99),
    sampleSize: allDurations.length,
    perTool,
  }
}

export function getMcpCallStats(
  agentName: string,
  hours: number = 24,
  workspaceId: number = 1,
): McpCallStats {
  const db = getDatabase()
  const since = Math.floor(Date.now() / 1000) - hours * 3600

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
  `).get(agentName, workspaceId, since) as any

  const breakdown = db.prepare(`
    SELECT
      tool_name,
      mcp_server,
      COUNT(*) as calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
      AVG(duration_ms) as avg_duration
    FROM mcp_call_log
    WHERE agent_name = ? AND workspace_id = ? AND created_at > ?
    GROUP BY tool_name, mcp_server
    ORDER BY calls DESC
  `).all(agentName, workspaceId, since) as any[]

  const total = totals?.total ?? 0
  const successCount = totals?.successes ?? 0
  const failureCount = totals?.failures ?? 0

  return {
    totalCalls: total,
    successCount,
    failureCount,
    successRate: total > 0 ? Math.round((successCount / total) * 10000) / 100 : 100,
    avgDurationMs: Math.round(totals?.avg_duration ?? 0),
    toolBreakdown: breakdown.map((row: any) => ({
      toolName: row.tool_name ?? 'unknown',
      mcpServer: row.mcp_server ?? 'unknown',
      calls: row.calls,
      successes: row.successes,
      failures: row.failures,
      avgDurationMs: Math.round(row.avg_duration ?? 0),
    })),
  }
}
