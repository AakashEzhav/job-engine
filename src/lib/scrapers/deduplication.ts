// ============================================================
// DEDUPLICATION ENGINE
//
// The problem: the same job appears from multiple sources.
// Stripe Senior Engineer → appears in Greenhouse API, RemoteOK,
// LinkedIn RSS, and maybe TheMuse. All 4 are the same job.
//
// Strategy: generate multiple fingerprints per job.
// If ANY fingerprint matches an existing job → it's a duplicate.
//
// Fingerprint types:
//   1. URL hash        — exact same URL = definitely duplicate
//   2. Content hash    — (normalized company + title + location)
//   3. Fuzzy hash      — handles "Sr. Engineer" vs "Senior Engineer"
//   4. ATS ID          — Greenhouse job ID is globally unique
// ============================================================

import type { ScrapedJob } from './jobboards'

// ─── NORMALIZATION ────────────────────────────────────────────

// Title normalization — handles all common variations
const TITLE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bsr\.?\s*/gi, 'senior '],
  [/\bjr\.?\s*/gi, 'junior '],
  [/\beng\b/gi, 'engineer'],
  [/\bdev\b/gi, 'developer'],
  [/\bmgr\b/gi, 'manager'],
  [/\bswe\b/gi, 'software engineer'],
  [/full[- ]?stack/gi, 'fullstack'],
  [/back[- ]?end/gi, 'backend'],
  [/front[- ]?end/gi, 'frontend'],
  [/machine learning/gi, 'ml'],
  [/artificial intelligence/gi, 'ai'],
  [/\bi\s*\b/gi, ''],       // "Engineer I" → "engineer"
  [/\bii\s*\b/gi, '2'],     // "Engineer II" → "engineer2"
  [/\biii\s*\b/gi, '3'],
  [/[^a-z0-9 ]/gi, ' '],
  [/\s+/g, ' '],
]

export function normalizeTitle(title: string): string {
  let t = title.toLowerCase()
  for (const [pattern, replacement] of TITLE_REPLACEMENTS) {
    t = t.replace(pattern, replacement)
  }
  return t.trim()
}

export function normalizeCompany(company: string): string {
  return company.toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|gmbh|ag|bv|sas|sa|plc|limited|incorporated)\b\.?/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

export function normalizeLocation(location: string): string {
  const lower = location.toLowerCase()
  // Reduce to country-level for matching
  if (/remote|worldwide|anywhere|distributed/.test(lower)) return 'remote'
  if (/usa|united states|san francisco|new york|seattle|austin|boston/.test(lower)) return 'usa'
  if (/uk|united kingdom|england|london/.test(lower)) return 'uk'
  if (/canada|toronto|vancouver/.test(lower)) return 'canada'
  if (/germany|berlin|munich|hamburg/.test(lower)) return 'germany'
  if (/netherlands|amsterdam/.test(lower)) return 'netherlands'
  if (/singapore/.test(lower)) return 'singapore'
  if (/australia|sydney|melbourne/.test(lower)) return 'australia'
  if (/switzerland|zurich/.test(lower)) return 'switzerland'
  if (/sweden|stockholm/.test(lower)) return 'sweden'
  if (/ireland|dublin/.test(lower)) return 'ireland'
  if (/uae|dubai/.test(lower)) return 'uae'
  return lower.replace(/[^a-z]/g, '').substring(0, 20)
}

// ─── FINGERPRINT GENERATION ───────────────────────────────────

function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function generateFingerprints(job: ScrapedJob): string[] {
  const fps: string[] = []

  const company = normalizeCompany(job.company_name)
  const title = normalizeTitle(job.job_title)
  const location = normalizeLocation(job.country + ' ' + (job.city || '') + ' ' + job.remote_type)

  // FP1: Primary content hash (company + title + location)
  fps.push('c:' + hashString(`${company}|${title}|${location}`))

  // FP2: URL-based (most reliable when available)
  if (job.job_url) {
    // Strip tracking params, normalize URL
    const cleanUrl = job.job_url
      .replace(/[?&](utm_[^&]+|ref=[^&]+|source=[^&]+|cid=[^&]+)/g, '')
      .replace(/\/$/, '')
      .toLowerCase()
    fps.push('u:' + hashString(cleanUrl))
  }

  // FP3: Fuzzy match — strip seniority level for cross-source matching
  // "Senior Software Engineer" and "Software Engineer" at same company
  // in same location are likely the same posting
  const titleNoLevel = title
    .replace(/\b(senior|junior|lead|staff|principal|head of|director)\b/gi, '')
    .replace(/\s+/g, ' ').trim()
  if (titleNoLevel !== title) {
    fps.push('f:' + hashString(`${company}|${titleNoLevel}|${location}`))
  }

  // FP4: ATS-specific ID extraction from URL
  // Greenhouse: /jobs/12345678 → gh:12345678
  const ghMatch = job.job_url?.match(/greenhouse\.io\/[^/]+\/jobs\/(\d+)/)
  if (ghMatch) fps.push('gh:' + ghMatch[1])

  // Lever: /postings/uuid → lv:uuid
  const lvMatch = job.job_url?.match(/lever\.co\/[^/]+\/([a-f0-9-]{36})/)
  if (lvMatch) fps.push('lv:' + lvMatch[1])

  // Ashby: /[company]/[uuid] → ash:uuid
  const ashMatch = job.job_url?.match(/ashbyhq\.com\/[^/]+\/([a-f0-9-]{36})/)
  if (ashMatch) fps.push('ash:' + ashMatch[1])

  // Indeed: jk= param → in:key
  const indeedMatch = job.job_url?.match(/jk=([a-f0-9]+)/)
  if (indeedMatch) fps.push('in:' + indeedMatch[1])

  return [...new Set(fps)] // deduplicate fingerprints themselves
}

// ─── SOURCE PRIORITY ─────────────────────────────────────────
// When two jobs have matching fingerprints, keep the better source.

export const SOURCE_PRIORITY: Record<string, number> = {
  ats:             10,   // Direct ATS API — authoritative
  career_page:     9,    // Company website — authoritative
  structured_data: 7,    // schema.org — reliable
  job_board:       4,    // Job boards — derived
  search_engine:   2,    // Search results — weakest
  social:          1,
}

// ─── DEDUPLICATION ────────────────────────────────────────────

export interface DeduplicationResult {
  unique: ScrapedJob[]
  duplicatesRemoved: number
  mergeLog: Array<{ kept: string; discarded: string; reason: string }>
}

export function deduplicateJobs(jobs: ScrapedJob[]): DeduplicationResult {
  // Map: fingerprint → job_id of the canonical job for that fingerprint
  const fingerprintIndex = new Map<string, string>()
  // Map: job_id → the canonical ScrapedJob
  const canonicalJobs = new Map<string, ScrapedJob>()
  const mergeLog: Array<{ kept: string; discarded: string; reason: string }> = []

  // Sort by source priority descending — process best sources first
  // so they win ties automatically
  const sorted = [...jobs].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source_type] ?? 0
    const pb = SOURCE_PRIORITY[b.source_type] ?? 0
    if (pa !== pb) return pb - pa
    return (b.quality_score || 0) - (a.quality_score || 0)
  })

  for (const job of sorted) {
    const fps = generateFingerprints(job)
    let matchedCanonicalId: string | null = null

    // Check if any fingerprint already exists
    for (const fp of fps) {
      const existingId = fingerprintIndex.get(fp)
      if (existingId) {
        matchedCanonicalId = existingId
        break
      }
    }

    if (!matchedCanonicalId) {
      // New unique job — register all its fingerprints
      canonicalJobs.set(job.job_id, job)
      for (const fp of fps) {
        fingerprintIndex.set(fp, job.job_id)
      }
    } else {
      // Duplicate found
      const existing = canonicalJobs.get(matchedCanonicalId)!
      const merged = mergeJobData(existing, job)
      canonicalJobs.set(matchedCanonicalId, merged)

      mergeLog.push({
        kept: `${existing.company_name} — ${existing.job_title} [${existing.source_type}]`,
        discarded: `${job.company_name} — ${job.job_title} [${job.source_type}]`,
        reason: `Fingerprint match. Kept ${existing.source_type} over ${job.source_type}`
      })
    }
  }

  const unique = Array.from(canonicalJobs.values())

  return {
    unique,
    duplicatesRemoved: jobs.length - unique.length,
    mergeLog: mergeLog.slice(0, 50) // keep first 50 for logging
  }
}

// ─── SMART MERGE ──────────────────────────────────────────────
// When we find a duplicate, don't throw away the lower-priority version.
// It might have data the higher-priority version is missing.

export function mergeJobData(canonical: ScrapedJob, duplicate: ScrapedJob): ScrapedJob {
  return {
    ...canonical,

    // Take real salary over predicted
    salary_min: !canonical.salary_predicted ? canonical.salary_min : duplicate.salary_min,
    salary_max: !canonical.salary_predicted ? canonical.salary_max : duplicate.salary_max,
    salary_currency: !canonical.salary_predicted ? canonical.salary_currency : duplicate.salary_currency,
    salary_predicted: canonical.salary_predicted && duplicate.salary_predicted,

    // Take the longer, more complete description
    job_description: longerOf(canonical.job_description, duplicate.job_description),

    // Merge tech stacks — union of both
    tech_stack: uniqueArray([
      ...(canonical.tech_stack || []),
      ...(duplicate.tech_stack || [])
    ]).slice(0, 12),

    // Take the most specific location
    city: canonical.city || duplicate.city,

    // OR visa/relocation flags — if either source found it, it's true
    visa_sponsorship: canonical.visa_sponsorship || duplicate.visa_sponsorship,
    relocation_assistance: canonical.relocation_assistance || duplicate.relocation_assistance,
    visa_probability: Math.max(canonical.visa_probability || 0, duplicate.visa_probability || 0),

    // Take earliest date_posted (most accurate)
    date_posted: earlierDate(canonical.date_posted, duplicate.date_posted),

    // Recalculate quality score after merge
    // (higher salary confidence + tech stack = better score)
    quality_score: Math.max(canonical.quality_score || 0, duplicate.quality_score || 0),
  }
}

function longerOf(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return a.length >= b.length ? a : b
}

function earlierDate(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return new Date(a) <= new Date(b) ? a : b
}

function uniqueArray<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}
