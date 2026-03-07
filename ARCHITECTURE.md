# Job Engine Architecture

## How This System Works

This is built the same way Indeed, ZipRecruiter, and Glassdoor built their indexes.
Not by scraping job boards. By going to the source.

---

## The 4 Layers

```
Layer 1 — ATS APIs          ████████████████████  Most stable
Layer 2 — Career Pages      ████████████████      Most authoritative  
Layer 3 — Data Enrichment   ████████              Fills in salary/skills
Layer 4 — Free APIs         ████████████          Volume supplement
```

---

### Layer 1: ATS APIs

**What is an ATS?** An Applicant Tracking System. When a company posts a job,
it goes into their ATS first. The ATS publishes it publicly so candidates can apply.

**Why this works:** ATS companies WANT their job listings scraped.
That's literally their product. Clean JSON APIs. No bot detection. No rate limits.

| ATS System | Companies | API Endpoint |
|---|---|---|
| Greenhouse | Stripe, Figma, Cloudflare, Databricks, Canva + 30 more | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` |
| Lever | OpenAI, Anthropic, Vercel, Klarna, Revolut + 20 more | `api.lever.co/v0/postings/{slug}` |
| Ashby | Perplexity, Cursor, Midjourney, ElevenLabs + 12 more | `api.ashbyhq.com/posting-api/job-board/{slug}` |
| Workable | 20,000+ companies | `apply.workable.com/api/v3/accounts/{slug}/jobs` |
| SmartRecruiters | IKEA, Booking.com + enterprise | `api.smartrecruiters.com/v1/companies/{slug}/postings` |
| Teamtailor | Klarna, Spotify ecosystem | `api.teamtailor.com/v1/jobs` |

**To add a new company:** Find their ATS slug and add one line to `ats-master.ts`:
```typescript
{ name: 'YourCompany', ats: 'greenhouse', slug: 'yourcompany', country: 'USA', stage: 'series-b' }
```

---

### Layer 2: Company Career Pages

Direct scraping of company websites. Jobs appear here **before any job board.**

Strategy (tried in order):
1. Extract `schema.org/JobPosting` JSON-LD from the HTML
2. Extract embedded JSON from `__NEXT_DATA__` (Next.js apps)
3. Extract job links via HTML pattern matching

Companies monitored: Google, Meta, Apple, Microsoft, Amazon, Netflix, Waymo,
DeepMind, SpaceX, ASML, SAP, Sea, Grab, Bytedance, Careem + more.

Any company discovered via the startup sidecar is automatically added here.

---

### Layer 3: Structured Data Enrichment

After Layers 1-2 run, jobs missing salary data get enriched.

We fetch the source page for each job and extract:
- `baseSalary` from schema.org/JobPosting
- Salary mentioned in the job description text
- Tech stack from requirements section
- Visa/relocation mentions

**Result:** Real salary data instead of benchmarks.

---

### Layer 4: Free APIs

Supplementary volume from APIs that are free, official, and never block.

| Source | Type | Coverage |
|---|---|---|
| RemoteOK | JSON API | Remote-first |
| Remotive | JSON API | Remote-first |
| Arbeitnow | JSON API | Europe (visa-friendly) |
| Himalayas | JSON API | Remote USA |
| Jobicy | JSON API | Remote USA |
| TheMuse | JSON API | Quality startups |
| WorkingNomads | JSON API | Remote worldwide |
| DevITJobs | JSON API | European tech |
| WeWorkRemotely | RSS | Remote |
| HackerNews | Algolia API | Startup hiring |
| YCombinator | JSON | YC companies |
| **Adzuna** | **Official API** | **LinkedIn + Indeed + Glassdoor** |

**The Adzuna note:** Adzuna is a legal aggregator that pulls from LinkedIn, Indeed,
and Glassdoor via official partnerships. Adding your free Adzuna API key gives you
their data without any scraping risk.

---

## What Is NOT Here (and Why)

| Excluded | Reason |
|---|---|
| LinkedIn direct scraping | TLS fingerprinting, IP reputation, cookie tracking. Gets blocked within hours. |
| Indeed direct scraping | Same as LinkedIn. Official RSS is used instead. |
| Glassdoor direct scraping | Same. Adzuna gets their data legally. |
| Archive.org for real-time | Crawl delay means listings are 3-7 days old. Not useful for job hunting. |
| Identity/UA rotation as strategy | Modern bot detection checks TLS handshake, canvas fingerprint, IP history. UA rotation alone fails. |

---

## Startup Discovery Sidecar

Runs automatically after every scrape. Does not block the main job.

```
ProductHunt daily leaderboard
YC company directory (W24, S24 batches)
TechCrunch funding RSS
         ↓
For each new company:
  → Try Greenhouse API
  → Try Lever API  
  → Try Ashby API
  → Try career page discovery
         ↓
Store in database → included in next scrape automatically
```

This is how the company list grows over time without manual work.

---

## Data Flow

```
                    ┌─────────────────────────────┐
                    │        SCRAPE TRIGGER        │
                    │   (GitHub Actions / Cron)    │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
        LAYER 1                LAYER 2              LAYER 4
       ATS APIs            Career Pages           Free APIs
    (best quality)        (first source)          (volume)
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                                   ▼
                             LAYER 3
                          Enrichment
                        (fill salary)
                                   │
                                   ▼
                           DEDUPLICATION
                    (career_page > ats > job_board)
                                   │
                                   ▼
                             SUPABASE DB
                                   │
                                   ▼
                            FRONTEND APP
```

---

## Adding More Companies

The fastest way to expand coverage:

1. **Find the company's career page**
2. **Check URL for ATS pattern:**
   - `boards.greenhouse.io/company` → Greenhouse
   - `jobs.lever.co/company` → Lever
   - `jobs.ashbyhq.com/company` → Ashby
   - `company.workable.com` → Workable
   - `company.wd5.myworkdayjobs.com` → Workday (needs custom scraper)
3. **Add one line** to `ATS_COMPANY_REGISTRY` in `ats-master.ts`

That's it. The system handles everything else automatically.

---

## Performance

| Layer | Companies/Sources | Jobs per run | Reliability |
|---|---|---|---|
| Layer 1 (ATS) | 65 companies | ~300-800 | ⭐⭐⭐⭐⭐ |
| Layer 2 (Career pages) | 22 companies | ~100-400 | ⭐⭐⭐⭐ |
| Layer 3 (Enrichment) | — | enriches 40 | ⭐⭐⭐⭐ |
| Layer 4 (Free APIs) | 13 sources | ~200-600 | ⭐⭐⭐⭐⭐ |
| **Total** | | **~600-1800/run** | |

Expected total jobs in database after 1 week: **3,000-8,000 unique active listings**
