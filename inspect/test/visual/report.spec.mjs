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

// Printing from a dark theme must still put dark text on white paper.
for (const via of ['color scheme', 'theme toggle']) {
  test(`print from dark ${via}: text keeps contrast on white paper`, async ({ page }) => {
    await open(page, MOCK_HTML, { theme: via === 'color scheme' ? 'dark' : 'light' });
    if (via === 'theme toggle') await page.locator('[data-theme-choice="dark"]').click();
    await page.emulateMedia({ media: 'print' });
    const low = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
          const s = Number(v) / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const out = [];
      for (const sel of ['.head h1', '.chip', '.depth', '.tldr li', '.lead', '.blk li', '.ev', '.quote', '.foot', '.report']) {
        const cs = getComputedStyle(document.querySelector(sel));
        const ratio = 1.05 / (lum(cs.color) + 0.05);
        if (ratio < 4.5) out.push(`${sel} ${cs.color} ${ratio.toFixed(2)}`);
        if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && lum(cs.backgroundColor) < 0.8) out.push(`${sel} bg ${cs.backgroundColor}`);
      }
      return out;
    });
    expect(low).toEqual([]);
  });
}

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
  // .report clips overflow, so also check nothing inside a section is cut off.
  const clipped = await page.evaluate(() => [...document.querySelectorAll('section')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.getAttribute('aria-labelledby')));
  expect(clipped).toEqual([]);
  await expect(page).toHaveScreenshot('mock-375.png', { fullPage: true });
});

// Long citation titles and evidence paths: the widest content a finding carries.
function longContentHtml() {
  const m = structuredClone(mock);
  for (const f of m.findings) {
    f.shrine_refs.push({ ...f.shrine_refs[0], title: 'Memory & Context Management', section: 'stack', status: 'draft' });
    f.evidence.push({ kind: 'mechanical', locator: '~/.config/agent/projects/-Users-someone-src-github-com-org-a-very-long-repository-name/memory/session-transcript.jsonl', metric: null, excerpt_scrubbed: null });
  }
  return renderReport(m);
}
const LONG_HTML = longContentHtml();

// Every visible .detail must end inside .report, which clips overflow.
const detailOverflow = (page) =>
  page.evaluate(() => {
    const right = document.querySelector('.report').getBoundingClientRect().right;
    return [...document.querySelectorAll('.detail')].filter((d) => d.getClientRects().length && d.getBoundingClientRect().right > right + 0.5).map((d) => d.id);
  });

test('375px: every finding detail fits inside the report', async ({ page }) => {
  await open(page, LONG_HTML, { theme: 'dark', width: 375, height: 800 });
  for (const tab of ['amplify', 'working']) {
    await page.locator(`#tab-${tab}`).click();
    for (const btn of await page.locator(`#panel-${tab} .f-btn`).all()) {
      await btn.click();
      expect(await detailOverflow(page), await btn.getAttribute('data-target')).toEqual([]);
    }
  }
});

test('375px with scripts off: every finding detail fits inside the report', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await open(page, LONG_HTML, { theme: 'dark', width: 375, height: 800 });
  expect(await page.locator('.detail:visible').count()).toBe(mock.findings.length);
  expect(await detailOverflow(page)).toEqual([]);
  await ctx.close();
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
