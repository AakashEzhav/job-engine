import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '30')

  const { data, error } = await supabase
    .from('opportunity_radar')
    .select('*')
    .eq('is_active', true)
    .order('hiring_probability', { ascending: false })
    .order('signal_date', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ signals: data || [] }, {
    headers: { 'Cache-Control': 'public, s-maxage=300' }
  })
}
