import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { db_helpers } from '@/lib/db'
import { logger } from '@/lib/logger'

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
  // Allow unauthenticated requests from localhost (Hermes hook runs locally on hpg6)
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || ''
  const isLocalhost = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === '' || clientIp === '::ffff:127.0.0.1'
  if (!isLocalhost) {
    const auth = requireRole(request, 'viewer')
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await request.json()
    const { event, source, ...rest } = body

    if (!event || typeof event !== 'string') {
      return NextResponse.json({ error: 'Missing required field: event' }, { status: 400 })
    }

    const activityType = EVENT_TYPE_MAP[event] || 'hermes_event'
    const description = descriptionFor(event, source)

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
