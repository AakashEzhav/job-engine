'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Rocket, ExternalLink, ArrowLeft, Search } from 'lucide-react'

interface Startup {
  id: string
  name: string
  website?: string
  description?: string
  logo?: string
  batch?: string
  source: string
  career_page_found: boolean
  career_page_url?: string
  has_open_roles: boolean
  jobs_count: number
  upvotes: number
  launch_date?: string
}

export default function StartupsPage() {
  const [startups, setStartups] = useState<Startup[]>([])
  const [loading, setLoading] = useState(true)
  const [hiringOnly, setHiringOnly] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch(`/api/startups?hiring=${hiringOnly}&limit=50`)
      .then(r => r.json())
      .then(d => { setStartups(d.startups || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [hiringOnly])

  const filtered = startups.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description?.toLowerCase().includes(search.toLowerCase())
  )

  const sourceEmoji: Record<string, string> = {
    ycombinator: '🧡', producthunt: '🐱', crunchbase: '📊'
  }

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
          <Link href="/startups" className="nav-item active mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/radar" className="nav-item mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item mt-0.5">🔖 Saved Jobs</Link>
        </nav>
        <div className="p-4 mt-4 border-t border-border">
          <p className="sidebar-label">Filters</p>
          <button
            onClick={() => setHiringOnly(!hiringOnly)}
            className={`w-full text-left text-[13px] px-3 py-2 rounded-lg transition-colors mt-1 ${
              hiringOnly ? 'text-accent bg-accent/8 font-medium' : 'text-text-secondary hover:bg-surface-3'
            }`}
          >
            ✅ Hiring Now Only
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Rocket size={16} className="text-blue-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Startup Discovery</h1>
              <p className="text-[12px] text-text-muted">YC, Product Hunt & newly funded startups</p>
            </div>
          </div>
          <div className="mt-3 relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className="search-input text-sm"
              placeholder="Search startups..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: '36px' }}
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="startup-card animate-pulse">
                  <div className="h-5 bg-surface-3 rounded w-1/2 mb-2" />
                  <div className="h-3 bg-surface-3 rounded w-3/4 mb-1" />
                  <div className="h-3 bg-surface-3 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <Rocket size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold">No startups found</p>
              <p className="text-text-muted text-sm mt-1">They'll appear after the first discovery run</p>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-text-muted mb-4">
                <span className="text-text-primary font-semibold">{filtered.length}</span> startups discovered
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map(startup => (
                  <div key={startup.id} className="startup-card group">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-surface-3 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {startup.logo ? (
                          <img src={startup.logo} alt={startup.name} className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-lg">{sourceEmoji[startup.source] || '🚀'}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-text-primary text-[14px] truncate">{startup.name}</h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {startup.batch && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium">
                              {startup.batch}
                            </span>
                          )}
                          <span className="text-[11px] text-text-muted capitalize">{startup.source}</span>
                        </div>
                      </div>
                    </div>

                    {startup.description && (
                      <p className="text-[12px] text-text-secondary leading-relaxed mb-3 line-clamp-2">
                        {startup.description}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div className="flex items-center gap-2">
                        {startup.has_open_roles ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-md badge-visa badge font-medium">
                            ✅ {startup.jobs_count} open roles
                          </span>
                        ) : startup.career_page_found ? (
                          <span className="text-[11px] text-text-muted">Career page found</span>
                        ) : (
                          <span className="text-[11px] text-text-muted">Checking careers...</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {startup.career_page_url && (
                          <a
                            href={startup.career_page_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                          >
                            Jobs <ExternalLink size={10} />
                          </a>
                        )}
                        {startup.website && (
                          <a
                            href={startup.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-text-muted hover:text-text-secondary flex items-center gap-1"
                          >
                            Site <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
