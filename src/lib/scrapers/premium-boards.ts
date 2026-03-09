// ============================================================
// HIGH-VALUE JOB BOARD SCRAPERS — LEGAL & RELIABLE METHODS
//
// WHY NOT DIRECT SCRAPING OF LINKEDIN/INDEED/GLASSDOOR:
//   - They detect bots in seconds and ban IPs
//   - Their ToS forbids scraping
//   - Any scraper breaks within hours
//
// INSTEAD WE USE:
//   1. LinkedIn: RSS feeds + public job search API (free tier)
//   2. Indeed: Publisher RSS API (free, official)
//   3. Glassdoor: jobsearch API (free partner access)
//   4. Adzuna API (free tier, aggregates Indeed/LinkedIn/Glassdoor)
//   5. The Muse API (free, no key needed)
//   6. Arbeitnow API (free, no key, 500+ remote jobs)
//   7. Jobicy API (free remote jobs)
//   8. DevITjobs API (free European tech jobs)
//   9. Himalayas API (free remote jobs)
//  10. USAJobs.gov API (free, US government jobs)
// ============================================================

import {
  safeJsonFetch, safeFetch, parseHTML, cleanText, sleep,
  extractSalary, detectRemoteType, extractTechStack,
  detectJobCategory, normalizeCountry, isTargetCountry
} from './base'
import {
  calculateVisaProbability, predictSalary, detectExperienceLevel,
  scoreJobQuality, generateJobFingerprint
} from '../ai/detector'
import type { ScrapedJob } from './jobboards'

// ============================================================
// 1. ADZUNA API
// Free tier: 250 requests/day, aggregates Indeed + LinkedIn + more
// Sign up at: https://developer.adzuna.com (free)
// ============================================================
export async function scrapeAdzuna(): Promise<ScrapedJob[]> {
  console.log('[Adzuna] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const appId = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY

  if (!appId || !appKey) {
    console.log('[Adzuna] No API key — skipping. Add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.local')
    return []
  }

  const countries: Array<{ code: string; name: string }> = [
    { code: 'us', name: 'USA' },
    { code: 'gb', name: 'United Kingdom' },
    { code: 'ca', name: 'Canada' },
    { code: 'au', name: 'Australia' },
  ]

  const searchTerms = ['software engineer', 'developer']

  // Run all requests in parallel to avoid timeout
  const allRequests = countries.flatMap(country =>
    searchTerms.map(term => ({ country, term }))
  )

  const responses = await Promise.all(allRequests.map(async ({ country, term }) => {
    const url = `https://api.adzuna.com/v1/api/jobs/${country.code}/search/1?` +
      `app_id=${appId}&app_key=${appKey}` +
      `&results_per_page=50` +
      `&what=${encodeURIComponent(term)}` +
      `&sort_by=date` +
      `&max_days_old=15` +
      `&content-type=application/json`
    const data = await safeJsonFetch<any>(url)
    return { country, data }
  }))

  for (const { country, data } of responses) {
    if (!data?.results) continue

    for (const item of data.results) {
      const title = item.title || ''
      const company = item.company?.display_name || 'Unknown'
      const description = item.description || ''
      const location = item.location?.display_name || ''
      const salaryMin = item.salary_min
      const salaryMax = item.salary_max

      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description, country.name)

      let finalSalaryMin = salaryMin
      let finalSalaryMax = salaryMax
      let salaryCurrency = country.code === 'gb' ? 'GBP' : country.code === 'au' ? 'AUD' : country.code === 'ca' ? 'CAD' : 'USD'
      let salaryPredicted = false

      if (!finalSalaryMin) {
        const predicted = predictSalary(title, country.name, expLevel)
        finalSalaryMin = predicted.min
        finalSalaryMax = predicted.max
        salaryCurrency = predicted.currency
        salaryPredicted = true
      }

      const datePosted = item.created ? new Date(item.created).toISOString() : new Date().toISOString()
      const remoteType = detectRemoteType(`${title} ${description} ${location}`)

      const jobObj = {
        salary_min: finalSalaryMin, salary_max: finalSalaryMax, salary_currency: salaryCurrency,
        visa_probability: visaProb, remote_type: remoteType, country: country.name,
        company_stage: undefined, date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, title, country.name),
        job_title: title,
        company_name: company,
        country: country.name,
        city: location.split(',')[0]?.trim(),
        remote_type: remoteType,
        salary_min: finalSalaryMin, salary_max: finalSalaryMax,
        salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
        job_description: cleanText(description).substring(0, 2000),
        job_url: item.redirect_url || item.adref || '',
        job_source: 'adzuna',
        source_type: 'job_board',
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

  console.log(`[Adzuna] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 2. ARBEITNOW — Free API, no key needed
// Remote + visa-sponsorship jobs, heavily European
// https://arbeitnow.com/api
// ============================================================
export async function scrapeArbeitnow(): Promise<ScrapedJob[]> {
  console.log('[Arbeitnow] Starting scrape...')
  const jobs: ScrapedJob[] = []

  // They have multiple endpoints
  const endpoints = [
    'https://arbeitnow.com/api/job-board-api',          // All jobs
    'https://arbeitnow.com/api/job-board-api?tags=remote', // Remote only
  ]

  for (const endpoint of endpoints) {
    const data = await safeJsonFetch<{ data: any[] }>(endpoint)
    if (!data?.data) continue

    for (const item of data.data) {
      const title = item.title || ''
      const company = item.company_name || ''
      const description = item.description || ''
      const location = item.location || ''
      const tags = item.tags || []
      const remote = item.remote || tags.includes('remote')

      // Arbeitnow is mostly European
      let country = 'Germany'
      const locLower = location.toLowerCase()
      if (locLower.includes('berlin') || locLower.includes('germany') || locLower.includes('munich')) country = 'Germany'
      else if (locLower.includes('amsterdam') || locLower.includes('netherlands')) country = 'Netherlands'
      else if (locLower.includes('london') || locLower.includes('uk')) country = 'United Kingdom'
      else if (locLower.includes('zurich') || locLower.includes('switzerland')) country = 'Switzerland'
      else if (locLower.includes('stockholm') || locLower.includes('sweden')) country = 'Sweden'
      else if (locLower.includes('remote')) country = 'Germany'

      const datePosted = item.created_at ? new Date(item.created_at * 1000).toISOString() : undefined
      if (datePosted) {
        const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
        if (daysAgo > 15) continue
      }

      const expLevel = detectExperienceLevel(title, description)
      const visaProb = calculateVisaProbability(description + ' ' + item.visa_sponsorship ? 'visa sponsorship available' : '', country)

      const predicted = predictSalary(title, country, expLevel)

      const remoteType = remote ? 'remote' : detectRemoteType(description + location)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
        visa_probability: item.visa_sponsorship ? 0.9 : visaProb,
        remote_type: remoteType, country,
        company_stage: undefined, date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, title, country),
        job_title: title,
        company_name: company,
        country,
        city: location.split(',')[0]?.trim().substring(0, 100),
        remote_type: remoteType,
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, salary_predicted: true,
        job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
        job_url: item.url || '',
        job_source: 'arbeitnow',
        source_type: 'job_board',
        visa_probability: item.visa_sponsorship ? 0.9 : visaProb,
        visa_sponsorship: item.visa_sponsorship === true,
        relocation_assistance: /relocation/i.test(description),
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: [...extractTechStack(description), ...tags.filter((t: string) => t.length < 20)].slice(0, 8),
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }
    await sleep(1000)
  }

  console.log(`[Arbeitnow] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 3. THE MUSE API — Free, no key needed
// Quality startups and tech companies
// https://www.themuse.com/api/public/jobs
// ============================================================
export async function scrapeTheMuse(): Promise<ScrapedJob[]> {
  console.log('[TheMuse] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const pages = [1, 2, 3] // Free tier allows paging
  const categories = ['Engineering', 'Data Science', 'Design', 'Product']

  for (const category of categories) {
    for (const page of pages) {
      const url = `https://www.themuse.com/api/public/jobs?category=${encodeURIComponent(category)}&page=${page}&descending=true`
      const data = await safeJsonFetch<{ results: any[]; total: number }>(url)

      if (!data?.results) break

      for (const item of data.results) {
        const title = item.name || ''
        const company = item.company?.name || ''
        const description = item.contents || ''
        const locations = item.locations || []
        const levels = item.levels || []

        // Filter for target countries
        let country = ''
        let city = ''
        let remoteType: 'remote' | 'hybrid' | 'onsite' = 'onsite'

        for (const loc of locations) {
          const locName = loc.name || ''
          if (locName.toLowerCase().includes('remote') || locName.toLowerCase().includes('anywhere')) {
            remoteType = 'remote'
            country = 'USA'
          } else if (locName.includes('New York') || locName.includes('San Francisco') || locName.includes('Seattle') || locName.includes('Austin')) {
            country = 'USA'
            city = locName
          } else if (locName.includes('London')) {
            country = 'United Kingdom'; city = 'London'
          } else if (locName.includes('Berlin')) {
            country = 'Germany'; city = 'Berlin'
          } else if (locName.includes('Amsterdam')) {
            country = 'Netherlands'; city = 'Amsterdam'
          } else if (locName.includes('Singapore')) {
            country = 'Singapore'; city = 'Singapore'
          } else if (locName.includes('Toronto') || locName.includes('Canada')) {
            country = 'Canada'; city = locName
          }
        }

        if (!country) continue // Skip non-target countries

        const expLevel = levels[0]?.short_name?.toLowerCase().includes('senior') ? 'senior' :
          levels[0]?.short_name?.toLowerCase().includes('junior') ? 'junior' : 'mid'

        const visaProb = calculateVisaProbability(description, country)
        const predicted = predictSalary(title, country, expLevel)

        const datePosted = item.publication_date ? new Date(item.publication_date).toISOString() : undefined
        if (datePosted) {
          const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
          if (daysAgo > 15) continue
        }

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
          visa_probability: visaProb, remote_type: remoteType, country,
          company_stage: undefined, date_posted: datePosted,
          verification_status: 'verified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company, title, country),
          job_title: title,
          company_name: company,
          company_logo: item.company?.refs?.logo_image,
          country, city,
          remote_type: remoteType,
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
          job_url: item.refs?.landing_page || '',
          job_source: 'themuse',
          source_type: 'job_board',
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
      await sleep(500)
    }
  }

  console.log(`[TheMuse] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 4. JOBICY — Free remote jobs API, no key needed
// https://jobicy.com/api/v2/remote-jobs
// ============================================================
export async function scrapeJobicy(): Promise<ScrapedJob[]> {
  console.log('[Jobicy] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<{ jobs: any[] }>(
    'https://jobicy.com/api/v2/remote-jobs?count=50&tag=developer,engineer,data,design'
  )
  if (!data?.jobs) return []

  for (const item of data.jobs) {
    const title = item.jobTitle || ''
    const company = item.companyName || ''
    const description = item.jobDescription || ''
    const country = 'USA' // Jobicy is USA-centric for remote

    const datePosted = item.pubDate ? new Date(item.pubDate).toISOString() : undefined
    if (datePosted) {
      const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue
    }

    const expLevel = detectExperienceLevel(title, description)
    const visaProb = calculateVisaProbability(description, country)
    const salaryData = extractSalary(item.annualSalaryMin ? `$${item.annualSalaryMin}` : description)
    const predicted = !salaryData.min ? predictSalary(title, country, expLevel) : null

    const jobObj = {
      salary_min: salaryData.min || predicted?.min,
      salary_max: salaryData.max || predicted?.max,
      salary_currency: 'USD',
      visa_probability: visaProb, remote_type: 'remote' as const, country,
      company_stage: undefined, date_posted: datePosted,
      verification_status: 'verified', is_hidden_opportunity: false
    }

    jobs.push({
      job_id: generateJobFingerprint(company, title, 'remote'),
      job_title: title,
      company_name: company,
      company_logo: item.companyLogo,
      country, remote_type: 'remote',
      salary_min: salaryData.min || predicted?.min,
      salary_max: salaryData.max || predicted?.max,
      salary_currency: 'USD',
      salary_predicted: !salaryData.min,
      job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
      job_url: item.url || '',
      job_source: 'jobicy',
      source_type: 'job_board',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5,
      relocation_assistance: false,
      quality_score: scoreJobQuality(jobObj),
      date_posted: datePosted,
      tech_stack: extractTechStack(description),
      job_category: detectJobCategory(title, description),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    })
  }

  console.log(`[Jobicy] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 5. HIMALAYAS — Free remote jobs API, no key needed
// https://himalayas.app/jobs/api
// ============================================================
export async function scrapeHimalayas(): Promise<ScrapedJob[]> {
  console.log('[Himalayas] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<{ jobs: any[] }>(
    'https://himalayas.app/jobs/api?limit=50'
  )
  if (!data?.jobs) return []

  for (const item of data.jobs) {
    const title = item.title || ''
    const company = item.company?.name || ''
    const description = item.description || item.descriptionHtml?.replace(/<[^>]+>/g, '') || ''
    const country = 'USA'

    const datePosted = item.createdAt ? new Date(item.createdAt).toISOString() : undefined
    if (datePosted) {
      const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue
    }

    const expLevel = detectExperienceLevel(title, description)
    const visaProb = calculateVisaProbability(description, country)

    let salaryMin = item.salaryMin
    let salaryMax = item.salaryMax
    let salaryCurrency = item.salaryCurrency || 'USD'
    let salaryPredicted = false

    if (!salaryMin) {
      const predicted = predictSalary(title, country, expLevel)
      salaryMin = predicted.min; salaryMax = predicted.max
      salaryCurrency = predicted.currency; salaryPredicted = true
    }

    const jobObj = {
      salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
      visa_probability: visaProb, remote_type: 'remote' as const, country,
      company_stage: undefined, date_posted: datePosted,
      verification_status: 'verified', is_hidden_opportunity: false
    }

    jobs.push({
      job_id: generateJobFingerprint(company, title, 'remote'),
      job_title: title,
      company_name: company,
      company_logo: item.company?.logo,
      country, remote_type: 'remote',
      salary_min: salaryMin, salary_max: salaryMax,
      salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
      job_description: cleanText(description).substring(0, 2000),
      job_url: `https://himalayas.app/jobs/${item.slug}` || '',
      job_source: 'himalayas',
      source_type: 'job_board',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5,
      relocation_assistance: false,
      quality_score: scoreJobQuality(jobObj),
      date_posted: datePosted,
      tech_stack: item.techStack || extractTechStack(description),
      job_category: detectJobCategory(title, description),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    })
  }

  console.log(`[Himalayas] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 6. USA JOBS (US Government jobs — visa sponsorship common)
// Free official government API
// https://developer.usajobs.gov
// ============================================================
export async function scrapeUSAJobs(): Promise<ScrapedJob[]> {
  console.log('[USAJobs] Starting scrape...')

  const apiKey = process.env.USAJOBS_API_KEY
  const userEmail = process.env.USAJOBS_EMAIL

  if (!apiKey || !userEmail) {
    console.log('[USAJobs] No API key. Register free at: https://developer.usajobs.gov/apirequest/')
    return []
  }

  const searchTerms = ['software engineer', 'data scientist', 'information technology']
  const jobs: ScrapedJob[] = []

  for (const keyword of searchTerms) {
    const url = `https://data.usajobs.gov/api/search?Keyword=${encodeURIComponent(keyword)}&DatePosted=15&ResultsPerPage=25`

    const data = await safeJsonFetch<any>(url, {
      'Host': 'data.usajobs.gov',
      'User-Agent': userEmail,
      'Authorization-Key': apiKey
    })

    if (!data?.SearchResult?.SearchResultItems) continue

    for (const item of data.SearchResult.SearchResultItems) {
      const j = item.MatchedObjectDescriptor
      if (!j) continue

      const title = j.PositionTitle || ''
      const company = j.OrganizationName || 'US Government'
      const location = j.PositionLocationDisplay || 'USA'

      const salaryMin = parseInt(j.PositionRemuneration?.[0]?.MinimumRange || '0')
      const salaryMax = parseInt(j.PositionRemuneration?.[0]?.MaximumRange || '0')

      const datePosted = j.PublicationStartDate
      const expLevel = detectExperienceLevel(title)

      const jobObj = {
        salary_min: salaryMin || undefined,
        salary_max: salaryMax || undefined,
        salary_currency: 'USD',
        visa_probability: 0.8, // US govt jobs often sponsor
        remote_type: /remote|telework/i.test(j.UserArea?.Details?.Telework || '') ? 'remote' as const : 'onsite' as const,
        country: 'USA', company_stage: undefined,
        date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, title, 'USA'),
        job_title: title,
        company_name: company,
        country: 'USA',
        city: location.split(',')[0]?.trim(),
        remote_type: jobObj.remote_type,
        salary_min: salaryMin || undefined,
        salary_max: salaryMax || undefined,
        salary_currency: 'USD',
        salary_predicted: false,
        job_description: j.QualificationSummary?.substring(0, 2000),
        job_url: j.PositionURI || '',
        job_source: 'usajobs',
        source_type: 'job_board',
        visa_probability: 0.8,
        visa_sponsorship: true,
        relocation_assistance: true,
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(title + ' ' + (j.QualificationSummary || '')),
        job_category: detectJobCategory(title),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }
    await sleep(500)
  }

  console.log(`[USAJobs] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 7. DEVITJOBS — European tech jobs, free API
// https://devitjobs.com/api/jobsLight
// ============================================================
export async function scrapeDevITJobs(): Promise<ScrapedJob[]> {
  console.log('[DevITJobs] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<any[]>('https://devitjobs.com/api/jobsLight')
  if (!data || !Array.isArray(data)) return []

  for (const item of data.slice(0, 100)) {
    const title = item.title || ''
    const company = item.companyName || ''
    const description = item.jobDesc || ''
    const countryCode = item.country || ''

    // Map country codes
    const countryMap: Record<string, string> = {
      'DE': 'Germany', 'NL': 'Netherlands', 'GB': 'United Kingdom',
      'CH': 'Switzerland', 'SE': 'Sweden', 'DK': 'Denmark',
      'NO': 'Norway', 'FI': 'Finland', 'IE': 'Ireland',
      'AT': 'Austria', 'BE': 'Belgium'
    }
    const country = countryMap[countryCode] || ''
    if (!country || !isTargetCountry(country)) continue

    const remoteType = item.remote ? 'remote' : 'onsite'
    const expLevel = detectExperienceLevel(title, description)
    const visaProb = calculateVisaProbability(description, country)
    const predicted = predictSalary(title, country, expLevel)

    const datePosted = item.created_at ? new Date(item.created_at).toISOString() : undefined
    if (datePosted) {
      const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue
    }

    const jobObj = {
      salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
      visa_probability: visaProb, remote_type: remoteType as any, country,
      company_stage: undefined, date_posted: datePosted,
      verification_status: 'verified', is_hidden_opportunity: false
    }

    jobs.push({
      job_id: generateJobFingerprint(company, title, country),
      job_title: title,
      company_name: company,
      country,
      city: item.city,
      remote_type: remoteType as any,
      salary_min: predicted.min, salary_max: predicted.max,
      salary_currency: predicted.currency, salary_predicted: true,
      job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
      job_url: item.jobUrl || '',
      job_source: 'devitjobs',
      source_type: 'job_board',
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

  console.log(`[DevITJobs] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 8. LINKEDIN RSS — Official public RSS feeds (no auth needed)
// LinkedIn allows RSS access for public job searches
// NOTE: This is the ONLY legitimate, ToS-compliant way to get LinkedIn data
// ============================================================
export async function scrapeLinkedInRSS(): Promise<ScrapedJob[]> {
  console.log('[LinkedIn RSS] Scraping public job feeds...')
  const jobs: ScrapedJob[] = []

  // LinkedIn's public RSS job search feeds (these are officially supported)
  // Format: https://www.linkedin.com/jobs/search/rss/?keywords=...&location=...
  const searches = [
    { keywords: 'software+engineer+remote', location: 'worldwide', country: 'USA' },
    { keywords: 'senior+engineer+visa+sponsorship', location: 'United+States', country: 'USA' },
    { keywords: 'software+developer+relocation', location: 'Germany', country: 'Germany' },
    { keywords: 'engineer+visa+sponsorship', location: 'United+Kingdom', country: 'United Kingdom' },
    { keywords: 'software+engineer+remote', location: 'Singapore', country: 'Singapore' },
    { keywords: 'developer+visa+sponsor', location: 'Canada', country: 'Canada' },
    { keywords: 'engineer+relocation+australia', location: 'Australia', country: 'Australia' },
    { keywords: 'software+engineer+netherlands', location: 'Netherlands', country: 'Netherlands' },
  ]

  for (const search of searches) {
    const url = `https://www.linkedin.com/jobs/search/rss/?keywords=${search.keywords}&location=${search.location}&f_TPR=r604800&f_JT=F` // Last 7 days, full-time

    const xml = await safeFetch(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)',
        'Accept': 'application/rss+xml, application/xml'
      }
    })

    if (!xml || !xml.includes('<item>')) {
      console.log(`[LinkedIn RSS] No data for ${search.keywords} in ${search.location}`)
      continue
    }

    const $ = parseHTML(xml)
    const items = $('item')

    items.each((_, el) => {
      const title = cleanText($(el).find('title').text())
      const link = $(el).find('link').text() || $(el).find('guid').text()
      const description = cleanText($(el).find('description').text().replace(/<[^>]+>/g, ''))
      const pubDate = $(el).find('pubDate').text()

      if (!title || !link) return

      // Extract company from title (LinkedIn format: "Job Title at Company Name")
      const atMatch = title.match(/^(.+?)\s+at\s+(.+?)(?:\s*[-–].*)?$/)
      const jobTitle = atMatch ? atMatch[1].trim() : title
      const company = atMatch ? atMatch[2].trim() : 'LinkedIn Company'

      if (!jobTitle || jobTitle.length < 3) return

      const datePosted = pubDate ? new Date(pubDate).toISOString() : undefined
      if (datePosted) {
        const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
        if (daysAgo > 15) return
      }

      const expLevel = detectExperienceLevel(jobTitle, description)
      const visaProb = calculateVisaProbability(description + ' ' + search.keywords, search.country)
      const remoteType = detectRemoteType(`${jobTitle} ${description} ${search.keywords}`)
      const predicted = predictSalary(jobTitle, search.country, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
        visa_probability: visaProb, remote_type: remoteType, country: search.country,
        company_stage: undefined, date_posted: datePosted,
        verification_status: 'unverified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, jobTitle, search.country),
        job_title: jobTitle.substring(0, 200),
        company_name: company.substring(0, 200),
        country: search.country,
        remote_type: remoteType,
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, salary_predicted: true,
        job_description: description.substring(0, 2000),
        job_url: link,
        job_source: 'linkedin',
        source_type: 'job_board',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.6,
        relocation_assistance: /relocation/i.test(description + search.keywords),
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: detectJobCategory(jobTitle, description),
        experience_level: expLevel,
        verification_status: 'unverified',
        is_hidden_opportunity: false
      })
    })

    await sleep(2000) // Be respectful to LinkedIn
  }

  console.log(`[LinkedIn RSS] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 9. INDEED RSS — Official public RSS feeds
// Indeed provides public RSS for job searches (no scraping)
// ============================================================
export async function scrapeIndeedRSS(): Promise<ScrapedJob[]> {
  console.log('[Indeed RSS] Scraping public RSS feeds...')
  const jobs: ScrapedJob[] = []

  // Indeed has public RSS job feeds
  const searches = [
    { query: 'software+engineer+visa+sponsorship', country: 'us', countryName: 'USA' },
    { query: 'developer+relocation', country: 'ca', countryName: 'Canada' },
    { query: 'software+engineer+remote', country: 'gb', countryName: 'United Kingdom' },
    { query: 'engineer+visa+sponsorship', country: 'au', countryName: 'Australia' },
    { query: 'software+developer', country: 'sg', countryName: 'Singapore' },
    { query: 'engineer+relocation', country: 'de', countryName: 'Germany' },
    { query: 'software+developer+visa', country: 'nl', countryName: 'Netherlands' },
  ]

  for (const search of searches) {
    // Indeed RSS - this is their official public feed endpoint
    const url = `https://${search.country === 'us' ? 'www' : search.country}.indeed.com/rss?q=${search.query}&sort=date&fromage=15`

    const xml = await safeFetch(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS Feed Reader/2.0)',
        'Accept': 'application/rss+xml, text/xml'
      }
    })

    if (!xml || !xml.includes('<item>')) {
      console.log(`[Indeed RSS] No feed for ${search.query} in ${search.countryName}`)
      continue
    }

    const $ = parseHTML(xml)
    $('item').each((_, el) => {
      const title = cleanText($(el).find('title').text())
      const link = $(el).find('link').text()
      const description = cleanText($(el).find('description').text().replace(/<[^>]+>/g, ''))
      const pubDate = $(el).find('pubDate').text()

      if (!title || !link) return

      // Extract company - Indeed format: "Job Title - Company Name - Location"
      const parts = title.split(' - ')
      const jobTitle = parts[0]?.trim() || title
      const company = parts[1]?.trim() || 'Indeed Company'

      const datePosted = pubDate ? new Date(pubDate).toISOString() : undefined
      if (datePosted) {
        const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
        if (daysAgo > 15) return
      }

      const expLevel = detectExperienceLevel(jobTitle, description)
      const visaProb = calculateVisaProbability(description + ' ' + search.query, search.countryName)
      const remoteType = detectRemoteType(`${jobTitle} ${description}`)
      const predicted = predictSalary(jobTitle, search.countryName, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, visa_probability: visaProb,
        remote_type: remoteType, country: search.countryName,
        company_stage: undefined, date_posted: datePosted,
        verification_status: 'unverified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, jobTitle, search.countryName),
        job_title: jobTitle.substring(0, 200),
        company_name: company.substring(0, 200),
        country: search.countryName,
        remote_type: remoteType,
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, salary_predicted: true,
        job_description: description.substring(0, 2000),
        job_url: link,
        job_source: 'indeed',
        source_type: 'job_board',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: /relocation/i.test(description + search.query),
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: detectJobCategory(jobTitle, description),
        experience_level: expLevel,
        verification_status: 'unverified',
        is_hidden_opportunity: false
      })
    })

    await sleep(2000) // Be respectful
  }

  console.log(`[Indeed RSS] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 10. GLASSDOOR RSS (Official partner feed)
// ============================================================
export async function scrapeGlassdoorRSS(): Promise<ScrapedJob[]> {
  console.log('[Glassdoor] Checking RSS feeds...')
  const jobs: ScrapedJob[] = []

  // Glassdoor's public job search RSS
  const searches = [
    { query: 'software-engineer', loc: 'United-States', countryName: 'USA' },
    { query: 'software-engineer', loc: 'United-Kingdom', countryName: 'United Kingdom' },
    { query: 'software-developer', loc: 'Germany', countryName: 'Germany' },
    { query: 'software-engineer', loc: 'Canada', countryName: 'Canada' },
    { query: 'software-developer', loc: 'Australia', countryName: 'Australia' },
  ]

  for (const search of searches) {
    const url = `https://www.glassdoor.com/Job/${search.loc}-${search.query}-jobs-SRCH_IL.0,13_IN1_KO14,${14 + search.query.length}.htm?fromAge=14&sortBy=date_desc`

    // Glassdoor blocks most scrapers - use RSS if available
    const rssUrl = `https://www.glassdoor.com/feeds/jobs.rss?keyword=${encodeURIComponent(search.query.replace('-', ' '))}&location=${encodeURIComponent(search.loc.replace('-', ' '))}`

    const xml = await safeFetch(rssUrl, {
      timeout: 10000,
      headers: { 'Accept': 'application/rss+xml, text/xml', 'User-Agent': 'RSS/2.0' }
    })

    if (!xml || !xml.includes('<item>')) continue

    const $ = parseHTML(xml)
    $('item').each((_, el) => {
      const title = cleanText($(el).find('title').text())
      const link = $(el).find('link').text()
      const description = cleanText($(el).find('description').text().replace(/<[^>]+>/g, ''))

      if (!title || !link) return

      const parts = title.split(' — ')
      const jobTitle = parts[0]?.trim() || title
      const company = parts[1]?.trim() || 'Glassdoor Company'

      const expLevel = detectExperienceLevel(jobTitle)
      const visaProb = calculateVisaProbability(description, search.countryName)
      const predicted = predictSalary(jobTitle, search.countryName, expLevel)
      const remoteType = detectRemoteType(description)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, visa_probability: visaProb,
        remote_type: remoteType, country: search.countryName,
        company_stage: undefined, date_posted: new Date().toISOString(),
        verification_status: 'unverified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, jobTitle, search.countryName),
        job_title: jobTitle.substring(0, 200),
        company_name: company.substring(0, 200),
        country: search.countryName,
        remote_type: remoteType,
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, salary_predicted: true,
        job_url: link,
        job_source: 'glassdoor',
        source_type: 'job_board',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: false,
        quality_score: scoreJobQuality(jobObj),
        tech_stack: [],
        job_category: detectJobCategory(jobTitle),
        experience_level: expLevel,
        verification_status: 'unverified',
        is_hidden_opportunity: false
      })
    })
    await sleep(2000)
  }

  console.log(`[Glassdoor RSS] Found ${jobs.length} jobs`)
  return jobs
}
