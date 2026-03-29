'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { GraphCanvas, GraphCanvasRef, type Theme } from 'reagraph'
import { Button } from '@/components/ui/button'

type TabId = 'graph' | 'timeline' | 'clusters' | 'search'

interface MemoryNode {
  id: string
  label: string
  type: string
  salience: number
  content: string
  fill: string
  size: number
}

interface MemoryEdge {
  id: string
  source: string
  target: string
}

interface ClusterInfo {
  id: number
  label?: string
  nodeCount: number
}

interface GraphData {
  nodes: MemoryNode[]
  edges: MemoryEdge[]
  clusters: ClusterInfo[]
  cachedAt: number
}

interface TimelineEntry {
  date: string
  memories: { id: string; label: string; type: string }[]
}

const memoryTheme: Theme = {
  canvas: { background: '#11111b', fog: '#11111b' },
  node: {
    fill: '#6c7086',
    activeFill: '#cba6f7',
    opacity: 1,
    selectedOpacity: 1,
    inactiveOpacity: 0.1,
    label: { color: '#cdd6f4', stroke: '#11111b', activeColor: '#f5f5f7' },
  },
  ring: { fill: '#6c7086', activeFill: '#cba6f7' },
  edge: {
    fill: '#45475a',
    activeFill: '#cba6f7',
    opacity: 0.15,
    selectedOpacity: 0.5,
    inactiveOpacity: 0.03,
    label: { color: '#6c7086', activeColor: '#cdd6f4' },
  },
  arrow: { fill: '#45475a', activeFill: '#cba6f7' },
  lasso: {
    background: 'rgba(203, 166, 247, 0.08)',
    border: 'rgba(203, 166, 247, 0.25)',
  },
}

export function MemoryGraphPanel() {
  const t = useTranslations('memoryGraph')
  const graphRef = useRef<GraphCanvasRef | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('graph')
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timelineData, setTimelineData] = useState<TimelineEntry[] | null>(null)
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [clustersData, setClustersData] = useState<ClusterInfo[] | null>(null)
  const [clustersLoading, setClustersLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null)

  const fetchGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/claudios?action=memories&sub=graph')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setGraphData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTimeline = useCallback(async () => {
    if (timelineData) return
    setTimelineLoading(true)
    try {
      const res = await fetch('/api/claudios?action=memories&sub=timeline&days=30')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setTimelineData(data.entries || data.timeline || [])
    } catch {
      setTimelineData([])
    } finally {
      setTimelineLoading(false)
    }
  }, [timelineData])

  const fetchClusters = useCallback(async () => {
    if (clustersData) return
    setClustersLoading(true)
    try {
      const res = await fetch('/api/claudios?action=memories&sub=clusters')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setClustersData(data.clusters || [])
    } catch {
      setClustersData([])
    } finally {
      setClustersLoading(false)
    }
  }, [clustersData])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  useEffect(() => {
    if (activeTab === 'timeline') fetchTimeline()
    if (activeTab === 'clusters') fetchClusters()
  }, [activeTab, fetchTimeline, fetchClusters])

  // Auto-fit graph after layout settles
  useEffect(() => {
    if (!graphData?.nodes.length) return
    const t1 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 800)
    const t2 = setTimeout(() => graphRef.current?.fitNodesInView(undefined, { animated: false }), 2500)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [graphData?.nodes.length])

  const filteredNodes = graphData?.nodes.filter(n => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return n.label.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q)
  }) ?? []

  const tabs: { id: TabId; label: string }[] = [
    { id: 'graph', label: t('tabs.graph') },
    { id: 'timeline', label: t('tabs.timeline') },
    { id: 'clusters', label: t('tabs.clusters') },
    { id: 'search', label: t('tabs.search') },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-0 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        {graphData && (
          <span className="text-xs text-muted-foreground">
            {graphData.nodes.length} {t('nodes')} / {graphData.edges.length} {t('edges')}
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-3 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              activeTab === tab.id
                ? 'bg-secondary text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'graph' && (
          <GraphTab
            loading={loading}
            error={error}
            graphData={graphData}
            graphRef={graphRef}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            onRetry={fetchGraph}
            t={t}
          />
        )}
        {activeTab === 'timeline' && (
          <TimelineTab loading={timelineLoading} data={timelineData} t={t} />
        )}
        {activeTab === 'clusters' && (
          <ClustersTab loading={clustersLoading} data={clustersData} t={t} />
        )}
        {activeTab === 'search' && (
          <SearchTab
            nodes={graphData?.nodes ?? []}
            query={searchQuery}
            setQuery={setSearchQuery}
            filtered={filteredNodes}
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            t={t}
          />
        )}
      </div>
    </div>
  )
}

function GraphTab({
  loading, error, graphData, graphRef, selectedNode, setSelectedNode, onRetry, t,
}: {
  loading: boolean
  error: string | null
  graphData: GraphData | null
  graphRef: React.RefObject<GraphCanvasRef | null>
  selectedNode: MemoryNode | null
  setSelectedNode: (n: MemoryNode | null) => void
  onRetry: () => void
  t: ReturnType<typeof useTranslations>
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ minHeight: 400 }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <span className="text-muted-foreground text-sm">{t('loading')}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ minHeight: 400 }}>
        <p className="text-sm text-red-400">{error}</p>
        <Button size="sm" variant="outline" onClick={onRetry}>{t('retry')}</Button>
      </div>
    )
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm" style={{ minHeight: 400 }}>
        {t('noData')}
      </div>
    )
  }

  return (
    <div className="relative w-full overflow-hidden" style={{ minHeight: 500, height: 'calc(100vh - 200px)' }}>
      <GraphCanvas
        ref={graphRef}
        nodes={graphData.nodes}
        edges={graphData.edges}
        theme={memoryTheme}
        layoutType="forceDirected2d"
        edgeArrowPosition="none"
        animated={true}
        draggable={true}
        cameraMode="pan"
        onNodeClick={(node) => {
          const found = graphData.nodes.find(n => n.id === node.id)
          setSelectedNode(found ?? null)
        }}
      />
      {selectedNode && (
        <div className="absolute bottom-4 left-4 z-10 max-w-xs">
          <div className="px-4 py-3 rounded-lg bg-card/90 backdrop-blur-sm border border-border shadow-xl">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="text-sm font-medium text-foreground truncate">{selectedNode.label}</span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-muted-foreground hover:text-foreground text-xs shrink-0"
              >
                x
              </button>
            </div>
            <div className="flex gap-2 mb-2 text-xs">
              <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{selectedNode.type}</span>
              <span className="text-muted-foreground">{t('salience')}: {selectedNode.salience?.toFixed(2)}</span>
            </div>
            {selectedNode.content && (
              <p className="text-xs text-muted-foreground line-clamp-3">{selectedNode.content}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineTab({
  loading, data, t,
}: {
  loading: boolean
  data: TimelineEntry[] | null
  t: ReturnType<typeof useTranslations>
}) {
  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 rounded bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
        {t('noData')}
      </div>
    )
  }

  return (
    <div className="p-4 overflow-y-auto h-full space-y-4">
      {data.map((entry, i) => (
        <div key={i} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{entry.date}</h4>
          <div className="space-y-1 pl-2 border-l border-border">
            {(entry.memories || []).map((m) => (
              <div key={m.id} className="flex items-center gap-2 py-1">
                <span className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground">{m.type}</span>
                <span className="text-sm text-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ClustersTab({
  loading, data, t,
}: {
  loading: boolean
  data: ClusterInfo[] | null
  t: ReturnType<typeof useTranslations>
}) {
  if (loading) {
    return (
      <div className="p-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 rounded bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
        {t('noData')}
      </div>
    )
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="grid grid-cols-2 gap-3">
        {data.map((cluster) => (
          <div key={cluster.id} className="p-3 rounded-lg bg-card border border-border">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-foreground truncate">
                {cluster.label || `${t('cluster')} ${cluster.id}`}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {cluster.nodeCount} {t('nodes')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SearchTab({
  nodes, query, setQuery, filtered, selectedNode, setSelectedNode, t,
}: {
  nodes: MemoryNode[]
  query: string
  setQuery: (q: string) => void
  filtered: MemoryNode[]
  selectedNode: MemoryNode | null
  setSelectedNode: (n: MemoryNode | null) => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('search')}
        className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="text-xs text-muted-foreground">
        {query ? `${filtered.length} / ${nodes.length}` : `${nodes.length} ${t('nodes')}`}
      </div>
      {nodes.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8">{t('noData')}</div>
      ) : filtered.length === 0 && query ? (
        <div className="text-sm text-muted-foreground text-center py-8">{t('noResults')}</div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map(node => (
            <button
              key={node.id}
              onClick={() => setSelectedNode(selectedNode?.id === node.id ? null : node)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                selectedNode?.id === node.id
                  ? 'bg-primary/10 border-primary/30 text-foreground'
                  : 'bg-card border-border text-foreground hover:bg-secondary'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{node.label}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground">{node.type}</span>
                  <span className="text-xs text-muted-foreground">{node.salience?.toFixed(1)}</span>
                </div>
              </div>
              {selectedNode?.id === node.id && node.content && (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{node.content}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
