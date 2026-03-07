// ============================================================
// RESILIENCE SYSTEM
// Every scraper has: retry logic, fallback source, circuit breaker,
// health tracking, and graceful degradation
// ============================================================

import { createAdminClient } from '../db/supabase'
import { sleep } from './base'

// ============================================================
// CIRCUIT BREAKER
// If a scraper fails 3 times in a row → pause it for 2 hours
// This prevents wasting time on dead sources
// ============================================================
interface CircuitState {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'  // closed = working normally
}

const circuitBreakers = new Map<string, CircuitState>()

const FAILURE_THRESHOLD = 3
const RECOVERY_TIMEOUT = 2 * 60 * 60 * 1000 // 2 hours

export function checkCircuit(scraperName: string): boolean {
  const state = circuitBreakers.get(scraperName)
  if (!state) return true // No history = allowed

  if (state.state === 'open') {
    const timeSinceLastFailure = Date.now() - state.lastFailure
    if (timeSinceLastFailure > RECOVERY_TIMEOUT) {
      // Try again (half-open)
      state.state = 'half-open'
      console.log(`[Circuit] ${scraperName}: Attempting recovery after ${Math.round(timeSinceLastFailure / 60000)} minutes`)
      return true
    }
    console.log(`[Circuit] ${scraperName}: BLOCKED (${state.failures} failures, circuit open)`)
    return false
  }

  return true // closed or half-open = proceed
}

export function recordSuccess(scraperName: string) {
  const state = circuitBreakers.get(scraperName)
  if (state) {
    state.failures = 0
    state.state = 'closed'
    console.log(`[Circuit] ${scraperName}: ✅ Recovered`)
  }
}

export function recordFailure(scraperName: string, error: string) {
  const state = circuitBreakers.get(scraperName) || { failures: 0, lastFailure: 0, state: 'closed' as const }
  state.failures++
  state.lastFailure = Date.now()

  if (state.failures >= FAILURE_THRESHOLD) {
    state.state = 'open'
    console.log(`[Circuit] ${scraperName}: 🔴 OPENED after ${state.failures} failures: ${error}`)
  } else {
    console.log(`[Circuit] ${scraperName}: ⚠️ Failure ${state.failures}/${FAILURE_THRESHOLD}: ${error}`)
  }

  circuitBreakers.set(scraperName, state as CircuitState)
}

// ============================================================
// SCRAPER WRAPPER WITH FULL RESILIENCE
// Wraps any scraper function with: retries, timeout, circuit breaker, fallback
// ============================================================
interface ScraperConfig {
  name: string
  fn: () => Promise<any[]>
  fallback?: () => Promise<any[]>
  timeout?: number
  retries?: number
  priority?: number // 1=critical, 2=important, 3=nice-to-have
}

export async function runWithResilience(config: ScraperConfig): Promise<{
  name: string
  success: boolean
  jobs: any[]
  jobCount: number
  error?: string
  usedFallback?: boolean
  durationMs: number
}> {
  const { name, fn, fallback, timeout = 60000, retries = 2, priority = 2 } = config
  const startTime = Date.now()

  // Check circuit breaker
  if (!checkCircuit(name)) {
    return { name, success: false, jobs: [], jobCount: 0, error: 'Circuit open', durationMs: 0 }
  }

  let lastError: string = ''

  // Try main scraper with retries
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[${name}] Attempt ${attempt}/${retries}...`)

      // Timeout wrapper
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${timeout / 1000}s`)), timeout)
        )
      ])

      if (Array.isArray(result) && result.length >= 0) {
        recordSuccess(name)
        const durationMs = Date.now() - startTime
        console.log(`[${name}] ✅ Success: ${result.length} jobs in ${durationMs}ms`)
        return { name, success: true, jobs: result, jobCount: result.length, durationMs }
      }

      throw new Error('Invalid result format')

    } catch (error: any) {
      lastError = error.message || 'Unknown error'
      console.error(`[${name}] Attempt ${attempt} failed: ${lastError}`)

      if (attempt < retries) {
        const backoffMs = attempt * 3000 // 3s, 6s backoff
        console.log(`[${name}] Retrying in ${backoffMs / 1000}s...`)
        await sleep(backoffMs)
      }
    }
  }

  // Main scraper failed all retries — try fallback
  recordFailure(name, lastError)

  if (fallback) {
    console.log(`[${name}] Trying fallback source...`)
    try {
      const fallbackResult = await Promise.race([
        fallback(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Fallback timeout')), 30000)
        )
      ])

      if (Array.isArray(fallbackResult)) {
        console.log(`[${name}] Fallback succeeded: ${fallbackResult.length} jobs`)
        return {
          name,
          success: true,
          jobs: fallbackResult,
          jobCount: fallbackResult.length,
          durationMs: Date.now() - startTime,
          usedFallback: true,
          error: `Primary failed, used fallback: ${lastError}`
        }
      }
    } catch (fbError: any) {
      console.error(`[${name}] Fallback also failed: ${fbError.message}`)
    }
  }

  const durationMs = Date.now() - startTime
  return { name, success: false, jobs: [], jobCount: 0, error: lastError, durationMs }
}

// ============================================================
// HEALTH TRACKER
// Saves scraper health to database for monitoring
// ============================================================
export async function saveScraperHealth(results: ReturnType<typeof runWithResilience> extends Promise<infer T> ? T[] : never) {
  try {
    const supabase = createAdminClient()

    await supabase.from('scrape_logs').insert(
      results.map(r => ({
        source: r.name,
        status: r.success ? (r.usedFallback ? 'fallback' : 'success') : 'failed',
        jobs_found: r.jobCount,
        jobs_new: 0,
        error_message: r.error || null,
        duration_ms: r.durationMs,
        started_at: new Date(Date.now() - r.durationMs).toISOString(),
        completed_at: new Date().toISOString()
      }))
    )
  } catch (e) {
    // Don't let health tracking break the scraper
  }
}

// ============================================================
// STALE CACHE — Use last run's data if scraper fails
// Stores last known good results in Supabase
// ============================================================
export async function getLastKnownGoodResults(scraperName: string): Promise<number> {
  try {
    const supabase = createAdminClient()
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('job_source', scraperName)
      .gt('expires_at', new Date().toISOString())

    return count || 0
  } catch {
    return 0
  }
}

// ============================================================
// RATE LIMITER — Prevents hitting API limits
// ============================================================
const rateLimiters = new Map<string, { requests: number; windowStart: number }>()

export function checkRateLimit(domain: string, maxPerHour: number): boolean {
  const now = Date.now()
  const window = 60 * 60 * 1000 // 1 hour

  const limiter = rateLimiters.get(domain) || { requests: 0, windowStart: now }

  // Reset window if expired
  if (now - limiter.windowStart > window) {
    limiter.requests = 0
    limiter.windowStart = now
  }

  if (limiter.requests >= maxPerHour) {
    console.log(`[RateLimit] ${domain}: Limit reached (${maxPerHour}/hour)`)
    return false
  }

  limiter.requests++
  rateLimiters.set(domain, limiter)
  return true
}

// ============================================================
// FALLBACK DATA SOURCES MAP
// For every primary source, defines what to try if it fails
// ============================================================
export const FALLBACK_MAP: Record<string, string[]> = {
  // If LinkedIn RSS fails → try Indeed RSS → try RemoteOK
  'linkedin': ['indeed', 'remoteok'],

  // If Indeed RSS fails → try Adzuna → try Arbeitnow
  'indeed': ['adzuna', 'arbeitnow'],

  // If Glassdoor fails → try TheMuse → try Jobicy
  'glassdoor': ['themuse', 'jobicy'],

  // If HackerNews fails → try Reddit → try WWR
  'hackernews': ['reddit', 'weworkremotely'],

  // If RemoteOK fails → try Remotive → try WorkingNomads
  'remoteok': ['remotive', 'workingnomads'],

  // If Adzuna fails → try TheMuse (doesn't need API key)
  'adzuna': ['themuse', 'himalayas'],

  // If TechCrunch scrape fails → use Arbeitnow as a signal proxy
  'techcrunch': ['arbeitnow'],
}

// ============================================================
// SMART RETRY ORCHESTRATOR
// Runs all scrapers and ensures minimum job coverage
// ============================================================
export async function ensureMinimumCoverage(
  currentJobs: any[],
  targetMinimum: number,
  availableScrapers: Record<string, () => Promise<any[]>>
): Promise<any[]> {
  if (currentJobs.length >= targetMinimum) return currentJobs

  console.log(`[Coverage] Only ${currentJobs.length}/${targetMinimum} jobs. Running backup scrapers...`)

  // Run backup scrapers until we hit minimum
  const backupOrder = ['themuse', 'jobicy', 'himalayas', 'arbeitnow', 'devitjobs']

  const allJobs = [...currentJobs]
  for (const scraperName of backupOrder) {
    if (allJobs.length >= targetMinimum) break
    if (!availableScrapers[scraperName]) continue

    console.log(`[Coverage] Running backup: ${scraperName}`)
    try {
      const backupJobs = await availableScrapers[scraperName]()
      allJobs.push(...backupJobs)
      console.log(`[Coverage] Added ${backupJobs.length} jobs from ${scraperName}`)
    } catch (e) {
      console.log(`[Coverage] Backup ${scraperName} failed, skipping`)
    }
  }

  return allJobs
}
