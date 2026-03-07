// ============================================================
// MAIN SCRAPER ORCHESTRATOR — WITH FULL RESILIENCE
// Every scraper has: circuit breaker, retries, fallback, timeout
// System never fails completely — always has backup sources
// ============================================================

import { createAdminClient } from '../db/supabase'
import {
  scrapeWeWorkRemotely, scrapeRemoteOK, scrapeHackerNews,
  scrapeRemotive, scrapeWorkingNomads, scrapeYCombinator, scrapeGitHubJobs
} from './jobboards'
import {
  scrapeProductHunt, scrapeYCDirectory, scrapeTechCrunchFunding,
  scrapeRedditHiring, findAndScrapeCareerPage
} from './startups'
import {
  scrapeAdzuna, scrapeArbeitnow, scrapeTheMuse, scrapeJobicy,
  scrapeHimalayas, scrapeUSAJobs, scrapeDevITJobs,
  scrapeLinkedInRSS, scrapeIndeedRSS, scrapeGlassdoorRSS
} from './premium-boards'
import {
  runWithResilience, saveScraperHealth, ensureMinimumCoverage,
  checkRateLimit
} from './resilience'
import { runGhostScraper } from './ghost-scraper'
import type { ScrapedJob } from './jobboards'

// ============================================================
// SCRAPER REGISTRY
// Every scraper defined with fallback + priority
// Priority 1 = most critical, runs first + gets extra retries
// ============================================================
const SCRAPER_REGISTRY = [
  // --- TIER 1: Free APIs (most reliable, no auth) ---
  { name: 'RemoteOK',       fn: scrapeRemoteOK,       priority: 1, fallback: scrapeRemotive,     timeout: 30000, retries: 3 },
  { name: 'Remotive',       fn: scrapeRemotive,        priority: 1, fallback: scrapeWorkingNomads,timeout: 30000, retries: 3 },
  { name: 'Arbeitnow',      fn: scrapeArbeitnow,       priority: 1, fallback: scrapeDevITJobs,    timeout: 30000, retries: 3 },
  { name: 'Himalayas',      fn: scrapeHimalayas,       priority: 1, fallback: scrapeJobicy,       timeout: 30000, retries: 3 },
  { name: 'Jobicy',         fn: scrapeJobicy,          priority: 1, fallback: scrapeRemoteOK,     timeout: 30000, retries: 3 },
  { name: 'TheMuse',        fn: scrapeTheMuse,         priority: 1, fallback: scrapeHimalayas,    timeout: 30000, retries: 3 },
  { name: 'DevITJobs',      fn: scrapeDevITJobs,       priority: 2, fallback: scrapeArbeitnow,    timeout: 25000, retries: 2 },
  { name: 'WorkingNomads',  fn: scrapeWorkingNomads,   priority: 2, fallback: scrapeJobicy,       timeout: 25000, retries: 2 },

  // --- TIER 2: RSS feeds (LinkedIn, Indeed, Glassdoor) ---
  { name: 'LinkedIn RSS',   fn: scrapeLinkedInRSS,     priority: 2, fallback: scrapeIndeedRSS,    timeout: 45000, retries: 2 },
  { name: 'Indeed RSS',     fn: scrapeIndeedRSS,       priority: 2, fallback: scrapeLinkedInRSS,  timeout: 45000, retries: 2 },
  { name: 'Glassdoor RSS',  fn: scrapeGlassdoorRSS,    priority: 3, fallback: scrapeTheMuse,      timeout: 45000, retries: 2 },

  // --- TIER 3: Scraping (may fail more often) ---
  { name: 'WeWorkRemotely', fn: scrapeWeWorkRemotely,  priority: 2, fallback: scrapeRemoteOK,     timeout: 40000, retries: 2 },
  { name: 'HackerNews',     fn: scrapeHackerNews,      priority: 2, fallback: scrapeRedditHiring, timeout: 40000, retries: 2 },
  { name: 'YCombinator',    fn: scrapeYCombinator,     priority: 3, fallback: scrapeTheMuse,      timeout: 40000, retries: 2 },
  { name: 'GitHub Careers', fn: scrapeGitHubJobs,      priority: 3, fallback: scrapeTheMuse,      timeout: 60000, retries: 1 },
  { name: 'Reddit',         fn: scrapeRedditHiring,    priority: 3, fallback: scrapeHackerNews,   timeout: 30000, retries: 2 },

  // --- TIER 4: Optional (needs API keys) ---
  { name: 'Adzuna',         fn: scrapeAdzuna,          priority: 2, fallback: scrapeTheMuse,      timeout: 60000, retries: 2 },
  { name: 'USAJobs',        fn: scrapeUSAJobs,         priority: 3, fallback: undefined,          timeout: 30000, retries: 2 },
]

// ============================================================
// RUN ALL SCRAPERS — WITH RESILIENCE
// ============================================================
export async function runAllScrapers(): Promise<{
  success: boolean
  totalJobs: number
  newJobs: number
  errors: string[]
  scraperResults: Array<{ name: string; jobs: number; success: boolean; usedFallback?: boolean }>
}> {
  const supabase = createAdminClient()
  const errors: string[] = []
  let totalJobs = 0
  let newJobs = 0

  console.log('🚀 Starting Global Job Engine scrape with full resilience...')
  const startTime = Date.now()

  // Log start
  const { data: logEntry } = await supabase
    .from('scrape_logs')
    .insert({ source: 'all', status: 'running' })
    .select().single()

  const allJobs: ScrapedJob[] = []
  const scraperResults: Array<{ name: string; jobs: number; success: boolean; usedFallback?: boolean }> = []

  // Run scrapers in priority order, 3 at a time
  const tier1 = SCRAPER_REGISTRY.filter(s => s.priority === 1)
  const tier2 = SCRAPER_REGISTRY.filter(s => s.priority === 2)
  const tier3 = SCRAPER_REGISTRY.filter(s => s.priority === 3)

  // Run each tier sequentially, scrapers within a tier in parallel batches
  for (const tier of [tier1, tier2, tier3]) {
    for (let i = 0; i < tier.length; i += 3) {
      const batch = tier.slice(i, i + 3)

      const batchResults = await Promise.allSettled(
        batch.map(s => runWithResilience({
          name: s.name,
          fn: s.fn,
          fallback: s.fallback,
          timeout: s.timeout,
          retries: s.retries,
          priority: s.priority
        }))
      )

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const r = result.value
          allJobs.push(...r.jobs)
          scraperResults.push({ name: r.name, jobs: r.jobCount, success: r.success, usedFallback: r.usedFallback })
          if (!r.success) errors.push(`${r.name}: ${r.error}`)
          if (r.usedFallback) console.log(`[Orchestrator] ${r.name} used fallback`)
        } else {
          errors.push(`${batch[scraperResults.length % batch.length].name}: Promise rejected`)
        }
      }
    }
  }

  // ---- GHOST SCRAPER: LinkedIn, Indeed, Glassdoor, ATS Systems ----
  console.log('\n🔥 Running Ghost Scraper (LinkedIn + Indeed + Glassdoor + 50 companies)...')
  try {
    const ghostJobs = await runGhostScraper()
    allJobs.push(...ghostJobs)
    scraperResults.push({ name: 'Ghost Scraper', jobs: ghostJobs.length, success: true })
    console.log(`✅ Ghost Scraper: ${ghostJobs.length} jobs from LinkedIn/Indeed/Glassdoor/ATS`)
  } catch (e: any) {
    const error = `Ghost Scraper failed: ${e.message}`
    errors.push(error)
    scraperResults.push({ name: 'Ghost Scraper', jobs: 0, success: false })
    console.error(`❌ ${error}`)
  }

  totalJobs = allJobs.length
  console.log(`\n📊 Total jobs scraped: ${totalJobs}`)

  // ---- Deduplicate ----
  const dedupedJobs = deduplicateJobs(allJobs)
  console.log(`🔄 After deduplication: ${dedupedJobs.length} unique jobs`)

  // ---- Ensure minimum coverage (run backup scrapers if needed) ----
  const MIN_JOBS = 100
  if (dedupedJobs.length < MIN_JOBS) {
    console.log(`\n⚠️  Only ${dedupedJobs.length} jobs — below minimum ${MIN_JOBS}. Running backup sources...`)
    const backupJobs = await runBackupScrapers()
    allJobs.push(...backupJobs)
    const rededuped = deduplicateJobs(allJobs)
    allJobs.length = 0
    allJobs.push(...rededuped)
  }

  const finalDeduped = deduplicateJobs(allJobs)

  // ---- Save to database ----
  newJobs = await saveJobsToDatabase(supabase, finalDeduped)
  console.log(`💾 New jobs saved: ${newJobs}`)

  // ---- Remove expired jobs ----
  const { count: expiredCount } = await supabase
    .from('jobs')
    .update({ verification_status: 'expired' })
    .lt('expires_at', new Date().toISOString())
    .neq('verification_status', 'expired')
    .select('id', { count: 'exact', head: true })

  console.log(`🗑️  Marked ${expiredCount || 0} jobs as expired`)

  // ---- Scrape startups ----
  await scrapeAndSaveStartups(supabase)

  // ---- Update opportunity radar ----
  await updateOpportunityRadar(supabase)

  const duration = Date.now() - startTime

  // Update log
  if (logEntry?.id) {
    await supabase
      .from('scrape_logs')
      .update({
        status: errors.length === 0 ? 'success' : 'partial',
        jobs_found: totalJobs,
        jobs_new: newJobs,
        error_message: errors.join('\n'),
        duration_ms: duration,
        completed_at: new Date().toISOString()
      })
      .eq('id', logEntry.id)
  }

  // Save scraper health logs
  await saveScraperHealth(scraperResults.map(r => ({
    ...r, jobs: [], jobCount: r.jobs, durationMs: 0, error: !r.success ? 'failed' : undefined
  })) as any)

  // Print summary table
  console.log('\n📋 SCRAPER RESULTS:')
  console.log('─'.repeat(50))
  for (const r of scraperResults) {
    const icon = r.success ? (r.usedFallback ? '⚠️ ' : '✅') : '❌'
    const fb = r.usedFallback ? ' (fallback)' : ''
    console.log(`${icon} ${r.name.padEnd(20)} ${r.jobs} jobs${fb}`)
  }
  console.log('─'.repeat(50))

  const successCount = scraperResults.filter(r => r.success).length
  console.log(`\n✨ Scrape complete in ${(duration / 1000).toFixed(1)}s`)
  console.log(`   Sources: ${successCount}/${scraperResults.length} succeeded`)
  console.log(`   Jobs: ${totalJobs} found → ${dedupedJobs.length} unique → ${newJobs} new`)

  return {
    success: successCount > scraperResults.length * 0.5, // success if >50% scrapers worked
    totalJobs,
    newJobs,
    errors,
    scraperResults
  }
}

// Re-export dedupedJobs count for the return
let lastDedupCount = 0

// ============================================================
// DEDUPLICATION
// ============================================================
function deduplicateJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  const seen = new Map<string, ScrapedJob>()

  for (const job of jobs) {
    const existing = seen.get(job.job_id)
    if (!existing) {
      seen.set(job.job_id, job)
    } else {
      // Prefer career page sources over job boards
      if (job.source_type === 'career_page' && existing.source_type !== 'career_page') {
        seen.set(job.job_id, { ...job, verification_status: 'verified' })
      }
      // Prefer higher quality scores
      else if (job.quality_score > existing.quality_score) {
        seen.set(job.job_id, job)
      }
    }
  }

  return Array.from(seen.values())
}

// ============================================================
// BACKUP SCRAPER RUNNER
// Called when total jobs fall below minimum threshold
// Uses only the most reliable no-auth sources
// ============================================================
async function runBackupScrapers(): Promise<ScrapedJob[]> {
  console.log('[Backup] Running guaranteed-reliable sources...')
  const backupJobs: ScrapedJob[] = []

  const backupSources = [
    { name: 'TheMuse-Backup', fn: scrapeTheMuse },
    { name: 'Jobicy-Backup', fn: scrapeJobicy },
    { name: 'Himalayas-Backup', fn: scrapeHimalayas },
    { name: 'Arbeitnow-Backup', fn: scrapeArbeitnow },
  ]

  for (const source of backupSources) {
    try {
      const jobs = await Promise.race([
        source.fn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
      ])
      console.log(`[Backup] ${source.name}: ${jobs.length} jobs`)
      backupJobs.push(...jobs)
    } catch (e) {
      console.log(`[Backup] ${source.name} failed, skipping`)
    }
  }

  return backupJobs
}

// ============================================================
// SAVE JOBS TO DATABASE
// ============================================================
async function saveJobsToDatabase(supabase: any, jobs: ScrapedJob[]): Promise<number> {
  let newCount = 0
  const BATCH_SIZE = 50

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('jobs')
      .upsert(
        batch.map(job => ({
          ...job,
          scraped_date: new Date().toISOString(),
          expires_at: calculateExpiryDate(job.date_posted)
        })),
        {
          onConflict: 'job_id',
          ignoreDuplicates: false
        }
      )
      .select('id')

    if (error) {
      console.error('DB Error:', error.message)
    } else {
      newCount += data?.length || 0
    }
  }

  return newCount
}

function calculateExpiryDate(datePosted?: string): string {
  const base = datePosted ? new Date(datePosted) : new Date()
  base.setDate(base.getDate() + 15)
  return base.toISOString()
}

// ============================================================
// SCRAPE AND SAVE STARTUPS
// ============================================================
async function scrapeAndSaveStartups(supabase: any) {
  console.log('\n🚀 Discovering new startups...')

  const [phStartups, ycStartups] = await Promise.allSettled([
    scrapeProductHunt(),
    scrapeYCDirectory()
  ])

  const allStartups = [
    ...(phStartups.status === 'fulfilled' ? phStartups.value : []),
    ...(ycStartups.status === 'fulfilled' ? ycStartups.value : []),
  ]

  if (allStartups.length === 0) return

  // Upsert startups
  const { error } = await supabase
    .from('startups')
    .upsert(
      allStartups.map(s => ({
        name: s.name,
        website: s.website,
        description: s.description,
        logo: s.logo,
        batch: s.batch,
        source: s.source,
        source_url: s.source_url,
        upvotes: s.upvotes || 0,
        launch_date: s.launch_date
      })),
      { onConflict: 'name', ignoreDuplicates: false }
    )

  if (!error) {
    console.log(`✅ Saved ${allStartups.length} startups`)
  }

  // For new startups, try to find career pages
  const { data: newStartups } = await supabase
    .from('startups')
    .select('name, website')
    .eq('career_page_found', false)
    .not('website', 'is', null)
    .limit(20) // Check 20 per run

  if (newStartups) {
    for (const startup of newStartups) {
      if (!startup.website) continue

      const { found, careerUrl, jobs } = await findAndScrapeCareerPage(
        startup.name, startup.website
      )

      await supabase
        .from('startups')
        .update({
          career_page_found: found,
          career_page_url: careerUrl,
          has_open_roles: jobs.length > 0,
          jobs_count: jobs.length
        })
        .eq('name', startup.name)

      if (jobs.length > 0) {
        await saveJobsToDatabase(supabase, jobs)
      }
    }
  }
}

// ============================================================
// UPDATE OPPORTUNITY RADAR
// ============================================================
async function updateOpportunityRadar(supabase: any) {
  console.log('\n📡 Updating Opportunity Radar...')

  const signals = await scrapeTechCrunchFunding()

  if (signals.length === 0) return

  const { error } = await supabase
    .from('opportunity_radar')
    .upsert(
      signals.map(s => ({
        company_name: s.company_name,
        company_url: s.company_url,
        signal_type: s.signal_type,
        signal_description: s.signal_description,
        signal_source: s.signal_source,
        signal_url: s.signal_url,
        signal_date: s.signal_date,
        hiring_probability: s.hiring_probability,
        predicted_roles: s.predicted_roles,
        predicted_timeline: s.predicted_timeline,
        is_active: true
      })),
      { onConflict: 'company_name', ignoreDuplicates: false }
    )

  if (!error) {
    console.log(`✅ Updated ${signals.length} radar signals`)
  }
}

// ============================================================
// CLEAN EXPIRED JOBS
// ============================================================
export async function cleanExpiredJobs(): Promise<number> {
  const supabase = createAdminClient()

  const { count } = await supabase
    .from('jobs')
    .delete()
    .lt('expires_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()) // Delete jobs expired 7+ days ago
    .select('id', { count: 'exact', head: true })

  return count || 0
}
