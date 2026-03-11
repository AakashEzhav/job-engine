import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const hiringOnly = searchParams.get('hiring') === 'true'
  const companyName = searchParams.get('company') || ''

  // If fetching jobs for a specific company
  if (companyName) {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .ilike('company_name', `%${companyName}%`)
      .neq('verification_status', 'expired')
      .order('date_posted', { ascending: false })
      .limit(20)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ jobs: data || [] })
  }

  let query = supabase
    .from('startups')
    .select('*', { count: 'exact' })
    .order('jobs_count', { ascending: false })
    .limit(limit)

  if (hiringOnly) query = query.gt('jobs_count', 0)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ startups: data || [], total: count || 0 })
}
