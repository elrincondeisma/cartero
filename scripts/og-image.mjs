// Genera apps/landing/public/og.png (1200x630) a partir de una captura real.
//   node scripts/og-image.mjs
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const shot = readFileSync('apps/landing/src/assets/screens/request-dark.png').toString('base64')
const html = `<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#0c0c0e;font-family:Inter,system-ui,sans-serif;overflow:hidden;position:relative">
<div style="position:absolute;inset:0;background:radial-gradient(700px circle at 20% 0%,rgba(249,115,22,.35),transparent 70%)"></div>
<div style="position:absolute;left:70px;top:70px;width:520px;color:#fff">
  <div style="display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700">
    <svg width="48" height="48" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#ea580c"/><path d="M7 11.5 16 17l9-5.5V22a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 7 22z" fill="#fff"/><path d="M7.5 9.5h17L16 15z" fill="#fff" opacity=".85"/></svg>Cartero</div>
  <div style="margin-top:44px;font-size:56px;line-height:1.05;font-weight:800;letter-spacing:-1.5px">The open-source API client <span style="color:#fb923c">with everything included.</span></div>
  <div style="margin-top:28px;font-size:22px;color:#a1a1aa;line-height:1.4">Runner · Mocks · Monitors · Docs · Teams · MCP<br/>Self-hosted. MIT. Imports from Postman.</div>
</div>
<img src="data:image/png;base64,${shot}" style="position:absolute;left:640px;top:90px;width:900px;border-radius:14px;border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.6)"/>
</body></html>`

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html)
await page.screenshot({ path: 'apps/landing/public/og.png' })
await browser.close()
console.log('og.png generada')
