import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const hiringOnly = searchParams.get('hiring') === 'true'

  const from = (page - 1) * limit
  const to = from + limit - 1

  let query = supabase
    .from('startups')
    .select('*', { count: 'exact' })
    .order('launch_date', { ascending: false })
    .range(from, to)

  if (hiringOnly) {
    query = query.eq('has_open_roles', true)
  }

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    startups: data || [],
    total: count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit)
  })
}
