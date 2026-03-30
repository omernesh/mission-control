declare global {
  var __claudiosPolling: boolean | undefined
}

/**
 * Next.js startup hook — initializes Claudios integration on server start.
 *
 * Runs once in the Node.js runtime when the server starts:
 *   1. Starts WsHub bridge (forwards real-time events to SSE clients)
 *   2. Registers Claudios orchestrator agent in MC
 *   3. Starts polling loop that upserts per-session agent rows into SQLite
 *
 * Each Claudios session appears as its own agent row in the agents panel
 * with correct 4-state status: busy / idle / error (stalled) / offline.
 *
 * Graceful degradation: Claudios services being down does NOT crash MC.
 * All fetches have AbortSignal.timeout(3000) and catch blocks.
 */
export async function register() {
  // CRITICAL: Only run in Node.js runtime — not Edge, not during build.
  // Without this guard, the ws module import crashes in Edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Dynamic imports required — instrumentation.ts runs before the module graph
  // is fully initialized, so static top-level imports are not safe here.
  const { claudiosBridge } = await import('@/lib/claudios-bridge')
  const { ClaudiosAdapter, mapSessionStatus } = await import('@/lib/adapters/claudios')
  const { claudiosConfig } = await import('@/lib/claudios-config')

  // 1. Start WsHub bridge — forwards real-time events to eventBus -> SSE clients
  if (claudiosConfig.wshubPsk) {
    claudiosBridge.start(claudiosConfig.wshubUrl, claudiosConfig.wshubPsk)
    console.log('[claudios] WsHub bridge started:', claudiosConfig.wshubUrl)
  } else {
    console.warn('[claudios] WSHUB_PSK not set — WsHub bridge disabled')
  }

  // 2. Register Claudios orchestrator agent (eventBus broadcast only — no SQLite write)
  const adapter = new ClaudiosAdapter()
  try {
    await adapter.register({
      agentId: 'claudios-orchestrator',
      name: 'Claudios',
      framework: 'claudios',
      metadata: { role: 'orchestrator', description: 'VP R&D — orchestrates all Claude Code sessions' },
    })
  } catch (err) {
    console.error('[claudios] Failed to register orchestrator agent:', err instanceof Error ? err.message : String(err))
  }

  // MC base URL for internal API calls — service runs on PORT (default 3001)
  const MC_BASE = process.env.MC_URL || `http://localhost:${process.env.PORT || 3001}`
  // Internal auth via x-api-key header (auth.ts does NOT support Basic scheme)
  const MC_API_KEY = process.env.API_KEY || ''

  // 3. Polling loop — upserts each Claudios session as an individual agent row in SQLite.
  //
  // IMPORTANT: eventBus.broadcast() alone does NOT write to the SQLite agents table.
  // We must call POST /api/agents (creates) or PUT /api/agents (updates by name) to
  // ensure the agents panel shows individual session rows with correct 4-state status.
  async function poll() {
    try {
      // Fetch sessions from Session Manager
      const res = await fetch(`${claudiosConfig.sessionManagerUrl}/sessions`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) throw new Error(`Session Manager returned ${res.status}`)
      const { sessions } = await res.json() as {
        sessions: Array<{
          id: string
          nickname: string
          hostname: string
          cwd: string
          status: 'active' | 'inactive'
          last_activity: string | null
        }>
      }

      // Upsert each session as an individual agent row in MC SQLite.
      // Strategy: attempt POST (create), on 409 (name conflict) fall back to PUT (update by name).
      for (const session of sessions) {
        const mcStatus = mapSessionStatus(session)
        const agentName = session.nickname || session.id
        const agentPayload = {
          name: agentName,
          role: 'claude-code-session',
          status: mcStatus,
          session_key: `claudios-${session.id}`,
          config: {
            hostname: session.hostname,
            cwd: session.cwd,
            framework: 'claudios',
            sessionId: session.id,
            last_activity: session.last_activity,
          },
        }

        try {
          // Attempt create first
          const createRes = await fetch(`${MC_BASE}/api/agents`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': MC_API_KEY,
            },
            body: JSON.stringify(agentPayload),
            signal: AbortSignal.timeout(3000),
          })

          if (createRes.status === 409) {
            // Agent already exists — update status + config via PUT
            const updateRes = await fetch(`${MC_BASE}/api/agents`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': MC_API_KEY,
              },
              body: JSON.stringify({
                name: agentName,
                status: mcStatus,
                config: agentPayload.config,
              }),
              signal: AbortSignal.timeout(3000),
            })
            if (!updateRes.ok) {
              console.warn(`[claudios] PUT /api/agents failed for ${agentName}: ${updateRes.status}`)
            }
          } else if (!createRes.ok) {
            console.warn(`[claudios] POST /api/agents failed for ${agentName}: ${createRes.status}`)
            continue
          }
        } catch (upsertErr) {
          // Log but don't fail the whole poll — one bad session shouldn't block others
          console.error(
            `[claudios] Failed to upsert agent for session ${session.id}:`,
            upsertErr instanceof Error ? upsertErr.message : String(upsertErr)
          )
        }
      }

      console.log(`[claudios] Poll complete: ${sessions.length} sessions`)
    } catch (err) {
      console.error('[claudios] Poll error:', err instanceof Error ? err.message : String(err))
    }
  }

  // HMR guard: only register one polling loop per process lifetime
  if (!globalThis.__claudiosPolling) {
    globalThis.__claudiosPolling = true

    // Run initial poll immediately, then every pollIntervalMs (default 10s)
    poll()
    const timer = setInterval(poll, claudiosConfig.pollIntervalMs)
    // unref so the timer doesn't keep the process alive after all other work is done
    timer.unref()

    // Cleanup on graceful shutdown
    const cleanup = () => {
      globalThis.__claudiosPolling = false
      clearInterval(timer)
      claudiosBridge.stop()
    }
    process.once('SIGTERM', cleanup)
    process.once('SIGINT', cleanup)
  }
}
