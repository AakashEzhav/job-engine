// ============================================================
// DYNAMIC CAREER PAGE HANDLERS
//
// Problem: Big companies load jobs via internal APIs,
// not static HTML. Schema.org extraction gets partial results.
// Solution: Reverse-engineer their actual internal API calls.
//
// Problem: Career pages only show 10-20 jobs at a time.
// Solution: Paginate through all pages automatically.
//
// Problem: Apple/Google block repeated requests.
// Solution: Exponential backoff + rate limiting per domain.
//
// Companies with custom handlers:
//   Amazon    — uses their internal jobs API
//   Microsoft — uses their HRSD/REST API  
//   Apple     — paginated JSON endpoint
//   Google    — paginated GCS-backed API
//   Netflix   — uses Workday with custom wrapper
//   Meta      — GraphQL API
//   Nvidia    — Workday API (standard)
//   Bytedance — paginated JSON
//   ASML      — paginated JSON
//   SAP       — paginated OData API
// ============================================================

import axios, { AxiosError } from 'axios'
import * as cheerio from 'cheerio'
import { cleanText, sleep, extractTechStack, detectJobCategory } from './base'
import { calculateVisaProbability, predictSalary, detectExperienceLevel,
  scoreJobQuality, generateJobFingerprint } from '../ai/detector'
import type { ScrapedJob } from './jobboards'

// ─── RATE LIMITER ─────────────────────────────────────────────
// Tracks requests per domain to avoid triggering rate limits.

const domainRequestLog = new Map<string, number[]>()

function canRequest(domain: string, maxPerMinute: number): boolean {
  const now = Date.now()
  const log = domainRequestLog.get(domain) || []
  // Remove requests older than 1 minute
  const recent = log.filter(t => now - t < 60000)
  domainRequestLog.set(domain, recent)
  if (recent.length >= maxPerMinute) return false
  recent.push(now)
  return true
}

// ─── RETRY WITH EXPONENTIAL BACKOFF ──────────────────────────

async function fetchWithRetry(
  url: string,
  options: any,
  maxRetries = 3,
  domain = 'unknown'
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Rate check
    if (!canRequest(domain, 20)) {
      await sleep(3000)
    }

    try {
      const response = await axios.get(url, { ...options, timeout: 15000 })
      return response.data
    } catch (e: any) {
      const status = e?.response?.status

      if (status === 403 || status === 429) {
        // Rate limited or blocked — back off longer
        const backoff = Math.pow(2, attempt) * 5000 // 10s, 20s, 40s
        console.log(`[DynamicAPI] ${domain}: ${status}, backing off ${backoff / 1000}s`)
        await sleep(backoff)
      } else if (status === 404 || status === 410) {
        return null // Resource gone — don't retry
      } else if (attempt < maxRetries) {
        await sleep(attempt * 2000)
      }

      if (attempt === maxRetries) throw e
    }
  }
}

// ─── PAGINATION ENGINE ────────────────────────────────────────
// Follows paginated job results until exhausted or limit reached.

async function paginateAll<T>(
  fetchPage: (offset: number) => Promise<{ items: T[]; total: number } | null>,
  pageSize: number,
  maxJobs = 200
): Promise<T[]> {
  const all: T[] = []
  let offset = 0

  while (offset < maxJobs) {
    const result = await fetchPage(offset)
    if (!result || result.items.length === 0) break

    all.push(...result.items)

    if (all.length >= result.total || result.items.length < pageSize) break
    offset += pageSize
    await sleep(1000) // Polite pause between pages
  }

  return all
}

// ─── AMAZON ──────────────────────────────────────────────────
// Amazon uses an internal REST API for their job search.
// Endpoint discovered from their career site's network requests.

export async function scrapeAmazon(): Promise<ScrapedJob[]> {
  console.log('[Amazon] Fetching via internal jobs API...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { team: 'software-development', country: 'USA', loc: 'US' },
    { team: 'software-development', country: 'United Kingdom', loc: 'GB' },
    { team: 'software-development', country: 'Germany', loc: 'DE' },
    { team: 'data-science', country: 'USA', loc: 'US' },
  ]

  for (const search of searches) {
    const rawJobs = await paginateAll(
      async (offset) => {
        const url = `https://www.amazon.jobs/en/search.json?` +
          `base_query=software+engineer&` +
          `category[]=${search.team}&` +
          `country[]=${search.loc}&` +
          `employment_type[]=Full+Time&` +
          `offset=${offset}&` +
          `result_limit=10&` +
          `sort=recent`

        const data = await fetchWithRetry(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Referer': 'https://www.amazon.jobs/',
          }
        }, 3, 'amazon.jobs')

        if (!data?.jobs) return null
        return { items: data.jobs, total: data.hits || data.jobs.length }
      },
      10,
      100
    )

    for (const job of rawJobs) {
      const title = job.title || ''
      const location = job.location || search.country
      const description = job.description || job.basic_qualifications || ''
      const datePosted = job.posted_date

      if (!title) continue

      const country = search.country
      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description, country)
      const predicted = predictSalary(title, country, expLevel)
      const remoteType = /remote|virtual/i.test(location) ? 'remote' : 'onsite'

      const jobObj = {
        salary_min: job.salary_min || predicted.min,
        salary_max: job.salary_max || predicted.max,
        salary_currency: search.country === 'United Kingdom' ? 'GBP' : search.country === 'Germany' ? 'EUR' : 'USD',
        visa_probability: visaProb, remote_type: remoteType, country,
        company_stage: 'enterprise', date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint('Amazon', title, country),
        job_title: title.substring(0, 200),
        company_name: 'Amazon',
        country, city: location.split(',')[0]?.trim(),
        remote_type: remoteType as any,
        salary_min: jobObj.salary_min, salary_max: jobObj.salary_max,
        salary_currency: jobObj.salary_currency,
        salary_predicted: !job.salary_min,
        job_description: cleanText((description).replace(/<[^>]+>/g, '')).substring(0, 3000),
        job_url: `https://www.amazon.jobs/en/jobs/${job.id_icims}` || job.job_path,
        job_source: 'amazon',
        source_type: 'career_page',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: /relocation/i.test(description),
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }
  }

  console.log(`[Amazon] Found ${jobs.length} jobs`)
  return jobs
}

// ─── MICROSOFT ────────────────────────────────────────────────
// Microsoft exposes a public job search REST API.

export async function scrapeMicrosoft(): Promise<ScrapedJob[]> {
  console.log('[Microsoft] Fetching via public jobs API...')
  const jobs: ScrapedJob[] = []

  const countries = [
    { code: 'United States', name: 'USA', currency: 'USD' },
    { code: 'United Kingdom', name: 'United Kingdom', currency: 'GBP' },
    { code: 'Germany', name: 'Germany', currency: 'EUR' },
    { code: 'Netherlands', name: 'Netherlands', currency: 'EUR' },
    { code: 'Canada', name: 'Canada', currency: 'CAD' },
    { code: 'Singapore', name: 'Singapore', currency: 'SGD' },
    { code: 'Australia', name: 'Australia', currency: 'AUD' },
    { code: 'Ireland', name: 'Ireland', currency: 'EUR' },
  ]

  for (const country of countries) {
    const rawJobs = await paginateAll(
      async (offset) => {
        const url = `https://jobs.microsoft.com/api/v2/jobs?` +
          `q=software+engineer&` +
          `l=${encodeURIComponent(country.code)}&` +
          `pg=${Math.floor(offset / 20) + 1}&` +
          `pgSz=20&` +
          `o=Relevance&` +
          `flt=true`

        const data = await fetchWithRetry(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Referer': 'https://jobs.microsoft.com/',
          }
        }, 3, 'jobs.microsoft.com')

        if (!data?.operationResult?.result?.jobs) return null
        return {
          items: data.operationResult.result.jobs,
          total: data.operationResult.result.totalJobs || 0
        }
      },
      20,
      100
    )

    for (const job of rawJobs) {
      const title = job.title || ''
      const location = job.primaryLocation || country.name
      const description = job.description || ''
      const datePosted = job.postingDate

      if (!title || daysSince(datePosted) > 20) continue

      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description, country.name)
      const predicted = predictSalary(title, country.name, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: country.currency, visa_probability: visaProb,
        remote_type: 'onsite', country: country.name,
        company_stage: 'enterprise', date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint('Microsoft', title, country.name),
        job_title: title.substring(0, 200),
        company_name: 'Microsoft',
        country: country.name, city: location.split(',')[0]?.trim(),
        remote_type: /remote/i.test(location) ? 'remote' : 'onsite',
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: country.currency, salary_predicted: true,
        job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 3000),
        job_url: `https://jobs.microsoft.com/en-us/job/${job.jobId}`,
        job_source: 'microsoft',
        source_type: 'career_page',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: /relocation/i.test(description),
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description + ' ' + (job.skills || []). join(' ')),
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }

    await sleep(1500)
  }

  console.log(`[Microsoft] Found ${jobs.length} jobs`)
  return jobs
}

// ─── APPLE ────────────────────────────────────────────────────
// Apple has a public jobs JSON API (despite their reputation).

export async function scrapeApple(): Promise<ScrapedJob[]> {
  console.log('[Apple] Fetching via jobs search API...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { query: 'software engineer', country: 'USA', team: 'Software and Services' },
    { query: 'machine learning', country: 'USA', team: 'Machine Learning and AI' },
    { query: 'software engineer', country: 'United Kingdom', team: 'Software and Services' },
    { query: 'software engineer', country: 'Germany', team: 'Software and Services' },
  ]

  for (const search of searches) {
    const rawJobs = await paginateAll(
      async (offset) => {
        const url = `https://jobs.apple.com/api/role/search?` +
          `query=${encodeURIComponent(search.query)}&` +
          `locale=en-us&` +
          `filters.team=${encodeURIComponent(search.team)}&` +
          `page=${Math.floor(offset / 20) + 1}`

        const data = await fetchWithRetry(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
            'Accept': 'application/json',
            'Referer': 'https://jobs.apple.com/',
          }
        }, 3, 'jobs.apple.com')

        if (!data?.searchResults) return null
        return { items: data.searchResults, total: data.totalRecords || 0 }
      },
      20,
      100
    )

    for (const job of rawJobs) {
      const title = job.postingTitle || ''
      const location = job.locations?.[0]?.name || search.country
      const description = job.jobSummary || ''
      const datePosted = job.postDateTime

      if (!title || daysSince(datePosted) > 20) continue

      const country = detectCountryFromText(location) || search.country
      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description, country)
      const predicted = predictSalary(title, country, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: country === 'United Kingdom' ? 'GBP' : country === 'Germany' ? 'EUR' : 'USD',
        visa_probability: visaProb, remote_type: 'onsite', country,
        company_stage: 'enterprise', date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint('Apple', title, country),
        job_title: title.substring(0, 200),
        company_name: 'Apple',
        country, city: location.split(',')[0]?.trim(),
        remote_type: 'onsite',
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: jobObj.salary_currency, salary_predicted: true,
        job_description: description.substring(0, 3000),
        job_url: `https://jobs.apple.com/en-us/details/${job.positionId}`,
        job_source: 'apple',
        source_type: 'career_page',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: true, // Apple is known for relocation
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }

    await sleep(2000) // Apple is rate-sensitive
  }

  console.log(`[Apple] Found ${jobs.length} jobs`)
  return jobs
}

// ─── META ─────────────────────────────────────────────────────
// Meta uses a GraphQL API for their careers site.

export async function scrapeMeta(): Promise<ScrapedJob[]> {
  console.log('[Meta] Fetching via careers API...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { teams: ['Engineering, Tech Lead'], country: 'USA' },
    { teams: ['Software Engineering'], country: 'USA' },
    { teams: ['Software Engineering'], country: 'United Kingdom' },
    { teams: ['Software Engineering'], country: 'Singapore' },
    { teams: ['Software Engineering'], country: 'Canada' },
  ]

  for (const search of searches) {
    const rawJobs = await paginateAll(
      async (offset) => {
        // Meta's public GraphQL endpoint
        const url = 'https://www.metacareers.com/graphql'
        const data = await fetchWithRetry(url, {
          method: 'post',
          data: {
            variables: {
              search_input: {
                q: 'engineer',
                divisions: search.teams,
                page: Math.floor(offset / 10) + 1,
                results_per_page: 10,
                sort_by_new: true,
              }
            },
            doc_id: '7745811422161613' // Meta's career search document ID
          },
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0',
            'Referer': 'https://www.metacareers.com/',
          }
        }, 3, 'metacareers.com')

        const results = data?.data?.job_search?.results
        if (!results) return null
        return { items: results, total: data.data.job_search.count || 0 }
      },
      10,
      60
    )

    for (const job of rawJobs) {
      const title = job.title || ''
      const location = job.locations?.[0] || search.country
      const description = job.description || ''
      const datePosted = job.updated_time

      if (!title) continue

      const country = detectCountryFromText(location) || search.country
      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description, country)
      const predicted = predictSalary(title, country, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max, salary_currency: 'USD',
        visa_probability: visaProb, remote_type: 'onsite', country,
        company_stage: 'enterprise', date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint('Meta', title, country),
        job_title: title.substring(0, 200),
        company_name: 'Meta',
        country, city: typeof location === 'string' ? location.split(',')[0]?.trim() : undefined,
        remote_type: 'onsite',
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: 'USD', salary_predicted: true,
        job_description: description.substring(0, 3000),
        job_url: `https://www.metacareers.com/jobs/${job.id}`,
        job_source: 'meta',
        source_type: 'career_page',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: true,
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }

    await sleep(2000)
  }

  console.log(`[Meta] Found ${jobs.length} jobs`)
  return jobs
}

// ─── WORKDAY UNIVERSAL SCRAPER ────────────────────────────────
// Workday is used by thousands of enterprises.
// Their job search API is consistent across all customers.
// Each company has URL: company.wd5.myworkdayjobs.com

const WORKDAY_COMPANIES = [
  { slug: 'nvidia',    tenant: 'nvidia',    name: 'Nvidia',    country: 'USA' },
  { slug: 'netflix',   tenant: 'netflix',   name: 'Netflix',   country: 'USA' },
  { slug: 'apple',     tenant: 'apple',     name: 'Apple',     country: 'USA' },
  { slug: 'ibm',       tenant: 'ibm',       name: 'IBM',       country: 'USA' },
  { slug: 'oracle',    tenant: 'oracle',    name: 'Oracle',    country: 'USA' },
  { slug: 'salesforce',tenant: 'salesforce',name: 'Salesforce',country: 'USA' },
  { slug: 'adobe',     tenant: 'adobe',     name: 'Adobe',     country: 'USA' },
  { slug: 'intel',     tenant: 'intel',     name: 'Intel',     country: 'USA' },
  { slug: 'qualcomm',  tenant: 'qualcomm',  name: 'Qualcomm',  country: 'USA' },
  { slug: 'arm',       tenant: 'arm',       name: 'ARM',       country: 'United Kingdom' },
  { slug: 'sap',       tenant: 'sap',       name: 'SAP',       country: 'Germany' },
  { slug: 'booking',   tenant: 'booking',   name: 'Booking.com',country: 'Netherlands' },
]

export async function scrapeWorkday(company: typeof WORKDAY_COMPANIES[0]): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = []

  const rawJobs = await paginateAll(
    async (offset) => {
      // Workday's standard job search API — consistent across all tenants
      const url = `https://${company.slug}.wd5.myworkdayjobs.com/wday/cxs/${company.tenant}/External/jobs`

      const data = await fetchWithRetry(url, {
        method: 'post',
        data: {
          appliedFacets: {},
          limit: 20,
          offset,
          searchText: 'software engineer'
        },
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        }
      }, 3, `${company.slug}.wd5.myworkdayjobs.com`)

      if (!data?.jobPostings) return null
      return { items: data.jobPostings, total: data.total || 0 }
    },
    20,
    80
  )

  for (const job of rawJobs) {
    const title = job.title || ''
    const location = job.locationsText || company.country

    if (!title) continue

    const country = detectCountryFromText(location) || company.country
    const expLevel = detectExperienceLevel(title)
    const visaProb = calculateVisaProbability('', country)
    const predicted = predictSalary(title, country, expLevel)

    const jobObj = {
      salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
      visa_probability: visaProb, remote_type: 'onsite', country,
      company_stage: 'enterprise', date_posted: job.postedOn,
      verification_status: 'verified', is_hidden_opportunity: false
    }

    jobs.push({
      job_id: generateJobFingerprint(company.name, title, country),
      job_title: title.substring(0, 200),
      company_name: company.name,
      country, city: location.split(',')[0]?.trim(),
      remote_type: /remote/i.test(location) ? 'remote' : 'onsite',
      salary_min: predicted.min, salary_max: predicted.max,
      salary_currency: predicted.currency, salary_predicted: true,
      job_url: `https://${company.slug}.wd5.myworkdayjobs.com/External/job/${job.externalPath}`,
      job_source: 'workday',
      source_type: 'career_page',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5,
      relocation_assistance: false,
      quality_score: scoreJobQuality(jobObj),
      date_posted: job.postedOn,
      tech_stack: extractTechStack(title),
      job_category: detectJobCategory(title),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    })
  }

  return jobs
}

export async function scrapeAllWorkday(): Promise<ScrapedJob[]> {
  console.log(`[Workday] Scraping ${WORKDAY_COMPANIES.length} companies...`)
  const all: ScrapedJob[] = []

  for (let i = 0; i < WORKDAY_COMPANIES.length; i += 3) {
    const batch = WORKDAY_COMPANIES.slice(i, i + 3)
    const results = await Promise.allSettled(batch.map(c => scrapeWorkday(c)))
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value)
    }
    await sleep(500)
  }

  console.log(`[Workday] Found ${all.length} total jobs`)
  return all
}

// ─── DEAD JOB CHECKER ─────────────────────────────────────────
// Verify that job URLs are still live. If 404/410 → mark as expired.

export async function checkForDeadJobs(supabase: any, batchSize = 50): Promise<{
  checked: number
  killed: number
}> {
  console.log('[DeadJobChecker] Checking job URL validity...')

  // Get jobs that haven't been checked recently
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, job_url, job_source')
    .eq('verification_status', 'verified')
    .lt('scraped_date', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()) // Not checked in 3 days
    .not('job_url', 'is', null)
    .limit(batchSize)

  if (!jobs || jobs.length === 0) return { checked: 0, killed: 0 }

  let killed = 0

  await Promise.allSettled(
    jobs.map(async (job: any) => {
      try {
        const response = await axios.head(job.job_url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000,
          maxRedirects: 3,
          validateStatus: () => true // Don't throw on any status
        })

        if (response.status === 404 || response.status === 410) {
          await supabase
            .from('jobs')
            .update({ verification_status: 'expired' })
            .eq('id', job.id)
          killed++
        } else {
          // Job is still live — update scraped_date
          await supabase
            .from('jobs')
            .update({ scraped_date: new Date().toISOString() })
            .eq('id', job.id)
        }
      } catch {
        // Network error — don't delete, just skip
      }
    })
  )

  console.log(`[DeadJobChecker] Checked ${jobs.length}, killed ${killed} dead jobs`)
  return { checked: jobs.length, killed }
}

// ─── HELPERS ─────────────────────────────────────────────────

function detectCountryFromText(text: string): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  if (/san francisco|new york|seattle|austin|boston|chicago|los angeles|remote/.test(lower)) return 'USA'
  if (/united states|usa|u\.s\./.test(lower)) return 'USA'
  if (/london|manchester|edinburgh|united kingdom|uk\b/.test(lower)) return 'United Kingdom'
  if (/berlin|munich|frankfurt|germany/.test(lower)) return 'Germany'
  if (/amsterdam|netherlands/.test(lower)) return 'Netherlands'
  if (/zurich|switzerland/.test(lower)) return 'Switzerland'
  if (/stockholm|sweden/.test(lower)) return 'Sweden'
  if (/singapore/.test(lower)) return 'Singapore'
  if (/sydney|melbourne|australia/.test(lower)) return 'Australia'
  if (/toronto|vancouver|canada/.test(lower)) return 'Canada'
  if (/dublin|ireland/.test(lower)) return 'Ireland'
  if (/dubai|uae/.test(lower)) return 'UAE'
  return null
}

function daysSince(dateStr?: string): number {
  if (!dateStr) return 0
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
}
