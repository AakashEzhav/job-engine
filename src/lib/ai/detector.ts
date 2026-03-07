// ============================================================
// AI JOB DETECTION ENGINE
// Detects hiring posts, predicts salaries, scores visa probability
// Uses rule-based NLP (no API cost)
// ============================================================

// ---- HIRING PHRASE DETECTION ----
const HIRING_PHRASES = [
  'we are hiring', 'we\'re hiring', 'now hiring', 'currently hiring',
  'join our team', 'join us', 'come work with us', 'work with us',
  'looking for', 'seeking', 'open role', 'open position', 'job opening',
  'we need a', 'we\'re looking for', 'we are looking for',
  'hiring engineer', 'hiring developer', 'hiring designer', 'hiring manager',
  'hiring founding', 'first engineer', 'early engineer', 'founding team',
  'building our team', 'growing our team', 'expanding our team',
  'apply now', 'apply here', 'dm me', 'reach out if',
  'full-time', 'full time', 'contract role', 'freelance opportunity',
  'remote position', 'remote role', 'remote job',
  'immediate opening', 'urgent hire', 'asap hire'
]

const NON_HIRING_PHRASES = [
  'was hired', 'got hired', 'been hired', 'just hired',
  'my new job', 'started at', 'starting at', 'joined',
  'just joined', 'fired', 'laid off', 'got fired',
  'company culture', 'interview tips', 'resume tips'
]

export function detectHiringPost(text: string): { isHiring: boolean; confidence: number; signals: string[] } {
  const lower = text.toLowerCase()
  const signals: string[] = []
  let score = 0

  // Check for hiring phrases
  for (const phrase of HIRING_PHRASES) {
    if (lower.includes(phrase)) {
      signals.push(phrase)
      score += 1
    }
  }

  // Deduct for non-hiring phrases
  for (const phrase of NON_HIRING_PHRASES) {
    if (lower.includes(phrase)) score -= 2
  }

  // Bonus signals
  if (/\$[\d,]+/.test(text)) { score += 0.5; signals.push('salary mentioned') }
  if (/\d+\s*years?\s*(of\s*)?experience/i.test(text)) { score += 0.5; signals.push('experience required') }
  if (/apply|application|cv|resume/i.test(lower)) { score += 0.5; signals.push('apply mentioned') }

  const confidence = Math.min(1.0, score / 3)
  return {
    isHiring: confidence >= 0.4,
    confidence,
    signals
  }
}

// ---- EXTRACT JOB DETAILS FROM UNSTRUCTURED TEXT ----
export function extractJobDetails(text: string): {
  company?: string
  role?: string
  location?: string
  salary?: string
  remote?: boolean
  visaSponsorship?: boolean
} {
  const result: ReturnType<typeof extractJobDetails> = {}

  // Remote detection
  result.remote = /\bremote\b/i.test(text)

  // Visa detection
  result.visaSponsorship = /visa\s*sponsor|work\s*authori[sz]|h1b|relocation/i.test(text)

  // Salary extraction
  const salaryMatch = text.match(/\$[\d,]+k?(?:\s*[-–]\s*\$[\d,]+k?)?|\d+k\s*[-–]\s*\d+k/i)
  if (salaryMatch) result.salary = salaryMatch[0]

  // Role extraction (common patterns)
  const rolePatterns = [
    /hiring\s+(?:a\s+)?([A-Z][a-zA-Z\s]{3,40}(?:engineer|developer|designer|manager|analyst|lead|architect))/i,
    /looking\s+for\s+(?:a\s+)?([A-Z][a-zA-Z\s]{3,40})/i,
    /([A-Z][a-zA-Z\s]{2,30})\s+(?:role|position|opening)/i,
  ]
  for (const pattern of rolePatterns) {
    const match = text.match(pattern)
    if (match) { result.role = match[1].trim(); break }
  }

  return result
}

// ---- VISA SPONSORSHIP PROBABILITY ----
const VISA_POSITIVE_KEYWORDS = [
  'visa sponsorship', 'visa sponsor', 'we sponsor', 'sponsorship available',
  'work authorization', 'work permit', 'relocation support', 'relocation assistance',
  'relocation package', 'global talent', 'international candidates', 'global candidates',
  'h1b', 'h-1b', 'tier 2', 'skilled worker visa', 'global hire', 'open to relocation'
]

const VISA_NEGATIVE_KEYWORDS = [
  'must be authorized', 'no sponsorship', 'cannot sponsor', 'us citizen only',
  'citizens only', 'must have right to work', 'not able to sponsor',
  'no visa', 'local candidates only', 'must be based in', 'in-office only'
]

export function calculateVisaProbability(jobText: string, country: string): number {
  const lower = jobText.toLowerCase()
  let score = 0.3 // Base probability

  // Country bonuses (countries known for sponsoring)
  const sponsorFriendlyCountries: Record<string, number> = {
    'usa': 0.4, 'united states': 0.4, 'canada': 0.5, 'germany': 0.5,
    'netherlands': 0.5, 'australia': 0.5, 'new zealand': 0.5,
    'singapore': 0.6, 'uae': 0.6, 'united arab emirates': 0.6,
    'united kingdom': 0.45, 'uk': 0.45, 'ireland': 0.45,
    'sweden': 0.4, 'denmark': 0.4, 'norway': 0.4, 'finland': 0.4,
    'switzerland': 0.45, 'japan': 0.35, 'south korea': 0.35
  }
  const countryLower = country.toLowerCase()
  score += sponsorFriendlyCountries[countryLower] || 0

  // Keyword analysis
  let positiveHits = 0
  let negativeHits = 0
  for (const kw of VISA_POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) positiveHits++
  }
  for (const kw of VISA_NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) negativeHits++
  }

  if (positiveHits > 0) score = Math.min(0.95, score + positiveHits * 0.2)
  if (negativeHits > 0) score = Math.max(0.0, score - negativeHits * 0.25)

  return Math.round(score * 100) / 100
}

// ---- SALARY PREDICTION ----
// Based on title + location + experience level
const SALARY_BENCHMARKS: Record<string, Record<string, [number, number]>> = {
  usa: {
    'software engineer': [100000, 180000],
    'senior software engineer': [140000, 250000],
    'full stack developer': [95000, 170000],
    'frontend developer': [90000, 160000],
    'backend developer': [100000, 175000],
    'data engineer': [110000, 190000],
    'data scientist': [110000, 200000],
    'devops engineer': [115000, 195000],
    'product manager': [120000, 220000],
    'ux designer': [85000, 150000],
    'ui designer': [80000, 145000],
    'default': [80000, 140000]
  },
  canada: {
    'software engineer': [80000, 140000],
    'senior software engineer': [110000, 190000],
    'default': [65000, 120000]
  },
  germany: {
    'software engineer': [60000, 100000],
    'senior software engineer': [80000, 130000],
    'default': [55000, 95000]
  },
  netherlands: {
    'software engineer': [65000, 110000],
    'senior software engineer': [85000, 135000],
    'default': [55000, 95000]
  },
  singapore: {
    'software engineer': [70000, 130000],
    'senior software engineer': [100000, 170000],
    'default': [60000, 110000]
  },
  'united kingdom': {
    'software engineer': [55000, 100000],
    'senior software engineer': [75000, 130000],
    'default': [45000, 85000]
  },
  australia: {
    'software engineer': [80000, 140000],
    'senior software engineer': [110000, 175000],
    'default': [70000, 120000]
  },
  default: {
    'software engineer': [60000, 110000],
    'default': [40000, 80000]
  }
}

export function predictSalary(jobTitle: string, country: string, experienceLevel?: string): {
  min: number; max: number; currency: string; predicted: boolean
} {
  const titleLower = jobTitle.toLowerCase()
  const countryLower = country.toLowerCase()

  const countryBenchmarks = SALARY_BENCHMARKS[countryLower] || SALARY_BENCHMARKS['default']

  let salary: [number, number] | undefined
  for (const [title, range] of Object.entries(countryBenchmarks)) {
    if (title !== 'default' && titleLower.includes(title)) {
      salary = range
      break
    }
  }
  if (!salary) salary = countryBenchmarks['default'] || SALARY_BENCHMARKS['default']['default']

  // Experience level multiplier
  let multiplier = 1.0
  if (experienceLevel === 'senior' || experienceLevel === 'lead') multiplier = 1.3
  else if (experienceLevel === 'junior' || experienceLevel === 'entry') multiplier = 0.7
  else if (experienceLevel === 'staff' || experienceLevel === 'principal') multiplier = 1.5

  // Currency mapping
  const currencies: Record<string, string> = {
    usa: 'USD', canada: 'CAD', germany: 'EUR', netherlands: 'EUR',
    france: 'EUR', ireland: 'EUR', sweden: 'SEK', denmark: 'DKK',
    norway: 'NOK', switzerland: 'CHF', 'united kingdom': 'GBP',
    australia: 'AUD', 'new zealand': 'NZD', singapore: 'SGD',
    japan: 'JPY', 'south korea': 'KRW', uae: 'AED',
    'united arab emirates': 'AED'
  }

  return {
    min: Math.round(salary[0] * multiplier),
    max: Math.round(salary[1] * multiplier),
    currency: currencies[countryLower] || 'USD',
    predicted: true
  }
}

// ---- EXPERIENCE LEVEL DETECTOR ----
export function detectExperienceLevel(title: string, description?: string): string {
  const text = `${title} ${description || ''}`.toLowerCase()

  if (/\b(staff|principal|distinguished|fellow)\b/.test(text)) return 'staff'
  if (/\b(lead|head of|director|vp|vice president)\b/.test(text)) return 'lead'
  if (/\b(senior|sr\.?|sr\s)\b/.test(text)) return 'senior'
  if (/\b(junior|jr\.?|jr\s|entry.level|entry level|graduate|intern)\b/.test(text)) return 'junior'
  if (/\b(mid.level|mid level|intermediate|2\+|3\+\s*years)\b/.test(text)) return 'mid'
  return 'mid' // default
}

// ---- JOB QUALITY SCORER ----
export function scoreJobQuality(job: {
  salary_min?: number
  salary_max?: number
  salary_currency: string
  visa_probability: number
  remote_type: string
  country: string
  company_stage?: string
  date_posted?: string
  verification_status: string
  is_hidden_opportunity: boolean
}): number {
  let score = 0

  // Salary score (0-3 points)
  const usdEquivalent = getUSDEquivalent(
    ((job.salary_min || 0) + (job.salary_max || 0)) / 2,
    job.salary_currency
  )
  if (usdEquivalent > 200000) score += 3
  else if (usdEquivalent > 150000) score += 2.5
  else if (usdEquivalent > 100000) score += 2
  else if (usdEquivalent > 70000) score += 1.5
  else if (usdEquivalent > 50000) score += 1

  // Visa probability (0-2 points)
  score += job.visa_probability * 2

  // Remote bonus (0-1.5 points)
  if (job.remote_type === 'remote') score += 1.5
  else if (job.remote_type === 'hybrid') score += 0.75

  // Country strength (0-1.5 points)
  const countryScores: Record<string, number> = {
    usa: 1.5, switzerland: 1.5, singapore: 1.4, australia: 1.3,
    canada: 1.3, 'new zealand': 1.2, germany: 1.2, netherlands: 1.2,
    'united kingdom': 1.1, ireland: 1.1, 'uae': 1.1, sweden: 1.0,
    denmark: 1.0, norway: 1.0, finland: 0.9, japan: 0.9
  }
  score += countryScores[job.country.toLowerCase()] || 0.5

  // Freshness (0-1 point)
  if (job.date_posted) {
    const daysAgo = (Date.now() - new Date(job.date_posted).getTime()) / (1000 * 60 * 60 * 24)
    if (daysAgo < 1) score += 1
    else if (daysAgo < 3) score += 0.75
    else if (daysAgo < 7) score += 0.5
  }

  // Startup / growth stage bonus
  if (job.company_stage === 'series-a' || job.company_stage === 'series-b') score += 0.5
  if (job.is_hidden_opportunity) score += 0.5

  // Verified bonus
  if (job.verification_status === 'verified') score += 0.5

  return Math.min(10, Math.round(score * 10) / 10)
}

// Currency conversion to USD (approximate)
function getUSDEquivalent(amount: number, currency: string): number {
  const rates: Record<string, number> = {
    USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.74, AUD: 0.66,
    NZD: 0.61, SGD: 0.74, CHF: 1.13, SEK: 0.096, DKK: 0.145,
    NOK: 0.095, AED: 0.27, JPY: 0.0067, KRW: 0.00075
  }
  return amount * (rates[currency] || 1)
}

// ---- DUPLICATE DETECTOR ----
export function generateJobFingerprint(
  company: string, title: string, location: string
): string {
  const normalize = (s: string) => s.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/senior|sr|junior|jr/g, '')
    .trim()

  const key = `${normalize(company)}-${normalize(title)}-${normalize(location)}`
  // Simple hash
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

// ---- HIRING SIGNAL DETECTOR (for Opportunity Radar) ----
const FUNDING_KEYWORDS = ['raised', 'funding', 'series', 'seed round', 'million', 'billion', 'investment', 'backed by']
const EXPANSION_KEYWORDS = ['expanding', 'growing', 'scaling', 'new market', 'new office', 'international expansion']
const LAUNCH_KEYWORDS = ['launched', 'launches', 'announces', 'new product', 'beta launch', 'public launch']
const HIRING_SIGNAL_KEYWORDS = ['growing team', 'hiring', 'headcount', 'team growth', 'engineering team']

export function detectHiringSignals(text: string): {
  signalType: string
  confidence: number
  signals: string[]
} {
  const lower = text.toLowerCase()
  const signals: string[] = []
  let signalType = 'general'
  let confidence = 0

  let fundingScore = 0
  let expansionScore = 0
  let launchScore = 0
  let hiringScore = 0

  for (const kw of FUNDING_KEYWORDS) {
    if (lower.includes(kw)) { fundingScore++; signals.push(kw) }
  }
  for (const kw of EXPANSION_KEYWORDS) {
    if (lower.includes(kw)) { expansionScore++; signals.push(kw) }
  }
  for (const kw of LAUNCH_KEYWORDS) {
    if (lower.includes(kw)) { launchScore++; signals.push(kw) }
  }
  for (const kw of HIRING_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) { hiringScore++; signals.push(kw) }
  }

  const maxScore = Math.max(fundingScore, expansionScore, launchScore, hiringScore)
  if (fundingScore === maxScore && fundingScore > 0) { signalType = 'funding'; confidence = Math.min(0.95, fundingScore * 0.3) }
  else if (expansionScore === maxScore && expansionScore > 0) { signalType = 'expansion'; confidence = Math.min(0.85, expansionScore * 0.25) }
  else if (launchScore === maxScore && launchScore > 0) { signalType = 'launch'; confidence = Math.min(0.75, launchScore * 0.25) }
  else if (hiringScore > 0) { signalType = 'hiring'; confidence = Math.min(0.90, hiringScore * 0.35) }

  return { signalType, confidence, signals: [...new Set(signals)] }
}
