import { NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('stats_summary')
    .select('*')
    .single()

  if (error) {
    // Fallback: compute stats manually
    const [jobs, remote, visa, radar, startups] = await Promise.all([
      supabase.from('jobs').select('id', { count: 'exact', head: true })
        .gt('expires_at', new Date().toISOString()),
      supabase.from('jobs').select('id', { count: 'exact', head: true })
        .eq('remote_type', 'remote').gt('expires_at', new Date().toISOString()),
      supabase.from('jobs').select('id', { count: 'exact', head: true })
        .gte('visa_probability', 0.5).gt('expires_at', new Date().toISOString()),
      supabase.from('opportunity_radar').select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase.from('startups').select('id', { count: 'exact', head: true })
        .eq('has_open_roles', true),
    ])

    return NextResponse.json({
      total_active_jobs: jobs.count || 0,
      remote_jobs: remote.count || 0,
      visa_jobs: visa.count || 0,
      watchlist_count: radar.count || 0,
      startups_hiring: startups.count || 0,
    })
  }

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' }
  })
}
