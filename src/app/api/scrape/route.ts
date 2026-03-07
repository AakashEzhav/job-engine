import { NextRequest, NextResponse } from 'next/server'
import { runScrapeJob } from '@/lib/scrapers/orchestrator-v2'

export const maxDuration = 300 // 5 minutes max on Vercel

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runScrapeJob()

    return NextResponse.json({
      success: result.success,
      totalScraped: result.totalScraped,
      afterDedup: result.afterDedup,
      newSaved: result.newSaved,
      enriched: result.enriched,
      durationSeconds: (result.durationMs / 1000).toFixed(1),
      layers: result.layers.map(l => ({
        layer: l.layer,
        name: l.name,
        jobs: l.jobs,
        success: l.success,
        durationSeconds: (l.durationMs / 1000).toFixed(1),
      })),
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('Scrape failed:', error)
    return NextResponse.json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return POST(request)
}
