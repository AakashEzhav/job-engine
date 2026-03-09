'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, ExternalLink, ChevronDown, Calendar, FileText, TrendingUp, CheckCircle, XCircle, Clock, Star } from 'lucide-react'
import { supabase } from '@/lib/db/supabase'

interface Application {
  id: string
  job_id: string
  job_title: string
  company_name: string
  country?: string
  job_url?: string
  status: string
  applied_date: string
  notes?: string
  salary_expected?: number
  salary_currency?: string
  next_step?: string
  next_step_date?: string
  created_at: string
}

const STATUSES = [
  { id: 'wishlist', label: 'Wishlist', color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: '⭐' },
  { id: 'applied', label: 'Applied', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: '📤' },
  { id: 'interviewing', label: 'Interviewing', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: '🎯' },
  { id: 'offer', label: 'Offer', color: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: '🎉' },
  { id: 'rejected', label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: '❌' },
  { id: 'withdrawn', label: 'Withdrawn', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', icon: '↩️' },
]

const statusInfo = (id: string) => STATUSES.find(s => s.id === id) || STATUSES[1]

export default function TrackerPage() {
  const [apps, setApps] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNotes, setEditNotes] = useState('')

  const [form, setForm] = useState({
    job_title: '', company_name: '', country: '', job_url: '',
    status: 'applied', applied_date: new Date().toISOString().split('T')[0],
    notes: '', salary_expected: '', salary_currency: 'USD',
    next_step: '', next_step_date: ''
  })

  useEffect(() => { fetchApps() }, [])

  async function fetchApps() {
    setLoading(true)
    const { data } = await supabase.from('applications').select('*').order('created_at', { ascending: false })
    setApps(data || [])
    setLoading(false)
  }

  async function addApp() {
    if (!form.job_title || !form.company_name) return
    const { error } = await supabase.from('applications').insert({
      job_id: `manual-${Date.now()}`,
      job_title: form.job_title,
      company_name: form.company_name,
      country: form.country || null,
      job_url: form.job_url || null,
      status: form.status,
      applied_date: form.applied_date,
      notes: form.notes || null,
      salary_expected: form.salary_expected ? parseInt(form.salary_expected) : null,
      salary_currency: form.salary_currency,
      next_step: form.next_step || null,
      next_step_date: form.next_step_date || null,
    })
    if (!error) {
      setShowAdd(false)
      setForm({ job_title: '', company_name: '', country: '', job_url: '', status: 'applied', applied_date: new Date().toISOString().split('T')[0], notes: '', salary_expected: '', salary_currency: 'USD', next_step: '', next_step_date: '' })
      fetchApps()
    }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from('applications').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a))
  }

  async function updateNotes(id: string) {
    await supabase.from('applications').update({ notes: editNotes, updated_at: new Date().toISOString() }).eq('id', id)
    setApps(prev => prev.map(a => a.id === id ? { ...a, notes: editNotes } : a))
    setEditingId(null)
  }

  async function deleteApp(id: string) {
    await supabase.from('applications').delete().eq('id', id)
    setApps(prev => prev.filter(a => a.id !== id))
  }

  const filtered = filterStatus ? apps.filter(a => a.status === filterStatus) : apps

  // Stats
  const stats = {
    total: apps.length,
    applied: apps.filter(a => a.status === 'applied').length,
    interviewing: apps.filter(a => a.status === 'interviewing').length,
    offers: apps.filter(a => a.status === 'offer').length,
    rejected: apps.filter(a => a.status === 'rejected').length,
    responseRate: apps.length > 0 ? Math.round(((apps.filter(a => ['interviewing','offer'].includes(a.status)).length) / Math.max(apps.filter(a => a.status !== 'wishlist').length, 1)) * 100) : 0
  }

  const upcomingSteps = apps.filter(a => a.next_step_date && new Date(a.next_step_date) >= new Date()).sort((a, b) => new Date(a.next_step_date!).getTime() - new Date(b.next_step_date!).getTime()).slice(0, 5)

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r border-border bg-surface-1 flex-shrink-0">
        <div className="p-5 border-b border-border">
          <Link href="/" className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors text-sm">
            <ArrowLeft size={14} /> Back to Jobs
          </Link>
        </div>
        <nav className="p-3">
          <Link href="/" className="nav-item">🔍 Browse Jobs</Link>
          <Link href="/startups" className="nav-item mt-0.5">🚀 Startup Jobs</Link>
          <Link href="/tracker" className="nav-item active mt-0.5">📋 Tracker</Link>
          <Link href="/insights" className="nav-item mt-0.5">📊 Insights</Link>
          <Link href="/radar" className="nav-item mt-0.5">📡 Opportunity Radar</Link>
          <Link href="/saved" className="nav-item mt-0.5">🔖 Saved Jobs</Link>
        </nav>
        <div className="p-4 border-t border-border mt-2">
          <p className="sidebar-label mb-2">Filter by Status</p>
          <button onClick={() => setFilterStatus('')} className={`w-full text-left text-[13px] px-3 py-1.5 rounded-lg mb-1 ${!filterStatus ? 'text-accent bg-accent/10' : 'text-text-secondary hover:bg-surface-3'}`}>
            All ({apps.length})
          </button>
          {STATUSES.map(s => (
            <button key={s.id} onClick={() => setFilterStatus(s.id === filterStatus ? '' : s.id)}
              className={`w-full text-left text-[13px] px-3 py-1.5 rounded-lg mb-0.5 ${filterStatus === s.id ? 'font-medium' : 'text-text-secondary hover:bg-surface-3'}`}
              style={filterStatus === s.id ? { color: s.color, background: s.bg } : {}}>
              {s.icon} {s.label} ({apps.filter(a => a.status === s.id).length})
            </button>
          ))}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <FileText size={16} className="text-blue-400" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-text-primary">Application Tracker</h1>
                <p className="text-[12px] text-text-muted">Track every job you apply to</p>
              </div>
            </div>
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-black text-sm font-semibold hover:bg-accent-bright transition-colors">
              <Plus size={14} /> Add Application
            </button>
          </div>

          {/* Stats bar */}
          <div className="flex gap-4 mt-4 flex-wrap">
            {[
              { label: 'Total', value: stats.total, color: '#94a3b8' },
              { label: 'Applied', value: stats.applied, color: '#3b82f6' },
              { label: 'Interviewing', value: stats.interviewing, color: '#f59e0b' },
              { label: 'Offers', value: stats.offers, color: '#10b981' },
              { label: 'Rejected', value: stats.rejected, color: '#ef4444' },
              { label: 'Response Rate', value: `${stats.responseRate}%`, color: stats.responseRate > 20 ? '#10b981' : '#f59e0b' },
            ].map(s => (
              <div key={s.label} className="bg-surface-2 rounded-lg px-4 py-2 text-center min-w-[80px]">
                <p className="text-[18px] font-bold font-mono" style={{ color: s.color }}>{s.value}</p>
                <p className="text-[11px] text-text-muted mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Upcoming steps */}
          {upcomingSteps.length > 0 && (
            <div className="mb-6 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-[12px] font-semibold text-amber-400 mb-2 flex items-center gap-1.5"><Calendar size={12} /> Upcoming</p>
              <div className="flex flex-col gap-1.5">
                {upcomingSteps.map(a => (
                  <div key={a.id} className="flex items-center justify-between text-[13px]">
                    <span className="text-text-primary">{a.company_name} — <span className="text-text-muted">{a.next_step}</span></span>
                    <span className="text-amber-400 font-mono text-[11px]">{new Date(a.next_step_date!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add form */}
          {showAdd && (
            <div className="mb-6 p-5 rounded-xl bg-surface-2 border border-border">
              <h3 className="text-[14px] font-semibold text-text-primary mb-4">Add Application</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input className="search-input" placeholder="Job Title *" value={form.job_title} onChange={e => setForm(p => ({...p, job_title: e.target.value}))} />
                <input className="search-input" placeholder="Company Name *" value={form.company_name} onChange={e => setForm(p => ({...p, company_name: e.target.value}))} />
                <input className="search-input" placeholder="Country" value={form.country} onChange={e => setForm(p => ({...p, country: e.target.value}))} />
                <input className="search-input" placeholder="Job URL" value={form.job_url} onChange={e => setForm(p => ({...p, job_url: e.target.value}))} />
                <select className="search-input" value={form.status} onChange={e => setForm(p => ({...p, status: e.target.value}))}>
                  {STATUSES.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                </select>
                <input type="date" className="search-input" value={form.applied_date} onChange={e => setForm(p => ({...p, applied_date: e.target.value}))} />
                <input className="search-input" placeholder="Expected Salary" value={form.salary_expected} onChange={e => setForm(p => ({...p, salary_expected: e.target.value}))} />
                <input className="search-input" placeholder="Next Step (e.g. Technical Interview)" value={form.next_step} onChange={e => setForm(p => ({...p, next_step: e.target.value}))} />
                <input type="date" className="search-input" placeholder="Next Step Date" value={form.next_step_date} onChange={e => setForm(p => ({...p, next_step_date: e.target.value}))} />
              </div>
              <textarea className="search-input w-full mt-3 h-20 resize-none" placeholder="Notes..." value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} />
              <div className="flex gap-2 mt-3">
                <button onClick={addApp} className="px-4 py-2 rounded-lg bg-accent text-black text-sm font-semibold hover:bg-accent-bright">Save</button>
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg bg-surface-3 text-text-secondary text-sm hover:bg-surface-2">Cancel</button>
              </div>
            </div>
          )}

          {/* Applications list */}
          {loading ? (
            <div className="text-center py-20 text-text-muted">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <FileText size={40} className="text-text-muted mb-4" />
              <p className="text-lg font-semibold text-text-primary">No applications yet</p>
              <p className="text-text-muted text-sm mt-1">Add your first application to start tracking</p>
              <button onClick={() => setShowAdd(true)} className="mt-4 px-4 py-2 rounded-lg bg-accent text-black text-sm font-semibold hover:bg-accent-bright">
                + Add Application
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filtered.map(app => {
                const s = statusInfo(app.status)
                return (
                  <div key={app.id} className="job-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-lg" style={{ background: s.bg }}>
                        {s.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-[15px] font-semibold text-text-primary">{app.job_title}</h3>
                            <p className="text-[13px] text-text-secondary">{app.company_name}{app.country ? ` · ${app.country}` : ''}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {app.job_url && (
                              <a href={app.job_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg hover:bg-surface-3 text-text-muted hover:text-accent transition-colors">
                                <ExternalLink size={13} />
                              </a>
                            )}
                            <button onClick={() => deleteApp(app.id)} className="p-1.5 rounded-lg hover:bg-surface-3 text-text-muted hover:text-red-400 transition-colors">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {/* Status dropdown */}
                          <div className="relative group">
                            <button className="flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-full font-medium transition-all" style={{ color: s.color, background: s.bg }}>
                              {s.icon} {s.label} <ChevronDown size={10} />
                            </button>
                            <div className="absolute left-0 top-full mt-1 z-10 bg-surface-2 border border-border rounded-xl p-1 hidden group-hover:block shadow-xl min-w-[140px]">
                              {STATUSES.map(opt => (
                                <button key={opt.id} onClick={() => updateStatus(app.id, opt.id)}
                                  className="w-full text-left text-[12px] px-3 py-1.5 rounded-lg hover:bg-surface-3 transition-colors"
                                  style={{ color: opt.color }}>
                                  {opt.icon} {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <span className="text-[11px] text-text-muted flex items-center gap-1">
                            <Calendar size={10} /> {new Date(app.applied_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>

                          {app.salary_expected && (
                            <span className="text-[11px] text-accent font-mono">
                              {app.salary_currency} {app.salary_expected.toLocaleString()}
                            </span>
                          )}

                          {app.next_step && (
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-400">
                              📅 {app.next_step}{app.next_step_date ? ` · ${new Date(app.next_step_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                            </span>
                          )}
                        </div>

                        {/* Notes */}
                        {editingId === app.id ? (
                          <div className="mt-2">
                            <textarea
                              className="search-input w-full h-16 resize-none text-[12px]"
                              value={editNotes}
                              onChange={e => setEditNotes(e.target.value)}
                              autoFocus
                            />
                            <div className="flex gap-2 mt-1">
                              <button onClick={() => updateNotes(app.id)} className="text-[12px] px-3 py-1 rounded-lg bg-accent text-black font-medium">Save</button>
                              <button onClick={() => setEditingId(null)} className="text-[12px] px-3 py-1 rounded-lg bg-surface-3 text-text-muted">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="mt-1.5">
                            {app.notes ? (
                              <p className="text-[12px] text-text-muted cursor-pointer hover:text-text-secondary"
                                onClick={() => { setEditingId(app.id); setEditNotes(app.notes || '') }}>
                                📝 {app.notes}
                              </p>
                            ) : (
                              <button className="text-[11px] text-text-muted hover:text-text-secondary"
                                onClick={() => { setEditingId(app.id); setEditNotes('') }}>
                                + Add note
                              </button>
                            )}
                          </div>
                        )}
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
