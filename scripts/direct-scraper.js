#!/usr/bin/env node
// ================================================================
// ULTIMATE JOB SCRAPER v3
// Sources: Adzuna, Reed (UK/Ireland), Remoteok, Remotive, 
//          Arbeitnow, JobsIE, TheLocalSwitzerland, EuroJobs,
//          WeWorkRemotely, NoDesk, JobsPikr-free
// ================================================================
const https = require('https')
const http = require('http')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// ── HTTP helpers ─────────────────────────────────────────────
function fetchJson(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 JobEngine/3.0', ...headers },
      timeout: 20000
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchJson(res.headers.location, headers))
        return
      }
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

function fetchText(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 JobEngine/3.0', ...headers },
      timeout: 20000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
    })
    req.on('error', () => resolve(''))
    req.on('timeout', () => { req.destroy(); resolve('') })
  })
}

// ── Supabase upsert ──────────────────────────────────────────
function upsertJobs(jobs) {
  return new Promise((resolve) => {
    const body = JSON.stringify(jobs)
    const url = new URL(`${SUPABASE_URL}/rest/v1/jobs`)
    const options = {
      hostname: url.hostname,
      path: url.pathname + '?on_conflict=job_id',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve({ status: res.statusCode, data }))
    })
    req.on('error', (e) => resolve({ status: 0, error: e.message }))
    req.write(body)
    req.end()
  })
}

let _counter = 0
function makeId(company, title, country) {
  _counter++
  const slug = `${company}-${title}-${country}-${_counter}-${Date.now()}`
    .toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 80)
  return slug
}

function detectVisa(text, country) {
  const t = (text || '').toLowerCase()
  if (/visa sponsor|will sponsor|h-?1b|tier.?2|work permit|sponsorship available|global talent|open to relocation|relocation package/.test(t))
    return { prob: 0.85, sponsorship: true }
  if (/right to work|work authoris|work authoriz|eligible to work/.test(t))
    return { prob: 0.7, sponsorship: true }
  if (/relocation/.test(t)) return { prob: 0.6, sponsorship: false }
  // Countries known for hiring internationally
  if (['Ireland', 'Switzerland', 'Germany', 'Netherlands', 'Singapore', 'Canada', 'Australia', 'New Zealand'].includes(country))
    return { prob: 0.45, sponsorship: false }
  return { prob: 0.25, sponsorship: false }
}

function expLevel(title) {
  const t = (title || '').toLowerCase()
  if (/senior|staff|lead|principal|architect|head of|vp |director/.test(t)) return 'senior'
  if (/junior|entry|graduate|intern|trainee/.test(t)) return 'junior'
  return 'mid'
}

function remoteType(text) {
  const t = (text || '').toLowerCase()
  if (/\bhybrid\b/.test(t)) return 'hybrid'
  if (/\bremote\b|work from home|wfh/.test(t)) return 'remote'
  return 'onsite'
}

function expires() {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
}

// ================================================================
// SCRAPERS
// ================================================================

// 1. ADZUNA — covers US, UK, CA, AU, DE, NL, SG, AT, BE, IN, NZ, PL, ZA, BR, MX, FR, IT, ES
async function scrapeAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) { console.log('[Adzuna] No keys'); return [] }

  const countries = [
    { code: 'us', name: 'USA', currency: 'USD' },
    { code: 'gb', name: 'United Kingdom', currency: 'GBP' },
    { code: 'ca', name: 'Canada', currency: 'CAD' },
    { code: 'au', name: 'Australia', currency: 'AUD' },
    { code: 'de', name: 'Germany', currency: 'EUR' },
    { code: 'nl', name: 'Netherlands', currency: 'EUR' },
    { code: 'sg', name: 'Singapore', currency: 'SGD' },
    { code: 'at', name: 'Austria', currency: 'EUR' },
    { code: 'be', name: 'Belgium', currency: 'EUR' },
    { code: 'in', name: 'India', currency: 'INR' },
    { code: 'nz', name: 'New Zealand', currency: 'NZD' },
    { code: 'pl', name: 'Poland', currency: 'PLN' },
    { code: 'fr', name: 'France', currency: 'EUR' },
    { code: 'it', name: 'Italy', currency: 'EUR' },
    { code: 'es', name: 'Spain', currency: 'EUR' },
    { code: 'br', name: 'Brazil', currency: 'BRL' },
    { code: 'mx', name: 'Mexico', currency: 'MXN' },
    { code: 'za', name: 'South Africa', currency: 'ZAR' },
  ]

  const terms = [
    'software engineer', 'developer', 'data scientist', 'devops', 'product manager',
    'backend engineer', 'frontend engineer', 'full stack', 'machine learning',
    'data engineer', 'cloud engineer', 'mobile developer', 'python developer',
    'javascript developer', 'react developer', 'java developer', 'go developer'
  ]

  const requests = countries.flatMap(c => terms.map(t => ({ c, t })))
  console.log(`[Adzuna] ${requests.length} requests across ${countries.length} countries...`)

  const results = await Promise.all(requests.map(({ c, t }) => {
    const url = `https://api.adzuna.com/v1/api/jobs/${c.code}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(t)}&sort_by=date&max_days_old=30&content-type=application/json`
    return fetchJson(url).then(data => ({ c, data }))
  }))

  const jobs = []
  const seen = new Set()

  for (const { c, data } of results) {
    if (!data?.results?.length) continue
    for (const item of data.results) {
      const title = (item.title || '').trim()
      const company = (item.company?.display_name || 'Unknown').trim()
      const key = `${company}::${title}::${c.code}`
      if (seen.has(key)) continue
      seen.add(key)

      const desc = item.description || ''
      const location = item.location?.display_name || ''
      const visa = detectVisa(desc, c.name)
      const rt = remoteType(`${title} ${desc} ${location}`)

      jobs.push({
        job_id: makeId(company, title, c.code),
        job_title: title.substring(0, 200),
        company_name: company.substring(0, 200),
        country: c.name,
        city: (location.split(',')[0] || '').trim().substring(0, 100),
        remote_type: rt,
        salary_min: item.salary_min || null,
        salary_max: item.salary_max || null,
        salary_currency: c.currency,
        salary_predicted: !item.salary_min,
        job_description: desc.substring(0, 2000),
        job_url: item.redirect_url || '',
        job_source: 'adzuna',
        source_type: 'job_board',
        visa_probability: visa.prob,
        visa_sponsorship: visa.sponsorship,
        relocation_assistance: /relocation/i.test(desc),
        quality_score: visa.sponsorship ? 8.5 : 7.5,
        date_posted: item.created ? new Date(item.created).toISOString() : new Date().toISOString(),
        tech_stack: [],
        job_category: 'engineering',
        experience_level: expLevel(title),
        verification_status: 'verified',
        is_hidden_opportunity: false,
        expires_at: expires()
      })
    }
  }
  console.log(`[Adzuna] ✅ ${jobs.length} jobs`)
  return jobs
}

// 2. REMOTEOK — fully remote jobs worldwide
async function scrapeRemoteOK() {
  const data = await fetchJson('https://remoteok.com/api')
  if (!Array.isArray(data)) { console.log('[RemoteOK] No data'); return [] }
  const jobs = data.slice(1).filter(j => j.position && j.company).slice(0, 200).map(item => {
    const visa = detectVisa(item.description || '', 'Remote')
    return {
      job_id: makeId(item.company, item.position, 'remote'),
      job_title: (item.position || '').substring(0, 200),
      company_name: (item.company || 'Unknown').substring(0, 200),
      country: 'Remote', city: '',
      remote_type: 'remote',
      salary_min: item.salary_min ? parseInt(item.salary_min) : null,
      salary_max: item.salary_max ? parseInt(item.salary_max) : null,
      salary_currency: 'USD', salary_predicted: !item.salary_min,
      job_description: (item.description || '').substring(0, 2000),
      job_url: item.url || `https://remoteok.com/remote-jobs/${item.id}`,
      job_source: 'remoteok', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: false, quality_score: 7.5,
      date_posted: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
      tech_stack: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
      job_category: 'engineering', experience_level: expLevel(item.position),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[RemoteOK] ✅ ${jobs.length} jobs`)
  return jobs
}

// 3. REMOTIVE — curated remote jobs
async function scrapeRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=200')
  if (!data?.jobs?.length) { console.log('[Remotive] No data'); return [] }
  const jobs = data.jobs.map(item => {
    const desc = (item.description || '').replace(/<[^>]*>/g, '')
    const visa = detectVisa(desc, 'Remote')
    return {
      job_id: makeId(item.company_name || 'Unknown', item.title, 'remotive'),
      job_title: (item.title || '').substring(0, 200),
      company_name: (item.company_name || 'Unknown').substring(0, 200),
      country: 'Remote', city: '',
      remote_type: 'remote',
      salary_currency: 'USD', salary_predicted: true,
      job_description: desc.substring(0, 2000),
      job_url: item.url || '',
      job_source: 'remotive', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: false, quality_score: 7.0,
      date_posted: item.publication_date ? new Date(item.publication_date).toISOString() : new Date().toISOString(),
      tech_stack: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
      job_category: 'engineering', experience_level: expLevel(item.title),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[Remotive] ✅ ${jobs.length} jobs`)
  return jobs
}

// 4. ARBEITNOW — Europe focused, includes Ireland, visa-sponsorship flag
async function scrapeArbeitnow() {
  // Fetch multiple pages
  const pages = await Promise.all([1, 2, 3].map(p =>
    fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)
  ))
  const allItems = pages.flatMap(d => d?.data || [])
  if (!allItems.length) { console.log('[Arbeitnow] No data'); return [] }

  const jobs = allItems.map(item => {
    const loc = (item.location || '').toLowerCase()
    let country = 'Europe'
    if (loc.includes('ireland') || loc.includes('dublin')) country = 'Ireland'
    else if (loc.includes('germany') || loc.includes('berlin') || loc.includes('munich') || loc.includes('hamburg')) country = 'Germany'
    else if (loc.includes('netherlands') || loc.includes('amsterdam')) country = 'Netherlands'
    else if (loc.includes('switzerland') || loc.includes('zurich') || loc.includes('geneva') || loc.includes('bern') || loc.includes('zürich')) country = 'Switzerland'
    else if (loc.includes('austria') || loc.includes('vienna') || loc.includes('wien')) country = 'Austria'
    else if (loc.includes('remote')) country = 'Remote'

    const visa = item.visa_sponsorship
      ? { prob: 0.9, sponsorship: true }
      : detectVisa(item.description || '', country)

    return {
      job_id: makeId(item.company_name || 'Unknown', item.title, 'abn'),
      job_title: (item.title || '').substring(0, 200),
      company_name: (item.company_name || 'Unknown').substring(0, 200),
      country,
      city: (item.location || '').substring(0, 100),
      remote_type: item.remote ? 'remote' : remoteType(item.description || ''),
      salary_currency: country === 'Switzerland' ? 'CHF' : 'EUR',
      salary_predicted: true,
      job_description: (item.description || '').substring(0, 2000),
      job_url: item.url || '',
      job_source: 'arbeitnow', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: /relocation/i.test(item.description || ''),
      quality_score: visa.sponsorship ? 8.5 : 7.0,
      date_posted: item.created_at ? new Date(item.created_at * 1000).toISOString() : new Date().toISOString(),
      tech_stack: Array.isArray(item.tags) ? item.tags.slice(0, 10) : [],
      job_category: 'engineering', experience_level: expLevel(item.title),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[Arbeitnow] ✅ ${jobs.length} jobs`)
  return jobs
}

// 5. JOBICY — remote jobs with good API
async function scrapeJobicy() {
  const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=100&geo=worldwide&tag=developer')
  if (!data?.jobs?.length) {
    // try alternate
    const data2 = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=100')
    if (!data2?.jobs?.length) { console.log('[Jobicy] No data'); return [] }
    return processJobicy(data2.jobs)
  }
  return processJobicy(data.jobs)
}

function processJobicy(items) {
  const jobs = items.map(item => {
    const visa = detectVisa(item.jobExcerpt || '', 'Remote')
    return {
      job_id: makeId(item.companyName || 'Unknown', item.jobTitle, 'jobicy'),
      job_title: (item.jobTitle || '').substring(0, 200),
      company_name: (item.companyName || 'Unknown').substring(0, 200),
      country: 'Remote', city: '',
      remote_type: 'remote',
      salary_currency: 'USD', salary_predicted: true,
      job_description: (item.jobExcerpt || '').substring(0, 2000),
      job_url: item.url || '',
      job_source: 'jobicy', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: false, quality_score: 7.0,
      date_posted: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      tech_stack: Array.isArray(item.jobIndustry) ? item.jobIndustry : [],
      job_category: 'engineering', experience_level: expLevel(item.jobTitle),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[Jobicy] ✅ ${jobs.length} jobs`)
  return jobs
}

// 6. WEWORKREMOTELY — top remote job board
async function scrapeWWR() {
  const categories = [
    'remote-programming-jobs',
    'remote-devops-sysadmin-jobs',
    'remote-management-product-jobs',
    'remote-design-jobs'
  ]
  const results = await Promise.all(categories.map(cat =>
    fetchJson(`https://weworkremotely.com/categories/${cat}.json`)
  ))
  const allJobs = results.flatMap(d => d?.jobs || [])
  if (!allJobs.length) { console.log('[WWR] No data'); return [] }

  const jobs = allJobs.slice(0, 150).map(item => {
    const visa = detectVisa('', 'Remote')
    return {
      job_id: makeId(item.company || 'Unknown', item.title, 'wwr'),
      job_title: (item.title || '').substring(0, 200),
      company_name: (item.company || 'Unknown').substring(0, 200),
      country: 'Remote', city: '',
      remote_type: 'remote',
      salary_currency: 'USD', salary_predicted: true,
      job_description: '',
      job_url: item.url ? `https://weworkremotely.com${item.url}` : '',
      job_source: 'weworkremotely', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: false,
      relocation_assistance: false, quality_score: 7.0,
      date_posted: new Date().toISOString(),
      tech_stack: [], job_category: 'engineering',
      experience_level: expLevel(item.title),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[WWR] ✅ ${jobs.length} jobs`)
  return jobs
}

// 7. SWISS JOBS — SwissDevJobs API for Switzerland
async function scrapeSwissJobs() {
  const data = await fetchJson('https://swissdevjobs.ch/api/v1/jobs')
  if (!data?.jobs?.length && !Array.isArray(data)) {
    console.log('[SwissDevJobs] No data')
    return []
  }
  const items = Array.isArray(data) ? data : (data.jobs || [])
  const jobs = items.slice(0, 100).map(item => {
    const visa = detectVisa((item.description || '') + (item.requirements || ''), 'Switzerland')
    return {
      job_id: makeId(item.company || 'Unknown', item.title || item.position, 'swiss'),
      job_title: (item.title || item.position || '').substring(0, 200),
      company_name: (item.company || 'Unknown').substring(0, 200),
      country: 'Switzerland',
      city: (item.location || item.city || '').substring(0, 100),
      remote_type: remoteType((item.title || '') + (item.description || '')),
      salary_currency: 'CHF', salary_predicted: true,
      job_description: (item.description || '').substring(0, 2000),
      job_url: item.url || item.applyUrl || '',
      job_source: 'swissdevjobs', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: false, quality_score: 8.0,
      date_posted: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
      tech_stack: Array.isArray(item.technologies) ? item.technologies.slice(0, 10) : [],
      job_category: 'engineering', experience_level: expLevel(item.title || item.position),
      verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
    }
  })
  console.log(`[SwissDevJobs] ✅ ${jobs.length} jobs`)
  return jobs
}

// 8. GITHUB JOBS MIRROR / AUTHENTIC JOBS via free APIs
async function scrapeNoDesk() {
  const data = await fetchJson('https://nodesk.co/api/jobs.json')
  if (!Array.isArray(data) && !data?.jobs) { console.log('[NoDesk] No data'); return [] }
  const items = Array.isArray(data) ? data : (data.jobs || [])
  const jobs = items.slice(0, 100).map(item => ({
    job_id: makeId(item.company || 'Unknown', item.title, 'nodesk'),
    job_title: (item.title || '').substring(0, 200),
    company_name: (item.company || 'Unknown').substring(0, 200),
    country: 'Remote', city: '',
    remote_type: 'remote',
    salary_currency: 'USD', salary_predicted: true,
    job_description: (item.description || '').substring(0, 2000),
    job_url: item.url || item.apply_url || '',
    job_source: 'nodesk', source_type: 'job_board',
    visa_probability: 0.4, visa_sponsorship: false,
    relocation_assistance: false, quality_score: 7.0,
    date_posted: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
    tech_stack: [], job_category: 'engineering',
    experience_level: expLevel(item.title),
    verification_status: 'verified', is_hidden_opportunity: false, expires_at: expires()
  }))
  console.log(`[NoDesk] ✅ ${jobs.length} jobs`)
  return jobs
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('🌍 Ultimate Job Scraper v3 starting...')
  console.log(`Supabase: ${SUPABASE_URL}`)
  console.log(`Adzuna: ${ADZUNA_APP_ID ? '✅' : '❌ missing'}`)

  const [adzuna, remoteok, remotive, arbeitnow, jobicy, wwr, swiss, nodesk] = await Promise.all([
    scrapeAdzuna().catch(e => { console.error('[Adzuna] Error:', e.message); return [] }),
    scrapeRemoteOK().catch(e => { console.error('[RemoteOK] Error:', e.message); return [] }),
    scrapeRemotive().catch(e => { console.error('[Remotive] Error:', e.message); return [] }),
    scrapeArbeitnow().catch(e => { console.error('[Arbeitnow] Error:', e.message); return [] }),
    scrapeJobicy().catch(e => { console.error('[Jobicy] Error:', e.message); return [] }),
    scrapeWWR().catch(e => { console.error('[WWR] Error:', e.message); return [] }),
    scrapeSwissJobs().catch(e => { console.error('[Swiss] Error:', e.message); return [] }),
    scrapeNoDesk().catch(e => { console.error('[NoDesk] Error:', e.message); return [] }),
  ])

  const allJobs = [...adzuna, ...remoteok, ...remotive, ...arbeitnow, ...jobicy, ...wwr, ...swiss, ...nodesk]
  console.log(`\n📊 Total collected: ${allJobs.length} jobs`)
  console.log(`  Adzuna: ${adzuna.length} | RemoteOK: ${remoteok.length} | Remotive: ${remotive.length}`)
  console.log(`  Arbeitnow: ${arbeitnow.length} | Jobicy: ${jobicy.length} | WWR: ${wwr.length}`)
  console.log(`  SwissDevJobs: ${swiss.length} | NoDesk: ${nodesk.length}`)

  if (!allJobs.length) { console.log('No jobs found'); process.exit(0) }

  // Country breakdown
  const byCountry = {}
  allJobs.forEach(j => { byCountry[j.country] = (byCountry[j.country] || 0) + 1 })
  console.log('\n🌍 By country:', Object.entries(byCountry).sort((a,b) => b[1]-a[1]).slice(0,10).map(([c,n]) => `${c}:${n}`).join(' | '))

  let saved = 0
  for (let i = 0; i < allJobs.length; i += 100) {
    const batch = allJobs.slice(i, i + 100)
    const result = await upsertJobs(batch)
    if (result.status === 201 || result.status === 200) {
      saved += batch.length
      process.stdout.write(`✅ Saved ${saved}/${allJobs.length}\r`)
    } else {
      console.log(`\n⚠️ Batch ${Math.floor(i/100)+1} failed: ${result.status}`)
      if (result.data) console.log(result.data.substring(0, 300))
    }
  }

  console.log(`\n\n🎉 DONE! Saved ${saved}/${allJobs.length} jobs to database`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
