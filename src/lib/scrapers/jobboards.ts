// ============================================================
// JOB BOARD SCRAPERS
// Scrapes: We Work Remotely, Remote OK, HN Who's Hiring,
//          Remotive, Working Nomads, Wellfound
// ============================================================

import {
  safeFetch, safeJsonFetch, parseHTML, cleanText, sleep,
  extractSalary, detectRemoteType, extractTechStack,
  detectJobCategory, normalizeCountry, isTargetCountry
} from './base'
import {
  calculateVisaProbability, predictSalary, detectExperienceLevel,
  scoreJobQuality, generateJobFingerprint
} from '../ai/detector'

export interface ScrapedJob {
  job_id: string
  job_title: string
  company_name: string
  company_logo?: string
  country: string
  city?: string
  remote_type: 'remote' | 'hybrid' | 'onsite'
  salary_min?: number
  salary_max?: number
  salary_currency: string
  salary_predicted: boolean
  job_description?: string
  job_url: string
  job_source: string
  source_type: string
  visa_sponsorship?: boolean
  visa_probability: number
  relocation_assistance: boolean
  quality_score: number
  date_posted?: string
  tech_stack: string[]
  job_category: string
  experience_level: string
  verification_status: string
  is_hidden_opportunity: boolean
}

// ============================================================
// 1. WE WORK REMOTELY
// ============================================================
export async function scrapeWeWorkRemotely(): Promise<ScrapedJob[]> {
  console.log('[WWR] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const categories = [
    'https://weworkremotely.com/remote-jobs.rss',
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    'https://weworkremotely.com/categories/remote-design-jobs.rss',
  ]

  for (const rssUrl of categories) {
    const xml = await safeFetch(rssUrl)
    if (!xml) continue

    const $ = parseHTML(xml)
    const items = $('item')

    items.each((_, el) => {
      const title = cleanText($(el).find('title').text())
      const company = cleanText($(el).find('region').text() || 'Unknown')
      const url = $(el).find('link').text() || $(el).find('url').text()
      const description = $(el).find('description').text()
      const pubDate = $(el).find('pubDate').text()

      if (!title || !url) return

      // WWR is always remote
      const salaryData = extractSalary(description)
      const expLevel = detectExperienceLevel(title, description)
      const techStack = extractTechStack(description)
      const country = 'USA' // WWR defaults to USA-based companies

      let salaryMin = salaryData.min
      let salaryMax = salaryData.max
      let salaryCurrency = salaryData.currency || 'USD'
      let salaryPredicted = false

      if (!salaryMin) {
        const predicted = predictSalary(title, country, expLevel)
        salaryMin = predicted.min
        salaryMax = predicted.max
        salaryCurrency = predicted.currency
        salaryPredicted = true
      }

      const visaProb = calculateVisaProbability(description, country)
      const jobObj = {
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
        visa_probability: visaProb,
        remote_type: 'remote' as const,
        country,
        company_stage: undefined,
        date_posted: pubDate ? new Date(pubDate).toISOString() : undefined,
        verification_status: 'verified',
        is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, title, 'remote'),
        job_title: title,
        company_name: company,
        country,
        remote_type: 'remote',
        salary_min: salaryMin,
        salary_max: salaryMax,
        salary_currency: salaryCurrency,
        salary_predicted: salaryPredicted,
        job_description: cleanText(description).substring(0, 2000),
        job_url: url,
        job_source: 'weworkremotely',
        source_type: 'job_board',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5 ? true : undefined,
        relocation_assistance: description.toLowerCase().includes('relocation'),
        quality_score: scoreJobQuality(jobObj),
        date_posted: pubDate ? new Date(pubDate).toISOString() : undefined,
        tech_stack: techStack,
        job_category: detectJobCategory(title, description),
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    })
    await sleep(1000)
  }

  console.log(`[WWR] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 2. REMOTE OK (JSON API)
// ============================================================
export async function scrapeRemoteOK(): Promise<ScrapedJob[]> {
  console.log('[RemoteOK] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<any[]>('https://remoteok.com/api', {
    'User-Agent': 'Mozilla/5.0 (compatible; JobBot/1.0)'
  })
  if (!data || !Array.isArray(data)) return []

  for (const item of data.slice(1, 100)) { // Skip first item (metadata)
    if (!item.position || !item.company) continue

    const title = item.position
    const company = item.company
    const description = item.description || ''
    const tags = item.tags || []
    const country = 'USA'

    const salaryData = extractSalary(description)
    const expLevel = detectExperienceLevel(title, description)

    let salaryMin = item.salary_min || salaryData.min
    let salaryMax = item.salary_max || salaryData.max
    let salaryCurrency = 'USD'
    let salaryPredicted = false

    if (!salaryMin) {
      const predicted = predictSalary(title, country, expLevel)
      salaryMin = predicted.min; salaryMax = predicted.max
      salaryCurrency = predicted.currency; salaryPredicted = true
    }

    const visaProb = calculateVisaProbability(description, country)
    const datePosted = item.date ? new Date(item.date).toISOString() : undefined

    // Check freshness
    if (datePosted) {
      const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue // Skip old jobs
    }

    const jobObj = {
      salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
      visa_probability: visaProb, remote_type: 'remote' as const,
      country, company_stage: undefined,
      date_posted: datePosted, verification_status: 'verified', is_hidden_opportunity: false
    }

    jobs.push({
      job_id: generateJobFingerprint(company, title, 'remote'),
      job_title: title,
      company_name: company,
      company_logo: item.company_logo,
      country,
      remote_type: 'remote',
      salary_min: salaryMin, salary_max: salaryMax,
      salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
      job_description: cleanText(description).substring(0, 2000),
      job_url: item.url || `https://remoteok.com/jobs/${item.id}`,
      job_source: 'remoteok',
      source_type: 'job_board',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5 ? true : undefined,
      relocation_assistance: false,
      quality_score: scoreJobQuality(jobObj),
      date_posted: datePosted,
      tech_stack: [...new Set([...extractTechStack(description), ...tags])],
      job_category: detectJobCategory(title, description),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    })
  }

  console.log(`[RemoteOK] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 3. HACKER NEWS WHO'S HIRING (Monthly thread)
// ============================================================
export async function scrapeHackerNews(): Promise<ScrapedJob[]> {
  console.log('[HN] Starting scrape...')
  const jobs: ScrapedJob[] = []

  // Get the latest "Who is Hiring?" thread
  const searchData = await safeJsonFetch<any>(
    'https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+Hiring&tags=story,ask_hn&numericFilters=created_at_i>1700000000'
  )

  if (!searchData?.hits?.length) return []

  // Find the most recent hiring thread
  const thread = searchData.hits
    .filter((h: any) => h.title?.includes('Who is Hiring'))
    .sort((a: any, b: any) => b.created_at_i - a.created_at_i)[0]

  if (!thread) return []

  // Get all comments
  const threadData = await safeJsonFetch<any>(
    `https://hn.algolia.com/api/v1/items/${thread.objectID}`
  )

  if (!threadData?.children) return []

  for (const comment of threadData.children.slice(0, 200)) {
    const text = comment.text || ''
    if (!text || text.length < 50) continue

    // Parse HN format: "Company | Role | Location | Remote/Onsite | Salary"
    const lines = text.replace(/<[^>]+>/g, ' ').split(/\||\n/).map((l: string) => cleanText(l))

    if (lines.length < 2) continue

    const company = lines[0]?.substring(0, 100) || 'Unknown'
    const role = lines[1]?.substring(0, 100) || 'Software Engineer'

    // Find location clues
    let country = 'USA'
    let remoteType: 'remote' | 'hybrid' | 'onsite' = 'onsite'

    for (const line of lines) {
      const lower = line.toLowerCase()
      if (lower.includes('remote')) remoteType = 'remote'
      else if (lower.includes('hybrid')) remoteType = 'hybrid'

      // Country detection
      if (lower.includes('san francisco') || lower.includes('new york') || lower.includes('usa')) country = 'USA'
      else if (lower.includes('london') || lower.includes('uk')) country = 'United Kingdom'
      else if (lower.includes('berlin') || lower.includes('germany')) country = 'Germany'
      else if (lower.includes('amsterdam') || lower.includes('netherlands')) country = 'Netherlands'
      else if (lower.includes('singapore')) country = 'Singapore'
      else if (lower.includes('toronto') || lower.includes('canada')) country = 'Canada'
      else if (lower.includes('sydney') || lower.includes('australia')) country = 'Australia'
    }

    if (!isTargetCountry(country) && remoteType !== 'remote') continue

    const salaryData = extractSalary(text)
    const expLevel = detectExperienceLevel(role, text)
    const visaProb = calculateVisaProbability(text, country)

    let salaryMin = salaryData.min
    let salaryMax = salaryData.max
    let salaryCurrency = salaryData.currency || 'USD'
    let salaryPredicted = false

    if (!salaryMin) {
      const predicted = predictSalary(role, country, expLevel)
      salaryMin = predicted.min; salaryMax = predicted.max
      salaryCurrency = predicted.currency; salaryPredicted = true
    }

    const jobUrl = `https://news.ycombinator.com/item?id=${comment.id}`
    const datePosted = comment.created_at || new Date().toISOString()

    const jobObj = {
      salary_min: salaryMin, salary_max: salaryMax, salary_currency: salaryCurrency,
      visa_probability: visaProb, remote_type: remoteType, country,
      company_stage: 'seed', date_posted: datePosted,
      verification_status: 'unverified', is_hidden_opportunity: true
    }

    jobs.push({
      job_id: generateJobFingerprint(company, role, country),
      job_title: role.substring(0, 200),
      company_name: company.substring(0, 200),
      country,
      remote_type: remoteType,
      salary_min: salaryMin, salary_max: salaryMax,
      salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
      job_description: cleanText(text.replace(/<[^>]+>/g, '')).substring(0, 2000),
      job_url: jobUrl,
      job_source: 'hackernews',
      source_type: 'social',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5,
      relocation_assistance: /relocation/i.test(text),
      quality_score: scoreJobQuality(jobObj),
      date_posted: datePosted,
      tech_stack: extractTechStack(text),
      job_category: detectJobCategory(role, text),
      experience_level: expLevel,
      verification_status: 'unverified',
      is_hidden_opportunity: true
    })
  }

  console.log(`[HN] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 4. REMOTIVE (JSON API)
// ============================================================
export async function scrapeRemotive(): Promise<ScrapedJob[]> {
  console.log('[Remotive] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<{ jobs: any[] }>('https://remotive.com/api/remote-jobs?limit=100')
  if (!data?.jobs) return []

  for (const item of data.jobs) {
    const title = item.title || ''
    const company = item.company_name || ''
    const description = item.description || ''
    const country = 'USA'

    const salaryData = extractSalary(item.salary || description)
    const expLevel = detectExperienceLevel(title, description)

    let salaryMin = salaryData.min
    let salaryMax = salaryData.max
    let salaryCurrency = salaryData.currency || 'USD'
    let salaryPredicted = false

    if (!salaryMin) {
      const predicted = predictSalary(title, country, expLevel)
      salaryMin = predicted.min; salaryMax = predicted.max
      salaryCurrency = predicted.currency; salaryPredicted = true
    }

    const datePosted = item.publication_date ? new Date(item.publication_date).toISOString() : undefined
    if (datePosted) {
      const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo > 15) continue
    }

    const visaProb = calculateVisaProbability(description, country)
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
      company_logo: item.company_logo,
      country,
      remote_type: 'remote',
      salary_min: salaryMin, salary_max: salaryMax,
      salary_currency: salaryCurrency, salary_predicted: salaryPredicted,
      job_description: cleanText(description.replace(/<[^>]+>/g, '')).substring(0, 2000),
      job_url: item.url || '',
      job_source: 'remotive',
      source_type: 'job_board',
      visa_probability: visaProb,
      visa_sponsorship: visaProb > 0.5 ? true : undefined,
      relocation_assistance: false,
      quality_score: scoreJobQuality(jobObj),
      date_posted: datePosted,
      tech_stack: extractTechStack(description),
      job_category: item.category || detectJobCategory(title, description),
      experience_level: expLevel,
      verification_status: 'verified',
      is_hidden_opportunity: false
    })
  }

  console.log(`[Remotive] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 5. Y COMBINATOR JOBS (Work at a Startup)
// ============================================================
export async function scrapeYCombinator(): Promise<ScrapedJob[]> {
  console.log('[YC] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const data = await safeJsonFetch<any[]>(
    'https://api.ycombinator.com/v0.1/jobs?page=1&per_page=100'
  )

  if (!data || !Array.isArray(data)) {
    // Fallback: scrape workatastartup.com
    return scrapeWorkAtStartup()
  }

  return jobs
}

async function scrapeWorkAtStartup(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = []

  const html = await safeFetch('https://www.workatastartup.com/jobs?role=eng&remote=remote')
  if (!html) return []

  const $ = parseHTML(html)

  // YC renders via React, so we need basic parsing
  $('a[href*="/jobs/"]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (!href.includes('/jobs/')) return

    const text = $(el).text().trim()
    if (!text || text.length < 5) return

    jobs.push({
      job_id: generateJobFingerprint('YC Startup', text, 'remote'),
      job_title: text.substring(0, 200),
      company_name: 'YC Startup',
      country: 'USA',
      remote_type: 'remote',
      salary_currency: 'USD',
      salary_predicted: true,
      job_url: `https://www.workatastartup.com${href}`,
      job_source: 'ycombinator',
      source_type: 'startup_board',
      visa_probability: 0.4,
      relocation_assistance: false,
      quality_score: 7.0,
      tech_stack: [],
      job_category: 'engineering',
      experience_level: 'mid',
      verification_status: 'unverified',
      is_hidden_opportunity: false,
      company_stage: 'seed'
    } as any)
  })

  console.log(`[YC] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 6. WORKING NOMADS
// ============================================================
export async function scrapeWorkingNomads(): Promise<ScrapedJob[]> {
  console.log('[WorkingNomads] Starting scrape...')
  const jobs: ScrapedJob[] = []

  const categories = ['developer', 'designer', 'data', 'devops']

  for (const cat of categories) {
    const data = await safeJsonFetch<any>(
      `https://www.workingnomads.com/api/exposed_jobs/?category=${cat}&limit=50`
    )
    if (!data?.results) continue

    for (const item of data.results) {
      const title = item.title || ''
      const company = item.company || ''
      const description = item.description || ''
      const country = 'USA'

      const datePosted = item.pub_date ? new Date(item.pub_date).toISOString() : undefined
      if (datePosted) {
        const daysAgo = (Date.now() - new Date(datePosted).getTime()) / (1000 * 60 * 60 * 24)
        if (daysAgo > 15) continue
      }

      const expLevel = detectExperienceLevel(title)
      const visaProb = calculateVisaProbability(description, country)
      const predicted = predictSalary(title, country, expLevel)

      const jobObj = {
        salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
        visa_probability: visaProb, remote_type: 'remote' as const, country,
        company_stage: undefined, date_posted: datePosted,
        verification_status: 'verified', is_hidden_opportunity: false
      }

      jobs.push({
        job_id: generateJobFingerprint(company, title, 'remote'),
        job_title: title,
        company_name: company,
        country,
        remote_type: 'remote',
        salary_min: predicted.min, salary_max: predicted.max,
        salary_currency: predicted.currency, salary_predicted: true,
        job_description: cleanText(description).substring(0, 2000),
        job_url: item.url || '',
        job_source: 'workingnomads',
        source_type: 'job_board',
        visa_probability: visaProb,
        visa_sponsorship: visaProb > 0.5,
        relocation_assistance: false,
        quality_score: scoreJobQuality(jobObj),
        date_posted: datePosted,
        tech_stack: extractTechStack(description),
        job_category: cat,
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false
      })
    }
    await sleep(500)
  }

  console.log(`[WorkingNomads] Found ${jobs.length} jobs`)
  return jobs
}

// ============================================================
// 7. GITHUB JOBS via GitHub API (Engineering roles)
// ============================================================
export async function scrapeGitHubJobs(): Promise<ScrapedJob[]> {
  console.log('[GitHub] Scanning org job pages...')
  const jobs: ScrapedJob[] = []

  // Find companies hiring on GitHub by scanning popular repos' org pages
  const techCompanies = [
    { name: 'Vercel', careersUrl: 'https://vercel.com/careers', country: 'USA' },
    { name: 'Supabase', careersUrl: 'https://supabase.com/careers', country: 'USA' },
    { name: 'PlanetScale', careersUrl: 'https://planetscale.com/careers', country: 'USA' },
    { name: 'Railway', careersUrl: 'https://railway.app/careers', country: 'USA' },
    { name: 'Fly.io', careersUrl: 'https://fly.io/jobs', country: 'USA' },
    { name: 'Linear', careersUrl: 'https://linear.app/careers', country: 'USA' },
    { name: 'Figma', careersUrl: 'https://www.figma.com/careers/', country: 'USA' },
    { name: 'Notion', careersUrl: 'https://www.notion.so/careers', country: 'USA' },
    { name: 'Stripe', careersUrl: 'https://stripe.com/jobs', country: 'USA' },
  ]

  for (const company of techCompanies) {
    const html = await safeFetch(company.careersUrl)
    if (!html) continue

    const $ = parseHTML(html)

    // Look for job links
    $('a').each((_, el) => {
      const href = $(el).attr('href') || ''
      const text = $(el).text().trim()

      if (
        text.length > 10 && text.length < 150 &&
        (href.includes('/job') || href.includes('/career') || href.includes('/opening') || href.includes('/position'))
      ) {
        const title = text
        const expLevel = detectExperienceLevel(title)
        const visaProb = calculateVisaProbability('', company.country)
        const predicted = predictSalary(title, company.country, expLevel)

        const jobUrl = href.startsWith('http') ? href : `${new URL(company.careersUrl).origin}${href}`

        const jobObj = {
          salary_min: predicted.min, salary_max: predicted.max, salary_currency: predicted.currency,
          visa_probability: visaProb, remote_type: 'remote' as const, country: company.country,
          company_stage: 'series-b', date_posted: new Date().toISOString(),
          verification_status: 'verified', is_hidden_opportunity: false
        }

        jobs.push({
          job_id: generateJobFingerprint(company.name, title, company.country),
          job_title: title,
          company_name: company.name,
          country: company.country,
          remote_type: 'remote',
          salary_min: predicted.min, salary_max: predicted.max,
          salary_currency: predicted.currency, salary_predicted: true,
          job_url: jobUrl,
          job_source: 'careers_page',
          source_type: 'career_page',
          visa_probability: visaProb,
          visa_sponsorship: true,
          relocation_assistance: true,
          quality_score: scoreJobQuality(jobObj),
          date_posted: new Date().toISOString(),
          tech_stack: [],
          job_category: detectJobCategory(title),
          experience_level: expLevel,
          verification_status: 'verified',
          is_hidden_opportunity: false
        })
      }
    })

    await sleep(2000)
  }

  console.log(`[GitHub/Careers] Found ${jobs.length} jobs`)
  return jobs
}
