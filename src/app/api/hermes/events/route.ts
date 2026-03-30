import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { requireRole } from '@/lib/auth'
import { db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'

interface HermesEventBody {
  event: string
  source?: string
  [key: string]: unknown
}

const EVENT_TYPE_MAP: Record<string, string> = {
  'session:start': 'hermes_session_start',
  'session:end': 'hermes_session_end',
  'agent:start': 'hermes_agent_start',
  'agent:end': 'hermes_agent_end',
}

function descriptionFor(event: string, source?: string): string {
  switch (event) {
    case 'session:start':
      return `Hermes session started${source ? ` (${source})` : ''}`
    case 'session:end':
      return `Hermes session ended${source ? ` (${source})` : ''}`
    case 'agent:start':
      return 'Hermes agent started'
    case 'agent:end':
      return 'Hermes agent ended'
    default:
      return `Hermes event: ${event}`
  }
}

export async function POST(request: NextRequest) {
  // Auth: accept either a valid API key/session OR the HERMES_HOOK_SECRET shared secret
  const hookSecret = process.env.HERMES_HOOK_SECRET
  const providedSecret = request.headers.get('x-hook-secret')
  const isHookAuth = hookSecret && providedSecret &&
    hookSecret.length === providedSecret.length &&
    timingSafeEqual(Buffer.from(hookSecret), Buffer.from(providedSecret))
  if (!isHookAuth) {
    const auth = requireRole(request, 'viewer')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10)
    if (contentLength > 8192) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    const body = await request.json() as HermesEventBody
    const { event, source } = body

    if (!event || typeof event !== 'string') {
      return NextResponse.json({ error: 'Missing required field: event' }, { status: 400 })
    }

    const activityType = EVENT_TYPE_MAP[event] || 'hermes_event'
    const description = descriptionFor(event, source)

    // logActivity is synchronous (better-sqlite3) — exceptions propagate to the catch block
    db_helpers.logActivity(
      activityType,
      'hermes',
      0,
      'Sammie',
      description,
      body,
      1
    )

    logger.info({ event, activityType }, 'Hermes event ingested')

    return NextResponse.json({ success: true, activityType })
  } catch (err) {
    logger.error({ err }, 'Hermes event ingestion failed')
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Event ingestion failed' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
