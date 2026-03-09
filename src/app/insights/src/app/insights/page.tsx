'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, DollarSign, Globe, Zap, BarChart2 } from 'lucide-react'

interface SalaryData { country: string; avg_min: number; avg_max: number; count: number; currency: string }
interface SkillData { skill: string; count: number }
interface SourceData { source: string; count: number }
interface CountryData { country: string; count: number }

export default function InsightsPage() {
  const [salaries, setSalaries] = useState<SalaryData[]>([])
  const [skills, setSkills] = useState<SkillData[]>([])
  const [sources, setSources] = useState<SourceData[]>([])
  const [countries, setCountries] = useState<CountryData[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [visaJobs, setVisaJobs] = useState(0)
  const [remoteJobs, setRemoteJobs] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/insights')
      const data = await res.json()
      setSalaries(data.salaries || [])
      setSkills(data.skills || [])
      setSources(data.sources || [])
      setCountries(data.countries || [])
      setTotalJobs(data.totalJobs || 0)
      setVisaJobs(data.visaJobs || 0)
      setRemoteJobs(data.remoteJobs || 0)
      setLoading(false)
    }
    load()
  }, [])

  const maxSkill = skills[0]?.count || 1
  const maxCountry = countries[0]?.count || 1
  const maxSource = sources[0]?.count || 1

  const currencySymbol: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', AUD: 'AU$', CAD: 'CA$',
    SGD: 'S$', CHF: 'CHF ', AED: 'AED ', INR: '₹'
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
          <Link href="/startups" className="nav-item mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/tracker" className="nav-item mt-0.5">📋 Tracker</Link>
          <Link href="/insights" className="nav-item active mt-0.5">📊 Insights</Link>
          <Link href="/radar" className="nav-item mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item mt-0.5">🔖 Saved Jobs</Link>
        </nav>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <BarChart2 size={16} className="text-purple-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-text-primary">Market Insights</h1>
              <p className="text-[12px] text-text-muted">Salary data, trending skills & market breakdown</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="text-center py-20 text-text-muted">Loading insights...</div>
          ) : (
            <div className="space-y-6 max-w-5xl">

              {/* Top stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Jobs', value: totalJobs.toLocaleString(), icon: '💼', color: '#94a3b8' },
                  { label: 'Remote Jobs', value: remoteJobs.toLocaleString(), icon: '🌍', color: '#3b82f6' },
                  { label: 'Visa Likely', value: visaJobs.toLocaleString(), icon: '✅', color: '#10b981' },
                  { label: 'Countries', value: countries.length.toString(), icon: '🗺️', color: '#f59e0b' },
                ].map(s => (
                  <div key={s.label} className="job-card p-4 text-center">
                    <p className="text-2xl mb-1">{s.icon}</p>
                    <p className="text-[22px] font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-[12px] text-text-muted mt-1">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Salary by country */}
              <div className="job-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign size={16} className="text-accent" />
                  <h2 className="text-[15px] font-semibold text-text-primary">Average Salary by Country</h2>
                  <span className="text-[11px] text-text-muted ml-auto">Jobs with salary data only</span>
                </div>
                {salaries.length === 0 ? (
                  <p className="text-text-muted text-sm">Not enough salary data yet</p>
                ) : (
                  <div className="space-y-3">
                    {salaries.map(s => {
                      const sym = currencySymbol[s.currency] || s.currency + ' '
                      const avg = Math.round((s.avg_min + s.avg_max) / 2)
                      return (
                        <div key={s.country} className="flex items-center gap-3">
                          <span className="text-[13px] text-text-secondary w-36 flex-shrink-0">{s.country}</span>
                          <div className="flex-1 bg-surface-3 rounded-full h-2 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent"
                              style={{ width: `${Math.min((avg / 200000) * 100, 100)}%` }} />
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-[13px] font-semibold text-accent font-mono">
                              {sym}{Math.round(s.avg_min / 1000)}k – {sym}{Math.round(s.avg_max / 1000)}k
                            </span>
                            <span className="text-[11px] text-text-muted ml-2">({s.count} jobs)</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Trending skills + Countries side by side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Trending skills */}
                <div className="job-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp size={16} className="text-amber-400" />
                    <h2 className="text-[15px] font-semibold text-text-primary">Trending Skills</h2>
                  </div>
                  <div className="space-y-2.5">
                    {skills.slice(0, 15).map((s, i) => (
                      <div key={s.skill} className="flex items-center gap-3">
                        <span className="text-[11px] font-mono text-text-muted w-5 text-right">{i + 1}</span>
                        <span className="text-[13px] font-mono text-text-primary w-28 flex-shrink-0">{s.skill}</span>
                        <div className="flex-1 bg-surface-3 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400/70" style={{ width: `${(s.count / maxSkill) * 100}%` }} />
                        </div>
                        <span className="text-[11px] text-text-muted font-mono w-10 text-right">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Jobs by country */}
                <div className="job-card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Globe size={16} className="text-blue-400" />
                    <h2 className="text-[15px] font-semibold text-text-primary">Jobs by Country</h2>
                  </div>
                  <div className="space-y-2.5">
                    {countries.slice(0, 15).map(c => (
                      <div key={c.country} className="flex items-center gap-3">
                        <span className="text-[13px] text-text-secondary w-32 flex-shrink-0 truncate">{c.country}</span>
                        <div className="flex-1 bg-surface-3 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full bg-blue-400/70" style={{ width: `${(c.count / maxCountry) * 100}%` }} />
                        </div>
                        <span className="text-[11px] text-text-muted font-mono w-10 text-right">{c.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Jobs by source */}
              <div className="job-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap size={16} className="text-green-400" />
                  <h2 className="text-[15px] font-semibold text-text-primary">Jobs by Source</h2>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {sources.map(s => (
                    <div key={s.source} className="bg-surface-2 rounded-xl p-3 flex items-center gap-3">
                      <div className="flex-1 bg-surface-3 rounded-full h-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-green-400/60" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-semibold text-text-primary capitalize">{s.source}</p>
                        <p className="text-[11px] text-text-muted">{s.count.toLocaleString()} jobs</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}
        </div>
      </main>
    </div>
  )
}
