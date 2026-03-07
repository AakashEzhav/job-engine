import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client for browser-side queries (read-only)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for server-side scraping (full access)
export function createAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false }
  })
}

// Types matching our database schema
export interface Job {
  id: string
  job_id: string
  job_title: string
  company_name: string
  company_logo?: string
  company_size?: string
  company_stage?: string
  country: string
  city?: string
  remote_type: 'remote' | 'hybrid' | 'onsite'
  salary_min?: number
  salary_max?: number
  salary_currency: string
  salary_predicted: boolean
  job_description?: string
  requirements?: string
  job_url: string
  job_source: string
  source_type: string
  visa_sponsorship?: boolean
  visa_probability: number
  relocation_assistance: boolean
  verification_status: string
  quality_score: number
  is_hidden_opportunity: boolean
  date_posted?: string
  scraped_date: string
  expires_at: string
  tech_stack?: string[]
  job_category?: string
  experience_level?: string
  created_at: string
  updated_at: string
}

export interface Company {
  id: string
  name: string
  website?: string
  careers_page?: string
  logo?: string
  industry?: string
  size?: string
  stage?: string
  country?: string
  hiring_probability: number
  is_hiring: boolean
  hiring_signals?: string[]
  signal_score: number
  last_scraped?: string
}

export interface Startup {
  id: string
  name: string
  website?: string
  description?: string
  logo?: string
  batch?: string
  source: string
  career_page_found: boolean
  career_page_url?: string
  has_open_roles: boolean
  jobs_count: number
  upvotes: number
  launch_date?: string
}

export interface OpportunityRadar {
  id: string
  company_name: string
  company_url?: string
  company_logo?: string
  signal_type: string
  signal_description?: string
  signal_source?: string
  signal_url?: string
  signal_date?: string
  hiring_probability: number
  predicted_roles?: string[]
  predicted_timeline?: string
  is_active: boolean
  jobs_appeared: boolean
  created_at: string
}

export interface UserProfile {
  id: string
  skills: string[]
  target_roles: string[]
  target_countries: string[]
  min_salary_usd: number
  prefers_remote: boolean
  prefers_visa_sponsorship: boolean
  experience_years: number
  keywords: string[]
}
