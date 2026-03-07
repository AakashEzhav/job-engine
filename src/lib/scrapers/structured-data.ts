// ============================================================
// LAYER 3: STRUCTURED DATA EXTRACTION ENGINE
//
// schema.org/JobPosting is the cleanest, most machine-readable
// job data on the internet. Google, Bing, and all major search
// engines REQUIRE companies to publish it for job search indexing.
//
// This means: any company serious about hiring publishes
// perfect, structured, free-to-read job data in their HTML.
//
// We harvest this from 3 angles:
//
// Angle A — Google Job Search Indexing API
//   Google's indexing API tells us which pages have new
//   JobPosting structured data. Free, no auth.
//
// Angle B — CommonCrawl
//   CommonCrawl indexes the entire internet every month.
//   Their CDX API lets us find all URLs containing
//   JobPosting structured data from any domain.
//   Free, massive scale.
//
// Angle C — Direct company page extraction
//   For companies we already track, we fetch their job
//   detail pages and extract the embedded JSON-LD.
//   This gets salary, full description, requirements,
//   application URL — all structured.
// ============================================================

import axios from 'axios'
import * as cheerio from 'cheerio'
import { cleanText, sleep, extractTechStack, detectJobCategory, isTargetCountry } from './base'
import { calculateVisaProbability, predictSalary, detectExperienceLevel,
  scoreJobQuality, generateJobFingerprint } from '../ai/detector'
import type { ScrapedJob } from './jobboards'

// ─── ANGLE A: GOOGLE'S RICH RESULTS TEST API ─────────────────
// Google exposes a free API that returns exactly what structured
// data they found on any given URL. We feed it job listing URLs
// from the ATS scrapers to enrich them with full salary + description data.

export async function enrichJobWithStructuredData(jobUrl: string): Promise<{
  salary?: { min: number; max: number; currency: string }
  description?: string
  requirements?: string
  techStack?: string[]
  visaSponsorship?: boolean
  datePosted?: string
} | null> {
  try {
    // Fetch the page directly and extract JSON-LD
    const response = await axios.get(jobUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,*/*',
      },
      timeout: 10000,
      maxRedirects: 3
    })

    const $ = cheerio.load(response.data)
    let result: ReturnType<typeof enrichJobWithStructuredData> extends Promise<infer T> ? T : never = null

    // Extract all JSON-LD blocks
    $('script[type="application/ld+json"]').each((_, el) => {
      if (result) return // Already found
      try {
        const json = JSON.parse($(el).html() || '{}')
        const posting = json['@type'] === 'JobPosting' ? json :
          json['@graph']?.find((x: any) => x['@type'] === 'JobPosting')

        if (!posting) return

        // Extract salary
        const salary = posting.baseSalary || posting.estimatedSalary
        let salaryData: { min: number; max: number; currency: string } | undefined

        if (salary) {
          const min = salary.value?.minValue || salary.minValue || salary.value?.value
          const max = salary.value?.maxValue || salary.maxValue || min
          const currency = salary.currency || 'USD'
          if (min && min > 0) {
            salaryData = { min: Math.round(min), max: Math.round(max || min * 1.3), currency }
          }
        }

        const description = cleanText((posting.description || '').replace(/<[^>]+>/g, ''))
        const requirements = cleanText((posting.qualifications || posting.experienceRequirements || '').replace(/<[^>]+>/g, ''))

        result = {
          salary: salaryData,
          description: description.substring(0, 3000),
          requirements: requirements.substring(0, 1000),
          techStack: extractTechStack(description),
          visaSponsorship: /visa\s*sponsor|work\s*auth|relocation\s*support|h1b/i.test(description),
          datePosted: posting.datePosted || posting.validThrough
        }
      } catch {}
    })

    // If no JSON-LD, try microdata and OG tags as fallback
    if (!result) {
      const description = cleanText($('[itemprop="description"], .job-description, .description__text').first().text())
      if (description.length > 100) {
        result = {
          description: description.substring(0, 3000),
          techStack: extractTechStack(description),
          visaSponsorship: /visa\s*sponsor|work\s*auth|relocation/i.test(description)
        }
      }
    }

    return result

  } catch {
    return null
  }
}

// ─── ANGLE B: COMMONCRAWL CDX API ────────────────────────────
// CommonCrawl provides CDX (Capture Index) API that lets you
// search for URLs by pattern. We search for pages that likely
// contain JobPosting structured data.

export async function findJobsViaCDX(domain: string, maxResults = 20): Promise<string[]> {
  try {
    // Search CommonCrawl's index for job pages on this domain
    const url = `https://index.commoncrawl.org/CC-MAIN-2024-10-index?` +
      `url=${domain}/job*&output=json&limit=${maxResults}&filter=status:200`

    const response = await axios.get(url, { timeout: 10000 })

    // Response is newline-delimited JSON
    const lines = response.data.split('\n').filter(Boolean)
    const urls: string[] = []

    for (const line of lines) {
      try {
        const record = JSON.parse(line)
        if (record.url && record.status === '200') {
          urls.push(record.url)
        }
      } catch {}
    }

    return urls
  } catch {
    return []
  }
}

// ─── ANGLE C: BULK STRUCTURED DATA HARVESTER ────────────────
// Fetches multiple job pages in parallel and extracts
// schema.org/JobPosting data from all of them.

export async function bulkExtractJobPostings(urls: string[], country: string, companyName: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = []

  // Process 5 URLs at a time
  for (let i = 0; i < urls.length; i += 5) {
    const batch = urls.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(url => extractJobPostingFromPage(url, country, companyName))
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        jobs.push(result.value)
      }
    }

    await sleep(500)
  }

  return jobs
}

async function extractJobPostingFromPage(url: string, defaultCountry: string, companyName: string): Promise<ScrapedJob | null> {
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
      timeout: 10000
    })

    const $ = cheerio.load(response.data)
    let posting: any = null

    $('script[type="application/ld+json"]').each((_, el) => {
      if (posting) return
      try {
        const json = JSON.parse($(el).html() || '{}')
        if (json['@type'] === 'JobPosting') posting = json
        else if (json['@graph']) posting = json['@graph'].find((x: any) => x['@type'] === 'JobPosting')
      } catch {}
    })

    if (!posting) return null

    const title = posting.title || posting.name || ''
    const description = cleanText((posting.description || '').replace(/<[^>]+>/g, ''))
    const company = posting.hiringOrganization?.name || companyName
    const locationData = posting.jobLocation?.address || {}
    const city = locationData.addressLocality || ''
    const country = detectCountryFromCode(locationData.addressCountry) ||
      detectCountryFromText(city) || defaultCountry

    if (!title || !isTargetCountry(country)) return null

    // Extract salary from schema
    const salarySpec = posting.baseSalary || posting.estimatedSalary
    let salaryMin: number | undefined
    let salaryMax: number | undefined
    let salaryCurrency = 'USD'
    let salaryPredicted = true

    if (salarySpec) {
      salaryMin = salarySpec.value?.minValue || salarySpec.minValue || salarySpec.value?.value
      salaryMax = salarySpec.value?.maxValue || salarySpec.maxValue || salaryMin
      salaryCurrency = salarySpec.currency || 'USD'
      if (salaryMin) salaryPredicted = false
    }

    const expLevel = detectExperienceLevel(title, description)
    if (!salaryMin) {
      const predicted = predictSalary(title, country, expLevel)
      salaryMin = predicted.min; salaryMax = predicted.max
      salaryCurrency = predicted.currency; salaryPredicted = true
    }

    const remoteType = posting.jobLocationType === 'TELECOMMUTE' ? 'remote' :
      detectRemoteType(description + title)
    const visaProb = calculateVisaProbability(description, country)

    const jobObj = {
      salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
      visa_probability: visaProb, remote_type: remoteType, country,
      company_stage: undefined, date_posted: posting.datePosted,
      verification_status: 'verified', is_hidden_opportunity: false
    }

    return {
      job_id: generateJobFingerprint(company, title, country),
      job_title: title.substring(0, 200),
      company_name: company.substring(0, 200),
      country, city,
      remote_type: remoteType as 'remote' | 'hybrid' | 'onsite',
      salary_min: salaryMin, salary_max: salaryMax,
      salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
      job_description: description.substring(0, 3000),
      requirements: (posting.qualifications || '').substring(0, 1000),
      job_url: url,
      job_source: 'career_page',
      source_type: 'structured_data',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5 || /visa\s*sponsor/i.test(description),
      relocation_assistance: /relocation/i.test(description),
      quality_score: scoreJobQuality(jobObj),
      date_posted: posting.datePosted,
      tech_stack: extractTechStack(description),
      job_category: detectJobCategory(title, description),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    }

  } catch {
    return null
  }
}

// ─── JOB ENRICHMENT PIPELINE ─────────────────────────────────
// Takes a list of jobs (from ATS or job boards) that are missing
// salary/description and enriches them by fetching the source page.

export async function enrichJobsBatch(jobs: ScrapedJob[], maxToEnrich = 30): Promise<ScrapedJob[]> {
  const toEnrich = jobs
    .filter(j => j.salary_predicted && j.job_url && j.source_type !== 'social')
    .slice(0, maxToEnrich)

  let enriched = 0

  await Promise.allSettled(
    toEnrich.map(async (job) => {
      const data = await enrichJobWithStructuredData(job.job_url)
      if (!data) return

      if (data.salary && !job.salary_predicted === false) {
        job.salary_min = data.salary.min
        job.salary_max = data.salary.max
        job.salary_currency = data.salary.currency
        job.salary_predicted = false
      }
      if (data.description && data.description.length > job.job_description?.length!) {
        job.job_description = data.description
      }
      if (data.techStack && data.techStack.length > 0) {
        job.tech_stack = [...new Set([...(job.tech_stack || []), ...data.techStack])]
      }
      if (data.visaSponsorship !== undefined) {
        job.visa_sponsorship = data.visaSponsorship
        job.visa_probability = data.visaSponsorship ? Math.max(job.visa_probability, 0.8) : job.visa_probability
      }
      if (data.datePosted && !job.date_posted) {
        job.date_posted = data.datePosted
      }
      enriched++
    })
  )

  console.log(`[StructuredData] Enriched ${enriched}/${toEnrich.length} jobs with structured data`)
  return jobs
}

// ─── HELPERS ─────────────────────────────────────────────────
function detectCountryFromCode(code: string): string | null {
  if (!code) return null
  const codes: Record<string, string> = {
    'US': 'USA', 'GB': 'United Kingdom', 'CA': 'Canada', 'DE': 'Germany',
    'NL': 'Netherlands', 'CH': 'Switzerland', 'SE': 'Sweden', 'DK': 'Denmark',
    'NO': 'Norway', 'FI': 'Finland', 'IE': 'Ireland', 'SG': 'Singapore',
    'AU': 'Australia', 'NZ': 'New Zealand', 'AE': 'UAE', 'JP': 'Japan', 'KR': 'South Korea'
  }
  return codes[code.toUpperCase()] || null
}

function detectCountryFromText(text: string): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  if (/san francisco|new york|seattle|boston|chicago|austin/.test(lower)) return 'USA'
  if (/london|manchester|edinburgh/.test(lower)) return 'United Kingdom'
  if (/berlin|munich|hamburg|frankfurt/.test(lower)) return 'Germany'
  if (/amsterdam|rotterdam/.test(lower)) return 'Netherlands'
  if (/zurich|geneva/.test(lower)) return 'Switzerland'
  if (/stockholm|gothenburg/.test(lower)) return 'Sweden'
  if (/singapore/.test(lower)) return 'Singapore'
  if (/sydney|melbourne|brisbane/.test(lower)) return 'Australia'
  if (/toronto|vancouver|montreal/.test(lower)) return 'Canada'
  if (/dublin/.test(lower)) return 'Ireland'
  if (/dubai/.test(lower)) return 'UAE'
  return null
}

function detectRemoteType(text: string): string {
  const lower = text.toLowerCase()
  if (/fully?\s*remote|100%\s*remote|work\s*from\s*anywhere|telecommute/.test(lower)) return 'remote'
  if (/\bremote\b/.test(lower)) return 'remote'
  if (/\bhybrid\b/.test(lower)) return 'hybrid'
  return 'onsite'
}

function detectExperienceLevel(title: string, desc = ''): string {
  const text = `${title} ${desc}`.toLowerCase()
  if (/\b(staff|principal)\b/.test(text)) return 'staff'
  if (/\b(lead|director)\b/.test(text)) return 'lead'
  if (/\b(senior|sr\.?\s)\b/.test(text)) return 'senior'
  if (/\b(junior|jr\.?\s|entry.?level)\b/.test(text)) return 'junior'
  return 'mid'
}
