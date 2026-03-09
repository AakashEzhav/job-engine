#!/usr/bin/env node
// ============================================================
// DIRECT SCRAPER - Runs in GitHub Actions
// Fetches from Adzuna + free job boards and saves to Supabase
// No Vercel involved - direct to database
// ============================================================

const https = require('https')
const http = require('http')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

// ─── HTTP fetch helper ───────────────────────────────────────
function fetchJson(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobEngine/1.0'
      },
      timeout: 15000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { resolve(null) }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

// ─── Supabase upsert ─────────────────────────────────────────
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

// ─── Fingerprint ─────────────────────────────────────────────
function fingerprint(company, title, country) {
  const str = `${company}-${title}-${country}`.toLowerCase().replace(/\s+/g, '-').substring(0, 50)
  return str + '-' + Math.random().toString(36).substring(2, 8)
}

// ─── ADZUNA ──────────────────────────────────────────────────
async function scrapeAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    console.log('[Adzuna] No API keys, skipping')
    return []
  }

  const countries = [
    { code: 'us', name: 'USA' },
    { code: 'gb', name: 'United Kingdom' },
    { code: 'ca', name: 'Canada' },
    { code: 'au', name: 'Australia' },
    { code: 'de', name: 'Germany' },
    { code: 'nl', name: 'Netherlands' },
    { code: 'sg', name: 'Singapore' },
  ]

  const terms = ['software engineer', 'developer', 'data scientist', 'devops engineer', 'product manager', 'backend engineer', 'frontend engineer']
  const jobs = []
  const seen = new Set()

  // Run all in parallel
  const requests = countries.flatMap(c => terms.map(t => ({ c, t })))
  
  console.log(`[Adzuna] Making ${requests.length} parallel requests...`)
  
  const results = await Promise.all(requests.map(({ c, t }) => {
    const url = `https://api.adzuna.com/v1/api/jobs/${c.code}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(t)}&sort_by=date&max_days_old=30&content-type=application/json`
    return fetchJson(url).then(data => ({ country: c, data }))
  }))

  for (const { country, data } of results) {
    if (!data?.results?.length) continue
    
    for (const item of data.results) {
      const title = item.title || ''
      const company = item.company?.display_name || 'Unknown'
      const key = `${company}-${title}-${country.code}`
      if (seen.has(key)) continue
      seen.add(key)

      const desc = item.description || ''
      const location = item.location?.display_name || ''
      const isRemote = /remote|work from home|wfh/i.test(`${title} ${desc} ${location}`)
      const isHybrid = /hybrid/i.test(`${title} ${desc} ${location}`)
      const remoteType = isRemote ? 'remote' : isHybrid ? 'hybrid' : 'onsite'
      const hasVisa = /visa sponsor|will sponsor|h-?1b|work authoriz|right to work/i.test(desc)

      const currencyMap = { gb: 'GBP', au: 'AUD', ca: 'CAD', de: 'EUR', nl: 'EUR', sg: 'SGD', us: 'USD' }

      jobs.push({
        job_id: fingerprint(company, title, country.name),
        job_title: title.substring(0, 200),
        company_name: company.substring(0, 200),
        country: country.name,
        city: location.split(',')[0]?.trim() || '',
        remote_type: remoteType,
        salary_min: item.salary_min || null,
        salary_max: item.salary_max || null,
        salary_currency: currencyMap[country.code] || 'USD',
        salary_predicted: !item.salary_min,
        job_description: desc.substring(0, 2000),
        job_url: item.redirect_url || '',
        job_source: 'adzuna',
        source_type: 'job_board',
        visa_probability: hasVisa ? 0.8 : 0.3,
        visa_sponsorship: hasVisa,
        relocation_assistance: /relocation/i.test(desc),
        quality_score: 7.5,
        date_posted: item.created ? new Date(item.created).toISOString() : new Date().toISOString(),
        tech_stack: [],
        job_category: 'engineering',
        experience_level: /senior|staff|lead|principal/i.test(title) ? 'senior' : /junior|entry|graduate/i.test(title) ? 'junior' : 'mid',
        verification_status: 'verified',
        is_hidden_opportunity: false,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
  }

  console.log(`[Adzuna] Found ${jobs.length} jobs`)
  return jobs
}

// ─── REMOTEOK ────────────────────────────────────────────────
async function scrapeRemoteOK() {
  const data = await fetchJson('https://remoteok.com/api')
  if (!Array.isArray(data)) return []

  const jobs = data.slice(1, 100).filter(j => j.position).map(item => ({
    job_id: fingerprint(item.company || 'Unknown', item.position, 'Remote'),
    job_title: (item.position || '').substring(0, 200),
    company_name: (item.company || 'Unknown').substring(0, 200),
    country: 'Remote',
    remote_type: 'remote',
    salary_min: item.salary_min || null,
    salary_max: item.salary_max || null,
    salary_currency: 'USD',
    salary_predicted: !item.salary_min,
    job_description: (item.description || '').substring(0, 2000),
    job_url: item.url || `https://remoteok.com/remote-jobs/${item.id}`,
    job_source: 'remoteok',
    source_type: 'job_board',
    visa_probability: 0.5,
    visa_sponsorship: false,
    relocation_assistance: false,
    quality_score: 7.0,
    date_posted: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
    tech_stack: item.tags || [],
    job_category: 'engineering',
    experience_level: 'mid',
    verification_status: 'verified',
    is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))

  console.log(`[RemoteOK] Found ${jobs.length} jobs`)
  return jobs
}

// ─── ARBEITNOW ───────────────────────────────────────────────
async function scrapeArbeitnow() {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api')
  if (!data?.data?.length) return []

  const jobs = data.data.slice(0, 100).map(item => ({
    job_id: fingerprint(item.company_name || 'Unknown', item.title, 'Europe'),
    job_title: (item.title || '').substring(0, 200),
    company_name: (item.company_name || 'Unknown').substring(0, 200),
    country: item.location?.includes('Germany') ? 'Germany' : item.location?.includes('Netherlands') ? 'Netherlands' : 'Europe',
    city: (item.location || '').substring(0, 100),
    remote_type: item.remote ? 'remote' : 'onsite',
    salary_currency: 'EUR',
    salary_predicted: true,
    job_description: (item.description || '').substring(0, 2000),
    job_url: item.url || '',
    job_source: 'arbeitnow',
    source_type: 'job_board',
    visa_probability: item.visa_sponsorship ? 0.9 : 0.3,
    visa_sponsorship: item.visa_sponsorship || false,
    relocation_assistance: false,
    quality_score: 7.0,
    date_posted: item.created_at ? new Date(item.created_at * 1000).toISOString() : new Date().toISOString(),
    tech_stack: item.tags || [],
    job_category: 'engineering',
    experience_level: 'mid',
    verification_status: 'verified',
    is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))

  console.log(`[Arbeitnow] Found ${jobs.length} jobs`)
  return jobs
}

// ─── REMOTIVE ────────────────────────────────────────────────
async function scrapeRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=100')
  if (!data?.jobs?.length) return []

  const jobs = data.jobs.map(item => ({
    job_id: fingerprint(item.company_name || 'Unknown', item.title, 'Remote'),
    job_title: (item.title || '').substring(0, 200),
    company_name: (item.company_name || 'Unknown').substring(0, 200),
    country: 'Remote',
    remote_type: 'remote',
    salary_currency: 'USD',
    salary_predicted: true,
    job_description: (item.description || '').replace(/<[^>]*>/g, '').substring(0, 2000),
    job_url: item.url || '',
    job_source: 'remotive',
    source_type: 'job_board',
    visa_probability: 0.4,
    visa_sponsorship: false,
    relocation_assistance: false,
    quality_score: 7.0,
    date_posted: item.publication_date ? new Date(item.publication_date).toISOString() : new Date().toISOString(),
    tech_stack: item.tags || [],
    job_category: item.category?.toLowerCase().includes('engineer') ? 'engineering' : 'other',
    experience_level: 'mid',
    verification_status: 'verified',
    is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))

  console.log(`[Remotive] Found ${jobs.length} jobs`)
  return jobs
}

// ─── WEWORKREMOTELY ──────────────────────────────────────────
async function scrapeWWR() {
  const data = await fetchJson('https://weworkremotely.com/categories/remote-programming-jobs.json')
  if (!data?.jobs?.length) return []

  const jobs = data.jobs.slice(0, 50).map(item => ({
    job_id: fingerprint(item.company || 'Unknown', item.title, 'Remote'),
    job_title: (item.title || '').substring(0, 200),
    company_name: (item.company || 'Unknown').substring(0, 200),
    country: 'Remote',
    remote_type: 'remote',
    salary_currency: 'USD',
    salary_predicted: true,
    job_description: '',
    job_url: item.url ? `https://weworkremotely.com${item.url}` : '',
    job_source: 'weworkremotely',
    source_type: 'job_board',
    visa_probability: 0.4,
    visa_sponsorship: false,
    relocation_assistance: false,
    quality_score: 7.0,
    date_posted: new Date().toISOString(),
    tech_stack: [],
    job_category: 'engineering',
    experience_level: 'mid',
    verification_status: 'verified',
    is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))

  console.log(`[WWR] Found ${jobs.length} jobs`)
  return jobs
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  console.log('🌍 Direct scraper starting...')
  console.log(`Supabase: ${SUPABASE_URL}`)
  console.log(`Adzuna: ${ADZUNA_APP_ID ? '✅ configured' : '❌ missing'}`)

  // Run all scrapers in parallel
  const [adzunaJobs, remoteokJobs, arbeitnowJobs, remotiveJobs, wwrJobs] = await Promise.all([
    scrapeAdzuna(),
    scrapeRemoteOK(),
    scrapeArbeitnow(),
    scrapeRemotive(),
    scrapeWWR()
  ])

  const allJobs = [...adzunaJobs, ...remoteokJobs, ...arbeitnowJobs, ...remotiveJobs, ...wwrJobs]
  console.log(`\n📊 Total jobs collected: ${allJobs.length}`)

  if (allJobs.length === 0) {
    console.log('⚠️ No jobs found')
    process.exit(0)
  }

  // Insert in batches of 100
  let saved = 0
  const batchSize = 100
  for (let i = 0; i < allJobs.length; i += batchSize) {
    const batch = allJobs.slice(i, i + batchSize)
    const result = await upsertJobs(batch)
    if (result.status === 201 || result.status === 200) {
      saved += batch.length
      console.log(`✅ Saved batch ${Math.floor(i/batchSize) + 1}: ${batch.length} jobs`)
    } else {
      console.log(`⚠️ Batch ${Math.floor(i/batchSize) + 1} status: ${result.status}`)
      if (result.data) console.log(result.data.substring(0, 200))
    }
  }

  console.log(`\n🎉 Done! Saved ${saved}/${allJobs.length} jobs to database`)
  console.log(`  Adzuna: ${adzunaJobs.length}`)
  console.log(`  RemoteOK: ${remoteokJobs.length}`)
  console.log(`  Arbeitnow: ${arbeitnowJobs.length}`)
  console.log(`  Remotive: ${remotiveJobs.length}`)
  console.log(`  WeWorkRemotely: ${wwrJobs.length}`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
