import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/db/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('saved_jobs')
    .select(`
      *,
      jobs (*)
    `)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saved: data || [] })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { job_id, notes, status } = body

  if (!job_id) return NextResponse.json({ error: 'job_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('saved_jobs')
    .upsert({ job_id, notes, status: status || 'saved' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saved: data })
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('job_id')

  if (!jobId) return NextResponse.json({ error: 'job_id required' }, { status: 400 })

  const { error } = await supabase
    .from('saved_jobs')
    .delete()
    .eq('job_id', jobId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
