#!/usr/bin/env node
// ============================================================
// SCRAPER RUNNER - Called by GitHub Actions
// Usage: node scripts/run-scrapers.js
// ============================================================

const https = require('https')

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
const CRON_SECRET = process.env.CRON_SECRET

if (!SITE_URL || !CRON_SECRET) {
  console.error('❌ Missing NEXT_PUBLIC_APP_URL or CRON_SECRET environment variables')
  process.exit(1)
}

const url = `https://${SITE_URL.replace(/^https?:\/\//, '')}/api/scrape`
console.log(`🔄 Triggering scrape at: ${url}`)

const options = {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${CRON_SECRET}`,
    'Content-Type': 'application/json'
  }
}

const req = https.request(url, options, (res) => {
  let data = ''
  res.on('data', (chunk) => { data += chunk })
  res.on('end', () => {
    try {
      const result = JSON.parse(data)
      if (result.success) {
        console.log(`✅ Scrape successful!`)
        console.log(`   📊 Total jobs found: ${result.totalJobs}`)
        console.log(`   🆕 New jobs saved: ${result.newJobs}`)
        if (result.errors?.length > 0) {
          console.log(`   ⚠️  Warnings: ${result.errors.join(', ')}`)
        }
        process.exit(0)
      } else {
        console.error(`❌ Scrape failed:`, result.error || result.errors)
        process.exit(1)
      }
    } catch (e) {
      console.error('❌ Invalid response:', data.substring(0, 500))
      process.exit(1)
    }
  })
})

req.on('error', (e) => {
  console.error('❌ Request failed:', e.message)
  process.exit(1)
})

// Set 5-minute timeout
req.setTimeout(300000, () => {
  console.error('❌ Request timed out after 5 minutes')
  req.destroy()
  process.exit(1)
})

req.end()
