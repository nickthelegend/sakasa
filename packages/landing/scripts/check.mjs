// Landing QA: renders the static page headlessly at 375, 768 and 1280 px,
// checks there is no horizontal overflow, and saves screenshots to e2e-out/.
// Usage: node scripts/check.mjs (needs playwright from packages/app/node_modules)
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const require = createRequire(join(root, 'packages/app/package.json'));
const { chromium } = require('playwright');
const url = pathToFileURL(join(here, '..', 'index.html')).href;
mkdirSync(join(root, 'e2e-out'), { recursive: true });
const browser = await chromium.launch({ headless: true });
let ok = true;
try {
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const heroH1 = document.querySelector('.hero h1');
      const proofElements = [...document.querySelectorAll('.proof-card .proof-num')].filter(
        (el) => el.textContent.trim().length > 0,
      );
      const metricsElements = document.querySelectorAll('#metrics div');
      const planElements = document.querySelectorAll('.plan');

      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        hasHeroH1: Boolean(heroH1 && heroH1.textContent.trim().length > 0),
        proofCount: proofElements.length,
        metricsCount: metricsElements.length,
        plansCount: planElements.length,
      };
    });
    // reveal all sections for the full-page capture
    await page.evaluate(() => document.querySelectorAll('.pending').forEach((s) => s.classList.remove('pending')));
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(root, 'e2e-out', `landing-${width}.png`), fullPage: true });

    const overflow = m.scrollWidth > m.innerWidth;
    const missingHeroH1 = !m.hasHeroH1;
    const missingProof = m.proofCount !== 3;
    const missingMetrics = m.metricsCount === 0;
    const missingPlans = m.plansCount < 1;
    const hasErrors = errors.length > 0;

    console.log(
      `${width}px: scrollWidth ${m.scrollWidth} vs ${m.innerWidth} ${overflow ? 'OVERFLOW' : 'ok'}, ` +
        `h1: ${m.hasHeroH1 ? 'ok' : 'MISSING'}, proof: ${m.proofCount}/3, ` +
        `metrics: ${m.metricsCount}, plans: ${m.plansCount}, errors: ${errors.length}`,
    );
    if (hasErrors) {
      console.error(`Console/page errors at ${width}px:`, errors);
    }

    if (overflow || hasErrors || missingHeroH1 || missingProof || missingMetrics || missingPlans) {
      ok = false;
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
