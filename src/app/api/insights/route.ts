import { NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET() {
  const [
    totalRes, remoteRes, visaRes,
    salaryRes, skillsRes, sourcesRes, countriesRes
  ] = await Promise.all([
    supabase.from('jobs').select('*', { count: 'exact', head: true }),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('remote_type', 'remote'),
    supabase.from('jobs').select('*', { count: 'exact', head: true }).gte('visa_probability', 0.4),
    supabase.from('jobs')
      .select('country, salary_min, salary_max, salary_currency')
      .not('salary_min', 'is', null)
      .not('salary_max', 'is', null)
      .gt('salary_min', 0)
      .gt('salary_max', 0),
    supabase.from('jobs').select('tech_stack').not('tech_stack', 'eq', '{}'),
    supabase.from('jobs').select('job_source'),
    supabase.from('jobs').select('country'),
  ])

  // Salary by country
  const salaryMap: Record<string, { mins: number[], maxs: number[], currency: string }> = {}
  for (const job of salaryRes.data || []) {
    if (!job.country || !job.salary_min || !job.salary_max) continue
    if (!salaryMap[job.country]) salaryMap[job.country] = { mins: [], maxs: [], currency: job.salary_currency || 'USD' }
    salaryMap[job.country].mins.push(job.salary_min)
    salaryMap[job.country].maxs.push(job.salary_max)
  }
  const salaries = Object.entries(salaryMap)
    .map(([country, d]) => ({
      country,
      avg_min: Math.round(d.mins.reduce((a, b) => a + b, 0) / d.mins.length),
      avg_max: Math.round(d.maxs.reduce((a, b) => a + b, 0) / d.maxs.length),
      count: d.mins.length,
      currency: d.currency
    }))
    .filter(s => s.avg_max > 1000)
    .sort((a, b) => b.avg_max - a.avg_max)
    .slice(0, 12)

  // Skills count
  const skillMap: Record<string, number> = {}
  for (const job of skillsRes.data || []) {
    if (!Array.isArray(job.tech_stack)) continue
    for (const skill of job.tech_stack) {
      if (skill && skill.length > 1 && skill.length < 30) {
        skillMap[skill] = (skillMap[skill] || 0) + 1
      }
    }
  }
  const skills = Object.entries(skillMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([skill, count]) => ({ skill, count }))

  // Sources
  const sourceMap: Record<string, number> = {}
  for (const job of sourcesRes.data || []) {
    sourceMap[job.job_source] = (sourceMap[job.job_source] || 0) + 1
  }
  const sources = Object.entries(sourceMap)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }))

  // Countries
  const countryMap: Record<string, number> = {}
  for (const job of countriesRes.data || []) {
    countryMap[job.country] = (countryMap[job.country] || 0) + 1
  }
  const countries = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1])
    .map(([country, count]) => ({ country, count }))

  return NextResponse.json({
    totalJobs: totalRes.count || 0,
    remoteJobs: remoteRes.count || 0,
    visaJobs: visaRes.count || 0,
    salaries,
    skills,
    sources,
    countries
  }, { headers: { 'Cache-Control': 'public, s-maxage=600' } })
}
