import WebSocket from 'ws'
import { eventBus } from '@/lib/event-bus'
import type { db_helpers as DbHelpers } from '@/lib/db'
import type { ingestClaudiosTokens as IngestFn } from '@/lib/token-ingest'

// Cache dynamic imports at module level to avoid re-importing on every message
let _dbHelpers: typeof DbHelpers | null = null
let _ingestFn: typeof IngestFn | null = null

async function getDbHelpers(): Promise<typeof DbHelpers> {
  if (!_dbHelpers) {
    const mod = await import('@/lib/db')
    _dbHelpers = mod.db_helpers
  }
  return _dbHelpers
}

async function getIngestFn(): Promise<typeof IngestFn> {
  if (!_ingestFn) {
    const mod = await import('@/lib/token-ingest')
    _ingestFn = mod.ingestClaudiosTokens
  }
  return _ingestFn
}

/**
 * Server-side WebSocket client that connects to WsHub :9877 as an observer.
 * Filters incoming events by channel prefix (session.*, task.*, health.*) and
 * forwards them to the local eventBus as 'activity.created' events.
 *
 * Observer role is READ-ONLY — no messages are sent after auth:ok.
 * WsHub closes with 4403 on any post-auth send attempt.
 */

const ALLOWED_PREFIXES = ['session.', 'task.', 'health.']

export class ClaudiosBridge {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts: number = 0
  private stopped: boolean = false

  start(url: string, psk: string): void {
    this.stopped = false
    this._connect(url, psk)
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private _connect(url: string, psk: string): void {
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
    }
    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      // Reset backoff counter on successful connection
      this.attempts = 0
      // CRITICAL: Auth must be sent within 5s or WsHub closes with 4401
      this.ws!.send(JSON.stringify({
        token: psk,
        machineId: 'mc-bridge',
        sessionInfo: 'mission-control-observer',
        role: 'observer',
      }))
    })

    this.ws.on('message', async (data: WebSocket.RawData) => {
      try {
        const envelope = JSON.parse(data.toString()) as Record<string, unknown>

        // auth:ok — no-op, just acknowledge silently
        if (envelope.type === 'auth:ok') return

        // Filter by channel prefix — drop debug/log noise
        const typeOrChannel = (envelope.type as string) || (envelope.channel as string) || ''
        if (ALLOWED_PREFIXES.some(p => typeOrChannel.startsWith(p))) {
          eventBus.broadcast('activity.created', {
            source: 'claudios-wshub',
            channel: envelope.channel,
            type: envelope.type,
            payload: envelope.payload,
          })

          // Persist to activities table so events survive page refresh
          try {
            const dbh = await getDbHelpers()
            dbh.logActivity(
              typeOrChannel.replace('.', '_'),
              'system',
              0,
              'claudios',
              `${typeOrChannel}: ${JSON.stringify(envelope.payload || {}).slice(0, 200)}`,
              { source: 'claudios-wshub', channel: envelope.channel, payload: envelope.payload },
              1
            )
          } catch (dbErr) {
            console.warn('[claudios-bridge] DB write failed:', (dbErr as Error).message)
          }

          // Capture token data from session.* events in real-time
          if (typeOrChannel.startsWith('session.')) {
            const payload = envelope.payload as Record<string, unknown> | null | undefined
            const inputTokens = Number(payload?.inputTokens ?? 0)
            const outputTokens = Number(payload?.outputTokens ?? 0)
            const totalTokens = Number(payload?.totalTokens ?? 0)
            if ((inputTokens > 0 || outputTokens > 0 || totalTokens > 0) && payload?.id) {
              try {
                const ingest = await getIngestFn()
                ingest([{
                  id: String(payload.id),
                  model: payload.model ? String(payload.model) : undefined,
                  inputTokens,
                  outputTokens,
                  status: payload.status ? String(payload.status) : undefined,
                }])
              } catch (ingestErr) {
                console.warn('[claudios-bridge] Token ingest failed:', (ingestErr as Error).message)
              }
            }
          }
        }
      } catch (parseErr) {
        console.warn('[claudios-bridge] Malformed message dropped:', (parseErr as Error).message)
      }
    })

    this.ws.on('close', () => {
      this._scheduleReconnect(url, psk)
    })

    this.ws.on('error', (wsErr) => {
      console.warn('[claudios-bridge] WebSocket error:', (wsErr as Error).message)
      // Error always triggers close — let the close handler deal with reconnect
    })
  }

  private _scheduleReconnect(url: string, psk: string): void {
    // Don't reconnect after explicit stop()
    if (this.stopped) return
    const delay = Math.min(1000 * Math.pow(2, this.attempts), 30000)
    this.attempts++
    this.reconnectTimer = setTimeout(() => this._connect(url, psk), delay)
    this.reconnectTimer.unref()
  }
}

// Singleton with HMR safety (same pattern as event-bus.ts)
const g = globalThis as typeof globalThis & { __claudiosBridge?: ClaudiosBridge }
export const claudiosBridge = g.__claudiosBridge ?? new ClaudiosBridge()
g.__claudiosBridge = claudiosBridge
