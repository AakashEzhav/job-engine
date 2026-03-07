'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Radio, TrendingUp, Zap, ExternalLink, ArrowLeft, RefreshCw, Clock } from 'lucide-react'

interface RadarSignal {
  id: string
  company_name: string
  company_url?: string
  company_logo?: string
  signal_type: string
  signal_description?: string
  signal_source: string
  signal_url?: string
  signal_date?: string
  hiring_probability: number
  predicted_roles?: string[]
  predicted_timeline?: string
}

const signalConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  funding: { label: 'Funded', color: '#4ade80', bg: 'rgba(74,222,128,0.1)', icon: '💰' },
  launch: { label: 'Launched', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)', icon: '🚀' },
  expansion: { label: 'Expanding', color: '#fb923c', bg: 'rgba(251,146,60,0.1)', icon: '📈' },
  hiring: { label: 'Hiring', color: '#b5ff4f', bg: 'rgba(181,255,79,0.1)', icon: '👥' },
  general: { label: 'Signal', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', icon: '📡' },
}

const timeAgo = (dateStr?: string) => {
  if (!dateStr) return 'Recently'
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default function RadarPage() {
  const [signals, setSignals] = useState<RadarSignal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/radar')
      .then(r => r.json())
      .then(d => { setSignals(d.signals || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface-1 flex-shrink-0">
        <div className="p-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors">
            <ArrowLeft size={14} /> Back to Jobs
          </Link>
        </div>
        <nav className="p-3">
          <Link href="/" className="nav-item">🔍 Browse Jobs</Link>
          <Link href="/startups" className="nav-item mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/radar" className="nav-item active mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item mt-0.5">🔖 Saved Jobs</Link>
        </nav>
        <div className="p-4 border-t border-border mt-auto">
          <p className="text-[11px] text-text-muted leading-relaxed">
            Radar detects companies likely to hire based on funding, launches, and growth signals — before jobs are posted.
          </p>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Radio size={16} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Opportunity Radar</h1>
              <p className="text-[12px] text-text-muted">Companies predicted to hire in 1–6 months</p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="live-indicator" />
              <span className="text-[12px] text-text-muted">{signals.length} signals</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="radar-card animate-pulse">
                  <div className="h-5 bg-surface-3 rounded w-1/2 mb-3" />
                  <div className="h-3 bg-surface-3 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-surface-3 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Radio size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold text-text-primary mb-2">Radar is scanning...</p>
              <p className="text-text-muted text-sm">Signals will appear after the first scrape runs</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map(signal => {
                const config = signalConfig[signal.signal_type] || signalConfig.general
                const prob = Math.round(signal.hiring_probability * 100)

                return (
                  <div key={signal.id} className="radar-card">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="font-semibold text-text-primary text-[14px]">{signal.company_name}</h3>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span
                            className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                            style={{ background: config.bg, color: config.color }}
                          >
                            {config.icon} {config.label}
                          </span>
                          <span className="text-[11px] text-text-muted">{timeAgo(signal.signal_date)}</span>
                        </div>
                      </div>

                      {/* Probability ring */}
                      <div
                        className="prob-ring"
                        style={{
                          background: `conic-gradient(${config.color} ${prob * 3.6}deg, var(--surface-3) 0deg)`,
                          color: config.color
                        }}
                      >
                        <div className="w-8 h-8 rounded-full bg-surface-1 flex items-center justify-center">
                          <span style={{ color: config.color }}>{prob}%</span>
                        </div>
                      </div>
                    </div>

                    {signal.signal_description && (
                      <p className="text-[12px] text-text-secondary leading-relaxed mb-3 line-clamp-2">
                        {signal.signal_description}
                      </p>
                    )}

                    {signal.predicted_roles && signal.predicted_roles.length > 0 && (
                      <div className="mb-3">
                        <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Predicted Roles</p>
                        <div className="flex flex-wrap gap-1">
                          {signal.predicted_roles.slice(0, 3).map(role => (
                            <span key={role} className="text-[11px] px-2 py-0.5 rounded-md bg-surface-3 text-text-secondary">
                              {role}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
                      <div className="flex items-center gap-1 text-[11px] text-text-muted">
                        <TrendingUp size={11} />
                        {signal.predicted_timeline || '1–3 months'} · via {signal.signal_source}
                      </div>
                      {signal.signal_url && (
                        <a
                          href={signal.signal_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-orange-400 hover:text-orange-300 flex items-center gap-1"
                        >
                          Source <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
