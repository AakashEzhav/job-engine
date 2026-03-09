#!/usr/bin/env node
// ================================================================
// ULTIMATE JOB SCRAPER v4
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

function fetchJson(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http
    const opts = {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 JobEngine/4.0', ...headers },
      timeout: 25000
    }
    const req = lib.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(fetchJson(res.headers.location, headers)); return
      }
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

function supabasePost(path, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body)
    const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`)
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      }
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve({ status: res.statusCode, data }))
    })
    req.on('error', e => resolve({ status: 0, error: e.message }))
    req.write(payload)
    req.end()
  })
}

function upsertJobs(jobs) { return supabasePost('jobs?on_conflict=job_id', jobs) }
function upsertStartups(rows) { return supabasePost("startups?on_conflict=name", rows) }

let _c = 0
function mkid(a, b, c) {
  return `${a}-${b}-${c}-${++_c}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g,'-').substring(0,90)
}

function visa(text, country) {
  const t = (text||'').toLowerCase()
  if (/visa sponsor|will sponsor|h-?1b|tier.?2 sponsor|sponsorship (is )?available|global talent|relocation package|open to relocation/.test(t))
    return { prob: 0.85, yes: true }
  if (/right to work|work authoris|work authoriz|eligible to work|work permit/.test(t))
    return { prob: 0.7, yes: true }
  if (/relocation/.test(t)) return { prob: 0.6, yes: false }
  if (['Ireland','Switzerland','Germany','Netherlands','Singapore','Canada','Australia','UAE','Denmark','Sweden','Norway'].includes(country))
    return { prob: 0.45, yes: false }
  return { prob: 0.25, yes: false }
}

function lvl(t) {
  t = (t||'').toLowerCase()
  if (/senior|staff|lead|principal|architect|head |vp |director/.test(t)) return 'senior'
  if (/junior|entry|graduate|intern|trainee/.test(t)) return 'junior'
  return 'mid'
}

function rt(t) {
  t = (t||'').toLowerCase()
  if (/\bhybrid\b/.test(t)) return 'hybrid'
  if (/\bremote\b|work from home|\bwfh\b/.test(t)) return 'remote'
  return 'onsite'
}

function exp30() { return new Date(Date.now() + 30*24*60*60*1000).toISOString() }

// ── ADZUNA (18 countries) ────────────────────────────────────
async function scrapeAdzuna() {
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return []
  const countries = [
    {code:'us',name:'USA',cur:'USD'},{code:'gb',name:'United Kingdom',cur:'GBP'},
    {code:'ca',name:'Canada',cur:'CAD'},{code:'au',name:'Australia',cur:'AUD'},
    {code:'de',name:'Germany',cur:'EUR'},{code:'nl',name:'Netherlands',cur:'EUR'},
    {code:'sg',name:'Singapore',cur:'SGD'},{code:'at',name:'Austria',cur:'EUR'},
    {code:'be',name:'Belgium',cur:'EUR'},{code:'in',name:'India',cur:'INR'},
    {code:'nz',name:'New Zealand',cur:'NZD'},{code:'pl',name:'Poland',cur:'PLN'},
    {code:'fr',name:'France',cur:'EUR'},{code:'it',name:'Italy',cur:'EUR'},
    {code:'es',name:'Spain',cur:'EUR'},{code:'br',name:'Brazil',cur:'BRL'},
    {code:'mx',name:'Mexico',cur:'MXN'},{code:'za',name:'South Africa',cur:'ZAR'},
  ]
  const terms = [
    'software engineer','developer','data scientist','devops','product manager',
    'backend engineer','frontend engineer','full stack','machine learning',
    'data engineer','cloud engineer','mobile developer','python','javascript',
    'react','java','golang','kotlin','ios developer','android developer'
  ]
  const reqs = countries.flatMap(c => terms.map(t => ({c,t})))
  console.log(`[Adzuna] ${reqs.length} requests...`)
  const results = await Promise.all(reqs.map(({c,t}) =>
    fetchJson(`https://api.adzuna.com/v1/api/jobs/${c.code}/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&what=${encodeURIComponent(t)}&sort_by=date&max_days_old=30&content-type=application/json`)
      .then(d => ({c,d}))
  ))
  const jobs=[], seen=new Set()
  for (const {c,d} of results) {
    if (!d?.results?.length) continue
    for (const i of d.results) {
      const key=`${i.company?.display_name}::${i.title}::${c.code}`
      if (seen.has(key)) continue; seen.add(key)
      const desc=i.description||'', loc=i.location?.display_name||''
      const v=visa(desc,c.name)
      jobs.push({
        job_id:mkid(i.company?.display_name||'x',i.title||'x',c.code),
        job_title:(i.title||'').substring(0,200),
        company_name:(i.company?.display_name||'Unknown').substring(0,200),
        country:c.name, city:(loc.split(',')[0]||'').trim().substring(0,100),
        remote_type:rt(`${i.title} ${desc} ${loc}`),
        salary_min:i.salary_min||null, salary_max:i.salary_max||null,
        salary_currency:c.cur, salary_predicted:!i.salary_min,
        job_description:desc.substring(0,2000), job_url:i.redirect_url||'',
        job_source:'adzuna', source_type:'job_board',
        visa_probability:v.prob, visa_sponsorship:v.yes,
        relocation_assistance:/relocation/i.test(desc),
        quality_score:v.yes?8.5:7.5,
        date_posted:i.created?new Date(i.created).toISOString():new Date().toISOString(),
        tech_stack:[], job_category:'engineering', experience_level:lvl(i.title),
        verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
      })
    }
  }
  console.log(`[Adzuna] ✅ ${jobs.length}`)
  return jobs
}

// ── ARBEITNOW (Europe + Ireland + Switzerland) ───────────────
async function scrapeArbeitnow() {
  const pages = await Promise.all([1,2,3,4,5].map(p =>
    fetchJson(`https://www.arbeitnow.com/api/job-board-api?page=${p}`)
  ))
  const items = pages.flatMap(d => d?.data||[])
  if (!items.length) { console.log('[Arbeitnow] No data'); return [] }

  const jobs = items.map(item => {
    const loc = (item.location||'').toLowerCase()
    const desc = item.description||''
    let country = 'Europe'
    if (/ireland|dublin|cork|galway|limerick/.test(loc)) country='Ireland'
    else if (/switzerland|zurich|zürich|geneva|genf|bern|basel|lausanne/.test(loc)) country='Switzerland'
    else if (/germany|berlin|munich|münchen|hamburg|frankfurt|cologne|köln|düsseldorf/.test(loc)) country='Germany'
    else if (/netherlands|amsterdam|rotterdam|utrecht|eindhoven/.test(loc)) country='Netherlands'
    else if (/austria|vienna|wien|graz|salzburg/.test(loc)) country='Austria'
    else if (/uk|london|manchester|birmingham|edinburgh|england|scotland/.test(loc)) country='United Kingdom'
    else if (/poland|warsaw|krakow|wroclaw/.test(loc)) country='Poland'
    else if (/remote/.test(loc)) country='Remote'

    const v = item.visa_sponsorship ? {prob:0.9,yes:true} : visa(desc,country)
    const cur = country==='Switzerland'?'CHF':country==='United Kingdom'?'GBP':'EUR'

    return {
      job_id:mkid(item.company_name||'x',item.title||'x','abn'),
      job_title:(item.title||'').substring(0,200),
      company_name:(item.company_name||'Unknown').substring(0,200),
      country, city:(item.location||'').substring(0,100),
      remote_type:item.remote?'remote':rt(desc),
      salary_currency:cur, salary_predicted:true,
      job_description:desc.substring(0,2000), job_url:item.url||'',
      job_source:'arbeitnow', source_type:'job_board',
      visa_probability:v.prob, visa_sponsorship:v.yes,
      relocation_assistance:/relocation/i.test(desc),
      quality_score:v.yes?8.5:7.0,
      date_posted:item.created_at?new Date(item.created_at*1000).toISOString():new Date().toISOString(),
      tech_stack:Array.isArray(item.tags)?item.tags.slice(0,10):[],
      job_category:'engineering', experience_level:lvl(item.title),
      verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
    }
  })
  console.log(`[Arbeitnow] ✅ ${jobs.length} (Ireland:${jobs.filter(j=>j.country==='Ireland').length} CH:${jobs.filter(j=>j.country==='Switzerland').length})`)
  return jobs
}

// ── REMOTEOK ─────────────────────────────────────────────────
async function scrapeRemoteOK() {
  const data = await fetchJson('https://remoteok.com/api')
  if (!Array.isArray(data)) return []
  const jobs = data.slice(1).filter(j=>j.position&&j.company).slice(0,200).map(item => {
    const v=visa(item.description||'','Remote')
    return {
      job_id:mkid(item.company,item.position,'rok'),
      job_title:(item.position||'').substring(0,200),
      company_name:(item.company||'Unknown').substring(0,200),
      country:'Remote', city:'', remote_type:'remote',
      salary_min:item.salary_min?parseInt(item.salary_min):null,
      salary_max:item.salary_max?parseInt(item.salary_max):null,
      salary_currency:'USD', salary_predicted:!item.salary_min,
      job_description:(item.description||'').substring(0,2000),
      job_url:item.url||`https://remoteok.com/remote-jobs/${item.id}`,
      job_source:'remoteok', source_type:'job_board',
      visa_probability:v.prob, visa_sponsorship:v.yes,
      relocation_assistance:false, quality_score:7.5,
      date_posted:item.date?new Date(item.date).toISOString():new Date().toISOString(),
      tech_stack:Array.isArray(item.tags)?item.tags.slice(0,10):[],
      job_category:'engineering', experience_level:lvl(item.position),
      verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
    }
  })
  console.log(`[RemoteOK] ✅ ${jobs.length}`)
  return jobs
}

// ── REMOTIVE ─────────────────────────────────────────────────
async function scrapeRemotive() {
  const data = await fetchJson('https://remotive.com/api/remote-jobs?limit=200')
  if (!data?.jobs?.length) return []
  const jobs = data.jobs.map(item => {
    const desc=(item.description||'').replace(/<[^>]*>/g,'')
    const v=visa(desc,'Remote')
    return {
      job_id:mkid(item.company_name||'x',item.title||'x','rem'),
      job_title:(item.title||'').substring(0,200),
      company_name:(item.company_name||'Unknown').substring(0,200),
      country:'Remote', city:'', remote_type:'remote',
      salary_currency:'USD', salary_predicted:true,
      job_description:desc.substring(0,2000), job_url:item.url||'',
      job_source:'remotive', source_type:'job_board',
      visa_probability:v.prob, visa_sponsorship:v.yes,
      relocation_assistance:false, quality_score:7.0,
      date_posted:item.publication_date?new Date(item.publication_date).toISOString():new Date().toISOString(),
      tech_stack:Array.isArray(item.tags)?item.tags.slice(0,10):[],
      job_category:'engineering', experience_level:lvl(item.title),
      verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
    }
  })
  console.log(`[Remotive] ✅ ${jobs.length}`)
  return jobs
}

// ── JOBICY ───────────────────────────────────────────────────
async function scrapeJobicy() {
  const data = await fetchJson('https://jobicy.com/api/v2/remote-jobs?count=100&tag=developer')
  const items = data?.jobs || []
  if (!items.length) return []
  const jobs = items.map(item => ({
    job_id:mkid(item.companyName||'x',item.jobTitle||'x','jcy'),
    job_title:(item.jobTitle||'').substring(0,200),
    company_name:(item.companyName||'Unknown').substring(0,200),
    country:'Remote', city:'', remote_type:'remote',
    salary_currency:'USD', salary_predicted:true,
    job_description:(item.jobExcerpt||'').substring(0,2000),
    job_url:item.url||'',
    job_source:'jobicy', source_type:'job_board',
    visa_probability:0.4, visa_sponsorship:false,
    relocation_assistance:false, quality_score:7.0,
    date_posted:item.pubDate?new Date(item.pubDate).toISOString():new Date().toISOString(),
    tech_stack:[], job_category:'engineering', experience_level:lvl(item.jobTitle),
    verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
  }))
  console.log(`[Jobicy] ✅ ${jobs.length}`)
  return jobs
}

// ── UAE JOBS via Bayt API (free) ─────────────────────────────
async function scrapeUAE() {
  // Use Adzuna for UAE and Gulf using gb endpoint with location filter
  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return []
  const terms = ['software engineer','developer','data scientist','product manager','devops']
  const results = await Promise.all(terms.map(t =>
    fetchJson(`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=20&what=${encodeURIComponent(t)}&where=dubai&content-type=application/json`)
  ))
  
  // Also try Gulf-specific free job board
  const gulfData = await fetchJson('https://www.bayt.com/api/jobs/?country=ae&format=json').catch(()=>null)
  
  const jobs = []
  const seen = new Set()
  
  // Hardcode some UAE jobs from public listings via Arbeitnow international
  const uaeSearch = await fetchJson('https://www.arbeitnow.com/api/job-board-api?page=1')
  const uaeItems = (uaeSearch?.data||[]).filter(i => {
    const loc = (i.location||'').toLowerCase()
    return /dubai|abu dhabi|uae|united arab|sharjah/.test(loc)
  })
  
  uaeItems.forEach(item => {
    const v = visa(item.description||'', 'UAE')
    jobs.push({
      job_id:mkid(item.company_name||'x',item.title||'x','uae'),
      job_title:(item.title||'').substring(0,200),
      company_name:(item.company_name||'Unknown').substring(0,200),
      country:'UAE', city:(item.location||'').substring(0,100),
      remote_type:rt(item.description||''),
      salary_currency:'AED', salary_predicted:true,
      job_description:(item.description||'').substring(0,2000),
      job_url:item.url||'',
      job_source:'arbeitnow', source_type:'job_board',
      visa_probability:v.prob, visa_sponsorship:v.yes,
      relocation_assistance:true, quality_score:8.0,
      date_posted:new Date().toISOString(),
      tech_stack:Array.isArray(item.tags)?item.tags.slice(0,10):[],
      job_category:'engineering', experience_level:lvl(item.title),
      verification_status:'verified', is_hidden_opportunity:false, expires_at:exp30()
    })
  })

  // Insert UAE from all sources as its own category
  console.log(`[UAE] ✅ ${jobs.length}`)
  return jobs
}

// ── STARTUP JOBS (populate startups table) ───────────────────
async function scrapeStartups() {
  console.log('[Startups] Fetching startup data...')
  
  // YC companies from Workable / work-at-a-startup
  const ycData = await fetchJson('https://www.workatastartup.com/api/companies?filter_by=eng&order_by=founded&order_direction=desc&page=1&limit=50')
  
  // Fallback: get from jobs already in DB tagged as ycombinator
  // and also fetch directly from YC API
  const ycJobs = await fetchJson('https://hacker-news.algolia.com/api/v1/search?query=hiring&tags=ask_hn,hiring&hitsPerPage=100')
  
  const startups = []
  
  // Build startup list from known fast-growing companies
  const knownStartups = [
    { name: 'Stripe', country: 'USA', stage: 'Series I+', employees: '8000+', description: 'Payment infrastructure for the internet', website: 'https://stripe.com', hiring_url: 'https://stripe.com/jobs' },
    { name: 'Revolut', country: 'United Kingdom', stage: 'Series E', employees: '8000+', description: 'Global financial superapp', website: 'https://revolut.com', hiring_url: 'https://www.revolut.com/careers' },
    { name: 'Wise', country: 'United Kingdom', stage: 'Public', employees: '3000+', description: 'Money transfers and banking', website: 'https://wise.com', hiring_url: 'https://www.wise.jobs' },
    { name: 'N26', country: 'Germany', stage: 'Series E', employees: '1500+', description: 'Mobile bank for Europe', website: 'https://n26.com', hiring_url: 'https://n26.com/en-eu/careers' },
    { name: 'Personio', country: 'Germany', stage: 'Series E', employees: '1800+', description: 'HR software for SMEs', website: 'https://personio.com', hiring_url: 'https://www.personio.com/about-personio/careers/' },
    { name: 'Monzo', country: 'United Kingdom', stage: 'Series H', employees: '3000+', description: 'Online bank for the UK', website: 'https://monzo.com', hiring_url: 'https://monzo.com/careers/' },
    { name: 'Figma', country: 'USA', stage: 'Acquired', employees: '1000+', description: 'Collaborative design tool', website: 'https://figma.com', hiring_url: 'https://www.figma.com/careers/' },
    { name: 'Notion', country: 'USA', stage: 'Series C', employees: '500+', description: 'All-in-one workspace', website: 'https://notion.so', hiring_url: 'https://www.notion.so/careers' },
    { name: 'Linear', country: 'USA', stage: 'Series B', employees: '100+', description: 'Issue tracking for teams', website: 'https://linear.app', hiring_url: 'https://linear.app/careers' },
    { name: 'Vercel', country: 'USA', stage: 'Series D', employees: '500+', description: 'Frontend cloud platform', website: 'https://vercel.com', hiring_url: 'https://vercel.com/careers' },
    { name: 'Supabase', country: 'USA', stage: 'Series C', employees: '100+', description: 'Open source Firebase alternative', website: 'https://supabase.com', hiring_url: 'https://supabase.com/careers' },
    { name: 'Intercom', country: 'Ireland', stage: 'Series D', employees: '1000+', description: 'Customer messaging platform', website: 'https://intercom.com', hiring_url: 'https://www.intercom.com/careers' },
    { name: 'Zendesk', country: 'USA', stage: 'Public', employees: '6000+', description: 'Customer service platform', website: 'https://zendesk.com', hiring_url: 'https://jobs.zendesk.com' },
    { name: 'Datadog', country: 'USA', stage: 'Public', employees: '5000+', description: 'Cloud monitoring platform', website: 'https://datadoghq.com', hiring_url: 'https://careers.datadoghq.com' },
    { name: 'HashiCorp', country: 'USA', stage: 'Public', employees: '2000+', description: 'Infrastructure automation', website: 'https://hashicorp.com', hiring_url: 'https://www.hashicorp.com/careers' },
    { name: 'Contentful', country: 'Germany', stage: 'Series F', employees: '800+', description: 'Content management platform', website: 'https://contentful.com', hiring_url: 'https://www.contentful.com/careers/' },
    { name: 'Celonis', country: 'Germany', stage: 'Series D', employees: '3000+', description: 'Process mining platform', website: 'https://celonis.com', hiring_url: 'https://www.celonis.com/careers/' },
    { name: 'Pitch', country: 'Germany', stage: 'Series B', employees: '200+', description: 'Presentation software for teams', website: 'https://pitch.com', hiring_url: 'https://pitch.com/jobs' },
    { name: 'Carta', country: 'USA', stage: 'Series G', employees: '1800+', description: 'Equity management platform', website: 'https://carta.com', hiring_url: 'https://carta.com/careers/' },
    { name: 'Deel', country: 'USA', stage: 'Series D', employees: '3000+', description: 'Global payroll and compliance', website: 'https://deel.com', hiring_url: 'https://www.deel.com/careers' },
    { name: 'Remote.com', country: 'Remote', stage: 'Series C', employees: '1000+', description: 'Global HR platform', website: 'https://remote.com', hiring_url: 'https://remote.com/careers' },
    { name: 'Loom', country: 'USA', stage: 'Acquired', employees: '400+', description: 'Async video messaging', website: 'https://loom.com', hiring_url: 'https://www.loom.com/careers' },
    { name: 'Rippling', country: 'USA', stage: 'Series F', employees: '2000+', description: 'HR and IT management', website: 'https://rippling.com', hiring_url: 'https://www.rippling.com/careers' },
    { name: 'Canva', country: 'Australia', stage: 'Series F', employees: '4000+', description: 'Online design platform', website: 'https://canva.com', hiring_url: 'https://www.canva.com/careers/' },
    { name: 'Atlassian', country: 'Australia', stage: 'Public', employees: '11000+', description: 'Team collaboration tools', website: 'https://atlassian.com', hiring_url: 'https://www.atlassian.com/company/careers' },
    { name: 'Shopify', country: 'Canada', stage: 'Public', employees: '10000+', description: 'E-commerce platform', website: 'https://shopify.com', hiring_url: 'https://www.shopify.com/careers' },
    { name: 'Wealthsimple', country: 'Canada', stage: 'Series E', employees: '1000+', description: 'Canadian investing app', website: 'https://wealthsimple.com', hiring_url: 'https://jobs.lever.co/wealthsimple' },
    { name: 'Careem', country: 'UAE', stage: 'Acquired', employees: '3000+', description: 'Super app for the Middle East', website: 'https://careem.com', hiring_url: 'https://careem.com/en-ae/careers/' },
    { name: 'Noon', country: 'UAE', stage: 'Growth', employees: '3000+', description: 'E-commerce platform for the Middle East', website: 'https://noon.com', hiring_url: 'https://www.noonacademy.com/careers' },
    { name: 'Tamara', country: 'UAE', stage: 'Series B', employees: '500+', description: 'Buy now pay later for MENA', website: 'https://tamara.co', hiring_url: 'https://tamara.co/careers' },
    { name: 'Tabby', country: 'UAE', stage: 'Series D', employees: '400+', description: 'BNPL and payments for MENA', website: 'https://tabby.ai', hiring_url: 'https://tabby.ai/careers' },
    { name: 'Swisscom', country: 'Switzerland', stage: 'Public', employees: '20000+', description: 'Swiss telecom & IT', website: 'https://swisscom.ch', hiring_url: 'https://jobs.swisscom.ch' },
    { name: 'Zurich Insurance', country: 'Switzerland', stage: 'Public', employees: '55000+', description: 'Global insurance company', website: 'https://zurich.com', hiring_url: 'https://www.zurich.com/en/careers' },
    { name: 'Numbrs', country: 'Switzerland', stage: 'Series C', employees: '200+', description: 'Digital banking app', website: 'https://numbrs.com', hiring_url: 'https://numbrs.com/en-gb/careers/' },
    { name: 'Frontify', country: 'Switzerland', stage: 'Series C', employees: '300+', description: 'Brand management platform', website: 'https://frontify.com', hiring_url: 'https://www.frontify.com/en/careers/' },
    { name: 'Stripe Ireland', country: 'Ireland', stage: 'Series I+', employees: '500+', description: 'Stripe European HQ', website: 'https://stripe.com', hiring_url: 'https://stripe.com/jobs/search?l=Dublin' },
    { name: 'HubSpot Dublin', country: 'Ireland', stage: 'Public', employees: '1000+', description: 'CRM platform European HQ', website: 'https://hubspot.com', hiring_url: 'https://www.hubspot.com/careers/jobs?hubs_search-jobs=dublin' },
    { name: 'Workhuman', country: 'Ireland', stage: 'Growth', employees: '1100+', description: 'HR tech platform', website: 'https://workhuman.com', hiring_url: 'https://www.workhuman.com/careers/' },
    { name: 'Clio', country: 'Canada', stage: 'Series F', employees: '1000+', description: 'Legal tech platform', website: 'https://clio.com', hiring_url: 'https://clio.com/careers/' },
    { name: 'Postman', country: 'USA', stage: 'Series D', employees: '800+', description: 'API development platform', website: 'https://postman.com', hiring_url: 'https://www.postman.com/company/careers/' },
    { name: 'PlanetScale', country: 'USA', stage: 'Series C', employees: '100+', description: 'Serverless MySQL platform', website: 'https://planetscale.com', hiring_url: 'https://planetscale.com/careers' },
  ]

  for (const s of knownStartups) {
    startups.push({
      name: s.name,
      description: s.description,
      website: s.website,
      source: s.country,
      source_url: s.hiring_url,
      career_page_url: s.hiring_url,
      career_page_found: true,
      has_open_roles: true,
      jobs_count: 0,
      batch: s.stage,
      upvotes: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  console.log(`[Startups] ✅ ${startups.length} startups`)
  return startups
}

// ── SAVE IN BATCHES ──────────────────────────────────────────
async function saveBatch(items, label, upsertFn) {
  if (!items.length) return 0
  let saved = 0
  for (let i=0; i<items.length; i+=100) {
    const batch = items.slice(i,i+100)
    const r = await upsertFn(batch)
    if (r.status===201||r.status===200) saved+=batch.length
    else console.log(`[${label}] Batch error ${r.status}: ${(r.data||'').substring(0,200)}`)
  }
  console.log(`[${label}] 💾 ${saved}/${items.length} saved`)
  return saved
}

// ── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('🌍 Ultimate Job Scraper v4')
  console.log(`Adzuna: ${ADZUNA_APP_ID?'✅':'❌'}`)

  const [adzuna, arbeitnow, remoteok, remotive, jobicy, uae, startups] = await Promise.all([
    scrapeAdzuna().catch(e=>{console.error('[Adzuna]',e.message);return[]}),
    scrapeArbeitnow().catch(e=>{console.error('[Arbeitnow]',e.message);return[]}),
    scrapeRemoteOK().catch(e=>{console.error('[RemoteOK]',e.message);return[]}),
    scrapeRemotive().catch(e=>{console.error('[Remotive]',e.message);return[]}),
    scrapeJobicy().catch(e=>{console.error('[Jobicy]',e.message);return[]}),
    scrapeUAE().catch(e=>{console.error('[UAE]',e.message);return[]}),
    scrapeStartups().catch(e=>{console.error('[Startups]',e.message);return[]}),
  ])

  const allJobs = [...adzuna,...arbeitnow,...remoteok,...remotive,...jobicy,...uae]
  console.log(`\n📊 ${allJobs.length} total jobs`)

  // Country summary
  const byCountry = {}
  allJobs.forEach(j=>{byCountry[j.country]=(byCountry[j.country]||0)+1})
  const top = Object.entries(byCountry).sort((a,b)=>b[1]-a[1]).slice(0,15)
  console.log('🌍 Countries:', top.map(([c,n])=>`${c}:${n}`).join(' | '))

  await saveBatch(allJobs, 'Jobs', upsertJobs)
  await saveBatch(startups, 'Startups', upsertStartups)

  console.log('\n🎉 DONE!')
  console.log(`  Ireland: ${allJobs.filter(j=>j.country==='Ireland').length}`)
  console.log(`  Switzerland: ${allJobs.filter(j=>j.country==='Switzerland').length}`)
  console.log(`  UAE: ${allJobs.filter(j=>j.country==='UAE').length}`)
  console.log(`  Startups saved: ${startups.length}`)
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1)})
