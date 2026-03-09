'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, Sliders, Globe, Wifi, Shield, TrendingUp,
  Zap, ChevronRight, Clock, Building2, MapPin,
  DollarSign, Bookmark, ExternalLink, Filter,
  RefreshCw, Star, Radio, Rocket, Menu, X
} from 'lucide-react'

// Types
interface Job {
  id: string
  job_title: string
  company_name: string
  company_logo?: string
  country: string
  city?: string
  remote_type: string
  salary_min?: number
  salary_max?: number
  salary_currency: string
  salary_predicted: boolean
  job_url: string
  job_source: string
  visa_probability: number
  relocation_assistance: boolean
  quality_score: number
  date_posted?: string
  tech_stack?: string[]
  job_category?: string
  experience_level?: string
  is_hidden_opportunity: boolean
  verification_status: string
}

interface Stats {
  total_active_jobs: number
  remote_jobs: number
  visa_jobs: number
  watchlist_count: number
  startups_hiring: number
  jobs_last_24h: number
}

// Utility functions
const formatSalary = (min?: number, max?: number, currency = 'USD', predicted = false) => {
  if (!min && !max) return null
  const fmt = (n: number) => n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
  const sym = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'AU$', SGD: 'S$', CHF: 'CHF' }[currency] || currency + ' '
  const range = min && max ? `${sym}${fmt(min)}–${sym}${fmt(max)}` : min ? `${sym}${fmt(min)}+` : `up to ${sym}${fmt(max!)}`
  return { text: range, predicted }
}

const timeAgo = (dateStr?: string) => {
  if (!dateStr) return 'Recently'
  const diff = Date.now() - new Date(dateStr).getTime()
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const sourceLabels: Record<string, string> = {
  adzuna: 'Adzuna', ycombinator: 'YC Jobs', remoteok: 'RemoteOK',
  remotive: 'Remotive', arbeitnow: 'Arbeitnow', weworkremotely: 'WeWorkRemotely',
  jobicy: 'Jobicy', swissdevjobs: 'SwissDevJobs', nodesk: 'NoDesk',
  careers_page: 'Career Page', linkedin: 'LinkedIn'
}

const countryEmoji: Record<string, string> = {
  'USA': '🇺🇸', 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'UK': '🇬🇧',
  'Canada': '🇨🇦', 'Germany': '🇩🇪', 'Netherlands': '🇳🇱', 'Singapore': '🇸🇬',
  'Australia': '🇦🇺', 'Switzerland': '🇨🇭', 'Ireland': '🇮🇪', 'UAE': '🇦🇪',
  'Sweden': '🇸🇪', 'Denmark': '🇩🇰', 'Norway': '🇳🇴', 'Finland': '🇫🇮',
  'Japan': '🇯🇵', 'South Korea': '🇰🇷', 'New Zealand': '🇳🇿', 'France': '🇫🇷',
  'Italy': '🇮🇹', 'Spain': '🇪🇸', 'Poland': '🇵🇱', 'Austria': '🇦🇹',
  'Belgium': '🇧🇪', 'India': '🇮🇳', 'Brazil': '🇧🇷', 'Mexico': '🇲🇽',
  'South Africa': '🇿🇦', 'Remote': '🌍', 'Europe': '🇪🇺'
}

// ============================================================
// JOB CARD COMPONENT
// ============================================================
function JobCard({ job, onSave, saved }: { job: Job; onSave: (id: string) => void; saved: boolean }) {
  const salary = formatSalary(job.salary_min, job.salary_max, job.salary_currency, job.salary_predicted)
  const flag = countryEmoji[job.country] || '🌍'
  const scoreWidth = `${(job.quality_score / 10) * 100}%`

  return (
    <div className="job-card p-5 group">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Company Logo or Initial */}
          <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-text-secondary overflow-hidden">
            {job.company_logo ? (
              <img src={job.company_logo} alt={job.company_name} className="w-full h-full object-contain" />
            ) : (
              job.company_name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] text-text-secondary truncate">{job.company_name}</p>
            <h3 className="text-[15px] font-semibold text-text-primary leading-tight truncate mt-0.5">
              {job.job_title}
            </h3>
          </div>
        </div>

        {/* Save button */}
        <button
          onClick={() => onSave(job.id)}
          className={`flex-shrink-0 p-1.5 rounded-lg transition-all ${
            saved
              ? 'text-accent bg-accent/10'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-3'
          }`}
          title={saved ? 'Saved' : 'Save job'}
        >
          <Bookmark size={15} fill={saved ? 'currentColor' : 'none'} />
        </button>
      </div>

      {/* Location & Remote */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="badge badge-source">
          {flag} {job.country}
          {job.city && ` · ${job.city}`}
        </span>
        {job.remote_type === 'remote' && (
          <span className="badge badge-remote">
            <Wifi size={10} /> Remote
          </span>
        )}
        {job.remote_type === 'hybrid' && (
          <span className="badge" style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
            Hybrid
          </span>
        )}
        {job.visa_probability >= 0.6 && (
          <span className="badge badge-visa">
            <Shield size={10} /> Visa
          </span>
        )}
        {job.is_hidden_opportunity && (
          <span className="badge badge-hidden">
            <Zap size={10} /> Hidden
          </span>
        )}
        {job.verification_status === 'verified' && (
          <span className="badge badge-verified">✓ Verified</span>
        )}
      </div>

      {/* Salary */}
      {salary && (
        <div className="flex items-center gap-1.5 mb-3">
          <DollarSign size={13} className="text-accent flex-shrink-0" />
          <span className="text-[13px] font-semibold text-accent">{salary.text}</span>
          {salary.predicted && (
            <span className="text-[11px] text-text-muted italic">est.</span>
          )}
        </div>
      )}

      {/* Tech Stack */}
      {job.tech_stack && job.tech_stack.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {job.tech_stack.slice(0, 4).map(tech => (
            <span key={tech} className="text-[11px] px-2 py-0.5 rounded-md bg-surface-3 text-text-muted font-mono">
              {tech}
            </span>
          ))}
          {job.tech_stack.length > 4 && (
            <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface-3 text-text-muted">
              +{job.tech_stack.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-3 border-t border-border">
        <div className="flex items-center gap-3">
          {/* Quality score */}
          <div className="flex items-center gap-1.5">
            <div className="score-bar w-16">
              <div className="score-fill" style={{ width: scoreWidth }} />
            </div>
            <span className="text-[11px] font-mono text-text-muted">{job.quality_score.toFixed(1)}</span>
          </div>

          {/* Time */}
          <span className="text-[11px] text-text-muted flex items-center gap-1">
            <Clock size={10} />
            {timeAgo(job.date_posted)}
          </span>

          {/* Source */}
          <span className="text-[11px] text-text-muted">
            {sourceLabels[job.job_source] || job.job_source}
          </span>
        </div>

        <a
          href={job.job_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[12px] text-accent font-medium hover:text-accent-bright transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          Apply <ExternalLink size={11} />
        </a>
      </div>
    </div>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [savedJobs, setSavedJobs] = useState<Set<string>>(new Set())
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const [lastUpdated, setLastUpdated] = useState(new Date())

  // Filters
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState('')
  const [remote, setRemote] = useState('')
  const [visa, setVisa] = useState('')
  const [category, setCategory] = useState('')
  const [source, setSource] = useState('')
  const [sortBy, setSortBy] = useState('quality_score')

  // Debounced search
  const [searchInput, setSearchInput] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Fetch jobs
  const fetchJobs = useCallback(async (resetPage = false) => {
    setLoading(true)
    const currentPage = resetPage ? 1 : page
    if (resetPage) setPage(1)

    const params = new URLSearchParams({
      page: currentPage.toString(),
      limit: '20',
      sort: sortBy
    })
    if (search) params.set('q', search)
    if (country) params.set('country', country)
    if (remote) params.set('remote', remote)
    if (visa) params.set('visa', visa)
    if (category) params.set('category', category)
    if (source) params.set('source', source)

    try {
      const res = await fetch(`/api/jobs?${params}`)
      const data = await res.json()
      setJobs(data.jobs || [])
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoading(false)
    }
  }, [page, search, country, remote, visa, category, sortBy])

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs/stats')
      const data = await res.json()
      setStats(data)
    } catch {}
  }, [])

  useEffect(() => { fetchJobs(true) }, [search, country, remote, visa, category, source, sortBy])
  useEffect(() => { fetchJobs() }, [page])
  useEffect(() => { fetchStats() }, [])
  useEffect(() => {
    const t = setInterval(fetchStats, 60000)
    return () => clearInterval(t)
  }, [])

  const handleSave = async (jobId: string) => {
    const newSaved = new Set(savedJobs)
    if (newSaved.has(jobId)) {
      newSaved.delete(jobId)
      await fetch(`/api/saved?job_id=${jobId}`, { method: 'DELETE' })
    } else {
      newSaved.add(jobId)
      await fetch('/api/saved', { method: 'POST', body: JSON.stringify({ job_id: jobId }), headers: { 'Content-Type': 'application/json' } })
    }
    setSavedJobs(newSaved)
  }

  const COUNTRIES = [
    'USA', 'United Kingdom', 'Canada', 'Germany', 'Netherlands', 'Singapore',
    'Australia', 'Switzerland', 'Ireland', 'UAE', 'Austria', 'Belgium',
    'France', 'Italy', 'Spain', 'Poland', 'India', 'New Zealand',
    'Brazil', 'Mexico', 'South Africa', 'Remote'
  ]
  const SOURCES = [
    { id: 'adzuna', label: '🔍 Adzuna' },
    { id: 'ycombinator', label: '🚀 YC Jobs' },
    { id: 'remoteok', label: '💻 RemoteOK' },
    { id: 'remotive', label: '🌍 Remotive' },
    { id: 'arbeitnow', label: '🇪🇺 Arbeitnow' },
    { id: 'weworkremotely', label: '🏠 WeWorkRemotely' },
    { id: 'jobicy', label: '📋 Jobicy' },
    { id: 'swissdevjobs', label: '🇨🇭 SwissDevJobs' },
    { id: 'nodesk', label: '🖥️ NoDesk' },
  ]
  const CATEGORIES = [
    { id: 'engineering', label: '⚙️ Engineering' },
    { id: 'data-ai', label: '🤖 Data / AI' },
    { id: 'design', label: '🎨 Design' },
    { id: 'product', label: '📦 Product' },
    { id: 'marketing', label: '📣 Marketing' },
  ]

  // Sidebar content
  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Logo */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Globe size={14} className="text-black" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-text-primary leading-none">Job Engine</p>
            <p className="text-[10px] text-text-muted mt-0.5">Global Discovery</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-3 border-b border-border">
        <Link href="/" className="nav-item active">
          <Search size={14} /> Browse Jobs
        </Link>
        <Link href="/startups" className="nav-item mt-0.5">
          <Rocket size={14} /> Startup Jobs
        </Link>
        <Link href="/radar" className="nav-item mt-0.5">
          <Radio size={14} /> Opportunity Radar
        </Link>
        <Link href="/saved" className="nav-item mt-0.5">
          <Bookmark size={14} /> Saved Jobs
        </Link>
      </nav>

      {/* Remote Filter */}
      <div className="sidebar-section">
        <p className="sidebar-label">Job Type</p>
        <div className="flex flex-col gap-1">
          {[
            { id: '', label: 'All Jobs' },
            { id: 'true', label: '🌍 Remote Only' },
            { id: 'hybrid', label: '🏢 Hybrid' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setRemote(opt.id)}
              className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
                remote === opt.id ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Visa Filter */}
      <div className="sidebar-section">
        <p className="sidebar-label">Visa Sponsorship</p>
        <div className="flex flex-col gap-1">
          {[
            { id: '', label: 'All' },
            { id: 'true', label: '✅ Visa Likely' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setVisa(opt.id)}
              className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
                visa === opt.id ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Country Filter */}
      <div className="sidebar-section">
        <p className="sidebar-label">Country</p>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setCountry('')}
            className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
              !country ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
            }`}
          >
            🌍 All Countries
          </button>
          {COUNTRIES.map(c => (
            <button
              key={c}
              onClick={() => setCountry(country === c ? '' : c)}
              className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
                country === c ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {countryEmoji[c] || '🌍'} {c}
            </button>
          ))}
        </div>
      </div>

      {/* Category Filter */}
      <div className="sidebar-section">
        <p className="sidebar-label">Category</p>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setCategory('')}
            className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
              !category ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
            }`}
          >
            All Categories
          </button>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(category === c.id ? '' : c.id)}
              className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
                category === c.id ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Source Filter */}
      <div className="sidebar-section">
        <p className="sidebar-label">Job Source</p>
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setSource('')}
            className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
              !source ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
            }`}
          >
            All Sources
          </button>
          {SOURCES.map(s => (
            <button
              key={s.id}
              onClick={() => setSource(source === s.id ? '' : s.id)}
              className={`text-left text-[13px] px-3 py-1.5 rounded-lg transition-colors ${
                source === s.id ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="p-4 mt-auto border-t border-border">
          <div className="flex items-center gap-1.5 mb-3">
            <div className="live-indicator" />
            <span className="text-[11px] text-text-muted">Live Database</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Jobs', value: stats.total_active_jobs },
              { label: 'Remote', value: stats.remote_jobs },
              { label: 'Visa', value: stats.visa_jobs },
              { label: 'Radar', value: stats.watchlist_count },
            ].map(s => (
              <div key={s.label} className="bg-surface-2 rounded-lg p-2 text-center">
                <p className="text-[15px] font-bold font-mono text-text-primary">{s.value?.toLocaleString() || '–'}</p>
                <p className="text-[10px] text-text-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface-1 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileFilterOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-surface-1 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <span className="font-semibold">Filters</span>
              <button onClick={() => setMobileFilterOpen(false)} className="p-1 rounded-lg hover:bg-surface-3">
                <X size={16} />
              </button>
            </div>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 border-b border-border bg-surface-0/80 backdrop-blur-sm px-4 py-3">
          <div className="flex items-center gap-3">
            {/* Mobile menu */}
            <button
              className="md:hidden p-1.5 rounded-lg hover:bg-surface-2 text-text-secondary"
              onClick={() => setMobileFilterOpen(true)}
            >
              <Filter size={16} />
            </button>

            {/* Search */}
            <div className="relative flex-1 max-w-xl">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                className="search-input"
                placeholder="Search jobs, companies, skills..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
              />
            </div>

            {/* Sort */}
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="hidden sm:block text-[13px] bg-surface-2 border border-border rounded-lg px-3 py-2 text-text-secondary cursor-pointer focus:outline-none focus:border-accent/40"
            >
              <option value="quality_score">Best Match</option>
              <option value="date_posted">Newest</option>
              <option value="salary_max">Highest Salary</option>
            </select>

            {/* Refresh */}
            <button
              onClick={() => fetchJobs(true)}
              className="p-2 rounded-lg hover:bg-surface-2 text-text-muted hover:text-text-secondary transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Active filters */}
          {(country || remote || visa || category || search) && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {[
                country && { label: `${countryEmoji[country] || ''} ${country}`, clear: () => setCountry('') },
                remote === 'true' && { label: '🌍 Remote', clear: () => setRemote('') },
                remote === 'hybrid' && { label: '🏢 Hybrid', clear: () => setRemote('') },
                visa && { label: '✅ Visa Likely', clear: () => setVisa('') },
                category && { label: CATEGORIES.find(c => c.id === category)?.label || category, clear: () => setCategory('') },
                source && { label: SOURCES.find(s => s.id === source)?.label || source, clear: () => setSource('') },
              ].filter(Boolean).map((f: any, i) => (
                <button
                  key={i}
                  onClick={f.clear}
                  className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-colors"
                >
                  {f.label} <X size={10} />
                </button>
              ))}
              <button
                onClick={() => { setCountry(''); setRemote(''); setVisa(''); setCategory(''); setSource(''); setSearchInput('') }}
                className="text-[12px] text-text-muted hover:text-text-secondary"
              >
                Clear all
              </button>
            </div>
          )}
        </header>

        {/* Job Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Result count */}
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] text-text-muted">
              {loading ? 'Searching...' : (
                <><span className="text-text-primary font-semibold">{total.toLocaleString()}</span> jobs found</>
              )}
            </p>
            <p className="text-[11px] text-text-muted hidden sm:block">
              Updated {timeAgo(lastUpdated.toISOString())}
            </p>
          </div>

          {/* Cards Grid */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="job-card p-5 animate-pulse">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-3" />
                    <div className="flex-1">
                      <div className="h-3 bg-surface-3 rounded w-1/3 mb-2" />
                      <div className="h-4 bg-surface-3 rounded w-2/3" />
                    </div>
                  </div>
                  <div className="flex gap-1.5 mb-3">
                    <div className="h-5 bg-surface-3 rounded-full w-16" />
                    <div className="h-5 bg-surface-3 rounded-full w-14" />
                  </div>
                  <div className="h-3 bg-surface-3 rounded w-1/4" />
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Globe size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold text-text-primary mb-2">No jobs found</p>
              <p className="text-text-muted text-sm">Try different filters or wait for the next scrape</p>
              <button
                onClick={() => { setCountry(''); setRemote(''); setVisa(''); setCategory(''); setSource(''); setSearchInput('') }}
                className="mt-4 px-4 py-2 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-bright transition-colors"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {jobs.map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onSave={handleSave}
                    saved={savedJobs.has(job.id)}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8 pb-4">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm disabled:opacity-30 hover:bg-surface-3 transition-colors"
                  >
                    Previous
                  </button>
                  <span className="text-[13px] text-text-muted font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-4 py-2 rounded-lg bg-surface-2 text-text-secondary text-sm disabled:opacity-30 hover:bg-surface-3 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}
