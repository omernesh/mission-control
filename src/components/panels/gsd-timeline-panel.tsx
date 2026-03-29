'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface PhaseInfo {
  number: number
  name: string
  status: 'complete' | 'in-progress' | 'not-started'
  planCount: number
  completedPlans: number
  date?: string
}

interface GsdState {
  milestone: string | null
  progress: number | null
  decisions: string[]
  velocity: string | null
  stoppedAt: string | null
}

interface GsdData {
  projects: {
    phases: PhaseInfo[]
    state: GsdState
  }
  status: unknown
}

function statusBadgeClass(status: PhaseInfo['status']): string {
  switch (status) {
    case 'complete': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'in-progress': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    default: return 'bg-secondary text-muted-foreground border-border'
  }
}

export function GsdTimelinePanel() {
  const t = useTranslations('gsdTimeline')
  const tc = useTranslations('common')
  const [data, setData] = useState<GsdData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/claudios?action=gsd')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) {
    return (
      <div className="m-4 space-y-3">
        <div className="h-20 rounded-lg bg-secondary animate-pulse" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-secondary animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="m-4 p-4 rounded-lg bg-card border border-border">
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <Button size="sm" variant="outline" onClick={fetchData}>{tc('retry')}</Button>
      </div>
    )
  }

  if (!data?.projects) {
    return (
      <div className="m-4 p-4 rounded-lg bg-card border border-border">
        <p className="text-sm text-muted-foreground">{t('noData')}</p>
      </div>
    )
  }

  const { phases, state } = data.projects
  const overallPct = state.progress ?? 0

  return (
    <div className="m-4 space-y-4">
      {/* Summary card */}
      <div className="p-4 rounded-lg bg-card border border-border space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {t('milestone')}: {state.milestone ?? '—'}
            </h2>
            {state.stoppedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('stoppedAt')}: {state.stoppedAt}
              </p>
            )}
          </div>
          {state.velocity && (
            <span className="shrink-0 text-xs text-muted-foreground border border-border rounded px-2 py-1">
              {t('velocity')}: {state.velocity}
            </span>
          )}
        </div>
        {/* Overall progress */}
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{t('progress')}</span>
            <span>{overallPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-primary transition-all"
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Phase list */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
          {t('phases')}
        </h3>
        {phases.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">{t('noData')}</div>
        ) : (
          phases.map((phase) => {
            const pct = phase.planCount > 0
              ? Math.round((phase.completedPlans / phase.planCount) * 100)
              : 0
            const isCurrent = phase.status === 'in-progress'
            return (
              <div
                key={phase.number}
                className={`p-3 rounded-lg bg-card border border-border ${
                  isCurrent ? 'border-l-2 border-l-primary' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground shrink-0">
                      P{phase.number}
                    </span>
                    <span className="text-sm font-medium text-foreground truncate">
                      {phase.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {phase.date && (
                      <span className="text-xs text-muted-foreground">{phase.date}</span>
                    )}
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium border ${statusBadgeClass(phase.status)}`}
                    >
                      {phase.status === 'complete'
                        ? t('complete')
                        : phase.status === 'in-progress'
                        ? t('inProgress')
                        : t('notStarted')}
                    </span>
                  </div>
                </div>
                {phase.planCount > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t('plans')}: {phase.completedPlans}/{phase.planCount}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary">
                      <div
                        className="h-1.5 rounded-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
