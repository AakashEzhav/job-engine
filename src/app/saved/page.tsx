'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Bookmark, ExternalLink, ArrowLeft, Trash2, DollarSign, Clock } from 'lucide-react'

interface SavedJob {
  id: string
  job_id: string
  status: string
  notes?: string
  created_at: string
  jobs: any
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  saved: { label: 'Saved', color: '#a0a0a8', bg: 'rgba(160,160,168,0.1)' },
  applied: { label: 'Applied', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  interviewing: { label: 'Interviewing', color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
  offered: { label: 'Offered 🎉', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  rejected: { label: 'Rejected', color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
}

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const formatSalary = (min?: number, max?: number, currency = 'USD') => {
  if (!min && !max) return null
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n/1000)}k` : `${n}`
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$' }[currency] || currency + ' '
  return min && max ? `${sym}${fmt(min)}–${sym}${fmt(max)}` : `${sym}${fmt(min || max!)}`
}

export default function SavedPage() {
  const [saved, setSaved] = useState<SavedJob[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/saved')
      .then(r => r.json())
      .then(d => { setSaved(d.saved || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const updateStatus = async (jobId: string, status: string) => {
    await fetch('/api/saved', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId, status }),
      headers: { 'Content-Type': 'application/json' }
    })
    setSaved(prev => prev.map(s => s.job_id === jobId ? { ...s, status } : s))
  }

  const removeJob = async (jobId: string) => {
    await fetch(`/api/saved?job_id=${jobId}`, { method: 'DELETE' })
    setSaved(prev => prev.filter(s => s.job_id !== jobId))
  }

  const byStatus = (status: string) => saved.filter(s => s.status === status)

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface-1 flex-shrink-0">
        <div className="p-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors text-sm">
            <ArrowLeft size={14} /> Back to Jobs
          </Link>
        </div>
        <nav className="p-3">
          <Link href="/" className="nav-item">🔍 Browse Jobs</Link>
          <Link href="/startups" className="nav-item mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/radar" className="nav-item mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item active mt-0.5">🔖 Saved Jobs</Link>
        </nav>
        <div className="p-4 mt-4 border-t border-border">
          <p className="sidebar-label">Pipeline</p>
          {Object.entries(statusConfig).map(([key, cfg]) => {
            const count = byStatus(key).length
            return (
              <div key={key} className="flex items-center justify-between py-1.5">
                <span className="text-[13px]" style={{ color: cfg.color }}>{cfg.label}</span>
                <span className="text-[11px] font-mono text-text-muted">{count}</span>
              </div>
            )
          })}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Bookmark size={16} className="text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Saved Jobs</h1>
              <p className="text-[12px] text-text-muted">Your application pipeline</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="job-card p-5 animate-pulse h-24" />
              ))}
            </div>
          ) : saved.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Bookmark size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold">No saved jobs yet</p>
              <p className="text-text-muted text-sm mt-1">Click the bookmark icon on any job to save it</p>
              <Link href="/" className="mt-4 px-4 py-2 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-bright transition-colors">
                Browse Jobs
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {saved.map(item => {
                const job = item.jobs
                if (!job) return null
                const config = statusConfig[item.status] || statusConfig.saved
                const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency)

                return (
                  <div key={item.id} className="job-card p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0 text-base font-semibold text-text-secondary">
                        {job.company_name?.charAt(0) || '?'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[12px] text-text-muted">{job.company_name}</p>
                            <h3 className="font-semibold text-text-primary text-[14px] mt-0.5">{job.job_title}</h3>
                          </div>
                          <button
                            onClick={() => removeJob(item.job_id)}
                            className="p-1.5 rounded-lg text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors flex-shrink-0"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 mt-2">
                          <span className="text-[12px] text-text-muted">
                            {job.country}{job.city ? ` · ${job.city}` : ''}
                          </span>
                          {salary && (
                            <span className="text-[12px] text-accent flex items-center gap-1">
                              <DollarSign size={11} />{salary}
                            </span>
                          )}
                          <span className="text-[11px] text-text-muted flex items-center gap-1">
                            <Clock size={10} /> Saved {timeAgo(item.created_at)}
                          </span>
                        </div>

                        {/* Status selector */}
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          <span className="text-[11px] text-text-muted">Status:</span>
                          {Object.entries(statusConfig).map(([key, cfg]) => (
                            <button
                              key={key}
                              onClick={() => updateStatus(item.job_id, key)}
                              className="text-[11px] px-2.5 py-1 rounded-full transition-colors"
                              style={item.status === key
                                ? { background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }
                                : { background: 'var(--surface-3)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
                              }
                            >
                              {cfg.label}
                            </button>
                          ))}
                          <a
                            href={job.job_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-auto text-[12px] text-accent hover:text-accent-bright flex items-center gap-1"
                          >
                            Open <ExternalLink size={11} />
                          </a>
                        </div>
                      </div>
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
