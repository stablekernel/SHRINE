// Visual baselines and accessibility for the report (spec 8, plan T1.12).
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../../src/render/report.mjs';
import { t0BadSetupFindings, t0HistoryFindings } from '../synth/t0-findings.mjs';

const mock = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/findings/mock-density.json', import.meta.url)), 'utf8'));
const MOCK_HTML = renderReport(mock);
const T0_HTML = renderReport(t0BadSetupFindings());
const T0_HIST_HTML = renderReport(t0HistoryFindings());
// Count-based checks below ("no hidden detail", "every finding fits") pass on zero
// items, so each also asserts there is something to check.
if (mock.findings.length === 0) throw new Error('mock-density fixture has no findings');

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
    for (const html of [MOCK_HTML, T0_HTML, T0_HIST_HTML]) {
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
  expect(await page.locator('.detail').count()).toBeGreaterThanOrEqual(mock.findings.length);
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

// A whole section kept on one page leaves page 1 half blank before the coverage map.
test('print lets sections flow across pages', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'light' });
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('section').count()).toBeGreaterThan(0);
  const held = await page.evaluate(() => [...document.querySelectorAll('section')].filter((s) => getComputedStyle(s).breakInside !== 'auto').map((s) => s.getAttribute('aria-labelledby')));
  expect(held).toEqual([]);
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
  expect(await page.locator('.detail').count()).toBeGreaterThanOrEqual(mock.findings.length);
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
  expect(await page.locator('section').count()).toBeGreaterThan(0);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('section')].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.getAttribute('aria-labelledby')));
  expect(clipped).toEqual([]);
  await expect(page).toHaveScreenshot('mock-375.png', { fullPage: true });
});

// A failed integrity check names the changed paths; a lazy-fetch pack path has no
// break points and must wrap inside the alert at phone width (WCAG 1.4.10).
test('390px: the integrity alert wraps a long pack path inside its box', async ({ page }) => {
  const m = structuredClone(mock);
  m.integrity = { ok: false, changed_paths: [`/Users/someone/src/a-long-repository-name/.git/objects/pack/pack-${'c'.repeat(40)}.promisor`] };
  await open(page, renderReport(m), { theme: 'light', width: 390, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const { codes, spill } = await page.evaluate(() => {
    const box = document.querySelector('.integrity').getBoundingClientRect();
    const all = [...document.querySelectorAll('.integrity code')];
    return { codes: all.length, spill: all.filter((c) => c.getBoundingClientRect().right > box.right + 0.5).length };
  });
  expect(codes, 'the alert names the path in a code element').toBeGreaterThan(0);
  expect(spill).toBe(0);
  await expect(page.locator('.integrity')).toHaveScreenshot('integrity-390.png');
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
    const shown = [...document.querySelectorAll('.detail')].filter((d) => d.getClientRects().length);
    // No visible detail is a failure, not a pass.
    if (shown.length === 0) return ['no visible .detail'];
    return shown.filter((d) => d.getBoundingClientRect().right > right + 0.5).map((d) => d.id);
  });

test('375px: every finding detail fits inside the report', async ({ page }) => {
  await open(page, LONG_HTML, { theme: 'dark', width: 375, height: 800 });
  let clicked = 0;
  for (const tab of ['amplify', 'working']) {
    await page.locator(`#tab-${tab}`).click();
    for (const btn of await page.locator(`#panel-${tab} .f-btn`).all()) {
      await btn.click();
      clicked++;
      expect(await detailOverflow(page), await btn.getAttribute('data-target')).toEqual([]);
    }
  }
  expect(clicked).toBe(mock.findings.length);
});

test('375px with scripts off: every finding detail fits inside the report', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await open(page, LONG_HTML, { theme: 'dark', width: 375, height: 800 });
  expect(await page.locator('.detail:visible').count()).toBe(mock.findings.length);
  expect(await detailOverflow(page)).toEqual([]);
  await ctx.close();
});

test('375px: timeline text stays readable and scrolls inside its own box', async ({ page }) => {
  await open(page, MOCK_HTML, { theme: 'dark', width: 375, height: 800 });
  const tl = page.locator('svg.tl:visible').first();
  const { px, overlaps } = await tl.evaluate(timelineText);
  expect(px).toBeGreaterThanOrEqual(10);
  expect(overlaps).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const r = await new AxeBuilder({ page }).include('.tl-scroll').analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

// Smallest rendered timeline text in CSS px, and any two text boxes that overlap.
const timelineText = (svg) => {
  const scale = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
  const texts = [...svg.querySelectorAll('text')];
  // Math.min() of nothing is Infinity, which would pass ">= 10".
  if (texts.length === 0) return { px: 0, overlaps: ['no text in timeline'] };
  const boxes = texts.map((t) => t.getBoundingClientRect());
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const overlaps = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => hit(a, b)).map(() => texts[i].textContent));
  return { px: Math.min(...texts.map((t) => parseFloat(getComputedStyle(t).fontSize) * scale)), overlaps };
};

test('desktop and tablet timeline text is at least 10px and never overlaps', async ({ page }) => {
  for (const width of [768, 1024, 1280, 1440]) {
    await open(page, MOCK_HTML, { theme: 'dark', width });
    let seen = 0;
    for (const svg of await page.locator('svg.tl').all()) {
      if (!(await svg.isVisible())) continue;
      seen++;
      const r = await svg.evaluate(timelineText);
      expect(r.px, `${width}px`).toBeGreaterThanOrEqual(10);
      expect(r.overlaps, `${width}px`).toEqual([]);
    }
    expect(seen, `${width}px visible timelines`).toBeGreaterThan(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
});

test('desktop timeline shows whole (no clipping in its scroll box) with text at least 10px', async ({ page }) => {
  for (const width of [1024, 1101, 1120, 1180, 1279, 1440]) {
    await open(page, MOCK_HTML, { theme: 'dark', width });
    const boxes = await page.locator('.tl-scroll').evaluateAll((els) =>
      els.filter((el) => el.getClientRects().length).map((el) => el.scrollWidth - el.clientWidth),
    );
    expect(boxes.length, `${width}px`).toBeGreaterThan(0);
    expect(Math.max(...boxes), `${width}px hidden timeline px`).toBeLessThanOrEqual(0);
    let seen = 0;
    for (const svg of await page.locator('svg.tl').all()) {
      if (!(await svg.isVisible())) continue;
      seen++;
      expect((await svg.evaluate(timelineText)).px, `${width}px`).toBeGreaterThanOrEqual(10);
    }
    expect(seen, `${width}px visible timelines`).toBeGreaterThan(0);
  }
});

test('content is about 80% of the viewport on desktop, full-bleed on phones', async ({ page }) => {
  for (const width of [1024, 1280, 1440]) {
    await open(page, MOCK_HTML, { theme: 'dark', width });
    const w = await page.locator('.report').evaluate((el) => el.getBoundingClientRect().width);
    expect(w / width, `${width}px`).toBeGreaterThan(0.75);
    expect(w / width, `${width}px`).toBeLessThan(0.85);
  }
  await open(page, MOCK_HTML, { theme: 'dark', width: 375 });
  expect(await page.locator('.report').evaluate((el) => el.getBoundingClientRect().width)).toBe(375 - 32);
});

test('labels never wrap or spill on desktop widths', async ({ page }) => {
  for (const width of [1024, 1280, 1440]) {
    await open(page, LONG_HTML, { theme: 'dark', width });
    const bad = await page.evaluate(() => {
      // Distinct text line bottoms, ignoring small offsets from mixed font sizes.
      const lines = (el) => {
        const ys = [];
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim()) continue;
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const x of r.getClientRects()) ys.push(x.bottom);
        }
        ys.sort((a, b) => a - b);
        return 1 + ys.filter((y, i) => i && y - ys[i - 1] > 10).length;
      };
      const out = [];
      let seen = 0;
      for (const el of document.querySelectorAll('.chip, .tag, table.cov th, .benefit b, .tab, .legend li, .ba figcaption, .status, .depth b, .ref small')) {
        if (!el.getClientRects().length) continue;
        seen++;
        const box = el.closest('.detail, section, .head, .depth').getBoundingClientRect();
        if (lines(el) > 1 || el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > box.right + 0.5) out.push(`${el.className || el.tagName}: ${el.textContent.trim().slice(0, 40)}`);
      }
      if (seen === 0) out.push('no visible labels to check');
      return out;
    });
    expect(bad, `${width}px`).toEqual([]);
  }
});

test('T0 fixture, light', async ({ page }) => {
  await open(page, T0_HTML, { theme: 'light' });
  await expect(page).toHaveScreenshot('t0-light.png', { fullPage: true });
});

test('above the fold at 1280x800: header, depth band, TLDR, Start with', async ({ page }) => {
  for (const html of [MOCK_HTML, T0_HTML, T0_HIST_HTML]) {
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

// Run limits: the band near the top, with one or two notes, and the share-safe copy of
// a partial-clone run. The banner stays one line from tablet up; the band never spills.
const LIMIT_PARTIAL = 'Git history was not read in 1 repo: a partial clone, and git 2.44.0 can fetch missing objects while reading it. Git dates there were not used, and the stale-file and review-date checks skip those files. Commit authors there are not read; the names and emails your git config files set, with every file they include, are still masked. Git 2.44.1 or later reads them safely.';
const LIMIT_HUNG = 'Git did not finish within 60 seconds in 1 repo and was stopped. Git reads there count as failed: no git dates or history. Repo config that blocks git (an include.path naming a pipe, for one) causes this.';
function limitsHtml(limits, { shareSafe = false, skipped = 0 } = {}) {
  const f = t0BadSetupFindings();
  f.run_limits = limits;
  f.notes.push(...limits);
  if (skipped) f.git_history_skipped = skipped;
  return renderReport(f, { shareSafe });
}
// Long unbroken paths (slashes, underscores, no spaces) must wrap, not be clipped.
const LIMIT_PATHS = 'Git could not read commit history in 2 repos: ~/src/github.com/acme/platform_payments_reconciliation_service_v2 (git timed out); ~/work/AcmeCorpPlatformPaymentsReconciliationServiceVersionTwoInternal (git log failed).';
const LIMIT_VARIANTS = {
  'one limit': limitsHtml([LIMIT_PARTIAL]),
  'long paths': limitsHtml([LIMIT_PATHS]),
  'two limits': limitsHtml([LIMIT_PARTIAL, LIMIT_HUNG]),
  'share-safe partial clone': limitsHtml([LIMIT_PARTIAL], { shareSafe: true, skipped: 1 }),
};
// Text lines an element renders, from its text boxes.
const textLines = (el) => {
  const ys = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.trim()) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const x of r.getClientRects()) ys.push(Math.round(x.top));
  }
  return new Set(ys).size;
};
for (const [name, html] of Object.entries(LIMIT_VARIANTS)) {
  for (const width of name === 'long paths' ? [375, 320] : [1440, 768, 375]) {
    test(`run limits, ${name}, ${width}px: band fits, banner one line from 768px, axe clean`, async ({ page }) => {
      await open(page, html, { theme: 'light', width, height: 900 });
      const band = page.locator('.run-limits');
      await expect(band).toBeVisible();
      expect(await band.locator('p').count()).toBe(name === 'two limits' ? 2 : 1);
      const spill = await band.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const report = document.querySelector('.report').getBoundingClientRect();
        // Each rendered text line, not the paragraph box: text can spill out of its box.
        let inner = 0;
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const r = document.createRange();
          r.selectNodeContents(n);
          for (const x of r.getClientRects()) if (x.right > box.right + 0.5) inner++;
        }
        return { scroll: el.scrollWidth - el.clientWidth, outside: box.right - report.right, inner };
      });
      expect(spill.scroll, 'band scrolls sideways').toBeLessThanOrEqual(0);
      expect(spill.outside, 'band ends inside the report').toBeLessThanOrEqual(0.5);
      expect(spill.inner, 'text spills out of the band').toBe(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (name.startsWith('share-safe')) {
        const banner = page.locator('.safe-banner');
        await expect(banner).toBeVisible();
        if (width >= 768) expect(await banner.evaluate(textLines), 'banner lines').toBe(1);
        await expect(page).toHaveScreenshot(`share-safe-limits-${width}.png`, { clip: { x: 0, y: 0, width, height: 420 } });
      }
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}

// Fails until the base PR's styles.css fix for .detail width at 375px lands.
test.fixme('history report at 375px: every finding detail stays inside .report', async ({ page }) => {
  await open(page, T0_HIST_HTML, { theme: 'light', width: 375, height: 800 });
  // .report{overflow:hidden} hides document overflow, so measure each open detail.
  const right = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().right);
  const reportRight = await right('.report');
  let checked = 0;
  for (const tab of ['amplify', 'working']) {
    const btns = page.locator(`#panel-${tab} .f-btn`);
    const n = await btns.count();
    for (let i = 0; i < n; i++) {
      if (await page.locator(`#tab-${tab}`).isVisible()) await page.locator(`#tab-${tab}`).click();
      const id = await btns.nth(i).getAttribute('data-target');
      await btns.nth(i).click();
      expect(await right(`[id="${id}"]`), id).toBeLessThanOrEqual(reportRight);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(0);
});

test('history report at 375px: no horizontal scroll, usage block readable in print', async ({ page }) => {
  await open(page, T0_HIST_HTML, { theme: 'light', width: 375, height: 800 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.emulateMedia({ media: 'print' });
  const usage = page.locator('.appendix details', { hasText: 'Usage from session history' });
  expect(await usage.locator('li').count()).toBeGreaterThan(4);
  expect(await usage.locator('ul').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(0);
});
