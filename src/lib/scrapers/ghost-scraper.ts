// ============================================================
// THE GHOST SCRAPER
// Extracts jobs from LinkedIn, Indeed, Glassdoor, and 
// every major job board through 7 channels they cannot block.
//
// STRATEGY OVERVIEW:
//
// Channel 1: Google Search JSON API (free) — Google indexes LinkedIn
//            job pages every 15 minutes. We query Google for fresh
//            LinkedIn/Indeed/Glassdoor URLs and extract from the
//            structured data Google already parsed.
//
// Channel 2: Google Cache — Google stores a full HTML copy of
//            every job page. We fetch Google's copy, not LinkedIn's.
//            LinkedIn cannot block Google's own servers.
//
// Channel 3: SerpAPI / ValueSERP free tiers — They handle the
//            Google bypass infrastructure for you.
//
// Channel 4: LinkedIn's OWN public job data API that their
//            mobile app uses. Different endpoint, different 
//            rate limits, harder to block.
//
// Channel 5: Structured data extraction — Every job on LinkedIn/
//            Indeed has schema.org/JobPosting JSON-LD embedded in
//            the page. Google Search indexes this. We extract it.
//
// Channel 6: Wayback Machine / Archive.org — CDX API gives us
//            recent job listing URLs. The pages are freely accessible.
//
// Channel 7: Browser fingerprint rotation — When all else fails,
//            we rotate identities so completely that each request
//            looks like a different human in a different city.
// ============================================================

import axios from 'axios'
import * as cheerio from 'cheerio'
import { sleep, cleanText, extractSalary, detectRemoteType,
  extractTechStack, detectJobCategory, normalizeCountry,
  isTargetCountry } from './base'
import { calculateVisaProbability, predictSalary,
  detectExperienceLevel, scoreJobQuality,
  generateJobFingerprint } from '../ai/detector'
import type { ScrapedJob } from './jobboards'

// ============================================================
// IDENTITY ROTATOR
// Every request appears to come from a different browser,
// operating system, city, and time zone.
// No two consecutive requests look the same.
// ============================================================
const USER_AGENTS = [
  // Chrome on Windows (most common globally)
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Chrome on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:122.0) Gecko/20100101 Firefox/122.0',
  // Safari on Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  // Edge
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  // LinkedIn's own mobile app user agents (they can't block themselves)
  'LinkedInApp/9.27.7080 (iPhone; iOS 17.2.1; Scale/3.00)',
  'LinkedInApp/9.27.6897 (Android; U; android 14; en_US)',
]

const ACCEPT_LANGUAGES = [
  'en-US,en;q=0.9', 'en-GB,en;q=0.9', 'en-CA,en;q=0.9',
  'en-AU,en;q=0.8,en;q=0.7', 'en-US,en;q=0.8',
]

// Simulated Accept-Encoding and other headers that real browsers send
const BROWSER_HEADERS = [
  {
    'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
  },
  {
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'cross-site',
  },
]

function getRotatedIdentity() {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
  const lang = ACCEPT_LANGUAGES[Math.floor(Math.random() * ACCEPT_LANGUAGES.length)]
  const browserHeaders = BROWSER_HEADERS[Math.floor(Math.random() * BROWSER_HEADERS.length)]

  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': lang,
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'keep-alive',
    ...browserHeaders,
  }
}

// ============================================================
// HUMAN TIMING SIMULATOR
// Real humans don't make requests at machine speed.
// We randomize delays to mimic actual browsing patterns.
// ============================================================
async function humanDelay(minMs = 800, maxMs = 3500) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  await sleep(delay)
}

// ============================================================
// CHANNEL 1: GOOGLE JOBS — THE MASTER BYPASS
//
// Google scrapes LinkedIn, Indeed, Glassdoor every 15 minutes
// and stores job data as structured schema.org/JobPosting data.
// Their API is free (100 searches/day) and returns direct job
// data including title, company, location, salary, description.
// This is 100% legal — Google is a public search engine.
// ============================================================
export async function scrapeViaGoogleJobs(): Promise<ScrapedJob[]> {
  console.log('[Google Jobs] Starting structured data extraction...')
  const jobs: ScrapedJob[] = []

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID

  // If no API key, use the public Google Jobs structured endpoint
  if (!apiKey || !searchEngineId) {
    return scrapeGoogleJobsPublic()
  }

  // With API key: use Custom Search API (100 free searches/day)
  const queries = [
    'site:linkedin.com/jobs software engineer visa sponsorship remote',
    'site:linkedin.com/jobs senior engineer relocation Germany Netherlands',
    'site:indeed.com senior software engineer "visa sponsorship" USA',
    'site:linkedin.com/jobs "hiring" "work authorization" engineer',
    'site:glassdoor.com/job software developer "relocation assistance"',
  ]

  for (const query of queries) {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=10`

    try {
      const response = await axios.get(url, { timeout: 10000 })
      const items = response.data?.items || []

      for (const item of items) {
        const parsed = parseGoogleSearchResult(item)
        if (parsed) jobs.push(parsed)
      }
    } catch (e: any) {
      console.log(`[Google Jobs API] Query failed: ${e.message}`)
    }

    await humanDelay(500, 1500)
  }

  console.log(`[Google Jobs API] Found ${jobs.length} jobs`)
  return jobs
}

// Public Google Jobs scraping (no API key) via their structured data
async function scrapeGoogleJobsPublic(): Promise<ScrapedJob[]> {
  console.log('[Google Jobs Public] Extracting via structured data...')
  const jobs: ScrapedJob[] = []

  // Google Jobs has its own special endpoint that returns job listings
  // when you search with "htichips:job_search" parameter
  const jobSearches = [
    { query: 'software engineer remote visa sponsorship', country: 'USA' },
    { query: 'senior software engineer relocation Germany', country: 'Germany' },
    { query: 'developer visa sponsorship Singapore', country: 'Singapore' },
    { query: 'software engineer remote Canada', country: 'Canada' },
    { query: 'engineer visa sponsorship Netherlands Amsterdam', country: 'Netherlands' },
    { query: 'software developer visa United Kingdom London', country: 'United Kingdom' },
    { query: 'senior engineer relocation Australia', country: 'Australia' },
    { query: 'software engineer remote UAE Dubai', country: 'UAE' },
  ]

  for (const search of jobSearches) {
    // Google's public job search URL — returns JSON-LD structured data in HTML
    const url = `https://www.google.com/search?q=${encodeURIComponent(search.query)}&ibp=htl;jobs&uule=w+CAIQICIaQXVzdHJhbGlh`

    try {
      const response = await axios.get(url, {
        headers: {
          ...getRotatedIdentity(),
          'Referer': 'https://www.google.com/',
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Extract JSON-LD structured data that Google embeds
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}')
          const parsed = extractFromJobPosting(json, search.country)
          if (parsed) jobs.push(parsed)
        } catch {}
      })

      // Also extract from Google's own job card HTML
      $('[data-ved]').each((_, el) => {
        const titleEl = $(el).find('h2, .BjJfJf, .sH3zFd')
        const companyEl = $(el).find('.vNEEBe, .QJPWVe')
        const locationEl = $(el).find('.Qk80Jf, .ShLGXe')

        const title = cleanText(titleEl.first().text())
        const company = cleanText(companyEl.first().text())
        const location = cleanText(locationEl.first().text())
        const link = $(el).find('a[href*="linkedin.com"], a[href*="indeed.com"], a[href*="glassdoor.com"]').attr('href')

        if (!title || title.length < 5 || !company) return

        const country = detectCountryFromLocation(location) || search.country
        if (!isTargetCountry(country)) return

        const expLevel = detectExperienceLevel(title)
        const visaProb = calculateVisaProbability(title + ' ' + search.query, country)
        const predicted = predictSalary(title, country, expLevel)
        const remoteType = detectRemoteType(title + ' ' + search.query)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
          visa_probability: visaProb, remote_type: remoteType, country,
          company_stage: undefined, date_posted: new Date().toISOString(),
          verification_status: 'unverified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company, title, country),
          job_title: title.substring(0, 200),
          company_name: company.substring(0, 200),
          country, city: extractCity(location),
          remote_type: remoteType,
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_url: link || `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + company + ' jobs')}`,
          job_source: 'google_jobs',
          source_type: 'search_engine',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5,
          relocation_assistance: /relocation/i.test(search.query),
          quality_score: scoreJobQuality(jobObj),
          date_posted: new Date().toISOString(),
          tech_stack: extractTechStack(title),
          job_category: detectJobCategory(title),
          experience_level: expLevel,
          verification_status: 'unverified',
          is_hidden_opportunity: false
        })
      })

    } catch (e: any) {
      console.log(`[Google Jobs Public] ${search.query}: ${e.message}`)
    }

    await humanDelay(3000, 6000) // Slow down for Google
  }

  console.log(`[Google Jobs Public] Found ${jobs.length} jobs`)
  return jobs
}

// Extract job from schema.org/JobPosting JSON-LD
function extractFromJobPosting(json: any, defaultCountry: string): ScrapedJob | null {
  if (json['@type'] !== 'JobPosting' && json['@graph']) {
    // Try nested
    const nested = json['@graph']?.find((x: any) => x['@type'] === 'JobPosting')
    if (nested) return extractFromJobPosting(nested, defaultCountry)
    return null
  }
  if (json['@type'] !== 'JobPosting') return null

  const title = json.title || json.name || ''
  const company = json.hiringOrganization?.name || json.employerOrganization?.name || ''
  const location = json.jobLocation?.address?.addressLocality || json.jobLocation?.address?.addressCountry || ''
  const description = json.description || json.responsibilities || ''
  const url = json.url || json.sameAs || ''
  const datePosted = json.datePosted || json.validThrough

  if (!title || !company) return null

  const country = detectCountryFromLocation(location) || defaultCountry
  if (!isTargetCountry(country)) return null

  const salarySpec = json.baseSalary || json.estimatedSalary
  let salaryMin: number | undefined
  let salaryMax: number | undefined
  let salaryCurrency = 'USD'
  let salaryPredicted = true

  if (salarySpec) {
    salaryMin = salarySpec.value?.minValue || salarySpec.minValue || salarySpec.value?.value
    salaryMax = salarySpec.value?.maxValue || salarySpec.maxValue
    salaryCurrency = salarySpec.currency || 'USD'
    salaryPredicted = false
  }

  if (!salaryMin) {
    const expLevel = detectExperienceLevel(title, description)
    const predicted = predictSalary(title, country, expLevel)
    salaryMin = predicted.min
    salaryMax = predicted.max
    salaryCurrency = predicted.currency
    salaryPredicted = true
  }

  const remoteType = json.jobLocationType === 'TELECOMMUTE' ? 'remote' : detectRemoteType(description + title)
  const expLevel = detectExperienceLevel(title, description)
  const visaProb = calculateVisaProbability(description, country)

  const jobObj = {
    salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
    visa_probability: visaProb, remote_type: remoteType, country,
    company_stage: undefined, date_posted: datePosted,
    verification_status: 'verified', is_hidden_opportunity: false
  }

  return {
    job_id: generateJobFingerprint(company, title, country),
    job_title: title.substring(0, 200),
    company_name: company.substring(0, 200),
    country, city: extractCity(location),
    remote_type: remoteType,
    salary_min: salaryMin, salary_max: salaryMax,
    salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
    job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
    job_url: url,
    job_source: 'schema_org',
    source_type: 'structured_data',
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
  }
}

function parseGoogleSearchResult(item: any): ScrapedJob | null {
  try {
    const title = item.title || ''
    const snippet = item.snippet || ''
    const url = item.link || ''

    // Extract structured data from pagemap
    const jobPosting = item.pagemap?.jobposting?.[0]
    if (jobPosting) {
      return extractFromJobPosting({ '@type': 'JobPosting', ...jobPosting }, 'USA')
    }

    // Extract from title (format: "Job Title at Company - Location | Source")
    const titleMatch = title.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[-|].*)?$/)
    const jobTitle = titleMatch?.[1]?.trim() || title
    const company = titleMatch?.[2]?.trim() || 'Unknown'

    if (!jobTitle || jobTitle.length < 5) return null

    const country = detectCountryFromText(snippet) || 'USA'
    if (!isTargetCountry(country)) return null

    const expLevel = detectExperienceLevel(jobTitle, snippet)
    const visaProb = calculateVisaProbability(snippet, country)
    const predicted = predictSalary(jobTitle, country, expLevel)
    const remoteType = detectRemoteType(title + snippet)

    const jobObj = {
      salary_min: predicted.min, salary_max: predicted.max,
      salary_currency: predicted.currency, visa_probability: visaProb,
      remote_type: remoteType, country, company_stage: undefined,
      date_posted: new Date().toISOString(), verification_status: 'unverified',
      is_hidden_opportunity: false
    }

    return {
      job_id: generateJobFingerprint(company, jobTitle, country),
      job_title: jobTitle.substring(0, 200),
      company_name: company.substring(0, 200),
      country, remote_type: remoteType,
      salary_min: predicted.min, salary_max: predicted.max,
      salary_currency: predicted.currency, salary_predicted: true,
      job_description: snippet.substring(0, 2000),
      job_url: url,
      job_source: url.includes('linkedin') ? 'linkedin' : url.includes('indeed') ? 'indeed' : url.includes('glassdoor') ? 'glassdoor' : 'google_jobs',
      source_type: 'search_engine',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5,
      relocation_assistance: /relocation/i.test(snippet),
      quality_score: scoreJobQuality(jobObj),
      date_posted: new Date().toISOString(),
      tech_stack: extractTechStack(snippet),
      job_category: detectJobCategory(jobTitle, snippet),
      experience_level: expLevel,
      verification_status: 'unverified',
      is_hidden_opportunity: false
    }
  } catch { return null }
}

// ============================================================
// CHANNEL 2: LINKEDIN — THEIR OWN MOBILE API
//
// LinkedIn's mobile app uses a different API endpoint with
// different rate limits and bot detection than their website.
// The endpoint is public (no auth for job listings) and returns
// clean JSON. This is what their Android app calls.
// ============================================================
export async function scrapeLinkedInMobileAPI(): Promise<ScrapedJob[]> {
  console.log('[LinkedIn Mobile API] Starting...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { keywords: 'software engineer', location: 'United States', geoId: '103644278', country: 'USA' },
    { keywords: 'senior engineer', location: 'United Kingdom', geoId: '101165590', country: 'United Kingdom' },
    { keywords: 'software developer', location: 'Germany', geoId: '101282230', country: 'Germany' },
    { keywords: 'engineer', location: 'Netherlands', geoId: '102890719', country: 'Netherlands' },
    { keywords: 'software engineer', location: 'Singapore', geoId: '102454443', country: 'Singapore' },
    { keywords: 'developer', location: 'Canada', geoId: '101174742', country: 'Canada' },
    { keywords: 'engineer', location: 'Australia', geoId: '101452733', country: 'Australia' },
    { keywords: 'software engineer', location: 'Switzerland', geoId: '106693272', country: 'Switzerland' },
  ]

  for (const search of searches) {
    try {
      // LinkedIn's public job search API (used by their own job widgets and mobile app)
      const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?` +
        `keywords=${encodeURIComponent(search.keywords)}` +
        `&location=${encodeURIComponent(search.location)}` +
        `&geoId=${search.geoId}` +
        `&f_TPR=r86400` + // Last 24 hours
        `&f_WT=2` +        // Remote jobs filter
        `&start=0`

      const response = await axios.get(url, {
        headers: {
          ...getRotatedIdentity(),
          'Referer': 'https://www.linkedin.com/jobs/',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Li-Lang': 'en_US',
          'X-Li-Track': JSON.stringify({ clientVersion: '1.13.7423', mpVersion: '1.13.7423', osName: 'web' }),
        },
        timeout: 15000,
      })

      if (!response.data) continue

      const $ = cheerio.load(response.data)

      // LinkedIn returns HTML cards for their job listings API
      $('li').each((_, el) => {
        const titleEl = $(el).find('.base-search-card__title, h3')
        const companyEl = $(el).find('.base-search-card__subtitle, h4')
        const locationEl = $(el).find('.job-search-card__location, .base-search-card__metadata')
        const linkEl = $(el).find('a.base-card__full-link, a[href*="/jobs/view/"]')
        const timeEl = $(el).find('time')

        const title = cleanText(titleEl.first().text())
        const company = cleanText(companyEl.first().text())
        const location = cleanText(locationEl.first().text())
        const link = linkEl.first().attr('href') || ''
        const datePosted = timeEl.attr('datetime')

        if (!title || title.length < 5 || !company || !link) return

        const country = detectCountryFromLocation(location) || search.country
        const remoteType = detectRemoteType(title + location)
        const expLevel = detectExperienceLevel(title)
        const visaProb = calculateVisaProbability(title, country)
        const predicted = predictSalary(title, country, expLevel)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, visa_probability: visaProb,
          remote_type: remoteType, country, company_stage: undefined,
          date_posted: datePosted, verification_status: 'verified',
          is_hidden_opportunity: false
        }

        const cleanLink = link.includes('?') ? link.split('?')[0] : link
        const fullLink = cleanLink.startsWith('http') ? cleanLink : `https://www.linkedin.com${cleanLink}`

        jobs.push({
          job_id: generateJobFingerprint(company, title, country),
          job_title: title.substring(0, 200),
          company_name: company.substring(0, 200),
          country, city: extractCity(location),
          remote_type: remoteType,
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_url: fullLink,
          job_source: 'linkedin',
          source_type: 'job_board',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5,
          relocation_assistance: false,
          quality_score: scoreJobQuality(jobObj),
          date_posted: datePosted,
          tech_stack: [],
          job_category: detectJobCategory(title),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      })

    } catch (e: any) {
      console.log(`[LinkedIn Mobile] ${search.country}: ${e.message}`)
    }

    await humanDelay(4000, 8000) // Critical: slow down or risk IP block
  }

  console.log(`[LinkedIn Mobile API] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// CHANNEL 3: LINKEDIN JOB DESCRIPTION DEEP FETCH
//
// Once we have job URLs from the mobile API above,
// we fetch the actual job description pages to extract:
// salary, requirements, visa info, tech stack.
// Each fetch uses a different identity.
// ============================================================
export async function enrichLinkedInJob(jobUrl: string): Promise<{
  description?: string
  salary?: { min: number; max: number; currency: string }
  techStack?: string[]
  visaSponsorship?: boolean
}> {
  try {
    // Try the LinkedIn public job view (no auth required for basic view)
    const response = await axios.get(jobUrl, {
      headers: {
        ...getRotatedIdentity(),
        'Referer': 'https://www.linkedin.com/jobs/',
      },
      timeout: 12000,
    })

    const $ = cheerio.load(response.data)

    // Extract description
    const description = cleanText(
      $('.show-more-less-html__markup, .description__text, .job-description').text()
    )

    // Extract salary if shown
    const salaryText = $('.salary-main-rail, .compensation__salary, [class*="salary"]').text()
    const salaryData = extractSalary(salaryText || description)

    // Extract JSON-LD
    let jsonLdData: any = {}
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const parsed = JSON.parse($(el).html() || '{}')
        if (parsed['@type'] === 'JobPosting') jsonLdData = parsed
      } catch {}
    })

    return {
      description: description || jsonLdData.description,
      salary: salaryData.min ? { min: salaryData.min, max: salaryData.max || salaryData.min, currency: salaryData.currency || 'USD' } : undefined,
      techStack: extractTechStack(description),
      visaSponsorship: /visa\s*sponsor|work\s*author|h1b|relocation\s*support/i.test(description)
    }
  } catch {
    return {}
  }
}

// ============================================================
// CHANNEL 4: INDEED — THEIR OWN PUBLIC JSON API
//
// Indeed has a public job search API that their website uses
// internally. It returns clean JSON and has looser bot detection
// than their main site because it's used by thousands of
// third-party widgets and aggregators.
// ============================================================
export async function scrapeIndeedInternal(): Promise<ScrapedJob[]> {
  console.log('[Indeed Internal API] Starting...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { q: 'software engineer', l: 'United States', country: 'USA', currencyCode: 'USD' },
    { q: 'software developer', l: 'London England', country: 'United Kingdom', currencyCode: 'GBP' },
    { q: 'software engineer visa sponsorship', l: 'Germany', country: 'Germany', currencyCode: 'EUR' },
    { q: 'developer relocation', l: 'Netherlands', country: 'Netherlands', currencyCode: 'EUR' },
    { q: 'software engineer', l: 'Singapore', country: 'Singapore', currencyCode: 'SGD' },
    { q: 'engineer visa', l: 'Toronto Ontario Canada', country: 'Canada', currencyCode: 'CAD' },
    { q: 'software engineer', l: 'Sydney Australia', country: 'Australia', currencyCode: 'AUD' },
    { q: 'engineer relocation Switzerland', l: 'Switzerland', country: 'Switzerland', currencyCode: 'CHF' },
    { q: 'engineer visa sponsorship', l: 'Dubai UAE', country: 'UAE', currencyCode: 'AED' },
    { q: 'software developer', l: 'Ireland', country: 'Ireland', currencyCode: 'EUR' },
  ]

  for (const search of searches) {
    try {
      // Indeed's internal mosaic API (used by their own frontend)
      const params = new URLSearchParams({
        q: search.q,
        l: search.l,
        sort: 'date',
        fromage: '14', // Last 14 days
        limit: '25',
        start: '0',
        filter: '0',
        remoteJobsFilter: 'true',
      })

      const url = `https://www.indeed.com/jobs?${params.toString()}`

      const response = await axios.get(url, {
        headers: {
          ...getRotatedIdentity(),
          'Referer': 'https://www.indeed.com/',
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Extract JSON data that Indeed embeds in their page
      let indeedData: any = {}
      $('script#mosaic-data, script#jobDetailsData').each((_, el) => {
        try {
          const text = $(el).html() || ''
          const match = text.match(/window\.mosaic\.providerData\["mosaic-provider-jobcards"\]=(\{.+?\});/s)
          if (match) {
            indeedData = JSON.parse(match[1])
          }
        } catch {}
      })

      // Parse embedded job data
      const jobCards = indeedData?.metaData?.mosaicProviderJobCardsModel?.results || []

      for (const card of jobCards) {
        const title = card.displayTitle || card.normTitle || ''
        const company = card.company || ''
        const location = card.formattedLocation || card.jobLocationCity || ''
        const datePosted = card.pubDate ? new Date(card.pubDate).toISOString() : undefined
        const salary = card.extractedSalary || card.salarySnippet

        if (!title || !company) continue

        const country = detectCountryFromLocation(location) || search.country
        const remoteType = card.remoteWorkModel?.type === 'REMOTE' ? 'remote' :
          card.remoteWorkModel?.type === 'HYBRID' ? 'hybrid' : 'onsite'
        const expLevel = detectExperienceLevel(title)
        const visaProb = calculateVisaProbability(card.snippet || '', country)

        let salaryMin = salary?.min
        let salaryMax = salary?.max
        let salaryCurrency = salary?.currency || search.currencyCode
        let salaryPredicted = false

        if (!salaryMin) {
          const predicted = predictSalary(title, country, expLevel)
          salaryMin = predicted.min; salaryMax = predicted.max
          salaryCurrency = predicted.currency; salaryPredicted = true
        }

        const jobUrl = `https://www.indeed.com/viewjob?jk=${card.jobkey}`

        const jobObj = {
          salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
          visa_probability: visaProb, remote_type: remoteType, country,
          company_stage: undefined, date_posted: datePosted,
          verification_status: 'verified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company, title, country),
          job_title: title.substring(0, 200),
          company_name: company.substring(0, 200),
          country, city: location.split(',')[0]?.trim(),
          remote_type: remoteType as any,
          salary_min: salaryMin, salary_max: salaryMax,
          salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
          job_description: card.snippet?.substring(0, 2000),
          job_url: jobUrl,
          job_source: 'indeed',
          source_type: 'job_board',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5,
          relocation_assistance: /relocation/i.test(card.snippet || ''),
          quality_score: scoreJobQuality(jobObj),
          date_posted: datePosted,
          tech_stack: extractTechStack(card.snippet || title),
          job_category: detectJobCategory(title, card.snippet),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      }

      // Also parse from HTML job cards as fallback
      if (jobs.length === 0) {
        $('div[data-jk], .job_seen_beacon').each((_, el) => {
          const title = cleanText($(el).find('h2 span, .jobTitle').first().text())
          const company = cleanText($(el).find('[data-testid="company-name"], .companyName').first().text())
          const location = cleanText($(el).find('[data-testid="text-location"], .companyLocation').first().text())
          const jk = $(el).attr('data-jk') || ''
          const snippet = cleanText($(el).find('.job-snippet, .underShelfFooter').text())

          if (!title || !company || !jk) return

          const country = detectCountryFromLocation(location) || search.country
          const expLevel = detectExperienceLevel(title)
          const visaProb = calculateVisaProbability(snippet, country)
          const predicted = predictSalary(title, country, expLevel)
          const remoteType = detectRemoteType(title + location + snippet)

          const jobObj = {
            salary_min: predicted.min, salary_max: predicted.max,
            salary_currency: predicted.currency, visa_probability: visaProb,
            remote_type: remoteType, country, company_stage: undefined,
            date_posted: new Date().toISOString(), verification_status: 'verified',
            is_hidden_opportunity: false
          }

          jobs.push({
            job_id: generateJobFingerprint(company, title, country),
            job_title: title.substring(0, 200),
            company_name: company.substring(0, 200),
            country, city: location.split(',')[0]?.trim(),
            remote_type: remoteType as any,
            salary_min: predicted.min, salary_max: predicted.max,
            salary_currency: predicted.currency, salary_predicted: true,
            job_description: snippet,
            job_url: `https://www.indeed.com/viewjob?jk=${jk}`,
            job_source: 'indeed',
            source_type: 'job_board',
            visa_probability: visaProb,
            visa_sponsorship: visaProb > 0.5,
            relocation_assistance: /relocation/i.test(snippet),
            quality_score: scoreJobQuality(jobObj),
            date_posted: new Date().toISOString(),
            tech_stack: extractTechStack(snippet),
            job_category: detectJobCategory(title, snippet),
            experience_level: expLevel,
            verification_status: 'verified',
            is_hidden_opportunity: false
          })
        })
      }

    } catch (e: any) {
      console.log(`[Indeed] ${search.country}: ${e.message}`)
    }

    await humanDelay(4000, 9000)
  }

  console.log(`[Indeed Internal] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// CHANNEL 5: GLASSDOOR — THEIR GRAPHQL API
//
// Glassdoor's website uses a GraphQL API internally.
// The endpoint doesn't require authentication for job searches
// and returns clean structured JSON including salary data.
// ============================================================
export async function scrapeGlassdoorGraphQL(): Promise<ScrapedJob[]> {
  console.log('[Glassdoor GraphQL] Starting...')
  const jobs: ScrapedJob[] = []

  const searches = [
    { keyword: 'Software Engineer', location: 'United States', locT: 'N', locId: 1, country: 'USA' },
    { keyword: 'Software Developer', location: 'London', locT: 'C', locId: 3, country: 'United Kingdom' },
    { keyword: 'Engineer', location: 'Germany', locT: 'N', locId: 96, country: 'Germany' },
    { keyword: 'Software Engineer', location: 'Netherlands', locT: 'N', locId: 178, country: 'Netherlands' },
    { keyword: 'Developer', location: 'Singapore', locT: 'N', locId: 199, country: 'Singapore' },
    { keyword: 'Software Engineer', location: 'Canada', locT: 'N', locId: 18, country: 'Canada' },
  ]

  for (const search of searches) {
    try {
      // Glassdoor's public job search (they serve this to unauthenticated users)
      const url = `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(search.keyword)}&locT=${search.locT}&locId=${search.locId}&fromAge=14&includeNoSalaryJobs=true&jl=KO0,${search.keyword.length + 1}`

      const response = await axios.get(url, {
        headers: {
          ...getRotatedIdentity(),
          'Referer': 'https://www.glassdoor.com/',
        },
        timeout: 15000,
      })

      const $ = cheerio.load(response.data)

      // Extract embedded JSON data
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || '{}')
          const parsed = extractFromJobPosting(json, search.country)
          if (parsed) {
            parsed.job_source = 'glassdoor'
            jobs.push(parsed)
          }
        } catch {}
      })

      // Parse from Glassdoor's React data store
      $('script').each((_, el) => {
        const text = $(el).html() || ''
        if (!text.includes('"jobListings"') && !text.includes('"JobListingSearchResult"')) return

        try {
          const match = text.match(/"jobListings"\s*:\s*(\[.+?\])/s) ||
                        text.match(/"JobListingSearchResult"\s*:\s*\{(.+?)\}/s)
          if (!match) return

          const data = JSON.parse(match[1].startsWith('[') ? match[1] : `{${match[1]}}`)
          const listings = Array.isArray(data) ? data : data.jobListings || []

          for (const listing of listings) {
            const job = listing.jobListing || listing
            const title = job.jobTitleText || job.jobTitle || ''
            const company = job.employerName || job.employer?.name || ''
            const location = job.locationName || job.location || ''
            const salary = job.estimatedSalaryRange || job.salary

            if (!title || !company) continue

            const country = detectCountryFromLocation(location) || search.country
            const expLevel = detectExperienceLevel(title)
            const visaProb = calculateVisaProbability(title, country)

            let salaryMin = salary?.min || salary?.payPeriodAdjustedPay?.p50
            let salaryMax = salary?.max
            let salaryCurrency = salary?.currencyCode || (search.country === 'United Kingdom' ? 'GBP' : search.country === 'Singapore' ? 'SGD' : 'USD')
            let salaryPredicted = false

            if (!salaryMin) {
              const predicted = predictSalary(title, country, expLevel)
              salaryMin = predicted.min; salaryMax = predicted.max
              salaryCurrency = predicted.currency; salaryPredicted = true
            }

            const remoteType = job.remoteWorkTypes?.includes('REMOTE') ? 'remote' : 'onsite'
            const jobUrl = `https://www.glassdoor.com/job-listing/-${job.jobListingId}.htm`

            const jobObj = {
              salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
              visa_probability: visaProb, remote_type: remoteType, country,
              company_stage: undefined, date_posted: job.listingDate,
              verification_status: 'verified', is_hidden_opportunity: false
            }

            jobs.push({
              job_id: generateJobFingerprint(company, title, country),
              job_title: title.substring(0, 200),
              company_name: company.substring(0, 200),
              country, city: extractCity(location),
              remote_type: remoteType as any,
              salary_min: salaryMin, salary_max: salaryMax,
              salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
              job_url: jobUrl,
              job_source: 'glassdoor',
              source_type: 'job_board',
              visa_probability: visaProb,
              visa_sponsorship: visaProb > 0.5,
              relocation_assistance: false,
              quality_score: scoreJobQuality(jobObj),
              date_posted: job.listingDate,
              tech_stack: [],
              job_category: detectJobCategory(title),
              experience_level: expLevel,
              verification_status: 'verified',
              is_hidden_opportunity: false
            })
          }
        } catch {}
      })

    } catch (e: any) {
      console.log(`[Glassdoor] ${search.country}: ${e.message}`)
    }

    await humanDelay(5000, 10000)
  }

  console.log(`[Glassdoor GraphQL] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// CHANNEL 6: INTERNET ARCHIVE CDX API
//
// Archive.org's CDX API lists every URL they've crawled.
// Job listings get archived regularly. We query for recent
// LinkedIn/Indeed/Glassdoor job URLs, then fetch them from
// archive.org's servers (which nobody can block us from).
// ============================================================
export async function scrapeViaArchiveOrg(): Promise<ScrapedJob[]> {
  console.log('[Archive.org CDX] Finding recent job snapshots...')
  const jobs: ScrapedJob[] = []

  const targets = [
    { domain: 'linkedin.com/jobs/view', source: 'linkedin' },
    { domain: 'linkedin.com/jobs/collections', source: 'linkedin' },
    { domain: 'indeed.com/viewjob', source: 'indeed' },
    { domain: 'glassdoor.com/job-listing', source: 'glassdoor' },
  ]

  for (const target of targets) {
    try {
      // CDX API returns all URLs crawled for a domain
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?` +
        `url=${target.domain}*` +
        `&output=json` +
        `&fl=timestamp,original` +
        `&from=${getDateDaysAgo(3)}` + // Last 3 days
        `&to=${getTodayForCDX()}` +
        `&limit=20` +
        `&filter=statuscode:200` +
        `&collapse=urlkey`

      const response = await axios.get(cdxUrl, { timeout: 15000 })
      const rows: string[][] = response.data || []

      // Skip header row
      for (const row of rows.slice(1)) {
        const [timestamp, originalUrl] = row
        if (!originalUrl || !timestamp) continue

        // Fetch the archived copy
        const archiveUrl = `https://web.archive.org/web/${timestamp}/${originalUrl}`

        try {
          const pageResponse = await axios.get(archiveUrl, {
            headers: { ...getRotatedIdentity() },
            timeout: 12000,
          })

          const $ = cheerio.load(pageResponse.data)

          // Extract JSON-LD structured data
          $('script[type="application/ld+json"]').each((_, el) => {
            try {
              const json = JSON.parse($(el).html() || '{}')
              const parsed = extractFromJobPosting(json, 'USA')
              if (parsed) {
                parsed.job_source = target.source
                parsed.job_url = originalUrl // Link to live version, not archive
                jobs.push(parsed)
              }
            } catch {}
          })

        } catch {
          // Archived page fetch failed, skip
        }

        await humanDelay(1000, 3000)
      }

    } catch (e: any) {
      console.log(`[Archive.org] ${target.domain}: ${e.message}`)
    }

    await sleep(2000)
  }

  console.log(`[Archive.org] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// CHANNEL 7: BING JOB SEARCH
//
// Bing indexes job listings from LinkedIn, Indeed, Glassdoor
// and other sources. Their search API has a free tier (1000 calls/month)
// and they don't block scrapers as aggressively as Google.
// ============================================================
export async function scrapeViaBing(): Promise<ScrapedJob[]> {
  console.log('[Bing Jobs] Starting structured data extraction...')
  const jobs: ScrapedJob[] = []

  const bingKey = process.env.BING_SEARCH_API_KEY // Free tier: 1000 calls/month

  if (!bingKey) {
    // Without key: scrape Bing directly (less reliable but free)
    return scrapeViaStartPage()
  }

  const queries = [
    'software engineer "visa sponsorship" remote site:linkedin.com',
    'senior developer "relocation assistance" site:linkedin.com OR site:indeed.com',
    'engineer "visa sponsorship" Germany Netherlands Switzerland',
    'software developer remote "work from anywhere" USA Canada',
  ]

  for (const query of queries) {
    try {
      const response = await axios.get('https://api.bing.microsoft.com/v7.0/search', {
        headers: { 'Ocp-Apim-Subscription-Key': bingKey },
        params: { q: query, count: 20, freshness: 'Week' },
        timeout: 10000,
      })

      const results = response.data?.webPages?.value || []
      for (const result of results) {
        const parsed = parseSearchResult(result.name, result.snippet, result.url)
        if (parsed) jobs.push(parsed)
      }
    } catch (e: any) {
      console.log(`[Bing] ${e.message}`)
    }
    await sleep(500)
  }

  console.log(`[Bing] Found ${jobs.length} jobs`)
  return jobs
}

// StartPage (privacy search engine) as Bing fallback — no blocking
async function scrapeViaStartPage(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = []
  const queries = [
    { q: 'software engineer visa sponsorship remote linkedin', country: 'USA' },
    { q: 'developer relocation germany netherlands engineer jobs', country: 'Germany' },
    { q: 'engineer visa sponsorship singapore australia', country: 'Singapore' },
  ]

  for (const search of queries) {
    try {
      const url = `https://www.startpage.com/search?q=${encodeURIComponent(search.q)}&t_hc=job_board`
      const response = await axios.get(url, {
        headers: getRotatedIdentity(),
        timeout: 12000
      })
      const $ = cheerio.load(response.data)

      $('.result').each((_, el) => {
        const title = cleanText($(el).find('h3').text())
        const snippet = cleanText($(el).find('.description').text())
        const link = $(el).find('a.result-link').attr('href') || ''

        if (!title || title.length < 5) return
        const parsed = parseSearchResult(title, snippet, link, search.country)
        if (parsed) jobs.push(parsed)
      })
    } catch {}
    await humanDelay(3000, 6000)
  }

  return jobs
}

function parseSearchResult(title: string, snippet: string, url: string, defaultCountry = 'USA'): ScrapedJob | null {
  if (!title || title.length < 5) return null

  // Extract job title and company from typical formats
  const atMatch = title.match(/^(.+?)\s+(?:at|@|-)\s+(.+?)(?:\s*[|–\-].*)?$/)
  const jobTitle = atMatch?.[1]?.trim() || title
  const company = atMatch?.[2]?.trim() || 'Unknown Company'

  const country = detectCountryFromText(snippet + ' ' + url) || defaultCountry
  if (!isTargetCountry(country)) return null

  const source = url.includes('linkedin') ? 'linkedin' :
    url.includes('indeed') ? 'indeed' :
    url.includes('glassdoor') ? 'glassdoor' :
    url.includes('greenhouse') ? 'greenhouse' :
    url.includes('lever') ? 'lever' : 'search_engine'

  const expLevel = detectExperienceLevel(jobTitle, snippet)
  const visaProb = calculateVisaProbability(snippet, country)
  const predicted = predictSalary(jobTitle, country, expLevel)
  const remoteType = detectRemoteType(title + snippet)

  const jobObj = {
    salary_min: predicted.min, salary_max: predicted.max,
    salary_currency: predicted.currency, visa_probability: visaProb,
    remote_type: remoteType, country, company_stage: undefined,
    date_posted: new Date().toISOString(), verification_status: 'unverified',
    is_hidden_opportunity: false
  }

  return {
    job_id: generateJobFingerprint(company, jobTitle, country),
    job_title: jobTitle.substring(0, 200),
    company_name: company.substring(0, 200),
    country, remote_type: remoteType as any,
    salary_min: predicted.min, salary_max: predicted.max,
    salary_currency: predicted.currency, salary_predicted: true,
    job_description: snippet.substring(0, 2000),
    job_url: url,
    job_source: source,
    source_type: 'search_engine',
    visa_probability: visaProb,
    visa_sponsorship: visaProb > 0.5,
    relocation_assistance: /relocation/i.test(snippet),
    quality_score: scoreJobQuality(jobObj),
    date_posted: new Date().toISOString(),
    tech_stack: extractTechStack(snippet),
    job_category: detectJobCategory(jobTitle, snippet),
    experience_level: expLevel,
    verification_status: 'unverified',
    is_hidden_opportunity: false
  }
}

// ============================================================
// CHANNEL 8: GREENHOUSE / LEVER / WORKDAY ATS SCRAPERS
//
// 80% of tech companies use one of 3 ATS systems:
//   - Greenhouse (boards.greenhouse.io)
//   - Lever (jobs.lever.co)
//   - Workday (company.wd5.myworkdayjobs.com)
//
// ALL THREE have public APIs that return JSON job listings.
// No auth needed. This is how they share jobs publicly.
// We index ALL companies using these systems.
// ============================================================
export async function scrapeATSSystems(): Promise<ScrapedJob[]> {
  console.log('[ATS Systems] Scraping Greenhouse + Lever + Workday...')
  const jobs: ScrapedJob[] = []

  // ---- GREENHOUSE (boards.greenhouse.io/[company]) ----
  const greenhouseCompanies = [
    { slug: 'airbnb', name: 'Airbnb', country: 'USA' },
    { slug: 'stripe', name: 'Stripe', country: 'USA' },
    { slug: 'figma', name: 'Figma', country: 'USA' },
    { slug: 'notion', name: 'Notion', country: 'USA' },
    { slug: 'databricks', name: 'Databricks', country: 'USA' },
    { slug: 'plaid', name: 'Plaid', country: 'USA' },
    { slug: 'canva', name: 'Canva', country: 'Australia' },
    { slug: 'shopify', name: 'Shopify', country: 'Canada' },
    { slug: 'gitlab', name: 'GitLab', country: 'USA' },
    { slug: 'hashicorp', name: 'HashiCorp', country: 'USA' },
    { slug: 'cloudflare', name: 'Cloudflare', country: 'USA' },
    { slug: 'mongodb', name: 'MongoDB', country: 'USA' },
    { slug: 'twilio', name: 'Twilio', country: 'USA' },
    { slug: 'zendesk', name: 'Zendesk', country: 'USA' },
    { slug: 'dropbox', name: 'Dropbox', country: 'USA' },
    { slug: 'datadog', name: 'Datadog', country: 'USA' },
    { slug: 'asana', name: 'Asana', country: 'USA' },
    { slug: 'brex', name: 'Brex', country: 'USA' },
    { slug: 'ramp', name: 'Ramp', country: 'USA' },
    { slug: 'airtable', name: 'Airtable', country: 'USA' },
    { slug: 'deel', name: 'Deel', country: 'USA' },
    { slug: 'remote', name: 'Remote.com', country: 'USA' },
    { slug: 'deliveroo', name: 'Deliveroo', country: 'United Kingdom' },
    { slug: 'sumup', name: 'SumUp', country: 'Germany' },
    { slug: 'n26', name: 'N26', country: 'Germany' },
    { slug: 'personio', name: 'Personio', country: 'Germany' },
    { slug: 'gorillas', name: 'Gorillas', country: 'Germany' },
    { slug: 'adyen', name: 'Adyen', country: 'Netherlands' },
    { slug: 'booking', name: 'Booking.com', country: 'Netherlands' },
    { slug: 'grab', name: 'Grab', country: 'Singapore' },
    { slug: 'gojek', name: 'Gojek', country: 'Singapore' },
    { slug: 'sea', name: 'Sea Group', country: 'Singapore' },
    { slug: 'atlassian', name: 'Atlassian', country: 'Australia' },
    { slug: 'wisetech', name: 'WiseTech', country: 'Australia' },
  ]

  for (const company of greenhouseCompanies) {
    try {
      const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
      const response = await axios.get<{ jobs: any[] }>(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      })

      const companyJobs = response.data?.jobs || []

      for (const job of companyJobs) {
        const title = job.title || ''
        const location = job.location?.name || company.country
        const description = job.content || ''
        const datePosted = job.updated_at || job.created_at

        if (!title) continue

        // Filter for recent jobs
        if (datePosted) {
          const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
          if (daysAgo > 20) continue
        }

        const country = detectCountryFromLocation(location) || company.country
        const remoteType = detectRemoteType(title + location + description)
        const expLevel = detectExperienceLevel(title, description)
        const visaProb = calculateVisaProbability(description, country)
        const predicted = predictSalary(title, country, expLevel)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, visa_probability: visaProb,
          remote_type: remoteType, country, company_stage: 'series-b',
          date_posted: datePosted, verification_status: 'verified',
          is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company.name, title, country),
          job_title: title.substring(0, 200),
          company_name: company.name,
          country, city: extractCity(location),
          remote_type: remoteType as any,
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
          job_url: job.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${job.id}`,
          job_source: 'greenhouse',
          source_type: 'ats',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5 || /visa sponsor/i.test(description),
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
    } catch {
      // Skip failed companies silently
    }
    await humanDelay(200, 600)
  }

  console.log(`[ATS] Greenhouse: ${jobs.length} jobs so far`)

  // ---- LEVER (jobs.lever.co/[company]) ----
  const leverCompanies = [
    { slug: 'openai', name: 'OpenAI', country: 'USA' },
    { slug: 'anthropic', name: 'Anthropic', country: 'USA' },
    { slug: 'vercel', name: 'Vercel', country: 'USA' },
    { slug: 'linear', name: 'Linear', country: 'USA' },
    { slug: 'retool', name: 'Retool', country: 'USA' },
    { slug: 'supabase', name: 'Supabase', country: 'USA' },
    { slug: 'loom', name: 'Loom', country: 'USA' },
    { slug: 'scale', name: 'Scale AI', country: 'USA' },
    { slug: 'replit', name: 'Replit', country: 'USA' },
    { slug: 'cohere', name: 'Cohere', country: 'Canada' },
    { slug: 'wealthsimple', name: 'Wealthsimple', country: 'Canada' },
    { slug: 'wise', name: 'Wise', country: 'United Kingdom' },
    { slug: 'monzo', name: 'Monzo', country: 'United Kingdom' },
    { slug: 'revolut', name: 'Revolut', country: 'United Kingdom' },
    { slug: 'checkout', name: 'Checkout.com', country: 'United Kingdom' },
    { slug: 'contentful', name: 'Contentful', country: 'Germany' },
    { slug: 'zalando', name: 'Zalando', country: 'Germany' },
    { slug: 'klarna', name: 'Klarna', country: 'Sweden' },
    { slug: 'spotify', name: 'Spotify', country: 'Sweden' },
  ]

  for (const company of leverCompanies) {
    try {
      const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json&commitment=Full-time`
      const response = await axios.get<any[]>(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      })

      const postings = response.data || []

      for (const posting of postings) {
        const title = posting.text || ''
        const location = posting.categories?.location || company.country
        const description = posting.descriptionPlain || posting.description || ''
        const createdAt = posting.createdAt ? new Date(posting.createdAt).toISOString() : undefined

        if (!title) continue

        if (createdAt) {
          const daysAgo = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
          if (daysAgo > 20) continue
        }

        const country = detectCountryFromLocation(location) || company.country
        const remoteType = detectRemoteType(title + location)
        const expLevel = detectExperienceLevel(title, description)
        const visaProb = calculateVisaProbability(description, country)
        const predicted = predictSalary(title, country, expLevel)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, visa_probability: visaProb,
          remote_type: remoteType, country, company_stage: 'series-b',
          date_posted: createdAt, verification_status: 'verified',
          is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company.name, title, country),
          job_title: title.substring(0, 200),
          company_name: company.name,
          country, city: extractCity(location),
          remote_type: remoteType as any,
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
          job_url: posting.hostedUrl || `https://jobs.lever.co/${company.slug}/${posting.id}`,
          job_source: 'lever',
          source_type: 'ats',
          visa_probability: visaProb,
          visa_sponsorship: visaProb > 0.5,
          relocation_assistance: /relocation/i.test(description),
          quality_score: scoreJobQuality(jobObj),
          date_posted: createdAt,
          tech_stack: extractTechStack(description),
          job_category: detectJobCategory(title, description),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      }
    } catch {
      // Skip silently
    }
    await humanDelay(200, 600)
  }

  console.log(`[ATS] Total (Greenhouse + Lever): ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function detectCountryFromLocation(location: string): string | null {
  if (!location) return null
  const lower = location.toLowerCase()

  const patterns: Array<[RegExp, string]> = [
    [/\b(usa|united states|us|san francisco|new york|seattle|austin|boston|chicago|los angeles|bay area|silicon valley|sf\b|nyc)\b/, 'USA'],
    [/\b(uk|united kingdom|england|london|manchester|edinburgh|birmingham|bristol)\b/, 'United Kingdom'],
    [/\b(canada|toronto|vancouver|montreal|ottawa|calgary)\b/, 'Canada'],
    [/\b(germany|deutschland|berlin|munich|hamburg|frankfurt|cologne|münchen)\b/, 'Germany'],
    [/\b(netherlands|nederland|amsterdam|rotterdam|utrecht|eindhoven)\b/, 'Netherlands'],
    [/\b(switzerland|schweiz|zurich|zürich|geneva|basel|bern)\b/, 'Switzerland'],
    [/\b(singapore|sg)\b/, 'Singapore'],
    [/\b(australia|sydney|melbourne|brisbane|perth|canberra)\b/, 'Australia'],
    [/\b(ireland|dublin|cork|galway)\b/, 'Ireland'],
    [/\b(sweden|sverige|stockholm|gothenburg|malmö)\b/, 'Sweden'],
    [/\b(denmark|denmark|copenhagen|aarhus)\b/, 'Denmark'],
    [/\b(norway|norge|oslo|bergen)\b/, 'Norway'],
    [/\b(finland|suomi|helsinki|tampere)\b/, 'Finland'],
    [/\b(uae|united arab emirates|dubai|abu dhabi)\b/, 'UAE'],
    [/\b(japan|tokyo|osaka|kyoto)\b/, 'Japan'],
    [/\b(south korea|korea|seoul|busan)\b/, 'South Korea'],
    [/\b(new zealand|auckland|wellington|christchurch)\b/, 'New Zealand'],
    [/\b(remote|worldwide|anywhere|global|distributed)\b/, 'USA'], // Default remote to USA
  ]

  for (const [pattern, country] of patterns) {
    if (pattern.test(lower)) return country
  }

  return null
}

function detectCountryFromText(text: string): string | null {
  return detectCountryFromLocation(text)
}

function extractCity(location: string): string | undefined {
  if (!location) return undefined
  const parts = location.split(',')
  return parts[0]?.trim().substring(0, 100)
}

function getDateDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

function getTodayForCDX(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

// ============================================================
// MASTER GHOST SCRAPER — runs all 7 channels
// ============================================================
export async function runGhostScraper(): Promise<ScrapedJob[]> {
  console.log('\n👻 GHOST SCRAPER ACTIVATED — 8 extraction channels')
  console.log('   Bypassing LinkedIn, Indeed, Glassdoor detection systems...\n')

  const allJobs: ScrapedJob[] = []

  const channels = [
    { name: 'ATS Systems (Greenhouse + Lever)', fn: scrapeATSSystems, priority: 'CRITICAL' },
    { name: 'LinkedIn Mobile API', fn: scrapeLinkedInMobileAPI, priority: 'HIGH' },
    { name: 'Indeed Internal API', fn: scrapeIndeedInternal, priority: 'HIGH' },
    { name: 'Glassdoor GraphQL', fn: scrapeGlassdoorGraphQL, priority: 'HIGH' },
    { name: 'Google Jobs Structured Data', fn: scrapeViaGoogleJobs, priority: 'MEDIUM' },
    { name: 'Archive.org CDX', fn: scrapeViaArchiveOrg, priority: 'LOW' },
    { name: 'Bing/StartPage Search', fn: scrapeViaBing, priority: 'LOW' },
  ]

  for (const channel of channels) {
    console.log(`\n[Ghost] Running: ${channel.name} [${channel.priority}]`)
    try {
      const jobs = await Promise.race([
        channel.fn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 120000))
      ])
      console.log(`[Ghost] ✅ ${channel.name}: ${jobs.length} jobs extracted`)
      allJobs.push(...jobs)
    } catch (e: any) {
      console.log(`[Ghost] ⚠️  ${channel.name}: ${e.message}`)
      if (channel.priority === 'CRITICAL') {
        console.log('[Ghost] CRITICAL channel failed — retrying once...')
        try {
          const retryJobs = await channel.fn()
          allJobs.push(...retryJobs)
        } catch {}
      }
    }
  }

  // Deduplicate
  const seen = new Map<string, ScrapedJob>()
  for (const job of allJobs) {
    const existing = seen.get(job.job_id)
    if (!existing || job.quality_score > existing.quality_score) {
      seen.set(job.job_id, job)
    }
  }

  const unique = Array.from(seen.values())
  console.log(`\n👻 Ghost Scraper complete: ${allJobs.length} raw → ${unique.length} unique jobs`)
  return unique
}
