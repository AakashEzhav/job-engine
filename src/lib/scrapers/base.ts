// ============================================================
// BASE SCRAPER UTILITIES
// ============================================================
import axios from 'axios'
import * as cheerio from 'cheerio'

// Target countries filter
export const TARGET_COUNTRIES = new Set([
  'usa', 'united states', 'us', 'canada', 'united kingdom', 'uk', 'england',
  'germany', 'netherlands', 'switzerland', 'sweden', 'denmark', 'norway',
  'finland', 'ireland', 'singapore', 'australia', 'new zealand', 'uae',
  'united arab emirates', 'japan', 'south korea'
])

export function isTargetCountry(country: string): boolean {
  return TARGET_COUNTRIES.has(country.toLowerCase().trim())
}

// Normalize country names
export function normalizeCountry(raw: string): string {
  const map: Record<string, string> = {
    'us': 'USA', 'united states': 'USA', 'u.s.': 'USA', 'u.s.a.': 'USA',
    'uk': 'United Kingdom', 'england': 'United Kingdom', 'britain': 'United Kingdom',
    'uae': 'UAE', 'united arab emirates': 'UAE',
    'deutschland': 'Germany', 'nl': 'Netherlands', 'au': 'Australia',
    'nz': 'New Zealand', 'sg': 'Singapore', 'ca': 'Canada',
    'ie': 'Ireland', 'ch': 'Switzerland', 'se': 'Sweden',
    'dk': 'Denmark', 'no': 'Norway', 'fi': 'Finland',
    'jp': 'Japan', 'kr': 'South Korea'
  }
  const lower = raw.toLowerCase().trim()
  return map[lower] || raw.split(',')[0].trim()
}

// Safe HTTP fetch with retries and headers
export async function safeFetch(url: string, options: {
  timeout?: number
  retries?: number
  headers?: Record<string, string>
} = {}): Promise<string | null> {
  const { timeout = 15000, retries = 2, headers = {} } = options

  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    ...headers
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: defaultHeaders,
        timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500
      })
      return response.data
    } catch (error) {
      if (attempt === retries) {
        console.error(`[Scraper] Failed to fetch ${url} after ${retries + 1} attempts`)
        return null
      }
      await sleep(1000 * (attempt + 1)) // Backoff
    }
  }
  return null
}

// Safe JSON API fetch
export async function safeJsonFetch<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const response = await axios.get<T>(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'JobDiscoveryBot/1.0',
        ...headers
      },
      timeout: 10000
    })
    return response.data
  } catch {
    return null
  }
}

// Cheerio HTML parser helper
export function parseHTML(html: string) {
  return cheerio.load(html)
}

// Sleep utility
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Clean text
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
}

// Extract salary from text
export function extractSalary(text: string): {
  min?: number; max?: number; currency?: string
} {
  if (!text) return {}

  // Pattern: $120k-$180k or $120,000 - $180,000 or £60k
  const patterns = [
    /([£$€¥₹])\s?([\d,]+)k?\s*[-–to]+\s*[£$€¥₹]?\s?([\d,]+)k?/i,
    /([£$€¥₹])\s?([\d,]+(?:,\d{3})*)/i,
    /([\d,]+)k?\s*[-–to]+\s*([\d,]+)k?\s*([A-Z]{3})/i,
  ]

  const currencyMap: Record<string, string> = {
    '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY'
  }

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const parseNum = (s: string) => {
        const n = parseInt(s.replace(/,/g, ''))
        return n < 1000 ? n * 1000 : n // Convert k values
      }
      return {
        currency: currencyMap[match[1]] || match[3] || 'USD',
        min: parseNum(match[2]),
        max: match[3] ? parseNum(match[3]) : undefined
      }
    }
  }
  return {}
}

// Detect remote type from text
export function detectRemoteType(text: string): 'remote' | 'hybrid' | 'onsite' {
  const lower = text.toLowerCase()
  if (/\bfully?\s*remote\b|\bwork\s*from\s*anywhere\b|\b100%\s*remote\b/.test(lower)) return 'remote'
  if (/\bhybrid\b/.test(lower)) return 'hybrid'
  if (/\bremote\b/.test(lower)) return 'remote'
  return 'onsite'
}

// Detect tech stack from description
export function extractTechStack(text: string): string[] {
  const technologies = [
    'JavaScript', 'TypeScript', 'Python', 'Java', 'Go', 'Rust', 'Ruby', 'PHP',
    'C++', 'C#', 'Swift', 'Kotlin', 'Scala', 'Elixir', 'Haskell',
    'React', 'Next.js', 'Vue', 'Angular', 'Svelte', 'Node.js', 'Express',
    'Django', 'FastAPI', 'Flask', 'Rails', 'Spring', 'Laravel',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'Cassandra',
    'AWS', 'GCP', 'Azure', 'Kubernetes', 'Docker', 'Terraform',
    'GraphQL', 'REST', 'gRPC', 'Kafka', 'RabbitMQ',
    'Machine Learning', 'Deep Learning', 'LLM', 'AI', 'PyTorch', 'TensorFlow'
  ]

  const found: string[] = []
  for (const tech of technologies) {
    const regex = new RegExp(`\\b${tech.replace('.', '\\.')}\\b`, 'i')
    if (regex.test(text)) found.push(tech)
  }
  return found
}

// Detect job category
export function detectJobCategory(title: string, description?: string): string {
  const text = `${title} ${description || ''}`.toLowerCase()

  if (/\b(engineer|developer|programmer|architect|devops|sre|platform|backend|frontend|full.?stack|mobile|ios|android)\b/.test(text)) return 'engineering'
  if (/\b(data\s*(engineer|scientist|analyst)|machine\s*learning|ml\s*engineer|ai\s*engineer|research)\b/.test(text)) return 'data-ai'
  if (/\b(designer|ui|ux|product\s*design|visual\s*design|graphic)\b/.test(text)) return 'design'
  if (/\b(product\s*manager|product\s*owner|pm\b)\b/.test(text)) return 'product'
  if (/\b(marketing|growth|seo|content|brand|social\s*media)\b/.test(text)) return 'marketing'
  if (/\b(sales|account\s*executive|business\s*development|bd\b)\b/.test(text)) return 'sales'
  if (/\b(operations|ops|finance|legal|hr|people|recruiting)\b/.test(text)) return 'operations'
  if (/\b(security|cybersecurity|infosec|penetration)\b/.test(text)) return 'security'
  return 'other'
}
