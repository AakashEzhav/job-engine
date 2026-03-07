-- ============================================================
-- GLOBAL JOB ENGINE - COMPLETE DATABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For fuzzy text search

-- ============================================================
-- TABLE 1: JOBS (Main job listings)
-- ============================================================
CREATE TABLE IF NOT EXISTS jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id                TEXT UNIQUE NOT NULL,           -- Fingerprint hash
  job_title             TEXT NOT NULL,
  company_name          TEXT NOT NULL,
  company_logo          TEXT,                           -- URL to company logo
  company_size          TEXT,                           -- startup, small, medium, large
  company_stage         TEXT,                           -- seed, series-a, series-b, public
  
  -- Location
  country               TEXT NOT NULL,
  city                  TEXT,
  remote_type           TEXT DEFAULT 'onsite',          -- remote, hybrid, onsite
  
  -- Salary
  salary_min            INTEGER,
  salary_max            INTEGER,
  salary_currency       TEXT DEFAULT 'USD',
  salary_predicted      BOOLEAN DEFAULT FALSE,          -- True if AI predicted it
  
  -- Job details
  job_description       TEXT,
  requirements          TEXT,
  job_url               TEXT NOT NULL,
  job_source            TEXT NOT NULL,                  -- linkedin, indeed, hn, etc
  source_type           TEXT DEFAULT 'job_board',       -- job_board, career_page, social
  
  -- Visa & Relocation
  visa_sponsorship      BOOLEAN,
  visa_probability      FLOAT DEFAULT 0.0,              -- 0.0 to 1.0
  relocation_assistance BOOLEAN DEFAULT FALSE,
  
  -- Status & Quality
  verification_status   TEXT DEFAULT 'unverified',      -- verified, unverified, expired
  quality_score         FLOAT DEFAULT 0.0,              -- 0.0 to 10.0 (our ranking)
  is_hidden_opportunity BOOLEAN DEFAULT FALSE,          -- Found via social/founder posts
  
  -- Dates
  date_posted           TIMESTAMPTZ,
  scraped_date          TIMESTAMPTZ DEFAULT NOW(),
  last_verified         TIMESTAMPTZ DEFAULT NOW(),
  expires_at            TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 days'),
  
  -- Tech tags
  tech_stack            TEXT[],                         -- ['React', 'Node.js', 'AWS']
  job_category          TEXT,                           -- engineering, design, product, etc
  experience_level      TEXT,                           -- junior, mid, senior, lead
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 2: COMPANIES (Tracked companies)
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT UNIQUE NOT NULL,
  website               TEXT,
  careers_page          TEXT,
  logo                  TEXT,
  industry              TEXT,
  size                  TEXT,
  stage                 TEXT,
  country               TEXT,
  city                  TEXT,
  founded_year          INTEGER,
  
  -- Funding info
  last_funding_amount   BIGINT,                         -- In USD
  last_funding_date     TIMESTAMPTZ,
  total_funding         BIGINT,
  
  -- Hiring signals
  hiring_probability    FLOAT DEFAULT 0.0,              -- 0.0 to 1.0
  is_hiring             BOOLEAN DEFAULT FALSE,
  hiring_signals        TEXT[],                         -- List of detected signals
  signal_score          INTEGER DEFAULT 0,
  
  -- Metadata
  source                TEXT,                           -- How we found them
  last_scraped          TIMESTAMPTZ,
  next_scrape           TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: STARTUPS (Startup watchlist)
-- ============================================================
CREATE TABLE IF NOT EXISTS startups (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT UNIQUE NOT NULL,
  website               TEXT,
  description           TEXT,
  logo                  TEXT,
  
  -- Startup info
  batch                 TEXT,                           -- YC S23, W24, etc.
  source                TEXT,                           -- ycombinator, producthunt, etc.
  source_url            TEXT,
  
  -- Status
  career_page_found     BOOLEAN DEFAULT FALSE,
  career_page_url       TEXT,
  has_open_roles        BOOLEAN DEFAULT FALSE,
  jobs_count            INTEGER DEFAULT 0,
  
  -- Signals
  upvotes               INTEGER DEFAULT 0,
  launch_date           TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 4: OPPORTUNITY RADAR (Companies likely to hire)
-- ============================================================
CREATE TABLE IF NOT EXISTS opportunity_radar (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_name          TEXT NOT NULL,
  company_url           TEXT,
  company_logo          TEXT,
  
  -- Why they're on the radar
  signal_type           TEXT NOT NULL,                  -- funding, launch, expansion, layoff
  signal_description    TEXT,
  signal_source         TEXT,                           -- techcrunch, producthunt, etc.
  signal_url            TEXT,
  signal_date           TIMESTAMPTZ,
  
  -- Predictions
  hiring_probability    FLOAT DEFAULT 0.0,
  predicted_roles       TEXT[],                         -- ['Senior Engineer', 'Designer']
  predicted_timeline    TEXT,                           -- '1-3 months', '3-6 months'
  
  -- Status
  is_active             BOOLEAN DEFAULT TRUE,
  jobs_appeared         BOOLEAN DEFAULT FALSE,          -- Did actual jobs appear?
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 5: SOCIAL POSTS (Hiring posts from social media)
-- ============================================================
CREATE TABLE IF NOT EXISTS social_posts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform              TEXT NOT NULL,                  -- reddit, hn, twitter
  post_id               TEXT,
  post_url              TEXT,
  author                TEXT,
  content               TEXT NOT NULL,
  
  -- AI Classification
  is_hiring_post        BOOLEAN DEFAULT FALSE,
  hiring_confidence     FLOAT DEFAULT 0.0,              -- AI confidence score
  extracted_company     TEXT,
  extracted_role        TEXT,
  extracted_location    TEXT,
  
  -- Link to job if created
  job_id                UUID REFERENCES jobs(id),
  
  posted_at             TIMESTAMPTZ,
  scraped_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 6: USER PROFILE (Personal preferences)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profile (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Skills and preferences
  skills                TEXT[],
  target_roles          TEXT[],
  target_countries      TEXT[],
  min_salary_usd        INTEGER DEFAULT 0,
  
  -- Job type preferences
  prefers_remote        BOOLEAN DEFAULT TRUE,
  prefers_visa_sponsorship BOOLEAN DEFAULT TRUE,
  experience_years      INTEGER DEFAULT 0,
  
  -- Saved searches
  keywords              TEXT[],
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: SAVED JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id                UUID REFERENCES jobs(id) ON DELETE CASCADE,
  notes                 TEXT,
  status                TEXT DEFAULT 'saved',           -- saved, applied, interviewing, rejected, offered
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 8: SCRAPE LOG (Audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS scrape_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source                TEXT NOT NULL,
  status                TEXT NOT NULL,                  -- success, failed, partial
  jobs_found            INTEGER DEFAULT 0,
  jobs_new              INTEGER DEFAULT 0,
  jobs_updated          INTEGER DEFAULT 0,
  error_message         TEXT,
  duration_ms           INTEGER,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- ============================================================
-- INDEXES (For fast searching)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_jobs_country ON jobs(country);
CREATE INDEX IF NOT EXISTS idx_jobs_remote_type ON jobs(remote_type);
CREATE INDEX IF NOT EXISTS idx_jobs_date_posted ON jobs(date_posted DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_quality_score ON jobs(quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_visa ON jobs(visa_sponsorship);
CREATE INDEX IF NOT EXISTS idx_jobs_verification ON jobs(verification_status);
CREATE INDEX IF NOT EXISTS idx_jobs_expires ON jobs(expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(job_source);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_name);
CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm ON jobs USING GIN (job_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_jobs_company_trgm ON jobs USING GIN (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_hiring ON companies(is_hiring, hiring_probability DESC);
CREATE INDEX IF NOT EXISTS idx_radar_active ON opportunity_radar(is_active, hiring_probability DESC);

-- ============================================================
-- AUTO-UPDATE updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER jobs_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER startups_updated_at BEFORE UPDATE ON startups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- VIEWS (For easy querying)
-- ============================================================

-- Active fresh jobs view
CREATE OR REPLACE VIEW active_jobs AS
SELECT * FROM jobs
WHERE verification_status != 'expired'
  AND expires_at > NOW()
  AND date_posted > NOW() - INTERVAL '15 days'
ORDER BY quality_score DESC, date_posted DESC;

-- Top companies to watch
CREATE OR REPLACE VIEW top_watchlist AS
SELECT * FROM opportunity_radar
WHERE is_active = TRUE
  AND jobs_appeared = FALSE
ORDER BY hiring_probability DESC, signal_date DESC;

-- Stats summary
CREATE OR REPLACE VIEW stats_summary AS
SELECT
  (SELECT COUNT(*) FROM jobs WHERE expires_at > NOW()) AS total_active_jobs,
  (SELECT COUNT(*) FROM jobs WHERE scraped_date > NOW() - INTERVAL '24 hours') AS jobs_last_24h,
  (SELECT COUNT(*) FROM jobs WHERE remote_type = 'remote' AND expires_at > NOW()) AS remote_jobs,
  (SELECT COUNT(*) FROM jobs WHERE visa_sponsorship = TRUE AND expires_at > NOW()) AS visa_jobs,
  (SELECT COUNT(*) FROM opportunity_radar WHERE is_active = TRUE) AS watchlist_count,
  (SELECT COUNT(*) FROM startups WHERE has_open_roles = TRUE) AS startups_hiring;

-- ============================================================
-- SAMPLE DATA: Insert default user profile
-- ============================================================
INSERT INTO user_profile (skills, target_roles, target_countries, min_salary_usd, prefers_remote, prefers_visa_sponsorship, experience_years, keywords)
VALUES (
  ARRAY['JavaScript', 'React', 'Node.js', 'Python'],
  ARRAY['Software Engineer', 'Full Stack Developer', 'Frontend Engineer'],
  ARRAY['USA', 'Canada', 'United Kingdom', 'Germany', 'Netherlands', 'Singapore', 'Australia'],
  80000,
  TRUE,
  TRUE,
  3,
  ARRAY['engineer', 'developer', 'remote', 'full stack']
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY (Keep data private)
-- ============================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

-- Allow public read on jobs (your personal site)
CREATE POLICY "Public read jobs" ON jobs FOR SELECT USING (true);
CREATE POLICY "Public read companies" ON companies FOR SELECT USING (true);
CREATE POLICY "Public read startups" ON startups FOR SELECT USING (true);
CREATE POLICY "Public read radar" ON opportunity_radar FOR SELECT USING (true);

-- Service role can do everything (for scrapers)
CREATE POLICY "Service full access jobs" ON jobs FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access companies" ON companies FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access startups" ON startups FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access radar" ON opportunity_radar FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access social" ON social_posts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access logs" ON scrape_logs FOR ALL USING (auth.role() = 'service_role');

-- Saved jobs and profile - full access
CREATE POLICY "Full access saved_jobs" ON saved_jobs FOR ALL USING (true);
CREATE POLICY "Full access user_profile" ON user_profile FOR ALL USING (true);
