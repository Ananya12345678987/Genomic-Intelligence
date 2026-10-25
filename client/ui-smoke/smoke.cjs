/**
 * UI smoke test with a MOCKED API (page.route). It verifies rendering and
 * interactions of the built client. It does NOT test the real backend or any
 * live data source. Usage: npm run build -w client && node client/ui-smoke/smoke.cjs <outDir>
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { messages } = require('./fixtures.cjs');

const out = process.argv[2] || '.';
const PORT = 4173;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 3500));
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const calls = [];
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const inv = { id: 'inv1', title: 'BRAF V600E in melanoma', status: 'complete', inputType: 'variant' };
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url()); const p = u.pathname.replace(/^\/api/, ''); const m = route.request().method();
      calls.push(`${m} ${p}`);
      if (p === '/health') return json(route, { status: 'ok', time: '', database: 'connected', ai: { configured: false, provider: 'none' }, sources: {} });
      if (p === '/auth/me') return json(route, { user: { id: 'u1', name: 'Test Researcher', email: 't@example.com', role: 'researcher' }, csrfToken: 'tok' });
      if (p === '/settings') return json(route, { settings: { aiSensitiveContentConsent: false, ai: { configured: false, sensitiveContentAllowedByOperator: false } } });
      if (p === '/investigations') return json(route, { items: [inv], page: 1, limit: 50, total: 1 });
      if (p === '/investigations/inv1') return json(route, { investigation: inv });
      if (p === '/investigations/inv1/messages') return json(route, { items: messages });
      if (p === '/reports/export/csv') return route.fulfill({ status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' }, body: 'gene,category\nBRAF,exact_normalized\n' });
      if (p === '/reports/export/pdf') return json(route, { error: { code: 'EXPORT_FAILED', message: 'Simulated failure for the error state.' } }, 500);
      return json(route, { error: { code: 'NOT_MOCKED', message: p } }, 404);
    });

    // Empty state
    await page.goto(`http://localhost:${PORT}/i/inv1`);
    await page.waitForSelector('text=Retrieved evidence');
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('text=Explore the evidence behind a genetic variant.');
    await page.screenshot({ path: `${out}/01-empty.png` });
    assert(await page.locator('text=Example searches').count() > 0, 'empty state shows example searches label');

    // Conversation with results
    await page.goto(`http://localhost:${PORT}/i/inv1`);
    await page.waitForSelector('text=Retrieved evidence');
    assert(await page.locator('text=Exact normalized match').first().isVisible(), 'exact match category visible');
    assert(await page.locator('text=Same position, different allele').first().isVisible(), 'related category shown separately');
    assert(await page.locator('text=Related findings').first().isVisible(), 'related findings section is separate from exact');
    assert(await page.locator('text=CIViC: Unavailable').first().isVisible() || (await page.locator('summary:has-text("Sources searched")').count()) > 0, 'unavailable source is reported');
    await page.locator('summary:has-text("Sources searched")').first().click();
    assert(await page.locator('text=CIViC: Unavailable').first().isVisible(), 'unavailable source stated plainly');
    assert(await page.locator('text=not by a model').first().isVisible(), 'deterministic summary labelled as not AI');
    await page.locator('summary:has-text("Clinical trials")').first().click();
    assert(await page.locator('text=does not mean a patient is eligible').first().isVisible() || await page.locator('text=not').filter({ hasText: 'eligible' }).count() > 0, 'trial eligibility disclaimer visible');
    await page.locator('summary:has-text("Publications")').first().click();
    await page.screenshot({ path: `${out}/02-results.png`, fullPage: false });
    await page.locator('article button').nth(1).click();
    await page.screenshot({ path: `${out}/03-card-expanded.png` });

    // Extraction review: uncertain item requires acknowledgement
    const go = page.getByRole('button', { name: /Investigate \d+ selected/ });
    await go.scrollIntoViewIfNeeded();
    assert(await go.isEnabled(), 'recognized selection can proceed');
    await page.getByLabel('Investigate KRAS G12').check();
    assert(await go.isDisabled(), 'uncertain finding blocks proceeding until acknowledged');
    await page.getByLabel(/I have checked the uncertain/).check();
    assert(await go.isEnabled(), 'acknowledgement enables proceeding');
    await page.screenshot({ path: `${out}/04-review.png` });

    // Export dialog: success and failure states
    await page.getByRole('button', { name: /Export/ }).first().click();
    await page.waitForSelector('text=Preview of what will be included');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /CSV data/ }).click()]);
    assert(dl.suggestedFilename() === 'report.csv', 'CSV download delivered by server response');
    await page.waitForSelector('text=Downloaded report.csv');
    await page.getByRole('button', { name: 'PDF report', exact: true }).click();
    await page.waitForSelector('text=Simulated failure for the error state.');
    assert(await page.locator('text=Downloaded report.pdf').count() === 0, 'no success message when the server fails');
    await page.screenshot({ path: `${out}/05-export.png` });
    await page.getByRole('button', { name: 'Close' }).click();

    // User menu consent
    await page.getByRole('button', { name: /Test Researcher/ }).click();
    assert(await page.locator('text=No AI provider is configured on this server').isVisible(), 'consent control explains that nothing is sent without a provider');

    // Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `${out}/06-mobile.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert(!overflow, 'no horizontal page scroll at 390px');
    const mainW = await page.locator('main').evaluate((el) => el.getBoundingClientRect().width);
    assert(mainW >= 340, `conversation column is usable at 390px (width ${Math.round(mainW)}px)`);
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.waitForTimeout(300);
    assert(await page.getByRole('button', { name: 'New investigation' }).isVisible(), 'navigation drawer opens on mobile');
    await page.screenshot({ path: `${out}/07-mobile-drawer.png` });
    await page.getByRole('button', { name: 'Close navigation' }).click({ position: { x: 360, y: 400 } });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/06-mobile.png` });
    console.log('API calls seen:', [...new Set(calls)].join(', '));
  } finally {
    await browser.close();
    preview.kill();
  }
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
