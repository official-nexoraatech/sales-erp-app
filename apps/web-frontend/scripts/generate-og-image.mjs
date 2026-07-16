// One-off asset-generation script (not part of the app runtime or build) — renders a static
// HTML snippet matching the marketing site's brand system (ink gradient, wordmark glyph,
// accent) and screenshots it to public/og-image.png at the standard 1200x630 OG size.
// Run with: node scripts/generate-og-image.mjs
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '../public/og-image.png');

const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Lexend';
    src: local('Lexend');
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    background: linear-gradient(160deg, #0A0B0D 0%, #14161A 55%, #0A0B0D 100%);
    display: flex; flex-direction: column; justify-content: center;
    padding: 96px;
    font-family: 'Segoe UI', Arial, sans-serif;
    position: relative;
    overflow: hidden;
  }
  .glow {
    position: absolute; top: -200px; left: -100px; width: 700px; height: 700px;
    background: radial-gradient(circle, rgba(245,158,11,0.25) 0%, transparent 60%);
  }
  .brand { display: flex; align-items: center; gap: 18px; margin-bottom: 48px; }
  .wordmark { font-size: 40px; font-weight: 600; color: #fff; letter-spacing: -0.02em; }
  h1 {
    font-size: 58px; font-weight: 600; color: #f5f6f7; line-height: 1.08;
    letter-spacing: -0.02em; max-width: 900px;
  }
  p { font-size: 26px; color: rgba(245,246,247,0.65); margin-top: 28px; max-width: 780px; }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="brand">
    <svg width="56" height="56" viewBox="0 0 32 32" fill="none">
      <path d="M8 23L15 14L24 8" stroke="#FBBF24" stroke-width="2.25" stroke-linecap="round" opacity="0.55"/>
      <rect x="4" y="19" width="8" height="8" rx="2.5" fill="#ffffff"/>
      <rect x="11.5" y="10.5" width="7" height="7" rx="2.25" fill="#ffffff" opacity="0.85"/>
      <rect x="20" y="4" width="8" height="8" rx="2.5" fill="#ffffff"/>
    </svg>
    <span class="wordmark">NEXORAA</span>
  </div>
  <h1>Run your whole business on one connected platform.</h1>
  <p>Sales, inventory, accounting, GST compliance, HR and CRM — unified.</p>
</body>
</html>
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
const buffer = await page.screenshot({ type: 'png' });
writeFileSync(outPath, buffer);
await browser.close();

console.log(`OG image written to ${outPath}`);
