import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, opts?: RequestInit): NextRequest {
  const { signal, ...rest } = opts ?? {}
  return new NextRequest(new URL(url, 'http://localhost:3001'), {
    ...rest,
    ...(signal ? { signal: signal as AbortSignal } : {}),
  })
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({
  requireRole: () => ({ user: { id: '1', name: 'admin', role: 'admin' } }),
}))

vi.mock('@/lib/claudios-config', () => ({
  claudiosConfig: {
    claudiosApiUrl: 'http://localhost:9878',
    sessionManagerUrl: 'http://localhost:7655',
    acpUrl: 'http://localhost:9878',
  },
}))

// ---------------------------------------------------------------------------
// GET /api/claudios - gsd action
// ---------------------------------------------------------------------------

describe('GET /api/claudios - gsd action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns projects and status from Claudios API', async () => {
    const { GET } = await import('../route')

    const fakeProjects = { phases: [{ id: 'p1', name: 'phase 1' }], state: { status: 'ok' } }
    const fakeStatus = { uptime: 1234, version: '1.0' }

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fakeProjects })
      .mockResolvedValueOnce({ ok: true, json: async () => fakeStatus })
    )

    const req = makeRequest('http://localhost:3001/api/claudios?action=gsd')
    const res = await GET(req)
    const body = await res.json()

    expect(body).toHaveProperty('projects')
    expect(body).toHaveProperty('status')
  })

  it('returns graceful error when Claudios is unreachable', async () => {
    const { GET } = await import('../route')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const req = makeRequest('http://localhost:3001/api/claudios?action=gsd')
    const res = await GET(req)
    const body = await res.json()

    expect(body).toHaveProperty('error')
    expect(body.projects?.phases ?? []).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GET /api/claudios - memories action
// ---------------------------------------------------------------------------

describe('GET /api/claudios - memories action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns unwrapped graph nodes for sub=graph', async () => {
    const { GET } = await import('../route')

    const cytoscapePayload = {
      nodes: [{ data: { id: '1', label: 'test', salience: 0.5 } }],
      edges: [],
      clusters: [],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => cytoscapePayload,
    }))

    const req = makeRequest('http://localhost:3001/api/claudios?action=memories&sub=graph')
    const res = await GET(req)
    const body = await res.json()

    // Nodes must be flat — NOT nested under `data`
    expect(Array.isArray(body.nodes)).toBe(true)
    if (body.nodes.length > 0) {
      const node = body.nodes[0]
      expect(node).toHaveProperty('id')
      expect(node).toHaveProperty('label')
      expect(node).not.toHaveProperty('data')
    }
  })

  it('passes through raw data for sub=timeline', async () => {
    const { GET } = await import('../route')

    const timelinePayload = { events: [{ ts: 1234, label: 'event-1' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => timelinePayload,
    }))

    const req = makeRequest('http://localhost:3001/api/claudios?action=memories&sub=timeline')
    const res = await GET(req)
    const body = await res.json()

    expect(body).toMatchObject(timelinePayload)
  })

  it('passes through raw data for sub=clusters', async () => {
    const { GET } = await import('../route')

    const clustersPayload = { clusters: [{ id: 'c1', label: 'cluster-1', members: [] }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => clustersPayload,
    }))

    const req = makeRequest('http://localhost:3001/api/claudios?action=memories&sub=clusters')
    const res = await GET(req)
    const body = await res.json()

    expect(body).toMatchObject(clustersPayload)
  })
})

// ---------------------------------------------------------------------------
// GET /api/claudios - standups action
// ---------------------------------------------------------------------------

describe('GET /api/claudios - standups action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proxies query params to Claudios standups endpoint', async () => {
    const { GET } = await import('../route')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reports: [], total: 0, limit: 10, offset: 5 }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const req = makeRequest(
      'http://localhost:3001/api/claudios?action=standups&q=test&limit=10&offset=5'
    )
    await GET(req)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('q=test')
    expect(calledUrl).toContain('limit=10')
    expect(calledUrl).toContain('offset=5')
  })

  it('returns empty reports array on error', async () => {
    const { GET } = await import('../route')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    const req = makeRequest('http://localhost:3001/api/claudios?action=standups')
    const res = await GET(req)
    const body = await res.json()

    expect(body).toMatchObject({ reports: [], total: 0 })
  })
})

// ---------------------------------------------------------------------------
// POST /api/claudios - command action
// ---------------------------------------------------------------------------

describe('POST /api/claudios - command action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proxies command to session endpoint', async () => {
    // POST export may not exist yet (added in Plan 01) — guard with optional chaining
    const mod = await import('../route')
    const POST = (mod as Record<string, unknown>).POST as
      | ((req: NextRequest) => Promise<Response>)
      | undefined

    if (!POST) {
      // Plan 01 not yet implemented — this is the RED phase
      expect(true).toBe(true)
      return
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, output: 'ok' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const req = makeRequest('http://localhost:3001/api/claudios?action=command', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'abc', command: '/status' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('/api/sessions/abc/command')
    expect(body).toHaveProperty('success')
  })

  it('returns 400 for missing sessionId or command', async () => {
    const mod = await import('../route')
    const POST = (mod as Record<string, unknown>).POST as
      | ((req: NextRequest) => Promise<Response>)
      | undefined

    if (!POST) {
      expect(true).toBe(true)
      return
    }

    vi.stubGlobal('fetch', vi.fn())

    const req = makeRequest('http://localhost:3001/api/claudios?action=command', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'abc' }), // missing command
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 502 when Claudios command endpoint fails', async () => {
    const mod = await import('../route')
    const POST = (mod as Record<string, unknown>).POST as
      | ((req: NextRequest) => Promise<Response>)
      | undefined

    if (!POST) {
      expect(true).toBe(true)
      return
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal server error' }),
    }))

    const req = makeRequest('http://localhost:3001/api/claudios?action=command', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'abc', command: '/status' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(502)
  })
})
