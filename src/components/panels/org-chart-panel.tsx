'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ReactFlow, Node, Edge, useNodesState, useEdgesState, Controls, Background, BackgroundVariant } from '@xyflow/react'
import '@xyflow/react/dist/style.css'

interface Session {
  id: string
  hostname: string
  status: string
  nickname: string
  project_id: string
  last_activity: string
}

interface HermesSession {
  sessionId: string
  source: string
  isActive: boolean
  title: string | null
}

const HERMES_COLOR = '#14b8a6'

function statusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'active': return '#22c55e'
    case 'idle': return '#eab308'
    case 'stalled': return '#ef4444'
    default: return '#6b7280'
  }
}

function buildOrgNodes(workers: Session[], hermesSessions: HermesSession[], t: ReturnType<typeof useTranslations>): { nodes: Node[]; edges: Edge[] } {
  const staticNodes: Node[] = [
    {
      id: 'omer',
      position: { x: 300, y: 0 },
      data: { label: t('owner') },
      type: 'input',
      style: {
        background: 'hsl(var(--primary) / 0.1)',
        border: '1px solid hsl(var(--primary) / 0.4)',
        color: 'hsl(var(--foreground))',
        borderRadius: '8px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: 600,
      },
    },
    {
      id: 'sammie',
      position: { x: 300, y: 120 },
      data: { label: t('chiefOfStaff') },
      style: {
        background: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.4)',
        color: 'hsl(var(--foreground))',
        borderRadius: '8px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: 500,
      },
    },
    {
      id: 'claudios',
      position: { x: 300, y: 240 },
      data: { label: t('vpRnd') },
      style: {
        background: 'rgba(168, 85, 247, 0.1)',
        border: '1px solid rgba(168, 85, 247, 0.4)',
        color: 'hsl(var(--foreground))',
        borderRadius: '8px',
        padding: '8px 16px',
        fontSize: '13px',
        fontWeight: 500,
      },
    },
  ]

  // Hermes nodes: positioned left, connected to Sammie
  const hermesSpacing = 160
  const hermesTotalWidth = Math.max(0, (hermesSessions.length - 1) * hermesSpacing)
  const hermesStartX = hermesSessions.length > 0 ? 50 : 0

  const hermesNodes: Node[] = hermesSessions.map((h, i) => ({
    id: `hermes-${h.sessionId}`,
    position: { x: hermesStartX + i * hermesSpacing, y: 380 },
    data: { label: h.title || h.source || h.sessionId.slice(0, 8) },
    style: {
      background: h.isActive ? `${HERMES_COLOR}22` : '#6b728022',
      border: `1px solid ${h.isActive ? `${HERMES_COLOR}66` : '#6b728066'}`,
      color: 'hsl(var(--foreground))',
      borderRadius: '8px',
      padding: '6px 12px',
      fontSize: '12px',
    },
  }))

  // Claudios workers: positioned right, connected to Claudios
  const workerCount = workers.length
  const workerSpacing = 160
  const workerOffsetX = hermesSessions.length > 0 ? hermesStartX + hermesTotalWidth + 300 : 300
  const totalWidth = Math.max(0, (workerCount - 1) * workerSpacing)
  const startX = workerOffsetX - totalWidth / 2

  const workerNodes: Node[] = workers.map((w, i) => ({
    id: w.id,
    position: { x: startX + i * workerSpacing, y: 380 },
    data: { label: w.nickname || w.hostname || w.id.slice(0, 8) },
    style: {
      background: `${statusColor(w.status)}22`,
      border: `1px solid ${statusColor(w.status)}66`,
      color: 'hsl(var(--foreground))',
      borderRadius: '8px',
      padding: '6px 12px',
      fontSize: '12px',
    },
  }))

  const staticEdges: Edge[] = [
    {
      id: 'e-omer-sammie',
      source: 'omer',
      target: 'sammie',
      animated: true,
      style: { stroke: 'hsl(var(--border))', strokeWidth: 1.5 },
    },
    {
      id: 'e-sammie-claudios',
      source: 'sammie',
      target: 'claudios',
      animated: true,
      style: { stroke: 'hsl(var(--border))', strokeWidth: 1.5 },
    },
  ]

  const hermesEdges: Edge[] = hermesSessions.map(h => ({
    id: `e-sammie-hermes-${h.sessionId}`,
    source: 'sammie',
    target: `hermes-${h.sessionId}`,
    animated: h.isActive,
    style: {
      stroke: h.isActive ? HERMES_COLOR : '#6b7280',
      strokeWidth: 1.5,
      opacity: 0.7,
    },
  }))

  const workerEdges: Edge[] = workers.map(w => ({
    id: `e-claudios-${w.id}`,
    source: 'claudios',
    target: w.id,
    animated: w.status?.toLowerCase() === 'active',
    style: {
      stroke: statusColor(w.status),
      strokeWidth: 1.5,
      opacity: 0.7,
    },
  }))

  return {
    nodes: [...staticNodes, ...hermesNodes, ...workerNodes],
    edges: [...staticEdges, ...hermesEdges, ...workerEdges],
  }
}

export function OrgChartPanel() {
  const t = useTranslations('orgChart')
  const [sessions, setSessions] = useState<Session[]>([])
  const [hermesSessions, setHermesSessions] = useState<HermesSession[]>([])
  const [loading, setLoading] = useState(true)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/claudios?action=sessions')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (err) {
      console.error('[org-chart] Failed to load sessions:', err)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchHermesSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      if (!res.ok) {
        console.warn('[org-chart] /api/sessions returned', res.status)
        return
      }
      const data = await res.json()
      const hermesOnly = (data.sessions || [])
        .filter((s: { kind?: string }) => s.kind === 'hermes')
        .map((s: { id: string; key?: string; active?: boolean }) => ({
          sessionId: s.id,
          source: s.key || 'cli',
          isActive: !!s.active,
          title: null,
        }))
      setHermesSessions(hermesOnly)
    } catch (err) {
      console.error('[org-chart] Failed to load hermes sessions:', err)
      setHermesSessions([])
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    fetchHermesSessions()
  }, [fetchSessions, fetchHermesSessions])

  useEffect(() => {
    const { nodes: n, edges: e } = buildOrgNodes(sessions, hermesSessions, t)
    setNodes(n)
    setEdges(e)
  }, [sessions, hermesSessions, t, setNodes, setEdges])

  return (
    <div className="m-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        {!loading && (
          <span className="text-xs text-muted-foreground">
            {sessions.length === 0 && hermesSessions.length === 0
              ? t('noWorkers')
              : [
                  sessions.length > 0 ? `${sessions.length} ${t('worker')}${sessions.length !== 1 ? 's' : ''}` : null,
                  hermesSessions.length > 0 ? `${hermesSessions.length} hermes` : null,
                ].filter(Boolean).join(' + ')}
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3">
        {(['active', 'idle', 'stalled'] as const).map(s => (
          <div key={s} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ background: statusColor(s) }} />
            <span className="text-xs text-muted-foreground capitalize">{t(s)}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: HERMES_COLOR }} />
          <span className="text-xs text-muted-foreground">Hermes</span>
        </div>
      </div>

      <div
        className="rounded-lg border border-border overflow-hidden"
        style={{ height: 'calc(100vh - 220px)', minHeight: 400 }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          fitView
          attributionPosition="bottom-right"
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="hsl(var(--border))" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  )
}
