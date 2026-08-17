import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', '.pdf-preview');
fs.mkdirSync(outDir, { recursive: true });

const url = process.env.PREVIEW_URL || 'http://localhost:5174/dev/drishti-pdf-preview';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('.print-page', { timeout: 30000 });
await page.waitForTimeout(500);

const pages = page.locator('.print-page');
const count = await pages.count();
console.log(`pages=${count}`);

for (let i = 0; i < count; i++) {
  const el = pages.nth(i);
  const file = path.join(outDir, `page-${String(i + 1).padStart(2, '0')}.png`);
  await el.screenshot({ path: file });
  console.log(`wrote ${file}`);
}

await browser.close();
