'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface StandupReportDto {
  id: string
  date: string
  summary: string
  actionItems?: string[]
  agentId?: string
  agentName?: string
}

interface StandupResponse {
  reports: StandupReportDto[]
  total: number
  limit: number
  offset: number
}

const PAGE_SIZE = 20
const SEARCH_DEBOUNCE_MS = 300

export function StandupReportsPanel() {
  const t = useTranslations('standupReports')
  const tc = useTranslations('common')
  const [reports, setReports] = useState<StandupReportDto[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchReports = useCallback(async (q: string, off: number, append: boolean) => {
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setError(null)
    }
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(off) })
      if (q) params.set('q', q)
      const res = await fetch(`/api/claudios?action=standups&${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: StandupResponse = await res.json()
      const incoming = data.reports || []
      if (append) {
        setReports(prev => [...prev, ...incoming])
      } else {
        setReports(incoming)
      }
      setTotal(data.total ?? incoming.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchReports('', 0, false)
  }, [fetchReports])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setOffset(0)
      setExpandedId(null)
      fetchReports(query, 0, false)
    }, SEARCH_DEBOUNCE_MS)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, fetchReports])

  function handleLoadMore() {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchReports(query, newOffset, true)
  }

  function formatDate(dateStr: string): string {
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  return (
    <div className="m-4">
      {/* Header + search */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg font-semibold text-foreground">Standup Reports</h2>
        {total > 0 && (
          <span className="text-xs text-muted-foreground">{t('total')}: {total}</span>
        )}
      </div>
      <div className="mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('search')}
          className="w-full px-3 py-2 text-sm rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* States */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-secondary animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-card border border-border">
          <p className="text-sm text-red-400 mb-3">{error}</p>
          <Button size="sm" variant="outline" onClick={() => fetchReports(query, 0, false)}>
            {tc('retry')}
          </Button>
        </div>
      ) : reports.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">{t('noResults')}</div>
      ) : (
        <div className="space-y-2">
          {reports.map(report => {
            const isExpanded = expandedId === report.id
            return (
              <button
                key={report.id}
                onClick={() => setExpandedId(isExpanded ? null : report.id)}
                className="w-full text-left px-4 py-3 rounded-lg bg-card border border-border hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0">{formatDate(report.date)}</span>
                    {report.agentName && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-secondary text-muted-foreground shrink-0">
                        {report.agentName}
                      </span>
                    )}
                    <span className="text-sm text-foreground truncate">{report.summary}</span>
                  </div>
                  <span className="text-muted-foreground shrink-0 text-xs leading-none">
                    {isExpanded ? '▾' : '▸'}
                  </span>
                </div>

                {/* Expanded content */}
                <div
                  className={`overflow-hidden transition-all ${isExpanded ? 'max-h-[500px] mt-3' : 'max-h-0'}`}
                >
                  <div className="space-y-3 pt-1 border-t border-border">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">{t('summary')}</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{report.summary}</p>
                    </div>
                    {report.actionItems && report.actionItems.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">{t('actionItems')}</p>
                        <ul className="space-y-1">
                          {report.actionItems.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                              <span className="text-muted-foreground shrink-0 mt-0.5">•</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {report.date && (
                      <p className="text-xs text-muted-foreground">{t('date')}: {formatDate(report.date)}</p>
                    )}
                  </div>
                </div>
              </button>
            )
          })}

          {/* Load more */}
          {reports.length < total && (
            <div className="pt-2 text-center">
              <Button
                variant="outline"
                size="sm"
                disabled={loadingMore}
                onClick={handleLoadMore}
              >
                {loadingMore ? '...' : t('loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
