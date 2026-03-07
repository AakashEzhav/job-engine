# 🌍 Global Job Engine — Complete Beginner Setup Guide

## What is this?

This is your personal automated job discovery machine. It automatically finds high-paying international jobs with visa sponsorship, remote work options, and startup opportunities — then shows them on a clean website, updated every 30 minutes. **It costs ₹0 to run.**

---

## How it works (simple explanation)

```
Every 30 minutes:
  GitHub Actions (free automation) →
    Runs scrapers →
      Scrapes 8+ job boards →
        AI scores each job (visa, salary, quality) →
          Saves to Supabase database →
            Your website shows results instantly
```

---

## What you need (all free)

| Service | What it does | Cost |
|---------|-------------|------|
| [GitHub](https://github.com) | Stores code + runs automation | Free |
| [Vercel](https://vercel.com) | Hosts your website | Free |
| [Supabase](https://supabase.com) | Stores all jobs in database | Free |
| Your computer | One-time setup only | — |

---

## STEP 1 — Install required software on your computer

You only need to do this once. These are programs that help you run the project.

### 1A. Install Node.js

Node.js lets you run JavaScript on your computer.

1. Go to: **https://nodejs.org**
2. Click the big green button that says **"LTS"** (Recommended)
3. Download and install it (just click Next, Next, Finish)
4. To verify: Open Terminal (Mac) or Command Prompt (Windows) and type:
   ```
   node --version
   ```
   You should see something like: `v20.11.0`

### 1B. Install Git

Git lets you upload code to GitHub.

1. Go to: **https://git-scm.com/downloads**
2. Download for your system and install
3. To verify:
   ```
   git --version
   ```

---

## STEP 2 — Create your free accounts

### 2A. Create a GitHub account
1. Go to **https://github.com**
2. Click "Sign up" and create a free account
3. Verify your email

### 2B. Create a Supabase account (free database)
1. Go to **https://supabase.com**
2. Click "Start your project" → Sign up with GitHub
3. Click "New Project"
4. Fill in:
   - **Name:** `job-engine`
   - **Database Password:** Create a strong password (save it!)
   - **Region:** Choose closest to you (Singapore for India)
5. Wait 2 minutes for it to set up
6. Once ready, go to: **Settings → API**
7. Copy and save these 3 values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)
   - **service_role** key (another long string — keep this secret!)

### 2C. Create a Vercel account (free hosting)
1. Go to **https://vercel.com**
2. Click "Sign Up" → "Continue with GitHub"
3. Authorize Vercel to access GitHub

---

## STEP 3 — Set up the database

1. In Supabase, click **SQL Editor** in the left sidebar
2. Click **New Query**
3. Open the file `supabase/migrations/001_schema.sql` from this project
4. Copy ALL the text in that file
5. Paste it into the Supabase SQL editor
6. Click the green **RUN** button
7. You should see "Success. No rows returned."

✅ Your database is now ready with all the tables!

---

## STEP 4 — Upload code to GitHub

### 4A. Create a new GitHub repository
1. Go to **https://github.com/new**
2. Repository name: `job-engine`
3. Select **Private** (keeps your data private)
4. Click **Create repository**

### 4B. Upload the code
Open Terminal/Command Prompt, navigate to the `job-engine` folder:

```bash
# Go into the project folder
cd job-engine

# Initialize git
git init

# Add all files
git add .

# Create first commit
git commit -m "Initial commit: Global Job Engine"

# Connect to your GitHub repo (replace YOUR_USERNAME)
git remote add origin https://github.com/YOUR_USERNAME/job-engine.git

# Upload to GitHub
git push -u origin main
```

---

## STEP 5 — Create your environment file

This file contains your secret keys. It stays on your computer only — never uploaded.

1. In the `job-engine` folder, create a file called `.env.local`
2. Copy the contents of `.env.example` into it
3. Fill in your real values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJ...your-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJ...your-service-key...
CRON_SECRET=make-up-any-long-random-string-here-like-abc123xyz789
```

For `CRON_SECRET`, just make up any random string (e.g., `myjobengine2024secretkey`). Write it down.

---

## STEP 6 — Deploy to Vercel (make it live on the internet)

1. Go to **https://vercel.com/new**
2. Click **"Import Git Repository"**
3. Select your `job-engine` repository
4. Click **Import**
5. In the **"Environment Variables"** section, add each variable from your `.env.local` file:
   - Click **"Add"** for each one
   - Name: `NEXT_PUBLIC_SUPABASE_URL`, Value: your URL
   - Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY`, Value: your anon key
   - Name: `SUPABASE_SERVICE_ROLE_KEY`, Value: your service key
   - Name: `CRON_SECRET`, Value: your random string
6. Click **Deploy**
7. Wait 2-3 minutes
8. Vercel gives you a URL like: `https://job-engine-xyz.vercel.app`

**Your website is now live!** 🎉

---

## STEP 7 — Set up automatic scraping (GitHub Actions)

This makes the scraper run every 30 minutes automatically.

1. Go to your GitHub repository
2. Click **Settings** (top menu)
3. Click **Secrets and variables** → **Actions** (left sidebar)
4. Click **New repository secret** and add:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_APP_URL` | `job-engine-xyz.vercel.app` (your Vercel URL, no https://) |
| `CRON_SECRET` | The same random string you used in Step 5 |

5. Go to the **Actions** tab in your repository
6. Click **"I understand my workflows, go ahead and enable them"**
7. Click on **"Global Job Scraper"** workflow
8. Click **"Enable workflow"**

✅ The scraper will now run automatically every 30 minutes!

---

## STEP 8 — Run your first scrape manually

Don't wait 30 minutes — trigger it now!

1. Go to **GitHub → Actions tab**
2. Click **"Global Job Scraper"**
3. Click **"Run workflow"** → **"Run workflow"** (green button)
4. Wait 2-3 minutes
5. Go to your Vercel URL — jobs should appear!

---

## STEP 9 — Test locally (optional)

If you want to run on your own computer:

```bash
# Install all packages
npm install

# Run development server
npm run dev
```

Open: **http://localhost:3000**

---

## What each page does

| Page | URL | Description |
|------|-----|-------------|
| **Job Feed** | `/` | All jobs with filters and search |
| **Startups** | `/startups` | New startups from YC, Product Hunt |
| **Radar** | `/radar` | Companies predicted to hire soon |
| **Saved** | `/saved` | Your saved jobs with status tracking |

---

## Job sources scraped

| Source | Type | Jobs |
|--------|------|------|
| We Work Remotely | Remote jobs | Engineering, Design |
| RemoteOK | Remote jobs | All tech |
| Hacker News | Social/Startup | Monthly thread |
| Remotive | Remote jobs | All tech |
| Working Nomads | Remote jobs | Tech |
| Y Combinator | Startup jobs | YC companies |
| Reddit r/forhire | Social | Hiring posts |
| TechCrunch | Funding signals | Radar only |
| Product Hunt | Startups | New launches |
| Company Career Pages | Direct | Verified jobs |

---

## AI features explained

### Salary Prediction
If a job doesn't list salary, the AI predicts it based on:
- Job title (Senior Engineer vs Junior)
- Country (USA pays more than Germany)
- Industry benchmarks

Predicted salaries show "(est.)" next to them.

### Visa Probability Score
Analyzes job description for keywords like "visa sponsorship", "relocation support", "open to international candidates". Score from 0–100%.

### Quality Score (0–10)
Ranks each job by:
- Salary level (30%)
- Visa probability (20%)
- Remote flexibility (15%)
- Country strength (15%)
- Job freshness (10%)
- Verification status (10%)

### Opportunity Radar
Monitors TechCrunch for funding announcements. When a startup raises money, it likely hires engineers in 1–3 months. The radar shows these companies before jobs are posted.

---

## Troubleshooting

### "No jobs showing"
→ Trigger a manual scrape (Step 8). Takes 2–3 minutes.

### "Database error"
→ Make sure you ran the SQL schema in Step 3 correctly.

### "Scraper failed in GitHub Actions"
→ Check that your GitHub Secrets are correct (Step 7).

### "Build failed on Vercel"
→ Check that all Environment Variables are filled in (Step 6).

---

## Updating skills/preferences

Edit this file to customize what jobs you see:

In Supabase SQL Editor, run:
```sql
UPDATE user_profile SET
  skills = ARRAY['Python', 'React', 'Machine Learning'],
  target_roles = ARRAY['ML Engineer', 'Data Scientist'],
  target_countries = ARRAY['USA', 'Canada', 'Singapore'],
  min_salary_usd = 100000,
  prefers_remote = TRUE
WHERE id = (SELECT id FROM user_profile LIMIT 1);
```

---

## Monthly maintenance (5 minutes)

Once a month, check:
1. GitHub Actions → are scrapes running? ✓
2. Supabase → Storage used under 500MB? ✓
3. Vercel → Still on free tier? ✓

That's it. The system runs itself. 🚀

---

*Built with Next.js · Supabase · GitHub Actions · ₹0/month*
