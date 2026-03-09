#!/usr/bin/env node
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

function fetchJson(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'JobEngine/1.0' },
      timeout: 20000
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

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

let counter = 0
function fingerprint(company, title, extra) {
  counter++
  const str = `${company}-${title}-${extra}-${counter}`.toLowerCase().replace(/\s+/g, '-').substring(0, 60)
  return str + '-' + Date.now().toString(36)
}

function detectVisa(desc, country) {
  // Strong visa signals
  const strongSignals = /visa sponsor|will sponsor|h-?1b sponsor|tier 2 sponsor|work permit|authoriz.*work|right to work.*provid|we.*sponsor|sponsorship.*available|global.*hire|hire.*worldwide|open to.*relocation/i
  // Country-specific signals  
  const euSignals = /work permit|blue card|eu work|relocation package|global talent/i
  const usSignals = /h1b|h-1b|visa sponsor|opt|stem opt|authorized to work/i
  
  if (strongSignals.test(desc)) return { prob: 0.85, sponsorship: true }
  if (country === 'USA' && usSignals.test(desc)) return { prob: 0.8, sponsorship: true }
  if (['Germany', 'Netherlands', 'United Kingdom', 'Ireland'].includes(country) && euSignals.test(desc)) return { prob: 0.75, sponsorship: true }
  if (/relocation/i.test(desc)) return { prob: 0.6, sponsorship: false }
  if (['Germany', 'Netherlands', 'Singapore', 'Canada', 'Australia', 'Ireland'].includes(country)) return { prob: 0.45, sponsorship: false }
  return { prob: 0.25, sponsorship: false }
}

async function scrapeAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) { console.log('[Adzuna] No keys'); return [] }

  const countries = [
    { code: 'us', name: 'USA' },
    { code: 'gb', name: 'United Kingdom' },
    { code: 'ca', name: 'Canada' },
    { code: 'au', name: 'Australia' },
    { code: 'de', name: 'Germany' },
    { code: 'nl', name: 'Netherlands' },
    { code: 'sg', name: 'Singapore' },
    { code: 'at', name: 'Austria' },
    { code: 'be', name: 'Belgium' },
    { code: 'in', name: 'India' },
    { code: 'nz', name: 'New Zealand' },
  ]

  const terms = [
    'software engineer', 'developer', 'data scientist', 'devops',
    'product manager', 'backend engineer', 'frontend engineer',
    'full stack developer', 'machine learning', 'data engineer',
    'cloud engineer', 'site reliability', 'mobile developer'
  ]

  const requests = countries.flatMap(c => terms.map(t => ({ c, t })))
  console.log(`[Adzuna] Making ${requests.length} parallel requests...`)

  const results = await Promise.all(requests.map(({ c, t }) => {
    const url = `https://api.adzuna.com/v1/api/jobs/${c.code}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(t)}&sort_by=date&max_days_old=30&content-type=application/json`
    return fetchJson(url).then(data => ({ country: c, data }))
  }))

  const jobs = []
  const seen = new Set()
  const currencyMap = { gb: 'GBP', au: 'AUD', ca: 'CAD', de: 'EUR', nl: 'EUR', sg: 'SGD', at: 'EUR', be: 'EUR', in: 'INR', nz: 'NZD', us: 'USD' }

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
      const visa = detectVisa(desc, country.name)
      const expLevel = /senior|staff|lead|principal|architect/i.test(title) ? 'senior' : /junior|entry|graduate|intern/i.test(title) ? 'junior' : 'mid'

      jobs.push({
        job_id: fingerprint(company, title, country.code),
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
        visa_probability: visa.prob,
        visa_sponsorship: visa.sponsorship,
        relocation_assistance: /relocation/i.test(desc),
        quality_score: visa.sponsorship ? 8.5 : 7.5,
        date_posted: item.created ? new Date(item.created).toISOString() : new Date().toISOString(),
        tech_stack: [],
        job_category: 'engineering',
        experience_level: expLevel,
        verification_status: 'verified',
        is_hidden_opportunity: false,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }
  }

  console.log(`[Adzuna] Found ${jobs.length} jobs`)
  return jobs
}

async function scrapeRemoteOK() {
  const data = await fetchJson('https://remoteok.com/api')
  if (!Array.isArray(data)) return []
  const jobs = data.slice(1, 150).filter(j => j.position).map(item => ({
    job_id: fingerprint(item.company || 'Unknown', item.position, 'rok'),
    job_title: (item.position || '').substring(0, 200),
    company_name: (item.company || 'Unknown').substring(0, 200),
    country: 'Remote', remote_type: 'remote',
    salary_min: item.salary_min || null, salary_max: item.salary_max || null,
    salary_currency: 'USD', salary_predicted: !item.salary_min,
    job_description: (item.description || '').substring(0, 2000),
    job_url: item.url || `https://remoteok.com/remote-jobs/${item.id}`,
    job_source: 'remoteok', source_type: 'job_board',
    visa_probability: 0.5, visa_sponsorship: false, relocation_assistance: false,
    quality_score: 7.0,
    date_posted: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
    tech_stack: item.tags || [], job_category: 'engineering', experience_level: 'mid',
    verification_status: 'verified', is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))
  console.log(`[RemoteOK] Found ${jobs.length} jobs`)
  return jobs
}

async function scrapeArbeitnow() {
  const data = await fetchJson('https://www.arbeitnow.com/api/job-board-api')
  if (!data?.data?.length) return []
  const jobs = data.data.slice(0, 150).map(item => {
    const visa = item.visa_sponsorship ? { prob: 0.9, sponsorship: true } : { prob: 0.35, sponsorship: false }
    return {
      job_id: fingerprint(item.company_name || 'Unknown', item.title, 'abn'),
      job_title: (item.title || '').substring(0, 200),
      company_name: (item.company_name || 'Unknown').substring(0, 200),
      country: item.location?.includes('Germany') ? 'Germany' : item.location?.includes('Netherlands') ? 'Netherlands' : item.location?.includes('Ireland') ? 'Ireland' : 'Europe',
      city: (item.location || '').substring(0, 100),
      remote_type: item.remote ? 'remote' : 'onsite',
      salary_currency: 'EUR', salary_predicted: true,
      job_description: (item.description || '').substring(0, 2000),
      job_url: item.url || '',
      job_source: 'arbeitnow', source_type: 'job_board',
      visa_probability: visa.prob, visa_sponsorship: visa.sponsorship,
      relocation_assistance: false, quality_score: visa.sponsorship ? 8.5 : 7.0,
      date_posted: item.created_at ? new Date(item.created_at * 1000).toISOString() : new Date().toISOString(),
      tech_stack: item.tags || [], job_category: 'engineering', experience_level: 'mid',
      verification_status: 'verified', is_hidden_opportunity: false,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  })
  console.log(`[Arbeitnow] Found ${jobs.length} jobs`)
  return jobs
}

async function scrapeRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=100')
  if (!data?.jobs?.length) return []
  const jobs = data.jobs.map(item => ({
    job_id: fingerprint(item.company_name || 'Unknown', item.title, 'rem'),
    job_title: (item.title || '').substring(0, 200),
    company_name: (item.company_name || 'Unknown').substring(0, 200),
    country: 'Remote', remote_type: 'remote',
    salary_currency: 'USD', salary_predicted: true,
    job_description: (item.description || '').replace(/<[^>]*>/g, '').substring(0, 2000),
    job_url: item.url || '',
    job_source: 'remotive', source_type: 'job_board',
    visa_probability: 0.4, visa_sponsorship: false, relocation_assistance: false,
    quality_score: 7.0,
    date_posted: item.publication_date ? new Date(item.publication_date).toISOString() : new Date().toISOString(),
    tech_stack: item.tags || [], job_category: 'engineering', experience_level: 'mid',
    verification_status: 'verified', is_hidden_opportunity: false,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  }))
  console.log(`[Remotive] Found ${jobs.length} jobs`)
  return jobs
}

async function main() {
  console.log('🌍 Direct scraper starting...')
  const [adzunaJobs, remoteokJobs, arbeitnowJobs, remotiveJobs] = await Promise.all([
    scrapeAdzuna(), scrapeRemoteOK(), scrapeArbeitnow(), scrapeRemotive()
  ])

  const allJobs = [...adzunaJobs, ...remoteokJobs, ...arbeitnowJobs, ...remotiveJobs]
  console.log(`\n📊 Total: ${allJobs.length} jobs`)

  let saved = 0
  for (let i = 0; i < allJobs.length; i += 100) {
    const batch = allJobs.slice(i, i + 100)
    const result = await upsertJobs(batch)
    if (result.status === 201 || result.status === 200) {
      saved += batch.length
      console.log(`✅ Batch ${Math.floor(i/100)+1}: ${batch.length} saved`)
    } else {
      console.log(`⚠️ Batch ${Math.floor(i/100)+1} failed: ${result.status} ${result.data?.substring(0,200)}`)
    }
  }

  console.log(`\n🎉 Done! ${saved}/${allJobs.length} jobs saved`)
  console.log(`  Adzuna: ${adzunaJobs.length} | RemoteOK: ${remoteokJobs.length} | Arbeitnow: ${arbeitnowJobs.length} | Remotive: ${remotiveJobs.length}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
