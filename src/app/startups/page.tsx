'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Rocket, ExternalLink, ArrowLeft, Search, ChevronDown, ChevronUp, MapPin, Wifi, Shield, DollarSign, Bookmark } from 'lucide-react'

interface Startup {
  id: string; name: string; website?: string; description?: string
  logo?: string; batch?: string; source: string
  career_page_url?: string; has_open_roles: boolean; jobs_count: number
}

interface Job {
  id: string; job_title: string; company_name: string; country: string
  city?: string; remote_type: string; salary_min?: number; salary_max?: number
  salary_currency: string; job_url: string; visa_probability: number
  date_posted?: string; experience_level?: string
}

const countryEmoji: Record<string,string> = {
  'USA':'🇺🇸','United Kingdom':'🇬🇧','Canada':'🇨🇦','Germany':'🇩🇪',
  'Netherlands':'🇳🇱','Singapore':'🇸🇬','Australia':'🇦🇺','Switzerland':'🇨🇭',
  'Ireland':'🇮🇪','UAE':'🇦🇪','France':'🇫🇷','Remote':'🌍'
}

const timeAgo = (d?: string) => {
  if (!d) return 'Recently'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const fmtSalary = (min?: number, max?: number, cur = 'USD') => {
  if (!min && !max) return null
  const sym: Record<string,string> = {USD:'$',EUR:'€',GBP:'£',AUD:'AU$',CAD:'CA$',SGD:'S$',CHF:'CHF ',AED:'AED '}
  const s = sym[cur] || cur + ' '
  const f = (n: number) => n >= 1000 ? `${Math.round(n/1000)}k` : `${n}`
  return min && max ? `${s}${f(min)}–${s}${f(max)}` : min ? `${s}${f(min)}+` : `up to ${s}${f(max!)}`
}

export default function StartupsPage() {
  const [startups, setStartups] = useState<Startup[]>([])
  const [loading, setLoading] = useState(true)
  const [hiringOnly, setHiringOnly] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [jobsMap, setJobsMap] = useState<Record<string, Job[]>>({})
  const [jobsLoading, setJobsLoading] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/startups?hiring=${hiringOnly}&limit=50`)
      .then(r => r.json())
      .then(d => { setStartups(d.startups || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [hiringOnly])

  async function toggleExpand(startup: Startup) {
    if (expanded === startup.name) { setExpanded(null); return }
    setExpanded(startup.name)
    if (jobsMap[startup.name]) return
    setJobsLoading(startup.name)
    const res = await fetch(`/api/startups?company=${encodeURIComponent(startup.name)}`)
    const data = await res.json()
    setJobsMap(prev => ({ ...prev, [startup.name]: data.jobs || [] }))
    setJobsLoading(null)
  }

  const filtered = startups.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase()) ||
    s.source?.toLowerCase().includes(search.toLowerCase())
  )

  const stageColor: Record<string, string> = {
    'Series A': '#3b82f6', 'Series B': '#8b5cf6', 'Series C': '#f59e0b',
    'Series D': '#ef4444', 'Series E': '#10b981', 'Series F': '#06b6d4',
    'Series G': '#ec4899', 'Public': '#94a3b8', 'Acquired': '#6b7280',
    'Growth': '#10b981', 'Series I+': '#f97316'
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface-1 flex-shrink-0">
        <div className="p-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors text-sm">
            <ArrowLeft size={14} /> Back to Jobs
          </Link>
        </div>
        <nav className="p-3 border-b border-border">
          <Link href="/" className="nav-item">🔍 Browse Jobs</Link>
          <Link href="/startups" className="nav-item active mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/tracker" className="nav-item mt-0.5">📋 App Tracker</Link>
          <Link href="/insights" className="nav-item mt-0.5">📊 Insights</Link>
          <Link href="/radar" className="nav-item mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item mt-0.5">🔖 Saved Jobs</Link>
        </nav>
        <div className="p-4">
          <p className="sidebar-label mb-2">Filters</p>
          <button onClick={() => setHiringOnly(!hiringOnly)}
            className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors ${hiringOnly ? 'text-accent bg-accent/10 font-medium' : 'text-text-secondary hover:bg-surface-3'}`}>
            ✅ Hiring Now Only
          </button>
          <button onClick={() => setHiringOnly(false)}
            className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors mt-1 ${!hiringOnly ? 'text-accent bg-accent/10 font-medium' : 'text-text-secondary hover:bg-surface-3'}`}>
            🏢 All Companies
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Rocket size={16} className="text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Startup Jobs</h1>
              <p className="text-[12px] text-text-muted">
                {filtered.filter(s => s.jobs_count > 0).length} companies hiring · {filtered.reduce((a,s) => a + s.jobs_count, 0)} open roles
              </p>
            </div>
          </div>
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input className="search-input" placeholder="Search companies, locations..."
              value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: '36px' }} />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="job-card p-4 animate-pulse">
                  <div className="h-5 bg-surface-3 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-surface-3 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Rocket size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold">No startups found</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map(startup => {
                const isOpen = expanded === startup.name
                const jobs = jobsMap[startup.name] || []
                const isLoadingJobs = jobsLoading === startup.name
                const stage = startup.batch || ''
                const flag = countryEmoji[startup.source] || '🌍'

                return (
                  <div key={startup.id} className="job-card overflow-hidden">
                    {/* Company row */}
                    <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(startup)}>
                      <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0 text-lg overflow-hidden">
                        {startup.logo
                          ? <img src={startup.logo} alt={startup.name} className="w-full h-full object-contain" />
                          : startup.name.charAt(0)
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-text-primary text-[14px]">{startup.name}</h3>
                          {stage && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: `${stageColor[stage]}20`, color: stageColor[stage] || '#94a3b8' }}>
                              {stage}
                            </span>
                          )}
                          <span className="text-[11px] text-text-muted">{flag} {startup.source}</span>
                        </div>
                        {startup.description && (
                          <p className="text-[12px] text-text-muted truncate mt-0.5">{startup.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {startup.jobs_count > 0 ? (
                          <span className="text-[12px] px-2.5 py-1 rounded-full font-medium"
                            style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                            {startup.jobs_count} jobs
                          </span>
                        ) : (
                          <span className="text-[11px] text-text-muted">No jobs found</span>
                        )}
                        {startup.career_page_url && (
                          <a href={startup.career_page_url} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-[11px] text-accent hover:text-accent-bright flex items-center gap-1">
                            Careers <ExternalLink size={10} />
                          </a>
                        )}
                        {startup.jobs_count > 0 && (
                          isOpen ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />
                        )}
                      </div>
                    </div>

                    {/* Jobs dropdown */}
                    {isOpen && startup.jobs_count > 0 && (
                      <div className="border-t border-border bg-surface-0">
                        {isLoadingJobs ? (
                          <div className="p-4 text-center text-text-muted text-[13px]">Loading jobs...</div>
                        ) : jobs.length === 0 ? (
                          <div className="p-4 text-center text-text-muted text-[13px]">No jobs found</div>
                        ) : (
                          <div className="divide-y divide-border">
                            {jobs.map(job => (
                              <div key={job.id} className="px-4 py-3 flex items-center gap-3 hover:bg-surface-2 transition-colors">
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-medium text-text-primary truncate">{job.job_title}</p>
                                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    <span className="text-[11px] text-text-muted flex items-center gap-1">
                                      <MapPin size={9} /> {countryEmoji[job.country] || '🌍'} {job.country}{job.city ? ` · ${job.city}` : ''}
                                    </span>
                                    {job.remote_type === 'remote' && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{background:'rgba(59,130,246,0.1)',color:'#60a5fa'}}>
                                        <Wifi size={8} className="inline mr-0.5" />Remote
                                      </span>
                                    )}
                                    {job.visa_probability >= 0.7 && (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{background:'rgba(16,185,129,0.1)',color:'#34d399'}}>
                                        ✅ Visa
                                      </span>
                                    )}
                                    {fmtSalary(job.salary_min, job.salary_max, job.salary_currency) && (
                                      <span className="text-[11px] font-mono text-accent">
                                        {fmtSalary(job.salary_min, job.salary_max, job.salary_currency)}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-text-muted">{timeAgo(job.date_posted)}</span>
                                  </div>
                                </div>
                                <a href={job.job_url} target="_blank" rel="noopener noreferrer"
                                  className="flex-shrink-0 flex items-center gap-1 text-[12px] text-accent hover:text-accent-bright font-medium">
                                  Apply <ExternalLink size={11} />
                                </a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
