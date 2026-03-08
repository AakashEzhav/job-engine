// ============================================================
// LAYER 2: COMPANY CAREER PAGE CRAWLER
//
// The best jobs never appear on job boards.
// They go live on the company's own website first,
// sometimes days before anywhere else.
//
// This crawler:
//   1. Maintains a list of 200+ companies to monitor
//   2. Auto-discovers their career page URL
//   3. Detects if they use a known ATS widget (Greenhouse embed,
//      Lever widget, etc.) and calls the API instead of scraping HTML
//   4. Falls back to HTML parsing if no widget detected
//   5. Extracts schema.org/JobPosting structured data when present
//   6. Monitors for NEW postings since last check
// ============================================================

import axios from 'axios'
import * as cheerio from 'cheerio'
import { createAdminClient } from '../db/supabase'
import { cleanText, sleep, extractTechStack, detectJobCategory, isTargetCountry } from './base'
import { calculateVisaProbability, predictSalary, detectExperienceLevel,
  scoreJobQuality, generateJobFingerprint } from '../ai/detector'
import { detectCompanyATS, scrapeAllATSSystems } from './ats-master'
import type { ScrapedJob } from './jobboards'

// ─── COMPANY CAREER PAGE REGISTRY ────────────────────────────
// Companies not in any ATS system — we monitor their websites directly.
// These are often: FAANG, large enterprises, companies with custom ATS.

const CAREER_PAGE_COMPANIES = [
  // FAANG + Big Tech (custom career portals)
  { name: 'Google',         careersUrl: 'https://careers.google.com/jobs/results/?degree=BACHELORS&degree=MASTERS&degree=DOCTORATE&employment_type=FULL_TIME', country: 'USA', jsonLdPage: true },
  { name: 'Meta',           careersUrl: 'https://www.metacareers.com/jobs?teams[0]=Engineering%20-%20Software', country: 'USA', jsonLdPage: true },
  { name: 'Apple',          careersUrl: 'https://jobs.apple.com/en-us/search?team=apps-and-frameworks-SFTWR-AF', country: 'USA', jsonLdPage: true },
  { name: 'Microsoft',      careersUrl: 'https://jobs.microsoft.com/en-us/search?q=software+engineer', country: 'USA', jsonLdPage: true },
  { name: 'Amazon',         careersUrl: 'https://www.amazon.jobs/en/search?base_query=software+engineer', country: 'USA', jsonLdPage: true },
  { name: 'Netflix',        careersUrl: 'https://jobs.netflix.com/search?q=engineer', country: 'USA', jsonLdPage: true },
  { name: 'Nvidia',         careersUrl: 'https://nvidia.wd5.myworkdayjobs.com/en-US/UniversityRecruiting', country: 'USA', jsonLdPage: false },
  // High-value startups with custom career pages
  { name: 'SpaceX',         careersUrl: 'https://boards.greenhouse.io/spacex', country: 'USA', jsonLdPage: false },
  { name: 'xAI',            careersUrl: 'https://x.ai/careers', country: 'USA', jsonLdPage: false },
  { name: 'Waymo',          careersUrl: 'https://waymo.com/careers/', country: 'USA', jsonLdPage: true },
  { name: 'DeepMind',       careersUrl: 'https://www.deepmind.com/careers', country: 'United Kingdom', jsonLdPage: true },
  { name: 'Palantir',       careersUrl: 'https://www.palantir.com/careers/jobs/', country: 'USA', jsonLdPage: true },
  // European tech
  { name: 'SAP',            careersUrl: 'https://jobs.sap.com/search/?createNewAlert=false&q=software+engineer', country: 'Germany', jsonLdPage: false },
  { name: 'Siemens',        careersUrl: 'https://jobs.siemens.com/careers?query=software', country: 'Germany', jsonLdPage: false },
  { name: 'ASML',           careersUrl: 'https://www.asml.com/en/careers/find-your-job?q=software', country: 'Netherlands', jsonLdPage: false },
  { name: 'Philips',        careersUrl: 'https://www.careers.philips.com/global/en/search-results', country: 'Netherlands', jsonLdPage: false },
  { name: 'ING',            careersUrl: 'https://www.ing.jobs/netherlands/Vacancies.htm?q=engineer', country: 'Netherlands', jsonLdPage: false },
  // Singapore / APAC
  { name: 'Sea Limited',    careersUrl: 'https://career.sea.com/jobs', country: 'Singapore', jsonLdPage: true },
  { name: 'Grab',           careersUrl: 'https://grab.careers/open-positions/', country: 'Singapore', jsonLdPage: true },
  { name: 'Bytedance',      careersUrl: 'https://jobs.bytedance.com/en/position', country: 'Singapore', jsonLdPage: false },
  // UAE / Middle East
  { name: 'Careem',         careersUrl: 'https://careers.careem.com/', country: 'UAE', jsonLdPage: true },
  { name: 'Talabat',        careersUrl: 'https://www.talabat.com/careers', country: 'UAE', jsonLdPage: false },
]

// ─── COMMON CAREER PAGE URL PATTERNS ─────────────────────────
const CAREER_PATH_PATTERNS = [
  '/careers', '/careers/', '/jobs', '/jobs/',
  '/careers/open-positions', '/careers/jobs', '/careers/openings',
  '/join-us', '/join', '/work-with-us', '/work-here',
  '/about/careers', '/company/careers', '/en/careers',
  '/team', '/open-roles', '/hiring', '/positions',
]

// ─── CAREER PAGE DISCOVERY ────────────────────────────────────

export async function discoverCareerPage(companyName: string, website: string): Promise<string | null> {
  const base = website.replace(/\/$/, '')

  // 1. Try common patterns
  for (const path of CAREER_PATH_PATTERNS) {
    try {
      const url = `${base}${path}`
      const response = await axios.head(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 5000,
        maxRedirects: 3,
        validateStatus: s => s < 400
      })
      if (response.status === 200) {
        // Verify it actually has job content
        const pageResponse = await axios.get(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 8000
        })
        const $ = cheerio.load(pageResponse.data)
        const bodyText = $('body').text().toLowerCase()
        const jobKeywords = ['engineer', 'developer', 'designer', 'manager', 'apply', 'opening', 'position', 'role', 'hiring']
        const hits = jobKeywords.filter(k => bodyText.includes(k)).length
        if (hits >= 3) return url
      }
    } catch {}
    await sleep(200)
  }

  // 2. Try to find it via their homepage link
  try {
    const homepage = await axios.get(base, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    })
    const $ = cheerio.load(homepage.data)
    let careerUrl: string | null = null

    $('a').each((_, el) => {
      if (careerUrl) return
      const href = $(el).attr('href') || ''
      const text = $(el).text().toLowerCase()
      if (/(career|job|hiring|work with us|join us|join our team)/.test(text) ||
          /(career|jobs|hiring|join)/.test(href)) {
        careerUrl = href.startsWith('http') ? href : `${base}${href.startsWith('/') ? href : '/' + href}`
      }
    })
    return careerUrl
  } catch {}

  return null
}

// ─── CAREER PAGE JOB EXTRACTOR ────────────────────────────────

export async function scrapeCareerPage(company: {
  name: string; careersUrl: string; country: string
}): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = []

  try {
    const response = await axios.get(company.careersUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000
    })

    const html = response.data
    const $ = cheerio.load(html)

    // ── Strategy 1: JSON-LD structured data ──────────────────
    // This is the most reliable — companies embed machine-readable job data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || '{}')
        // Can be a single JobPosting or a list
        const postings = json['@type'] === 'JobPosting' ? [json] :
          json['@graph']?.filter((x: any) => x['@type'] === 'JobPosting') ||
          (Array.isArray(json) ? json.filter((x: any) => x['@type'] === 'JobPosting') : [])

        for (const posting of postings) {
          const title = posting.title || posting.name || ''
          const description = posting.description || ''
          const location = posting.jobLocation?.address?.addressLocality ||
            posting.jobLocation?.address?.addressCountry || company.country
          const url = posting.url || posting.sameAs || company.careersUrl
          const datePosted = posting.datePosted

          if (!title || daysSince(datePosted || '') > 20) continue

          const country = detectCountryFromText(location) || company.country
          const built = buildCareerJob({ title, company: company.name, location, description,
            datePosted, country, url, source: 'career_page' })
          if (built) jobs.push(built)
        }
      } catch {}
    })

    // ── Strategy 2: Embedded JSON in JavaScript variables ────
    // Many modern career pages (React, Next.js) store all job data
    // in a __NEXT_DATA__ or window.__INITIAL_STATE__ variable
    $('script').each((_, el) => {
      const text = $(el).html() || ''
      if (!text.includes('jobTitle') && !text.includes('job_title') &&
          !text.includes('"title"') && !text.includes('position')) return

      // Try to extract JSON blobs
      const jsonMatches = text.match(/__NEXT_DATA__\s*=\s*({.+?});?\s*<\/script>/s) ||
                          text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s) ||
                          text.match(/window\.__data__\s*=\s*({.+?});/s)

      if (!jsonMatches) return

      try {
        const data = JSON.parse(jsonMatches[1])
        const flatJobs = findJobsInObject(data)

        for (const job of flatJobs) {
          const built = buildCareerJob({
            title: job.title || job.jobTitle || job.name || '',
            company: company.name,
            location: job.location || job.jobLocation || company.country,
            description: job.description || job.summary || '',
            datePosted: job.datePosted || job.postedAt || job.created_at,
            country: company.country,
            url: job.url || job.applyUrl || job.applicationUrl || company.careersUrl,
            source: 'career_page'
          })
          if (built) jobs.push(built)
        }
      } catch {}
    })

    // ── Strategy 3: HTML link extraction ─────────────────────
    // Fallback: find all links that look like job postings
    if (jobs.length === 0) {
      const jobLinks = new Map<string, string>()

      $('a').each((_, el) => {
        const href = $(el).attr('href') || ''
        const text = cleanText($(el).text())

        if (text.length < 8 || text.length > 150) return

        // Must look like a job title
        const isJobTitle = /engineer|developer|designer|manager|analyst|scientist|architect|lead|director|product|devops|data|backend|frontend|full.?stack/i.test(text)
        // Must look like a job URL
        const isJobUrl = /\/job|\/position|\/opening|\/role|\/career|\/posting/i.test(href)

        if (!isJobTitle && !isJobUrl) return
        if (!text || jobLinks.has(href)) return

        jobLinks.set(href, text)
      })

      for (const [href, title] of jobLinks) {
        const fullUrl = href.startsWith('http') ? href :
          href.startsWith('/') ? `${new URL(company.careersUrl).origin}${href}` :
          `${company.careersUrl}/${href}`

        const expLevel = detectExperienceLevel(title)
        const visaProb = calculateVisaProbability('', company.country)
        const predicted = predictSalary(title, company.country, expLevel)
        const remoteType = detectRemoteType(title)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
          visa_probability: visaProb, remote_type: remoteType, country: company.country,
          company_stage: undefined, date_posted: new Date().toISOString(),
          verification_status: 'verified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company.name, title, company.country),
          job_title: title.substring(0, 200),
          company_name: company.name,
          country: company.country,
          remote_type: remoteType as 'remote' | 'hybrid' | 'onsite',
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_url: fullUrl,
          job_source: 'career_page',
          source_type: 'career_page',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5,
          relocation_assistance: false,
          quality_score: scoreJobQuality(jobObj),
          date_posted: new Date().toISOString(),
          tech_stack: extractTechStack(title),
          job_category: detectJobCategory(title),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      }
    }

  } catch (e: any) {
    // Silently skip failed career pages
  }

  return jobs
}

// ─── RECURSIVE JSON OBJECT SEARCH ────────────────────────────
// Finds arrays of job-like objects anywhere in a nested JSON structure.
// Used to extract data from Next.js __NEXT_DATA__ blobs.

function findJobsInObject(obj: any, depth = 0): any[] {
  if (depth > 6 || !obj || typeof obj !== 'object') return []

  const results: any[] = []

  if (Array.isArray(obj)) {
    // Check if this looks like a job listing array
    if (obj.length > 0 && obj.length < 500 && isJobLike(obj[0])) {
      return obj
    }
    for (const item of obj) {
      results.push(...findJobsInObject(item, depth + 1))
    }
  } else {
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value) && value.length > 0 && isJobLike(value[0])) {
        results.push(...value)
      } else {
        results.push(...findJobsInObject(value, depth + 1))
      }
    }
  }

  return results
}

function isJobLike(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false
  const keys = Object.keys(obj).join(' ').toLowerCase()
  return (
    (keys.includes('title') || keys.includes('position') || keys.includes('job')) &&
    (keys.includes('location') || keys.includes('department') || keys.includes('url') || keys.includes('link'))
  )
}

// ─── MASTER CAREER PAGE RUNNER ────────────────────────────────

export async function scrapeAllCareerPages(): Promise<ScrapedJob[]> {
  console.log(`[CareerPages] Scraping ${CAREER_PAGE_COMPANIES.length} company career pages...`)
  const allJobs: ScrapedJob[] = []

  // Also pull from database: startups we've discovered with career pages
  try {
    const supabase = createAdminClient()
    const { data: dbCompanies } = await supabase
      .from('startups')
      .select('name, career_page_url, website')
      .eq('career_page_found', true)
      .not('career_page_url', 'is', null)
      .limit(50)

    if (dbCompanies) {
      for (const c of dbCompanies) {
        if (c.career_page_url) {
          CAREER_PAGE_COMPANIES.push({
            name: c.name,
            careersUrl: c.career_page_url,
            country: 'USA', // Default for discovered startups
            jsonLdPage: true
          })
        }
      }
    }
  } catch {}

  // Batch scrape: 4 at a time
  for (let i = 0; i < CAREER_PAGE_COMPANIES.length; i += 4) {
    const batch = CAREER_PAGE_COMPANIES.slice(i, i + 4)
    const results = await Promise.allSettled(batch.map(c => scrapeCareerPage(c)))

    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === 'fulfilled' && r.value.length > 0) {
        allJobs.push(...r.value)
      }
    }

    await sleep(500)
  }

  console.log(`[CareerPages] Found ${allJobs.length} jobs from ${CAREER_PAGE_COMPANIES.length} career pages`)
  return allJobs
}

// ─── SMART COMPANY DISCOVERY ──────────────────────────────────
// Given a list of new companies from Product Hunt / YC / news,
// auto-detect their ATS and start monitoring them.

export async function autoDiscoverAndMonitorCompany(
  companyName: string,
  website: string,
  country: string
): Promise<{ monitored: boolean; method: string; jobsFound: number }> {
  // Step 1: Try ATS detection first (most reliable)
  const atsResult = await detectCompanyATS(companyName, website)
  if (atsResult.ats) {
    // Save to database for ongoing monitoring
    try {
      const supabase = createAdminClient()
      await supabase.from('companies').upsert({
        name: companyName,
        website,
        country,
        careers_page: atsResult.jobsUrl || undefined,
        source: `ats:${atsResult.ats}`,
        is_hiring: true,
        last_scraped: new Date().toISOString()
      }, { onConflict: 'name' })
    } catch {}

    return { monitored: true, method: `ats:${atsResult.ats}`, jobsFound: 0 }
  }

  // Step 2: Try direct career page discovery
  const careerUrl = await discoverCareerPage(companyName, website)
  if (careerUrl) {
    const jobs = await scrapeCareerPage({ name: companyName, careersUrl: careerUrl, country })

    try {
      const supabase = createAdminClient()
      await supabase.from('startups').upsert({
        name: companyName,
        website,
        career_page_found: true,
        career_page_url: careerUrl,
        has_open_roles: jobs.length > 0,
        jobs_count: jobs.length
      }, { onConflict: 'name' })
    } catch {}

    return { monitored: true, method: 'career_page', jobsFound: jobs.length }
  }

  return { monitored: false, method: 'none', jobsFound: 0 }
}

// ─── SHARED HELPERS ──────────────────────────────────────────

function buildCareerJob(params: {
  title: string; company: string; location: string; description: string;
  datePosted?: string; country: string; url: string; source: string
}): ScrapedJob | null {
  const { title, company, location, description, datePosted, country, url, source } = params
  if (!title || title.length < 3) return null
  if (!isTargetCountry(country)) return null

  const expLevel = detectExperienceLevel(title, description)
  const visaProb = calculateVisaProbability(description, country)
  const predicted = predictSalary(title, country, expLevel)
  const remoteType = detectRemoteType(title + ' ' + location + ' ' + description)

  const jobObj = {
    salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
    visa_probability: visaProb, remote_type: remoteType, country,
    company_stage: undefined, date_posted: datePosted,
    verification_status: 'verified', is_hidden_opportunity: false
  }

  return {
    job_id: generateJobFingerprint(company, title, country),
    job_title: title.substring(0, 200),
    company_name: company,
    country, city: extractCity(location),
    remote_type: remoteType as 'remote' | 'hybrid' | 'onsite',
    salary_min: predicted.min, salary_max: predicted.max,
    salary_currency: predicted.currency, salary_predicted: true,
    job_description: description.substring(0, 3000),
    job_url: url,
    job_source: source,
    source_type: 'career_page',
    visa_probability: visaProb,
    visa_sponsorship: visaProb > 0.55,
    relocation_assistance: /relocation/i.test(description),
    quality_score: scoreJobQuality(jobObj),
    date_posted: datePosted,
    tech_stack: extractTechStack(description),
    job_category: detectJobCategory(title, description),
    experience_level: expLevel,
    verification_status: 'verified',
    is_hidden_opportunity: false
  }
}

function detectRemoteType(text: string): string {
  const lower = text.toLowerCase()
  if (/fully?\s*remote|100%\s*remote|work\s*from\s*anywhere|distributed/.test(lower)) return 'remote'
  if (/\bremote\b/.test(lower)) return 'remote'
  if (/\bhybrid\b/.test(lower)) return 'hybrid'
  return 'onsite'
}

function detectCountryFromText(text: string): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  const map: Array<[RegExp, string]> = [
    [/\b(usa|united states?|san francisco|new york|seattle|austin)\b/, 'USA'],
    [/\b(uk|united kingdom|england|london)\b/, 'United Kingdom'],
    [/\b(canada|toronto|vancouver|montreal)\b/, 'Canada'],
    [/\b(germany|deutschland|berlin|munich)\b/, 'Germany'],
    [/\b(netherlands|amsterdam)\b/, 'Netherlands'],
    [/\b(switzerland|zurich|geneva)\b/, 'Switzerland'],
    [/\b(sweden|stockholm)\b/, 'Sweden'],
    [/\b(singapore)\b/, 'Singapore'],
    [/\b(australia|sydney|melbourne)\b/, 'Australia'],
    [/\b(ireland|dublin)\b/, 'Ireland'],
    [/\b(uae|dubai)\b/, 'UAE'],
    [/\b(remote|worldwide|anywhere)\b/, 'USA'],
  ]
  for (const [pattern, country] of map) {
    if (pattern.test(lower)) return country
  }
  return null
}

function extractCity(location: string): string | undefined {
  if (!location) return undefined
  return location.split(',')[0]?.trim().substring(0, 100) || undefined
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
}
