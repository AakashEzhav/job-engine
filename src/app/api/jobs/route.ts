import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)

  // Parse filters
  const page = parseInt(searchParams.get('page') || '1')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
  const search = searchParams.get('q') || ''
  const country = searchParams.get('country') || ''
  const remote = searchParams.get('remote') || ''
  const visa = searchParams.get('visa') || ''
  const category = searchParams.get('category') || ''
  const source = searchParams.get('source') || ''
  const minSalary = parseInt(searchParams.get('minSalary') || '0')
  const sortBy = searchParams.get('sort') || 'quality_score'

  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('jobs')
    .select('*', { count: 'exact' })
    .neq('verification_status', 'expired')
    .gt('expires_at', new Date().toISOString())
    .gte('date_posted', new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString())

  // Search
  if (search) {
    query = query.or(`job_title.ilike.%${search}%,company_name.ilike.%${search}%,job_description.ilike.%${search}%`)
  }

  // Filters
  if (country) query = query.ilike('country', `%${country}%`)
  if (remote === 'true') query = query.eq('remote_type', 'remote')
  if (remote === 'hybrid') query = query.eq('remote_type', 'hybrid')
  if (visa === 'true') query = query.gte('visa_probability', 0.5)
  if (category) query = query.eq('job_category', category)
  if (source) query = query.eq('job_source', source)
  if (minSalary > 0) query = query.gte('salary_min', minSalary)

  // Sort
  const sortColumn = ['quality_score', 'date_posted', 'salary_max'].includes(sortBy) ? sortBy : 'quality_score'
  query = query.order(sortColumn, { ascending: false }).range(from, to)

  const { data: jobs, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    jobs: jobs || [],
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit)
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
    }
  })
}
