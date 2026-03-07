// ============================================================
// ORCHESTRATOR v2 — COMPLETE 4-LAYER ARCHITECTURE
// ============================================================

import { createAdminClient } from '../db/supabase'
import { sleep } from './base'
import { deduplicateJobs } from './deduplication'
import { enrichJobsBatch } from './structured-data'
import { scrapeAllATSSystems } from './ats-master'
import { scrapeAllCareerPages } from './career-pages'
import { scrapeAmazon, scrapeMicrosoft, scrapeApple, scrapeMeta, scrapeAllWorkday, checkForDeadJobs } from './dynamic-apis'
import { scrapeWeWorkRemotely, scrapeRemoteOK, scrapeHackerNews, scrapeRemotive, scrapeWorkingNomads, scrapeYCombinator } from './jobboards'
import { scrapeAdzuna, scrapeArbeitnow, scrapeTheMuse, scrapeJobicy, scrapeHimalayas, scrapeDevITJobs, scrapeUSAJobs } from './premium-boards'
import { scrapeYCDirectory, scrapeProductHunt, scrapeRedditHiring } from './startups'
import { autoDiscoverAndMonitorCompany } from './career-pages'
import type { ScrapedJob } from './jobboards'

interface LayerResult { layer: number; name: string; jobs: number; durationMs: number; success: boolean; error?: string }
interface OrchestratorResult { success: boolean; totalScraped: number; afterDedup: number; newSaved: number; enriched: number; duplicatesRemoved: number; deadJobsKilled: number; layers: LayerResult[]; durationMs: number }

const LAYER4_SOURCES = [
  { name: 'RemoteOK',       fn: scrapeRemoteOK },
  { name: 'Remotive',       fn: scrapeRemotive },
  { name: 'Arbeitnow',      fn: scrapeArbeitnow },
  { name: 'Himalayas',      fn: scrapeHimalayas },
  { name: 'Jobicy',         fn: scrapeJobicy },
  { name: 'TheMuse',        fn: scrapeTheMuse },
  { name: 'WorkingNomads',  fn: scrapeWorkingNomads },
  { name: 'DevITJobs',      fn: scrapeDevITJobs },
  { name: 'WeWorkRemotely', fn: scrapeWeWorkRemotely },
  { name: 'HackerNews',     fn: scrapeHackerNews },
  { name: 'YCombinator',    fn: scrapeYCombinator },
  { name: 'Adzuna',         fn: scrapeAdzuna },
  { name: 'USAJobs',        fn: scrapeUSAJobs },
  { name: 'Reddit Hiring',  fn: scrapeRedditHiring },
]

export async function runScrapeJob(): Promise<OrchestratorResult> {
  const supabase = createAdminClient()
  const startTime = Date.now()
  const layers: LayerResult[] = []
  const allJobs: ScrapedJob[] = []

  console.log('\n' + '═'.repeat(60))
  console.log('  JOB ENGINE — 4-LAYER ARCHITECTURE v2')
  console.log('  ' + new Date().toISOString())
  console.log('═'.repeat(60))

  // ── LAYER 1: ATS APIs ──────────────────────────────────────
  console.log('\n▶ LAYER 1: ATS APIs')
  const l1 = await runLayer('ATS APIs', async () => {
    const jobs = await scrapeAllATSSystems()
    allJobs.push(...jobs)
    return jobs.length
  })
  layers.push({ layer: 1, ...l1 })

  // ── LAYER 2: Company Career Pages ─────────────────────────
  console.log('\n▶ LAYER 2: Company Career Pages + Dynamic APIs')
  const l2 = await runLayer('Career Pages + Dynamic APIs', async () => {
    // Static career pages
    const staticJobs = await scrapeAllCareerPages()

    // Dynamic APIs (Amazon, Microsoft, Apple, Meta, Workday)
    console.log('  Scraping dynamic APIs: Amazon, Microsoft, Apple, Meta, Workday...')
    const dynamicResults = await Promise.allSettled([
      scrapeAmazon(),
      scrapeMicrosoft(),
      scrapeApple(),
      scrapeMeta(),
      scrapeAllWorkday(),
    ])

    const dynamicNames = ['Amazon', 'Microsoft', 'Apple', 'Meta', 'Workday']
    let dynamicCount = 0
    for (let i = 0; i < dynamicResults.length; i++) {
      const r = dynamicResults[i]
      if (r.status === 'fulfilled') {
        allJobs.push(...r.value)
        dynamicCount += r.value.length
        console.log(`  ✅ ${dynamicNames[i]}: ${r.value.length} jobs`)
      } else {
        console.log(`  ❌ ${dynamicNames[i]}: ${r.reason?.message}`)
      }
    }

    allJobs.push(...staticJobs)
    return staticJobs.length + dynamicCount
  })
  layers.push({ layer: 2, ...l2 })

  // ── LAYER 3: Structured Data Enrichment ───────────────────
  console.log('\n▶ LAYER 3: Structured Data Enrichment')
  const l3 = await runLayer('Enrichment', async () => {
    const beforeCount = allJobs.filter(j => !j.salary_predicted).length
    await enrichJobsBatch(allJobs, 50)
    const enriched = allJobs.filter(j => !j.salary_predicted).length - beforeCount
    return Math.max(0, enriched)
  })
  layers.push({ layer: 3, ...l3 })

  // ── LAYER 4: Free APIs ─────────────────────────────────────
  console.log('\n▶ LAYER 4: Free API Sources')
  const l4 = await runLayer('Free APIs', async () => {
    let total = 0
    for (let i = 0; i < LAYER4_SOURCES.length; i += 3) {
      const batch = LAYER4_SOURCES.slice(i, i + 3)
      const settled = await Promise.allSettled(batch.map(s => s.fn()))
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j]
        if (r.status === 'fulfilled') {
          allJobs.push(...r.value)
          total += r.value.length
          console.log(`  ✅ ${batch[j].name}: ${r.value.length}`)
        } else {
          console.log(`  ❌ ${batch[j].name}: failed`)
        }
      }
      await sleep(300)
    }
    return total
  })
  layers.push({ layer: 4, ...l4 })

  // ── DEDUPLICATION ──────────────────────────────────────────
  console.log(`\n▶ Deduplication (${allJobs.length} raw jobs)`)
  const { unique: dedupedJobs, duplicatesRemoved, mergeLog } = deduplicateJobs(allJobs)
  console.log(`  Raw: ${allJobs.length} → Unique: ${dedupedJobs.length} (removed ${duplicatesRemoved} duplicates)`)
  if (mergeLog.length > 0) {
    console.log(`  Sample merges:`)
    mergeLog.slice(0, 3).forEach(m => console.log(`    Kept: ${m.kept}`))
  }

  // ── SAVE TO DATABASE ───────────────────────────────────────
  console.log('\n▶ Saving to database...')
  const newSaved = await saveJobsToDatabase(supabase, dedupedJobs)
  console.log(`  Saved: ${newSaved} new/updated jobs`)

  // Mark expired (>30 days old)
  await supabase
    .from('jobs')
    .update({ verification_status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .neq('verification_status', 'expired')

  // ── DEAD JOB CHECKER ──────────────────────────────────────
  const { killed: deadJobsKilled } = await checkForDeadJobs(supabase, 30)

  // ── STARTUP DISCOVERY SIDECAR ─────────────────────────────
  runStartupDiscoverySidecar(supabase).catch(() => {})

  // ── SUMMARY ───────────────────────────────────────────────
  const totalMs = Date.now() - startTime
  const enriched = l3.jobs

  console.log('\n' + '═'.repeat(60))
  console.log('  COMPLETE')
  console.log(`  ${(totalMs / 1000).toFixed(1)}s  |  ${allJobs.length} scraped  |  ${dedupedJobs.length} unique  |  ${newSaved} saved`)
  console.log(`  ${duplicatesRemoved} duplicates removed  |  ${enriched} enriched  |  ${deadJobsKilled} dead killed`)
  console.log('')
  for (const l of layers) {
    const bar = '█'.repeat(Math.min(25, Math.ceil(l.jobs / 8)))
    console.log(`  L${l.layer} ${l.name.padEnd(30)} ${String(l.jobs).padStart(4)}  ${bar}`)
  }
  console.log('═'.repeat(60))

  await supabase.from('scrape_logs').insert({
    source: 'all', status: layers.filter(l => l.success).length >= 3 ? 'success' : 'partial',
    jobs_found: allJobs.length, jobs_new: newSaved, duration_ms: totalMs,
    error_message: layers.filter(l => l.error).map(l => `L${l.layer}: ${l.error}`).join('\n') || null,
    completed_at: new Date().toISOString()
  })

  return {
    success: layers.filter(l => l.success).length >= 3,
    totalScraped: allJobs.length, afterDedup: dedupedJobs.length,
    newSaved, enriched, duplicatesRemoved, deadJobsKilled, layers, durationMs: totalMs
  }
}

async function runLayer(name: string, fn: () => Promise<number>): Promise<{ name: string; jobs: number; durationMs: number; success: boolean; error?: string }> {
  const start = Date.now()
  try {
    const jobs = await fn()
    return { name, jobs, durationMs: Date.now() - start, success: true }
  } catch (e: any) {
    console.log(`  ❌ ${name} layer failed: ${e.message}`)
    return { name, jobs: 0, durationMs: Date.now() - start, success: false, error: e.message }
  }
}

async function runStartupDiscoverySidecar(supabase: any): Promise<void> {
  console.log('\n[Sidecar] Startup discovery...')
  try {
    const [ph, yc] = await Promise.allSettled([scrapeProductHunt(), scrapeYCDirectory()])
    const companies: Array<{ name: string; website: string }> = []
    if (ph.status === 'fulfilled') companies.push(...ph.value.filter((c: any) => c.website))
    if (yc.status === 'fulfilled') companies.push(...yc.value.filter((c: any) => c.website))

    let monitored = 0
    for (const c of companies.slice(0, 15)) {
      const r = await autoDiscoverAndMonitorCompany(c.name, c.website, 'USA')
      if (r.monitored) monitored++
      await sleep(500)
    }
    console.log(`[Sidecar] Added ${monitored} companies to monitoring`)
  } catch {}
}

async function saveJobsToDatabase(supabase: any, jobs: ScrapedJob[]): Promise<number> {
  let count = 0
  for (let i = 0; i < jobs.length; i += 50) {
    const batch = jobs.slice(i, i + 50)
    try {
      const { data } = await supabase.from('jobs').upsert(
        batch.map(j => ({
          ...j,
          scraped_date: new Date().toISOString(),
          expires_at: getExpiryDate(j.date_posted)
        })),
        { onConflict: 'job_id', ignoreDuplicates: false }
      ).select('id')
      if (data) count += data.length
    } catch {}
  }
  return count
}

function getExpiryDate(datePosted?: string): string {
  const base = datePosted ? new Date(datePosted) : new Date()
  base.setDate(base.getDate() + 30)
  return base.toISOString()
}
