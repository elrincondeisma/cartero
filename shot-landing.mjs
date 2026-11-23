import { chromium } from '@playwright/test'
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
await p.goto('http://localhost:4321/', { waitUntil: 'load' })
await p.waitForTimeout(2000)
const h = await p.evaluate(() => document.body.scrollHeight)
for (let y = 0; y < h; y += 500) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(120) }
await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(400)
let i = 1
for (let y = 900; y < h; y += 2100, i++)
  await p.screenshot({ path: `${process.argv[2]}/landing-sec${i}.png`, fullPage: true, clip: { x: 0, y, width: 1440, height: Math.min(2100, h - y) } })
console.log(i - 1)
await b.close()
