# 🌍 Global High-Value Job Discovery Engine

> Automated personal job discovery platform. Finds high-paying international jobs with visa sponsorship, remote work, and startup opportunities. Updates every 30 minutes. **Costs ₹0.**

## Features

- 🔍 **10+ job sources** — WWR, RemoteOK, HN, Remotive, YC, Reddit + more
- 🤖 **AI scoring** — Salary prediction, visa probability, quality ranking
- 📡 **Opportunity Radar** — Detects companies likely to hire before jobs are posted
- 🚀 **Startup Discovery** — YC, Product Hunt launches with career page scraping
- 🎯 **17 target countries** — USA, UK, Germany, Singapore, Australia + more
- ⚡ **Auto-updates** — Runs every 30 minutes via GitHub Actions
- 📱 **Mobile-first** — Works on all devices

## Setup

See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for complete step-by-step instructions.

Quick start:
```bash
npm install
cp .env.example .env.local
# Fill in your Supabase keys
npm run dev
```

## Stack

- **Frontend:** Next.js 14, React, Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Automation:** GitHub Actions (cron every 30min)
- **Hosting:** Vercel
- **AI:** Rule-based NLP (no API costs)

## Cost

| Service | Free Tier | Our Usage |
|---------|-----------|-----------|
| Vercel | 100GB bandwidth | ~1GB/month |
| Supabase | 500MB database | ~50MB/month |
| GitHub Actions | 2000 min/month | ~1400 min/month |

**Total: ₹0/month** ✅
