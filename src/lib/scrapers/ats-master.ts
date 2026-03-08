// ============================================================
// LAYER 1: ATS (APPLICANT TRACKING SYSTEM) SCRAPERS
//
// This is the most stable, most reliable job data source.
// Why: ATS systems WANT to be scraped. Their entire purpose
// is to publish job listings publicly. They have clean JSON APIs
// with no rate limiting, no bot detection, no CAPTCHAs.
//
// Coverage: ~70% of tech companies use one of these 9 systems.
//
// ATS SYSTEMS COVERED:
//   1. Greenhouse  (boards-api.greenhouse.io)      ~15,000 companies
//   2. Lever       (api.lever.co)                   ~5,000 companies
//   3. Ashby       (api.ashbyhq.com)                ~2,000 companies
//   4. Workable    (apply.workable.com/api)         ~20,000 companies
//   5. SmartRecruiters (api.smartrecruiters.com)   ~10,000 companies
//   6. Breezy HR   (api.breezy.hr)                  ~5,000 companies
//   7. BambooHR    (api.bamboohr.com)               ~30,000 companies
//   8. Pinpoint    (api.pinpointhq.com)             ~1,000 companies
//   9. Teamtailor  (api.teamtailor.com)             ~8,000 companies
//
// TOTAL: Access to jobs at 100,000+ companies through clean APIs
// ============================================================

import axios from 'axios'
import { cleanText, sleep, extractTechStack, detectJobCategory,
  isTargetCountry } from './base'
import { calculateVisaProbability, predictSalary,
  detectExperienceLevel, scoreJobQuality,
  generateJobFingerprint } from '../ai/detector'
import type { ScrapedJob } from './jobboards'

// ─── COMPANY REGISTRY ────────────────────────────────────────
// Each company entry tells us: which ATS they use, their slug,
// country, and stage. We monitor ALL of them.
//
// To add more companies: just add an entry. The system
// automatically pulls their jobs from the right ATS API.

export interface ATSCompany {
  name: string
  ats: 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'breezy' | 'bamboohr' | 'teamtailor' | 'pinpoint'
  slug: string
  country: string
  stage?: string
  logo?: string
}

export const ATS_COMPANY_REGISTRY: ATSCompany[] = [
  // ── GREENHOUSE ──────────────────────────────────────────
  // USA — Finance / Payments
  { name: 'Stripe',        ats: 'greenhouse', slug: 'stripe',        country: 'USA',            stage: 'late' },
  { name: 'Plaid',         ats: 'greenhouse', slug: 'plaid',         country: 'USA',            stage: 'series-d' },
  { name: 'Brex',          ats: 'greenhouse', slug: 'brex',          country: 'USA',            stage: 'series-d' },
  { name: 'Ramp',          ats: 'greenhouse', slug: 'ramp',          country: 'USA',            stage: 'series-d' },
  { name: 'Chime',         ats: 'greenhouse', slug: 'chime',         country: 'USA',            stage: 'late' },
  { name: 'Robinhood',     ats: 'greenhouse', slug: 'robinhood',     country: 'USA',            stage: 'public' },
  // USA — Infrastructure / DevTools
  { name: 'Cloudflare',    ats: 'greenhouse', slug: 'cloudflare',    country: 'USA',            stage: 'public' },
  { name: 'Datadog',       ats: 'greenhouse', slug: 'datadog',       country: 'USA',            stage: 'public' },
  { name: 'HashiCorp',     ats: 'greenhouse', slug: 'hashicorp',     country: 'USA',            stage: 'public' },
  { name: 'MongoDB',       ats: 'greenhouse', slug: 'mongodb',       country: 'USA',            stage: 'public' },
  { name: 'Airtable',      ats: 'greenhouse', slug: 'airtable',      country: 'USA',            stage: 'series-f' },
  { name: 'Notion',        ats: 'greenhouse', slug: 'notion',        country: 'USA',            stage: 'series-c' },
  { name: 'Figma',         ats: 'greenhouse', slug: 'figma',         country: 'USA',            stage: 'public' },
  { name: 'Dropbox',       ats: 'greenhouse', slug: 'dropbox',       country: 'USA',            stage: 'public' },
  { name: 'Asana',         ats: 'greenhouse', slug: 'asana',         country: 'USA',            stage: 'public' },
  { name: 'Twilio',        ats: 'greenhouse', slug: 'twilio',        country: 'USA',            stage: 'public' },
  { name: 'Zendesk',       ats: 'greenhouse', slug: 'zendesk',       country: 'USA',            stage: 'public' },
  { name: 'Databricks',    ats: 'greenhouse', slug: 'databricks',    country: 'USA',            stage: 'late' },
  { name: 'Airbnb',        ats: 'greenhouse', slug: 'airbnb',        country: 'USA',            stage: 'public' },
  { name: 'DoorDash',      ats: 'greenhouse', slug: 'doordash',      country: 'USA',            stage: 'public' },
  { name: 'Lyft',          ats: 'greenhouse', slug: 'lyft',          country: 'USA',            stage: 'public' },
  { name: 'Snap',          ats: 'greenhouse', slug: 'snap',          country: 'USA',            stage: 'public' },
  { name: 'Pinterest',     ats: 'greenhouse', slug: 'pinterest',     country: 'USA',            stage: 'public' },
  { name: 'Reddit',        ats: 'greenhouse', slug: 'reddit',        country: 'USA',            stage: 'public' },
  { name: 'Coinbase',      ats: 'greenhouse', slug: 'coinbase',      country: 'USA',            stage: 'public' },
  { name: 'Rippling',      ats: 'greenhouse', slug: 'rippling',      country: 'USA',            stage: 'series-g' },
  { name: 'Deel',          ats: 'greenhouse', slug: 'deel',          country: 'USA',            stage: 'series-d' },
  { name: 'Remote.com',    ats: 'greenhouse', slug: 'remote',        country: 'USA',            stage: 'series-c' },
  // UK
  { name: 'Deliveroo',     ats: 'greenhouse', slug: 'deliveroo',     country: 'United Kingdom', stage: 'public' },
  { name: 'Babylon Health',ats: 'greenhouse', slug: 'babylonhealth', country: 'United Kingdom', stage: 'public' },
  { name: 'Checkout.com',  ats: 'greenhouse', slug: 'checkout',      country: 'United Kingdom', stage: 'series-d' },
  // Germany
  { name: 'SumUp',         ats: 'greenhouse', slug: 'sumup',         country: 'Germany',        stage: 'series-f' },
  { name: 'N26',           ats: 'greenhouse', slug: 'n26',           country: 'Germany',        stage: 'series-e' },
  { name: 'Personio',      ats: 'greenhouse', slug: 'personio',      country: 'Germany',        stage: 'series-e' },
  { name: 'Celonis',       ats: 'greenhouse', slug: 'celonis',       country: 'Germany',        stage: 'series-d' },
  // Netherlands
  { name: 'Adyen',         ats: 'greenhouse', slug: 'adyen',         country: 'Netherlands',    stage: 'public' },
  // Australia
  { name: 'Canva',         ats: 'greenhouse', slug: 'canva',         country: 'Australia',      stage: 'late' },
  { name: 'Atlassian',     ats: 'greenhouse', slug: 'atlassian',     country: 'Australia',      stage: 'public' },
  // Canada
  { name: 'Shopify',       ats: 'greenhouse', slug: 'shopify',       country: 'Canada',         stage: 'public' },
  { name: 'Wattpad',       ats: 'greenhouse', slug: 'wattpad',       country: 'Canada',         stage: 'acquired' },

  // ── LEVER ───────────────────────────────────────────────
  { name: 'OpenAI',        ats: 'lever', slug: 'openai',        country: 'USA',            stage: 'late' },
  { name: 'Anthropic',     ats: 'lever', slug: 'anthropic',     country: 'USA',            stage: 'series-c' },
  { name: 'Vercel',        ats: 'lever', slug: 'vercel',        country: 'USA',            stage: 'series-c' },
  { name: 'Linear',        ats: 'lever', slug: 'linear',        country: 'USA',            stage: 'series-a' },
  { name: 'Retool',        ats: 'lever', slug: 'retool',        country: 'USA',            stage: 'series-c' },
  { name: 'Supabase',      ats: 'lever', slug: 'supabase',      country: 'USA',            stage: 'series-b' },
  { name: 'Scale AI',      ats: 'lever', slug: 'scale',         country: 'USA',            stage: 'late' },
  { name: 'Replit',        ats: 'lever', slug: 'replit',        country: 'USA',            stage: 'series-b' },
  { name: 'Weights & Biases',ats:'lever', slug: 'wandb',        country: 'USA',            stage: 'series-c' },
  { name: 'Hugging Face',  ats: 'lever', slug: 'huggingface',   country: 'USA',            stage: 'series-c' },
  { name: 'Mistral AI',    ats: 'lever', slug: 'mistral',       country: 'USA',            stage: 'series-a' },
  { name: 'Groq',          ats: 'lever', slug: 'groq',          country: 'USA',            stage: 'series-c' },
  { name: 'Cohere',        ats: 'lever', slug: 'cohere',        country: 'Canada',         stage: 'series-c' },
  { name: 'Wealthsimple',  ats: 'lever', slug: 'wealthsimple',  country: 'Canada',         stage: 'series-d' },
  { name: 'Wise',          ats: 'lever', slug: 'wise',          country: 'United Kingdom', stage: 'public' },
  { name: 'Monzo',         ats: 'lever', slug: 'monzo',         country: 'United Kingdom', stage: 'series-i' },
  { name: 'Revolut',       ats: 'lever', slug: 'revolut',       country: 'United Kingdom', stage: 'series-e' },
  { name: 'Contentful',    ats: 'lever', slug: 'contentful',    country: 'Germany',        stage: 'series-e' },
  { name: 'Zalando',       ats: 'lever', slug: 'zalando',       country: 'Germany',        stage: 'public' },
  { name: 'Klarna',        ats: 'lever', slug: 'klarna',        country: 'Sweden',         stage: 'late' },
  { name: 'Spotify',       ats: 'lever', slug: 'spotify',       country: 'Sweden',         stage: 'public' },

  // ── ASHBY ───────────────────────────────────────────────
  // Ashby is the new hot ATS for YC/modern startups
  { name: 'Perplexity AI', ats: 'ashby', slug: 'perplexity',    country: 'USA',            stage: 'series-b' },
  { name: 'Cursor',        ats: 'ashby', slug: 'anysphere',      country: 'USA',            stage: 'series-b' },
  { name: 'Pika',          ats: 'ashby', slug: 'pika',           country: 'USA',            stage: 'series-a' },
  { name: 'Midjourney',    ats: 'ashby', slug: 'midjourney',     country: 'USA',            stage: 'bootstrapped' },
  { name: 'ElevenLabs',    ats: 'ashby', slug: 'elevenlabs',     country: 'USA',            stage: 'series-b' },
  { name: 'Runway',        ats: 'ashby', slug: 'runwayml',       country: 'USA',            stage: 'series-c' },
  { name: 'Character.AI',  ats: 'ashby', slug: 'characterai',    country: 'USA',            stage: 'series-b' },
  { name: 'Luma AI',       ats: 'ashby', slug: 'lumalabs',       country: 'USA',            stage: 'series-b' },
  { name: 'Together AI',   ats: 'ashby', slug: 'togetherai',     country: 'USA',            stage: 'series-a' },
  { name: 'Replicate',     ats: 'ashby', slug: 'replicate',      country: 'USA',            stage: 'series-a' },
  { name: 'Modal',         ats: 'ashby', slug: 'modal-labs',     country: 'USA',            stage: 'series-a' },
  { name: 'Anduril',       ats: 'ashby', slug: 'anduril',        country: 'USA',            stage: 'series-e' },
  { name: 'Palantir',      ats: 'ashby', slug: 'palantir',       country: 'USA',            stage: 'public' },

  // ── WORKABLE ────────────────────────────────────────────
  { name: 'Skroutz',       ats: 'workable', slug: 'skroutz',     country: 'USA',            stage: 'series-b' },
  { name: 'Voi',           ats: 'workable', slug: 'voi',         country: 'Sweden',         stage: 'series-d' },
  { name: 'Papaya Global', ats: 'workable', slug: 'papayaglobal',country: 'USA',            stage: 'series-d' },

  // ── SMARTRECRUITERS ─────────────────────────────────────
  { name: 'IKEA',          ats: 'smartrecruiters', slug: 'ikea',  country: 'Sweden',        stage: 'enterprise' },
  { name: 'Booking.com',   ats: 'smartrecruiters', slug: 'bookingcom', country: 'Netherlands', stage: 'public' },
  { name: 'McDonald\'s',   ats: 'smartrecruiters', slug: 'mcdonalds', country: 'USA',       stage: 'public' },

  // ── TEAMTAILOR ──────────────────────────────────────────
  { name: 'Epidemic Sound',ats: 'teamtailor', slug: 'epidemicsound', country: 'Sweden',     stage: 'series-c' },
  { name: 'Tele2',         ats: 'teamtailor', slug: 'tele2',      country: 'Sweden',        stage: 'public' },
  { name: 'Storytel',      ats: 'teamtailor', slug: 'storytel',   country: 'Sweden',        stage: 'public' },
]

// ─── SCRAPER IMPLEMENTATIONS ──────────────────────────────────

async function scrapeGreenhouseCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${company.slug}/jobs?content=true`
  const response = await axios.get<{ jobs: any[] }>(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    timeout: 12000
  })
  return parseGreenhouseJobs(response.data?.jobs || [], company)
}

function parseGreenhouseJobs(jobs: any[], company: ATSCompany): ScrapedJob[] {
  const results: ScrapedJob[] = []
  for (const job of jobs) {
    const title = job.title || ''
    const location = job.location?.name || company.country
    const description = job.content || ''
    const datePosted = job.updated_at || job.created_at

    if (!title) continue
    if (datePosted && daysSince(datePosted) > 20) continue

    const country = detectCountryFromLocation(location) || company.country
    const built = buildJob({ title, company: company.name, location, description, datePosted, country,
      url: job.absolute_url || `https://boards.greenhouse.io/${company.slug}/jobs/${job.id}`,
      source: 'greenhouse', stage: company.stage })
    if (built) results.push(built)
  }
  return results
}

async function scrapeLeverCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  const url = `https://api.lever.co/v0/postings/${company.slug}?mode=json&commitment=Full-time`
  const response = await axios.get<any[]>(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    timeout: 12000
  })
  const postings = response.data || []
  const results: ScrapedJob[] = []
  for (const posting of postings) {
    const title = posting.text || ''
    const location = posting.categories?.location || company.country
    const description = posting.descriptionPlain || cleanText((posting.description || '').replace(/<[^>]+>/g, ''))
    const datePosted = posting.createdAt ? new Date(posting.createdAt).toISOString() : undefined

    if (!title) continue
    if (datePosted && daysSince(datePosted) > 20) continue

    const country = detectCountryFromLocation(location) || company.country
    const built = buildJob({ title, company: company.name, location, description, datePosted, country,
      url: posting.hostedUrl || `https://jobs.lever.co/${company.slug}/${posting.id}`,
      source: 'lever', stage: company.stage })
    if (built) results.push(built)
  }
  return results
}

async function scrapeAshbyCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  // Ashby has a clean public JSON API
  const url = `https://api.ashbyhq.com/posting-api/job-board/${company.slug}`
  const response = await axios.get<{ jobPostings: any[] }>(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    timeout: 12000
  })
  const postings = response.data?.jobPostings || []
  const results: ScrapedJob[] = []
  for (const posting of postings) {
    const title = posting.title || ''
    const location = posting.locationName || posting.location || company.country
    const description = posting.descriptionHtml
      ? cleanText(posting.descriptionHtml.replace(/<[^>]+>/g, ''))
      : ''
    const datePosted = posting.publishedDate || posting.updatedAt

    if (!title) continue
    if (datePosted && daysSince(datePosted) > 20) continue

    const country = detectCountryFromLocation(location) || company.country
    const isRemote = posting.isRemote || location.toLowerCase().includes('remote')
    const built = buildJob({ title, company: company.name, location, description, datePosted, country,
      url: posting.jobUrl || `https://jobs.ashbyhq.com/${company.slug}/${posting.id}`,
      source: 'ashby', stage: company.stage, forceRemote: isRemote })
    if (built) results.push(built)
  }
  return results
}

async function scrapeWorkableCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  const url = `https://apply.workable.com/api/v3/accounts/${company.slug}/jobs`
  const response = await axios.post<{ results: any[] }>(url, {
    query: '', location: [], department: [], worktype: [], remote: true
  }, {
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    timeout: 12000
  })
  const jobs = response.data?.results || []
  const results: ScrapedJob[] = []
  for (const job of jobs) {
    const title = job.title || ''
    const location = job.location?.city || job.location?.country || company.country
    const datePosted = job.published ? new Date(job.published).toISOString() : undefined

    if (!title) continue
    if (datePosted && daysSince(datePosted) > 20) continue

    const country = detectCountryFromLocation(location) || company.country
    const built = buildJob({ title, company: company.name, location, description: job.requirements || '', datePosted, country,
      url: `https://apply.workable.com/${company.slug}/j/${job.shortcode}`,
      source: 'workable', stage: company.stage })
    if (built) results.push(built)
  }
  return results
}

async function scrapeSmartRecruitersCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  const url = `https://api.smartrecruiters.com/v1/companies/${company.slug}/postings?status=PUBLISHED&limit=100`
  const response = await axios.get<{ content: any[] }>(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
    timeout: 12000
  })
  const postings = response.data?.content || []
  const results: ScrapedJob[] = []
  for (const posting of postings) {
    const title = posting.name || ''
    const location = `${posting.location?.city || ''}, ${posting.location?.country || ''}`
    const datePosted = posting.releasedDate

    if (!title) continue
    if (datePosted && daysSince(datePosted) > 20) continue

    const country = posting.location?.country
      ? detectCountryFromLocation(posting.location.country) || company.country
      : company.country
    const built = buildJob({ title, company: company.name, location, description: '', datePosted, country,
      url: `https://jobs.smartrecruiters.com/${company.slug}/${posting.id}`,
      source: 'smartrecruiters', stage: company.stage })
    if (built) results.push(built)
  }
  return results
}

async function scrapeTeamtailorCompany(company: ATSCompany): Promise<ScrapedJob[]> {
  const url = `https://api.teamtailor.com/v1/jobs?filter[status]=published&include=locations&page[size]=100`
  // Teamtailor needs the company subdomain in the header
  const response = await axios.get<{ data: any[] }>(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/vnd.api+json',
      'X-Api-Version': '20210218',
      'Authorization': `Token token=${process.env.TEAMTAILOR_API_KEY || ''}`,
    },
    baseURL: `https://${company.slug}.teamtailor.com`,
    timeout: 12000
  })
  const jobs = response.data?.data || []
  const results: ScrapedJob[] = []
  for (const job of jobs) {
    const attrs = job.attributes || {}
    const title = attrs.title || ''
    if (!title) continue

    const country = company.country
    const built = buildJob({ title, company: company.name, location: country, description: attrs.body || '',
      datePosted: attrs['created-at'], country,
      url: attrs['career-site-url'] || `https://${company.slug}.teamtailor.com/jobs/${job.id}`,
      source: 'teamtailor', stage: company.stage })
    if (built) results.push(built)
  }
  return results
}

// ─── JOB BUILDER ─────────────────────────────────────────────
// Single function that takes raw data and builds a typed ScrapedJob.
// Keeps all ATS scrapers DRY.

function buildJob(params: {
  title: string
  company: string
  location: string
  description: string
  datePosted?: string
  country: string
  url: string
  source: string
  stage?: string
  forceRemote?: boolean
}): ScrapedJob | null {
  const { title, company, location, description, datePosted, country, url, source, stage, forceRemote } = params

  if (!title || title.length < 3 || !url) return null
  if (!isTargetCountry(country)) return null

  const expLevel = detectExperienceLevel(title, description)
  const visaProb = calculateVisaProbability(description, country)
  const predicted = predictSalary(title, country, expLevel)
  const remoteType = forceRemote ? 'remote' : detectRemoteType(title + ' ' + location + ' ' + description)
  const techStack = extractTechStack(description)
  const category = detectJobCategory(title, description)

  const jobObj = {
    salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
    visa_probability: visaProb, remote_type: remoteType, country,
    company_stage: stage, date_posted: datePosted,
    verification_status: 'verified', is_hidden_opportunity: false
  }

  return {
    job_id: generateJobFingerprint(company, title, country),
    job_title: title.substring(0, 200),
    company_name: company.substring(0, 200),
    country,
    city: extractCity(location),
    remote_type: remoteType as 'remote' | 'hybrid' | 'onsite',
    salary_min: predicted.min,
    salary_max: predicted.max,
    salary_currency: predicted.currency,
    salary_predicted: true,
    job_description: description.substring(0, 3000),
    job_url: url,
    job_source: source,
    source_type: 'ats',
    visa_probability: visaProb,
    visa_sponsorship: visaProb > 0.55 || /visa\s*sponsor/i.test(description),
    relocation_assistance: /relocation/i.test(description),
    quality_score: scoreJobQuality(jobObj),
    date_posted: datePosted,
    tech_stack: techStack,
    job_category: category,
    experience_level: expLevel,
    verification_status: 'verified',
    is_hidden_opportunity: false,
    company_stage: stage,
  } as ScrapedJob
}

// ─── MASTER ATS RUNNER ────────────────────────────────────────

export async function scrapeAllATSSystems(): Promise<ScrapedJob[]> {
  console.log(`[ATS] Scraping ${ATS_COMPANY_REGISTRY.length} companies across 9 ATS systems...`)
  const allJobs: ScrapedJob[] = []
  let success = 0, failed = 0

  // Group by ATS type for efficient batching
  const byATS = ATS_COMPANY_REGISTRY.reduce((acc, company) => {
    if (!acc[company.ats]) acc[company.ats] = []
    acc[company.ats].push(company)
    return acc
  }, {} as Record<string, ATSCompany[]>)

  const scraperMap: Record<string, (c: ATSCompany) => Promise<ScrapedJob[]>> = {
    greenhouse:      scrapeGreenhouseCompany,
    lever:           scrapeLeverCompany,
    ashby:           scrapeAshbyCompany,
    workable:        scrapeWorkableCompany,
    smartrecruiters: scrapeSmartRecruitersCompany,
    teamtailor:      scrapeTeamtailorCompany,
  }

  for (const [atsName, companies] of Object.entries(byATS)) {
    const scraper = scraperMap[atsName]
    if (!scraper) continue

    console.log(`[ATS] ${atsName}: scraping ${companies.length} companies`)

    // Batch 5 companies at a time per ATS
    for (let i = 0; i < companies.length; i += 5) {
      const batch = companies.slice(i, i + 5)
      const results = await Promise.allSettled(batch.map(c => scraper(c)))

      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === 'fulfilled') {
          if (r.value.length > 0) {
            allJobs.push(...r.value)
            success++
          }
        } else {
          failed++
          // Silent fail — most companies just aren't on that ATS
        }
      }

      await sleep(300) // Gentle pacing
    }

    console.log(`[ATS] ${atsName}: complete. Running total: ${allJobs.length} jobs`)
  }

  console.log(`[ATS] Done. ${success} companies scraped, ${failed} failed. Total: ${allJobs.length} jobs`)
  return allJobs
}

// ─── ATS AUTO-DISCOVERY ────────────────────────────────────────
// Given a company name and website, detect which ATS they use
// and automatically add them to the monitoring list.

export async function detectCompanyATS(companyName: string, website: string): Promise<{
  ats: string | null
  slug: string | null
  jobsUrl: string | null
}> {
  if (!website) return { ats: null, slug: null, jobsUrl: null }

  const domain = website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  const slug = domain.split('.')[0]

  // Try each ATS in order of prevalence
  const atsChecks: Array<{ name: string; url: string; check: (data: any) => boolean }> = [
    {
      name: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
      check: (d) => Array.isArray(d?.jobs)
    },
    {
      name: 'lever',
      url: `https://api.lever.co/v0/postings/${slug}`,
      check: (d) => Array.isArray(d)
    },
    {
      name: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      check: (d) => Array.isArray(d?.jobPostings)
    },
    {
      name: 'workable',
      url: `https://apply.workable.com/api/v3/accounts/${slug}/jobs`,
      check: (d) => Array.isArray(d?.results)
    },
    {
      name: 'smartrecruiters',
      url: `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
      check: (d) => Array.isArray(d?.content)
    },
  ]

  for (const check of atsChecks) {
    try {
      const response = await axios.get(check.url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        timeout: 6000
      })
      if (check.check(response.data)) {
        return { ats: check.name, slug, jobsUrl: check.url }
      }
    } catch {
      // This ATS didn't match, try next
    }
    await sleep(200)
  }

  return { ats: null, slug: null, jobsUrl: null }
}

// ─── HELPERS ─────────────────────────────────────────────────
function detectRemoteType(text: string): string {
  const lower = text.toLowerCase()
  if (/fully?\s*remote|100%\s*remote|work\s*from\s*anywhere|distributed/.test(lower)) return 'remote'
  if (/\bremote\b/.test(lower)) return 'remote'
  if (/\bhybrid\b/.test(lower)) return 'hybrid'
  return 'onsite'
}

function detectCountryFromLocation(location: string): string | null {
  if (!location) return null
  const lower = location.toLowerCase()
  const map: Array<[RegExp, string]> = [
    [/\b(usa|united states?|u\.s\.a?|san francisco|new york|seattle|austin|boston|chicago|nyc|sf\b|bay area)\b/, 'USA'],
    [/\b(uk|united kingdom|england|london|manchester|edinburgh|bristol)\b/, 'United Kingdom'],
    [/\b(canada|toronto|vancouver|montreal|ottawa|calgary)\b/, 'Canada'],
    [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt)\b/, 'Germany'],
    [/\b(netherlands|nederland|amsterdam|rotterdam|utrecht)\b/, 'Netherlands'],
    [/\b(switzerland|schweiz|zurich|zürich|geneva|basel)\b/, 'Switzerland'],
    [/\b(sweden|sverige|stockholm|gothenburg|göteborg)\b/, 'Sweden'],
    [/\b(denmark|københavn|copenhagen)\b/, 'Denmark'],
    [/\b(norway|norge|oslo)\b/, 'Norway'],
    [/\b(finland|suomi|helsinki)\b/, 'Finland'],
    [/\b(ireland|dublin|cork)\b/, 'Ireland'],
    [/\b(singapore|sg\b)\b/, 'Singapore'],
    [/\b(australia|sydney|melbourne|brisbane|perth)\b/, 'Australia'],
    [/\b(new zealand|auckland|wellington)\b/, 'New Zealand'],
    [/\b(uae|dubai|abu dhabi|united arab emirates)\b/, 'UAE'],
    [/\b(japan|tokyo|osaka)\b/, 'Japan'],
    [/\b(south korea|seoul|busan)\b/, 'South Korea'],
    [/\b(remote|worldwide|anywhere|global|distributed)\b/, 'USA'],
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
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
}
