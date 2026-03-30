import { getDatabase } from '@/lib/db'

/**
 * Session data shape from Session Manager :7655 responses.
 * Only token-relevant fields are required; others are optional.
 */
export interface ClaudiosSessionData {
  id: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  status?: string
}

/**
 * Bridge Claudios session token data into the token_usage table.
 *
 * - Uses session_id = "claudios:{session.id}" to avoid collision with OpenClaw sessions
 * - Upserts: if (session_id + model) already exists, updates with MAX() to keep highest token counts
 * - Skips sessions with zero tokens
 *
 * @returns Number of newly inserted rows
 */
export function ingestClaudiosTokens(sessions: ClaudiosSessionData[]): number {
  if (sessions.length === 0) return 0

  const db = getDatabase()
  let inserted = 0

  for (const session of sessions) {
    const inputTokens = session.inputTokens ?? 0
    const outputTokens = session.outputTokens ?? 0

    // Skip zero-token sessions — nothing to record
    if (inputTokens === 0 && outputTokens === 0) continue

    const sessionId = `claudios:${session.id}`
    const model = session.model || 'unknown'

    // Upsert: update if row exists (token counts grow during a session), insert otherwise.
    // MAX() ensures we never decrease counts if a stale event arrives out of order.
    const existing = db.prepare(
      'SELECT id FROM token_usage WHERE session_id = ? AND model = ? LIMIT 1'
    ).get(sessionId, model) as { id: number } | undefined | null

    if (existing) {
      db.prepare(`
        UPDATE token_usage
        SET input_tokens = MAX(input_tokens, ?), output_tokens = MAX(output_tokens, ?)
        WHERE session_id = ? AND model = ?
      `).run(inputTokens, outputTokens, sessionId, model)
      // Don't increment inserted — this was an update, not a new row
      continue
    }

    // Insert new record
    const nowSec = Math.floor(Date.now() / 1000)
    db.prepare(`
      INSERT INTO token_usage (model, session_id, input_tokens, output_tokens, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(model, sessionId, inputTokens, outputTokens, 1, nowSec)

    inserted++
  }

  return inserted
}
