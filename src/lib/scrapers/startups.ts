// ============================================================
// STARTUP DISCOVERY SYSTEM
// Sources: Product Hunt, YC Directory, Crunchbase-like signals
// ============================================================

import { safeFetch, safeJsonFetch, parseHTML, cleanText, sleep } from './base'
import { generateJobFingerprint, predictSalary, detectExperienceLevel,
  scoreJobQuality, calculateVisaProbability, detectHiringSignals } from '../ai/detector'
import type { ScrapedJob } from './jobboards'

export interface DiscoveredStartup {
  name: string
  website?: string
  description?: string
  logo?: string
  batch?: string
  source: string
  source_url?: string
  upvotes?: number
  launch_date?: string
}

export interface RadarSignal {
  company_name: string
  company_url?: string
  company_logo?: string
  signal_type: string
  signal_description?: string
  signal_source: string
  signal_url?: string
  signal_date?: string
  hiring_probability: number
  predicted_roles: string[]
  predicted_timeline: string
}

// ============================================================
// PRODUCT HUNT - Daily new startups
// ============================================================
export async function scrapeProductHunt(): Promise<DiscoveredStartup[]> {
  console.log('[ProductHunt] Scraping recent launches...')
  const startups: DiscoveredStartup[] = []

  // Product Hunt has a public API
  const today = new Date()
  const dateStr = today.toISOString().split('T')[0]

  const html = await safeFetch(`https://www.producthunt.com/leaderboard/daily/${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}/all`)
  if (!html) return []

  const $ = parseHTML(html)

  // Parse product cards
  $('[data-test="product-item"]').each((_, el) => {
    const name = $(el).find('[data-test="product-name"]').text().trim()
    const description = $(el).find('[data-test="product-tagline"]').text().trim()
    const logo = $(el).find('img').first().attr('src')
    const upvotes = parseInt($(el).find('[data-test="vote-button"]').text().replace(/[^\d]/g, '') || '0')
    const href = $(el).find('a').first().attr('href') || ''

    if (!name) return

    startups.push({
      name,
      description,
      logo,
      source: 'producthunt',
      source_url: href.startsWith('http') ? href : `https://producthunt.com${href}`,
      upvotes,
      launch_date: new Date().toISOString()
    })
  })

  console.log(`[ProductHunt] Found ${startups.length} new startups`)
  return startups
}

// ============================================================
// Y COMBINATOR STARTUP DIRECTORY
// ============================================================
export async function scrapeYCDirectory(): Promise<DiscoveredStartup[]> {
  console.log('[YC Directory] Fetching recent batches...')
  const startups: DiscoveredStartup[] = []

  // YC has a public company listing
  const batches = ['W24', 'S23', 'W23'] // Recent batches
  
  for (const batch of batches) {
    const data = await safeJsonFetch<any>(
      `https://api.ycombinator.com/v0.1/companies?batch=${batch}&page=1&per_page=50`
    )

    if (!data?.companies) continue

    for (const company of data.companies) {
      startups.push({
        name: company.name,
        website: company.url,
        description: company.one_liner || company.long_description,
        logo: company.small_logo_thumb_url,
        batch: company.batch,
        source: 'ycombinator',
        source_url: `https://www.ycombinator.com/companies/${company.slug}`,
        launch_date: company.launched_at
      })
    }
    await sleep(1000)
  }

  console.log(`[YC] Found ${startups.length} startups`)
  return startups
}

// ============================================================
// TECHCRUNCH FUNDING RADAR
// ============================================================
export async function scrapeTechCrunchFunding(): Promise<RadarSignal[]> {
  console.log('[TechCrunch] Scanning funding news...')
  const signals: RadarSignal[] = []

  const rssUrl = 'https://techcrunch.com/feed/'
  const xml = await safeFetch(rssUrl)
  if (!xml) return []

  const $ = parseHTML(xml)
  const items = $('item')

  items.each((_, el) => {
    const title = cleanText($(el).find('title').text())
    const description = cleanText($(el).find('description').text())
    const url = $(el).find('link').text()
    const pubDate = $(el).find('pubDate').text()
    const fullText = `${title} ${description}`

    // Filter for funding/hiring news
    const { signalType, confidence, signals: detectedSignals } = detectHiringSignals(fullText)

    if (confidence < 0.3) return

    // Extract company name (often in title)
    const companyMatch = title.match(/^([A-Z][a-zA-Z\s]+?)\s+(?:raises|launches|announces|secures|closes)/i)
    if (!companyMatch) return

    const companyName = companyMatch[1].trim()

    // Predict roles based on signal type
    const predictedRoles: string[] = []
    if (signalType === 'funding') {
      predictedRoles.push('Senior Software Engineer', 'Engineering Manager', 'Product Manager')
    } else if (signalType === 'launch') {
      predictedRoles.push('Software Engineer', 'Designer', 'Marketing Manager')
    }

    // Check if it mentions hiring amount
    const amountMatch = title.match(/\$(\d+(?:\.\d+)?)\s*(million|billion|m\b|b\b)/i)
    let hiringProbability = confidence
    if (amountMatch) {
      const amount = parseFloat(amountMatch[1])
      const unit = amountMatch[2].toLowerCase()
      const usdAmount = unit.startsWith('b') ? amount * 1000 : amount
      if (usdAmount > 50) hiringProbability = Math.min(0.95, hiringProbability + 0.2)
      if (usdAmount > 10) hiringProbability = Math.min(0.95, hiringProbability + 0.1)
    }

    signals.push({
      company_name: companyName,
      company_url: undefined,
      signal_type: signalType,
      signal_description: title,
      signal_source: 'techcrunch',
      signal_url: url,
      signal_date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      hiring_probability: hiringProbability,
      predicted_roles: predictedRoles,
      predicted_timeline: signalType === 'funding' ? '1-3 months' : '3-6 months'
    })
  })

  console.log(`[TechCrunch] Found ${signals.length} hiring signals`)
  return signals
}

// ============================================================
// CAREER PAGE DETECTOR
// Tries to find and scrape company career pages
// ============================================================
const CAREER_PATHS = [
  '/careers', '/jobs', '/join', '/join-us', '/work-with-us',
  '/work-at', '/positions', '/openings', '/we-are-hiring',
  '/team', '/about/careers', '/company/careers', '/careers/open-roles'
]

export async function findAndScrapeCareerPage(
  companyName: string,
  companyUrl: string
): Promise<{ found: boolean; careerUrl?: string; jobs: ScrapedJob[] }> {
  const jobs: ScrapedJob[] = []

  // Normalize URL
  const baseUrl = companyUrl.replace(/\/$/, '')
  if (!baseUrl.startsWith('http')) return { found: false, jobs: [] }

  let careerUrl: string | undefined

  // Try each career path
  for (const path of CAREER_PATHS) {
    const url = `${baseUrl}${path}`
    const html = await safeFetch(url, { timeout: 8000 })
    if (!html) continue

    const $ = parseHTML(html)
    const bodyText = $('body').text().toLowerCase()

    // Check if this looks like a jobs page
    const jobKeywords = ['engineer', 'developer', 'designer', 'manager', 'apply', 'opening', 'position']
    const matches = jobKeywords.filter(kw => bodyText.includes(kw)).length

    if (matches >= 2) {
      careerUrl = url

      // Try to extract job listings
      $('a').each((_, el) => {
        const href = $(el).attr('href') || ''
        const text = $(el).text().trim()

        if (text.length < 8 || text.length > 150) return

        const isJobLink = (
          /engineer|developer|designer|manager|analyst|lead|architect|scientist/i.test(text) ||
          href.includes('/job') || href.includes('/position') || href.includes('/opening')
        )

        if (!isJobLink) return

        const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? href : '/' + href}`
        const expLevel = detectExperienceLevel(text)
        const visaProb = calculateVisaProbability('', 'USA')
        const predicted = predictSalary(text, 'USA', expLevel)

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, visa_probability: visaProb,
          remote_type: 'onsite' as const, country: 'USA',
          company_stage: undefined, date_posted: new Date().toISOString(),
          verification_status: 'verified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(companyName, text, 'careers'),
          job_title: text,
          company_name: companyName,
          country: 'USA',
          remote_type: 'onsite',
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_url: fullUrl,
          job_source: 'careers_page',
          source_type: 'career_page',
          visa_probability: visaProb,
          visa_sponsorship: true,
          relocation_assistance: true,
          quality_score: scoreJobQuality(jobObj),
          date_posted: new Date().toISOString(),
          tech_stack: [],
          job_category: detectJobCategory(text),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      })

      break
    }

    await sleep(500)
  }

  return { found: !!careerUrl, careerUrl, jobs }
}

// ============================================================
// REDDIT HIRING SCANNER
// ============================================================
export async function scrapeRedditHiring(): Promise<ScrapedJob[]> {
  console.log('[Reddit] Scanning hiring subreddits...')
  const jobs: ScrapedJob[] = []

  const subreddits = ['forhire', 'remotejobs', 'techjobs']

  for (const sub of subreddits) {
    const data = await safeJsonFetch<any>(
      `https://www.reddit.com/r/${sub}/new.json?limit=50`,
      { 'User-Agent': 'JobBot/1.0 (Personal Job Discovery)' }
    )

    if (!data?.data?.children) continue

    for (const post of data.data.children) {
      const p = post.data
      if (!p.title || p.is_self === false) continue

      const title = p.title
      const text = p.selftext || ''
      const fullText = `${title} ${text}`

      // Only "hiring" posts (not "for hire")
      if (!/\[hiring\]|\bhiring\b/i.test(title)) continue

      // Extract details
      const salaryData = extractSalaryFromReddit(title)
      const country = detectCountryFromText(fullText)

      if (!isTargetCountry(country)) continue

      const expLevel = detectExperienceLevel(title, text)
      const visaProb = calculateVisaProbability(text, country)
      const predicted = !salaryData.min ? predictSalary(title, country, expLevel) : null

      const salaryMin = salaryData.min || predicted?.min
      const salaryMax = salaryData.max || predicted?.max
      const salaryCurrency = salaryData.currency || predicted?.currency || 'USD'

      const datePosted = new Date(p.created_utc * 1000).toISOString()
      const daysAgo = (Date.now() - p.created_utc * 1000) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue

      const jobObj = {
        salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
        visa_probability: visaProb, remote_type: detectRemoteFromText(fullText),
        country, company_stage: undefined, date_posted: datePosted,
        verification_status: 'unverified', is_hidden_opportunity: true
      }

      jobs.push({
        job_id: generateJobFingerprint(p.author || 'reddit', title, country),
        job_title: title.replace(/\[hiring\]/i, '').trim().substring(0, 200),
        company_name: p.author || 'Reddit Poster',
        country,
        remote_type: detectRemoteFromText(fullText),
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
        salary_predicted: !salaryData.min,
        job_description: text.substring(0, 2000),
        job_url: `https://reddit.com${p.permalink}`,
        job_source: 'reddit',
        source_type: 'social',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: /relocation/i.test(fullText),
        quality_score: scoreJobQuality(jobObj as any),
        date_posted: datePosted,
        tech_stack: extractTechStackFromText(fullText),
        job_category: detectJobCategory(title, text),
        experience_level: expLevel,
        verification_status: 'unverified',
        is_hidden_opportunity: true
      })
    }
    await sleep(2000) // Respect Reddit rate limits
  }

  console.log(`[Reddit] Found ${jobs.length} jobs`)
  return jobs
}

// Helper functions
function extractSalaryFromReddit(text: string): { min?: number; max?: number; currency?: string } {
  const match = text.match(/\$(\d+)k?\s*[-–]\s*\$?(\d+)k?|\$(\d+),?(\d{3})/i)
  if (!match) return {}
  const parseVal = (s: string) => { const n = parseInt(s.replace(',', '')); return n < 1000 ? n * 1000 : n }
  return { min: match[1] ? parseVal(match[1]) : undefined, max: match[2] ? parseVal(match[2]) : undefined, currency: 'USD' }
}

function detectCountryFromText(text: string): string {
  const lower = text.toLowerCase()
  if (/\b(usa|united states|san francisco|new york|seattle|austin|boston)\b/.test(lower)) return 'USA'
  if (/\b(canada|toronto|vancouver|montreal)\b/.test(lower)) return 'Canada'
  if (/\b(uk|united kingdom|london|manchester)\b/.test(lower)) return 'United Kingdom'
  if (/\b(germany|berlin|munich|hamburg)\b/.test(lower)) return 'Germany'
  if (/\b(netherlands|amsterdam|rotterdam)\b/.test(lower)) return 'Netherlands'
  if (/\b(singapore)\b/.test(lower)) return 'Singapore'
  if (/\b(australia|sydney|melbourne)\b/.test(lower)) return 'Australia'
  if (/\b(remote|anywhere|worldwide|global)\b/.test(lower)) return 'USA' // Default remote to USA
  return 'USA'
}

function detectRemoteFromText(text: string): 'remote' | 'hybrid' | 'onsite' {
  const lower = text.toLowerCase()
  if (/fully?\s*remote|100%\s*remote|work\s*from\s*anywhere/.test(lower)) return 'remote'
  if (/hybrid/.test(lower)) return 'hybrid'
  if (/remote/.test(lower)) return 'remote'
  return 'onsite'
}

function extractTechStackFromText(text: string): string[] {
  const techs = ['JavaScript', 'TypeScript', 'Python', 'React', 'Node.js', 'AWS', 'Go', 'Rust', 'Vue', 'Angular', 'Django', 'PostgreSQL', 'MongoDB', 'Docker', 'Kubernetes']
  return techs.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(text))
}

function detectJobCategory(title: string, desc?: string): string {
  const text = `${title} ${desc || ''}`.toLowerCase()
  if (/engineer|developer|programmer/.test(text)) return 'engineering'
  if (/designer|ux|ui/.test(text)) return 'design'
  if (/data\s*scientist|ml|machine\s*learning/.test(text)) return 'data-ai'
  if (/product\s*manager/.test(text)) return 'product'
  return 'other'
}

import { isTargetCountry } from './base'
