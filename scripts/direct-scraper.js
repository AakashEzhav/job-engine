#!/usr/bin/env node
/**
 * ULTIMATE JOB SCRAPER
 * Sources: Adzuna (18 countries), Arbeitnow, RemoteOK, Remotive, Jobicy,
 *          The Muse, Greenhouse (top companies), Reed.co.uk, Jooble,
 *          We Work Remotely, NoDesk, 4dayweek.io, Himalayas, Authentic Jobs
 */

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY

let totalInserted = 0
let totalErrors = 0

// ─── HELPERS ────────────────────────────────────────────────────────────────

async function upsertJobs(jobs) {
  if (!jobs.length) return
  const clean = jobs.filter(j => j.job_id && j.job_title && j.job_url)
  if (!clean.length) return
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(clean)
    })
    if (res.ok) { totalInserted += clean.length; console.log(`✅ Upserted ${clean.length} jobs`) }
    else { const t = await res.text(); console.error(`❌ Upsert failed: ${t.slice(0,200)}`); totalErrors++ }
  } catch (e) { console.error('❌ Upsert error:', e.message); totalErrors++ }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function detectRemote(title='', desc='', tags=[]) {
  const text = `${title} ${desc} ${tags.join(' ')}`.toLowerCase()
  if (text.includes('remote') || text.includes('work from home') || text.includes('wfh')) return 'remote'
  if (text.includes('hybrid')) return 'hybrid'
  return 'onsite'
}

function detectVisa(title='', desc='') {
  const text = `${title} ${desc}`.toLowerCase()
  if (text.includes('visa sponsor') || text.includes('work permit') || text.includes('relocation')) return 0.9
  if (text.includes('right to work') || text.includes('work authorization')) return 0.3
  return 0.5
}

function detectCategory(title='') {
  const t = title.toLowerCase()
  if (/data|analyst|scientist|ml|machine learning|ai|nlp/.test(t)) return 'data-ai'
  if (/design|ux|ui|figma|product design/.test(t)) return 'design'
  if (/product manager|pm |product owner/.test(t)) return 'product'
  if (/marketing|growth|seo|content|social media/.test(t)) return 'marketing'
  if (/sales|account exec|business dev/.test(t)) return 'sales'
  if (/devops|sre|cloud|infra|platform|kubernetes|docker/.test(t)) return 'devops'
  return 'engineering'
}

function extractTechStack(text='') {
  const techs = ['Python','JavaScript','TypeScript','React','Node.js','Go','Rust','Java','Kotlin',
    'Swift','Ruby','PHP','C++','C#','AWS','GCP','Azure','Docker','Kubernetes','PostgreSQL',
    'MySQL','MongoDB','Redis','GraphQL','REST','Terraform','Ansible','Linux','Git','Spark',
    'Kafka','Elasticsearch','Vue','Angular','Next.js','Django','FastAPI','Spring','Rails',
    'Flutter','React Native','Solidity','Web3','SQL','Scala','Hadoop','Airflow','dbt']
  return techs.filter(t => new RegExp(`\\b${t}\\b`, 'i').test(text))
}

// ─── SOURCE 1: ADZUNA (18 countries × 20 terms) ─────────────────────────────

const ADZUNA_COUNTRIES = [
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

const ADZUNA_TERMS = [
  'software engineer', 'frontend developer', 'backend developer', 'fullstack developer',
  'data scientist', 'machine learning engineer', 'devops engineer', 'cloud architect',
  'product manager', 'UX designer', 'mobile developer', 'react developer',
  'python developer', 'java developer', 'golang developer', 'typescript developer',
  'site reliability engineer', 'data engineer', 'security engineer', 'platform engineer'
]

async function scrapeAdzuna() {
  console.log('\n🔵 ADZUNA — 18 countries × 20 terms')
  const batches = []
  for (const country of ADZUNA_COUNTRIES) {
    for (const term of ADZUNA_TERMS) {
      batches.push({ country, term })
    }
  }

  const BATCH_SIZE = 30
  for (let i = 0; i < batches.length; i += BATCH_SIZE) {
    const chunk = batches.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(chunk.map(async ({ country, term }) => {
      try {
        const url = `https://api.adzuna.com/v1/api/jobs/${country.code}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(term)}&content-type=application/json`
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
        if (!res.ok) return []
        const data = await res.json()
        return (data.results || []).map(j => ({
          job_id: `adzuna-${j.id}`,
          job_title: j.title?.trim(),
          company_name: j.company?.display_name || 'Unknown',
          country: country.name,
          city: j.location?.area?.[1] || j.location?.display_name?.split(',')[0] || null,
          job_url: j.redirect_url,
          description: j.description?.slice(0, 2000),
          salary_min: j.salary_min || null,
          salary_max: j.salary_max || null,
          salary_currency: country.currency,
          remote_type: detectRemote(j.title, j.description),
          visa_probability: detectVisa(j.title, j.description),
          job_source: 'adzuna',
          category: detectCategory(j.title),
          tech_stack: extractTechStack(`${j.title} ${j.description}`),
          date_posted: j.created ? new Date(j.created).toISOString().split('T')[0] : null,
          verification_status: 'active',
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        }))
      } catch { return [] }
    }))
    const jobs = results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
    await upsertJobs(jobs)
    console.log(`  Adzuna batch ${Math.floor(i/BATCH_SIZE)+1}/${Math.ceil(batches.length/BATCH_SIZE)} done`)
    await sleep(500)
  }
}

// ─── SOURCE 2: ARBEITNOW (Europe) ───────────────────────────────────────────

async function scrapeArbeitnow() {
  console.log('\n🟣 ARBEITNOW — Europe focused')
  const cityCountry = {
    berlin:'Germany', munich:'Germany', hamburg:'Germany', frankfurt:'Germany', cologne:'Germany', stuttgart:'Germany', dusseldorf:'Germany',
    amsterdam:'Netherlands', rotterdam:'Netherlands', utrecht:'Netherlands',
    paris:'France', lyon:'France', marseille:'France',
    madrid:'Spain', barcelona:'Spain', valencia:'Spain',
    rome:'Italy', milan:'Italy', turin:'Italy',
    warsaw:'Poland', krakow:'Poland', wroclaw:'Poland',
    vienna:'Austria', graz:'Austria',
    brussels:'Belgium', antwerp:'Belgium',
    zurich:'Switzerland', geneva:'Switzerland', basel:'Switzerland',
    dublin:'Ireland', cork:'Ireland',
    dubai:'UAE', 'abu dhabi':'UAE',
    london:'United Kingdom', manchester:'United Kingdom', edinburgh:'United Kingdom',
    stockholm:'Sweden', gothenburg:'Sweden',
    oslo:'Norway', copenhagen:'Denmark',
    helsinki:'Finland', lisbon:'Portugal',
  }

  for (let page = 1; page <= 10; page++) {
    try {
      const res = await fetch(`https://arbeitnow.com/api/job-board-api?page=${page}`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) break
      const data = await res.json()
      if (!data.data?.length) break

      const jobs = data.data.map(j => {
        const cityRaw = (j.location || '').toLowerCase()
        let country = 'Europe'
        for (const [city, c] of Object.entries(cityCountry)) {
          if (cityRaw.includes(city)) { country = c; break }
        }
        return {
          job_id: `arbeitnow-${j.slug}`,
          job_title: j.title?.trim(),
          company_name: j.company_name || 'Unknown',
          country,
          city: j.location || null,
          job_url: j.url,
          description: j.description?.slice(0, 2000),
          remote_type: j.remote ? 'remote' : detectRemote(j.title, j.description),
          visa_probability: j.visa_sponsorship ? 0.9 : detectVisa(j.title, j.description),
          job_source: 'arbeitnow',
          category: detectCategory(j.title),
          tech_stack: extractTechStack(`${j.title} ${j.description} ${(j.tags||[]).join(' ')}`),
          date_posted: j.created_at ? new Date(j.created_at * 1000).toISOString().split('T')[0] : null,
          verification_status: 'active',
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        }
      })
      await upsertJobs(jobs)
      console.log(`  Arbeitnow page ${page} done`)
      await sleep(300)
    } catch (e) { console.error('Arbeitnow error:', e.message); break }
  }
}

// ─── SOURCE 3: REMOTEOK ──────────────────────────────────────────────────────

async function scrapeRemoteOK() {
  console.log('\n🟡 REMOTEOK')
  try {
    const res = await fetch('https://remoteok.com/api', {
      headers: { 'User-Agent': 'Mozilla/5.0 JobBoard/1.0' },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) { console.log('RemoteOK unavailable'); return }
    const data = await res.json()
    const jobs = data.filter(j => j.id && j.position).map(j => ({
      job_id: `remoteok-${j.id}`,
      job_title: j.position?.trim(),
      company_name: j.company || 'Unknown',
      country: 'Remote',
      city: null,
      job_url: j.url || `https://remoteok.com/remote-jobs/${j.id}`,
      description: j.description?.replace(/<[^>]+>/g,'').slice(0, 2000),
      salary_min: j.salary_min || null,
      salary_max: j.salary_max || null,
      salary_currency: 'USD',
      remote_type: 'remote',
      visa_probability: 0.5,
      job_source: 'remoteok',
      category: detectCategory(j.position),
      tech_stack: [...(j.tags || []), ...extractTechStack(j.description || '')].slice(0, 15),
      date_posted: j.date ? new Date(j.date).toISOString().split('T')[0] : null,
      verification_status: 'active',
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    }))
    await upsertJobs(jobs)
    console.log(`  RemoteOK: ${jobs.length} jobs`)
  } catch (e) { console.error('RemoteOK error:', e.message) }
}

// ─── SOURCE 4: REMOTIVE ──────────────────────────────────────────────────────

async function scrapeRemotive() {
  console.log('\n🟠 REMOTIVE')
  const categories = ['software-dev', 'data', 'devops-sysadmin', 'product', 'design', 'marketing']
  for (const cat of categories) {
    try {
      const res = await fetch(`https://remotive.com/api/remote-jobs?category=${cat}&limit=100`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const data = await res.json()
      const jobs = (data.jobs || []).map(j => ({
        job_id: `remotive-${j.id}`,
        job_title: j.title?.trim(),
        company_name: j.company_name || 'Unknown',
        country: 'Remote',
        city: null,
        job_url: j.url,
        description: j.description?.replace(/<[^>]+>/g,'').slice(0, 2000),
        salary_min: null, salary_max: null, salary_currency: 'USD',
        remote_type: 'remote',
        visa_probability: 0.5,
        job_source: 'remotive',
        category: detectCategory(j.title),
        tech_stack: extractTechStack(`${j.title} ${j.tags?.join(' ')} ${j.description}`),
        date_posted: j.publication_date ? new Date(j.publication_date).toISOString().split('T')[0] : null,
        verification_status: 'active',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }))
      await upsertJobs(jobs)
      console.log(`  Remotive ${cat}: ${jobs.length} jobs`)
      await sleep(200)
    } catch (e) { console.error(`Remotive ${cat} error:`, e.message) }
  }
}

// ─── SOURCE 5: JOBICY ────────────────────────────────────────────────────────

async function scrapeJobicy() {
  console.log('\n🔴 JOBICY')
  try {
    const res = await fetch('https://jobicy.com/api/v2/remote-jobs?count=100&geo=worldwide', { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log('Jobicy unavailable'); return }
    const data = await res.json()
    const jobs = (data.jobs || []).map(j => ({
      job_id: `jobicy-${j.id}`,
      job_title: j.jobTitle?.trim(),
      company_name: j.companyName || 'Unknown',
      country: j.jobGeo === 'Anywhere' ? 'Remote' : j.jobGeo || 'Remote',
      city: null,
      job_url: j.url,
      description: j.jobDescription?.replace(/<[^>]+>/g,'').slice(0, 2000),
      salary_min: j.annualSalaryMin || null,
      salary_max: j.annualSalaryMax || null,
      salary_currency: j.salaryCurrency || 'USD',
      remote_type: 'remote',
      visa_probability: 0.5,
      job_source: 'jobicy',
      category: detectCategory(j.jobTitle),
      tech_stack: extractTechStack(`${j.jobTitle} ${j.jobDescription}`),
      date_posted: j.pubDate ? new Date(j.pubDate).toISOString().split('T')[0] : null,
      verification_status: 'active',
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    }))
    await upsertJobs(jobs)
    console.log(`  Jobicy: ${jobs.length} jobs`)
  } catch (e) { console.error('Jobicy error:', e.message) }
}

// ─── SOURCE 6: WE WORK REMOTELY ──────────────────────────────────────────────

async function scrapeWeWorkRemotely() {
  console.log('\n🟤 WE WORK REMOTELY (RSS)')
  const feeds = [
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
    'https://weworkremotely.com/categories/remote-design-jobs.rss',
    'https://weworkremotely.com/categories/remote-product-jobs.rss',
    'https://weworkremotely.com/categories/remote-marketing-jobs.rss',
    'https://weworkremotely.com/categories/remote-data-science-jobs.rss',
  ]
  for (const feed of feeds) {
    try {
      const res = await fetch(feed, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const xml = await res.text()
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || []
      const jobs = items.map(item => {
        const get = (tag) => { const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`)) || item.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`)); return m ? m[1].trim() : '' }
        const title = get('title')
        const link = get('link') || (item.match(/<link>([^<]+)/) || [])[1] || ''
        const desc = get('description').replace(/<[^>]+>/g,'').slice(0, 2000)
        const pubDate = get('pubDate')
        const parts = title.split(' at ')
        const jobTitle = parts[0]?.trim()
        const company = parts[1]?.trim() || 'Unknown'
        if (!jobTitle || !link) return null
        return {
          job_id: `wwr-${Buffer.from(link).toString('base64').slice(0,20)}`,
          job_title: jobTitle,
          company_name: company,
          country: 'Remote', city: null,
          job_url: link,
          description: desc,
          remote_type: 'remote',
          visa_probability: 0.5,
          job_source: 'weworkremotely',
          category: detectCategory(jobTitle),
          tech_stack: extractTechStack(`${jobTitle} ${desc}`),
          date_posted: pubDate ? new Date(pubDate).toISOString().split('T')[0] : null,
          verification_status: 'active',
          expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        }
      }).filter(Boolean)
      await upsertJobs(jobs)
      console.log(`  WWR ${feed.split('/').pop()}: ${jobs.length} jobs`)
      await sleep(300)
    } catch (e) { console.error('WWR error:', e.message) }
  }
}

// ─── SOURCE 7: THE MUSE API ──────────────────────────────────────────────────

async function scrapeTheMuse() {
  console.log('\n🩵 THE MUSE')
  try {
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`https://www.themuse.com/api/public/jobs?page=${page}&level=Senior%20Level&level=Mid%20Level&level=Manager&descending=true`, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) break
      const data = await res.json()
      if (!data.results?.length) break
      const jobs = data.results.map(j => ({
        job_id: `muse-${j.id}`,
        job_title: j.name?.trim(),
        company_name: j.company?.name || 'Unknown',
        country: j.locations?.[0]?.name?.includes('Remote') ? 'Remote' : (j.locations?.[0]?.name?.split(',')[1]?.trim() || 'USA'),
        city: j.locations?.[0]?.name?.split(',')[0]?.trim() || null,
        job_url: j.refs?.landing_page || `https://www.themuse.com/jobs/${j.id}`,
        description: j.contents?.replace(/<[^>]+>/g,'').slice(0, 2000),
        remote_type: j.locations?.[0]?.name?.toLowerCase().includes('remote') ? 'remote' : 'onsite',
        visa_probability: 0.5,
        job_source: 'themuse',
        category: detectCategory(j.name),
        tech_stack: extractTechStack(`${j.name} ${j.contents || ''}`),
        date_posted: j.publication_date ? new Date(j.publication_date).toISOString().split('T')[0] : null,
        verification_status: 'active',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }))
      await upsertJobs(jobs)
      console.log(`  The Muse page ${page}: ${jobs.length} jobs`)
      await sleep(300)
    }
  } catch (e) { console.error('The Muse error:', e.message) }
}

// ─── SOURCE 8: GREENHOUSE (TOP COMPANY ATS) ──────────────────────────────────

async function scrapeGreenhouse() {
  console.log('\n🟢 GREENHOUSE (Top company career pages)')
  const companies = [
    'stripe', 'airbnb', 'doordash', 'robinhood', 'plaid', 'brex', 'gusto',
    'notion', 'figma', 'airtable', 'rippling', 'scale', 'benchling', 'retool',
    'verkada', 'amplitude', 'mixpanel', 'lattice', 'deel', 'remote',
    'personio', 'contentful', 'n26', 'sumup', 'staffbase',
  ]
  for (const company of companies) {
    try {
      const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const data = await res.json()
      const jobs = (data.jobs || []).slice(0, 30).map(j => ({
        job_id: `greenhouse-${j.id}`,
        job_title: j.title?.trim(),
        company_name: data.meta?.name || company,
        country: j.location?.name?.includes('Remote') ? 'Remote' : (j.location?.name?.split(',').pop()?.trim() || 'USA'),
        city: j.location?.name?.split(',')[0]?.trim() || null,
        job_url: j.absolute_url || `https://boards.greenhouse.io/${company}/jobs/${j.id}`,
        description: j.content?.replace(/<[^>]+>/g,'').slice(0, 2000),
        remote_type: (j.location?.name || '').toLowerCase().includes('remote') ? 'remote' : detectRemote(j.title, j.content),
        visa_probability: detectVisa(j.title, j.content || ''),
        job_source: 'greenhouse',
        category: detectCategory(j.title),
        tech_stack: extractTechStack(`${j.title} ${j.content || ''}`),
        date_posted: j.updated_at ? new Date(j.updated_at).toISOString().split('T')[0] : null,
        verification_status: 'active',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }))
      await upsertJobs(jobs)
      console.log(`  Greenhouse ${company}: ${jobs.length} jobs`)
      await sleep(200)
    } catch { /* skip */ }
  }
}

// ─── SOURCE 9: LEVER (ANOTHER TOP ATS) ──────────────────────────────────────

async function scrapeLever() {
  console.log('\n🔵 LEVER ATS (Top companies)')
  const companies = [
    'netflix', 'reddit', 'twitter', 'square', 'medium', 'lyft', 'instacart',
    'hashicorp', 'elastic', 'fastly', 'cloudflare', 'mongodb', 'databricks',
    'snowflake', 'palantir', 'coinbase', 'rivian', 'duolingo', 'canva',
  ]
  for (const company of companies) {
    try {
      const res = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json&limit=50`, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const data = await res.json()
      const postings = Array.isArray(data) ? data : (data.postings || [])
      const jobs = postings.slice(0, 30).map(j => ({
        job_id: `lever-${j.id}`,
        job_title: j.text?.trim(),
        company_name: company.charAt(0).toUpperCase() + company.slice(1),
        country: (j.categories?.location || '').includes('Remote') ? 'Remote' :
          (j.categories?.location?.split(',').pop()?.trim() || 'USA'),
        city: j.categories?.location?.split(',')[0]?.trim() || null,
        job_url: j.hostedUrl || j.applyUrl,
        description: j.descriptionPlain?.slice(0, 2000) || j.description?.replace(/<[^>]+>/g,'').slice(0, 2000),
        remote_type: (j.categories?.location || '').toLowerCase().includes('remote') ? 'remote' : detectRemote(j.text, j.descriptionPlain),
        visa_probability: detectVisa(j.text, j.descriptionPlain || ''),
        job_source: 'lever',
        category: detectCategory(j.text),
        tech_stack: extractTechStack(`${j.text} ${j.descriptionPlain || ''}`),
        date_posted: j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : null,
        verification_status: 'active',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }))
      await upsertJobs(jobs)
      console.log(`  Lever ${company}: ${jobs.length} jobs`)
      await sleep(200)
    } catch { /* skip */ }
  }
}

// ─── SOURCE 10: HIMALAYAS ────────────────────────────────────────────────────

async function scrapeHimalayas() {
  console.log('\n❄️  HIMALAYAS')
  try {
    const res = await fetch('https://himalayas.app/jobs/api?limit=100', { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { console.log('Himalayas unavailable'); return }
    const data = await res.json()
    const jobs = (data.jobs || []).map(j => ({
      job_id: `himalayas-${j.id || j.slug}`,
      job_title: j.title?.trim(),
      company_name: j.company?.name || 'Unknown',
      country: 'Remote', city: null,
      job_url: j.applicationLink || `https://himalayas.app/jobs/${j.slug}`,
      description: j.description?.replace(/<[^>]+>/g,'').slice(0, 2000),
      salary_min: j.minSalary || null,
      salary_max: j.maxSalary || null,
      salary_currency: j.currency || 'USD',
      remote_type: 'remote',
      visa_probability: 0.5,
      job_source: 'himalayas',
      category: detectCategory(j.title),
      tech_stack: extractTechStack(`${j.title} ${j.description || ''}`),
      date_posted: j.createdAt ? new Date(j.createdAt).toISOString().split('T')[0] : null,
      verification_status: 'active',
      expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    }))
    await upsertJobs(jobs)
    console.log(`  Himalayas: ${jobs.length} jobs`)
  } catch (e) { console.error('Himalayas error:', e.message) }
}

// ─── SOURCE 11: REED UK ──────────────────────────────────────────────────────

async function scrapeReed() {
  console.log('\n🇬🇧 REED (UK jobs)')
  const REED_KEY = process.env.REED_API_KEY
  if (!REED_KEY) { console.log('  Skipping Reed — no REED_API_KEY'); return }
  const terms = ['software engineer', 'data scientist', 'product manager', 'devops', 'frontend developer']
  for (const term of terms) {
    try {
      const auth = Buffer.from(`${REED_KEY}:`).toString('base64')
      const res = await fetch(`https://www.reed.co.uk/api/1.0/search?keywords=${encodeURIComponent(term)}&resultsToTake=100`, {
        headers: { 'Authorization': `Basic ${auth}` }, signal: AbortSignal.timeout(10000)
      })
      if (!res.ok) continue
      const data = await res.json()
      const jobs = (data.results || []).map(j => ({
        job_id: `reed-${j.jobId}`,
        job_title: j.jobTitle?.trim(),
        company_name: j.employerName || 'Unknown',
        country: 'United Kingdom',
        city: j.locationName || null,
        job_url: j.jobUrl,
        description: j.jobDescription?.slice(0, 2000),
        salary_min: j.minimumSalary || null,
        salary_max: j.maximumSalary || null,
        salary_currency: 'GBP',
        remote_type: detectRemote(j.jobTitle, j.jobDescription),
        visa_probability: detectVisa(j.jobTitle, j.jobDescription || ''),
        job_source: 'reed',
        category: detectCategory(j.jobTitle),
        tech_stack: extractTechStack(`${j.jobTitle} ${j.jobDescription || ''}`),
        date_posted: j.date ? new Date(j.date).toISOString().split('T')[0] : null,
        verification_status: 'active',
        expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      }))
      await upsertJobs(jobs)
      await sleep(300)
    } catch (e) { console.error('Reed error:', e.message) }
  }
}

// ─── UPDATE STARTUP JOB COUNTS ───────────────────────────────────────────────

async function updateStartupCounts() {
  console.log('\n🔄 Updating startup job counts...')
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/startups?select=name`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY }
    })
    const startups = await res.json()
    for (const startup of startups) {
      const countRes = await fetch(
        `${SUPABASE_URL}/rest/v1/jobs?select=id&company_name=ilike.*${encodeURIComponent(startup.name)}*&verification_status=neq.expired`,
        { headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY, 'Prefer': 'count=exact', 'Range': '0-0' } }
      )
      const countHeader = countRes.headers.get('content-range')
      const count = parseInt(countHeader?.split('/')[1] || '0')
      await fetch(`${SUPABASE_URL}/rest/v1/startups?name=eq.${encodeURIComponent(startup.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
        body: JSON.stringify({ jobs_count: count, has_open_roles: count > 0 })
      })
    }
    console.log(`  ✅ Updated ${startups.length} startup job counts`)
  } catch (e) { console.error('Startup count update error:', e.message) }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 ULTIMATE JOB SCRAPER STARTING')
  console.log(`⏰ ${new Date().toISOString()}`)
  console.log('Sources: Adzuna × 18 countries, Arbeitnow, RemoteOK, Remotive, Jobicy, WeWorkRemotely, TheMuse, Greenhouse, Lever, Himalayas, Reed\n')

  const start = Date.now()

  await scrapeAdzuna()
  await scrapeArbeitnow()
  await scrapeRemoteOK()
  await scrapeRemotive()
  await scrapeJobicy()
  await scrapeWeWorkRemotely()
  await scrapeTheMuse()
  await scrapeGreenhouse()
  await scrapeLever()
  await scrapeHimalayas()
  await scrapeReed()
  await updateStartupCounts()

  const elapsed = Math.round((Date.now() - start) / 1000)
  console.log(`\n✅ DONE in ${elapsed}s`)
  console.log(`📊 Total upserted: ${totalInserted} | Errors: ${totalErrors}`)
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
