// Visual baselines and accessibility for the report (spec 8, plan T1.12).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../../src/render/report.mjs';
import { t0BadSetupFindings } from '../synth/t0-findings.mjs';

const mock = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/findings/mock-density.json', import.meta.url)), 'utf8'));
const MOCK_HTML = renderReport(mock);
const T0_HTML = renderReport(t0BadSetupFindings());

async function open(page, html, { theme, width = 1280, height = 800 } = {}) {
  await page.setViewportSize({ width, height });
  if (theme) await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.setContent(html, { waitUntil: 'load' });
}

for (const theme of ['light', 'dark']) {
  test(`mock density, ${theme}`, async ({ page }) => {
    await open(page, MOCK_HTML, { theme });
    await expect(page).toHaveScreenshot(`mock-${theme}.png`, { fullPage: true });
  });

  test(`axe: zero violations, ${theme}`, async ({ page }) => {
    for (const html of [MOCK_HTML, T0_HTML]) {
      await open(page, html, { theme });
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });
}

test('mock density, print', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'light' });
  await page.emulateMedia({ media: 'print' });
  // Size the viewport to the printed page first: a fullPage capture resizes the
  // viewport while shooting, and on Linux the print layout then flips by a few px.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1280, height });
  await expect(page).toHaveScreenshot('mock-print.png');
  const hidden = await page.locator('.detail:not(:visible)').count();
  expect(hidden).toBe(0);
});

test('print shows the content of every appendix section', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'light' });
  await page.emulateMedia({ media: 'print' });
  const sections = page.locator('.appendix details');
  expect(await sections.count()).toBeGreaterThan(0);
  for (const d of await sections.all()) {
    const body = d.locator(':scope > :not(summary)').first();
    expect(await body.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
  }
});

test('with scripts off the inert tab bar is hidden and every finding shows', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await open(page, MOCK_HTML, { theme: 'light' });
  await expect(page.locator('[role="tablist"]')).toBeHidden();
  expect(await page.locator('.detail:not(:visible)').count()).toBe(0);
  await ctx.close();
});

test('picking a finding focuses its detail heading and brings it into view at 375px', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'dark', width: 375, height: 800 });
  const btn = page.locator('#panel-amplify .f-btn').nth(1);
  const id = await btn.getAttribute('data-target');
  await btn.click();
  await expect(page.locator(`[id="${id}-t"]`)).toBeFocused();
  const top = await page.locator(`[id="${id}"]`).evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(0);
  expect(top).toBeLessThan(800);
});

test('mock density, 375px: no horizontal scroll', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'dark', width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('mock-375.png', { fullPage: true });
});

test('T0 fixture, light', async ({ page }) => {
  await open(page, T0_HTML, { theme: 'light' });
  await expect(page).toHaveScreenshot('t0-light.png', { fullPage: true });
});

test('above the fold at 1280x800: header, depth band, TLDR, Start with', async ({ page }) => {
  for (const html of [MOCK_HTML, T0_HTML]) {
    await open(page, html, { theme: 'dark' });
    for (const sel of ['.head', '.depth', '#tldr-h', '.start']) {
      const box = await page.locator(sel).boundingBox();
      expect(box, sel).not.toBeNull();
      expect(box.y + box.height, sel).toBeLessThanOrEqual(800);
    }
  }
});

test('tabs follow the ARIA pattern with arrow keys', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'dark' });
  const amplify = page.locator('#tab-amplify');
  await amplify.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-working')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-amplify')).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(amplify).toHaveAttribute('aria-selected', 'true');
});

test('T2-size fixture is under 300 KB', () => {
  expect(Buffer.byteLength(MOCK_HTML)).toBeLessThan(300 * 1024);
});
