// Generate skills/agentic-power-user/SKILL.md from the ratified principle and pattern pages.
//
// Mechanical: parse, sort, render. No model, no dates, no env, no git. The same pages give
// the same bytes. The skill stamps `source-hash`, a sha256 over the input pages, so a
// consumer pins the commit it fetched and checks the hash.
//
// Usage: node scripts/gen-skill.mjs [--check] [--docs <docs dir>] [--out <file>]
//   --check  render to memory; on any difference print a diff and exit 1
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import yaml from 'js-yaml';

// Same constant as src/pages/shrine-manifest.json.ts.
export const SITE = 'https://stablekernel.github.io/SHRINE/';
const NORTH_STAR = 'tokens-to-value';
const MAX_BULLETS = 5;
const SKIP = new Set(['index', 'overview']);

// Required sections per page kind. Each entry lists accepted heading names, first match wins.
const SECTIONS = {
  principles: [
    { key: 'principle', label: 'Principle', names: ['The Principle', 'The North Star'], lead: true },
    { key: 'signals', label: 'Signals of violation', names: ['Signal of Violation'] },
  ],
  patterns: [
    { key: 'pattern', label: 'Pattern', names: ['The Pattern'], lead: true },
    { key: 'use', label: 'Use when', names: ['When to Use', 'When to Apply'] },
    { key: 'notUse', label: 'Not when', names: ['When Not to Use'] },
    { key: 'anti', label: 'Anti-patterns', names: ['Anti-patterns'] },
  ],
};

export class PageError extends Error {
  constructor(file, reason) {
    super(`gen-skill: ${file}: ${reason}`);
    this.file = file;
  }
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const byText = (a, b) => a.localeCompare(b, 'en');

// Split raw page text into frontmatter data and body. A page without closed frontmatter fails.
function splitFrontmatter(raw, file) {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) throw new PageError(file, 'no frontmatter block (--- ... ---)');
  let data;
  try {
    data = yaml.load(match[1]) ?? {};
  } catch (err) {
    throw new PageError(file, `invalid frontmatter YAML: ${err.reason ?? err.message}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) throw new PageError(file, 'frontmatter is not a mapping');
  return { data, body: text.slice(match[0].length) };
}

// Split the body on `## ` headings outside code fences. Anchors use one slugger per page over
// every heading level, in order, as Astro does, so duplicate headings get the site's suffixes.
function splitSections(body, file) {
  const slugger = new GithubSlugger();
  const sections = new Map();
  let current = null;
  let fence = null;
  for (const line of body.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      if (!fence) fence = open[1];
      else if (line.trim().startsWith(fence)) fence = null;
    } else if (!fence) {
      const heading = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        const anchor = slugger.slug(heading[2]);
        if (heading[1] === '##') {
          current = { heading: heading[2], anchor, lines: [] };
          if (!sections.has(heading[2])) sections.set(heading[2], current);
          continue;
        }
      }
    }
    if (current) current.lines.push(line);
  }
  if (fence) throw new PageError(file, `unclosed code fence ${fence}`);
  return sections;
}

// Group section lines into blocks: a bullet with its indented children, a table row, or a paragraph.
function blocks(lines) {
  const out = [];
  let para = null;
  for (const line of lines) {
    if (!line.trim()) {
      para = null;
      continue;
    }
    if (/^[-*] /.test(line)) {
      out.push({ type: 'bullet', lines: [line.replace(/^\* /, '- ')] });
      para = null;
    } else if (/^\s+\S/.test(line) && out.length && out.at(-1).type === 'bullet' && !para) {
      out.at(-1).lines.push(line);
    } else if (/^\|/.test(line)) {
      out.push({ type: 'row', line });
      para = null;
    } else if (para) {
      para.text += ` ${line.trim()}`;
    } else {
      para = { type: 'para', text: line.trim() };
      out.push(para);
    }
  }
  return out;
}

const tableCells = (line) => line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

// Items for one section: bullets (with children) and table rows as `symptom: fix`, capped.
// A lead section (The Principle, The Pattern) that opens with a paragraph takes that paragraph,
// plus the list right after it when the paragraph ends in a colon.
function sectionItems(section, lead) {
  const all = blocks(section.lines);
  const items = [];
  const first = all[0];
  let rest = all;
  if (lead && first?.type === 'para') {
    items.push([`- ${first.text}`]);
    if (!first.text.endsWith(':')) return items;
    rest = all.slice(1);
  }
  let headerSeen = false;
  for (const block of rest) {
    if (block.type === 'para') {
      if (items.length) break;
      continue;
    }
    if (block.type === 'row') {
      const cells = tableCells(block.line);
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!headerSeen) {
        headerSeen = true;
        continue;
      }
      items.push([`- ${cells[0]}: ${cells.slice(1).filter(Boolean).join('; ')}`]);
    } else {
      items.push(block.lines);
    }
    if (items.length >= MAX_BULLETS + (lead && first?.type === 'para' ? 1 : 0)) break;
  }
  return items;
}

// Relative site links become absolute; nothing else is rewritten.
const absolute = (text) => text.replace(/\]\(\/SHRINE\//g, `](${SITE}`);

// Parse one page into its title, description, URL, and the required sections.
export function parsePage(raw, file, section, slug) {
  const { data, body } = splitFrontmatter(raw, file);
  for (const field of ['title', 'description']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      throw new PageError(file, `frontmatter "${field}" is missing or empty`);
    }
  }
  const sections = splitSections(body, file);
  const url = `${SITE}${section}/${slug}/`;
  const parts = {};
  for (const spec of SECTIONS[section]) {
    const found = spec.names.map((n) => sections.get(n)).find(Boolean);
    if (!found) throw new PageError(file, `required section "## ${spec.names.join('" or "## ')}" is missing`);
    const items = sectionItems(found, spec.lead);
    if (!items.length) throw new PageError(file, `section "## ${found.heading}" has no bullets or text`);
    parts[spec.key] = { label: spec.label, anchor: found.anchor, items };
  }
  return { section, slug, title: data.title, description: data.description, url, parts };
}

// Read the ratified pages under <docs>/src/content/docs/{principles,patterns}, sorted by section then slug.
export function readPages(docsDir) {
  const pages = [];
  for (const section of Object.keys(SECTIONS)) {
    const dir = join(docsDir, 'src/content/docs', section);
    if (!existsSync(dir)) throw new PageError(dir, 'directory not found');
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort(byText)) {
      const slug = name.slice(0, -3);
      if (SKIP.has(slug)) continue;
      const path = `src/content/docs/${section}/${name}`;
      const raw = readFileSync(join(docsDir, path));
      const { data } = splitFrontmatter(raw.toString('utf8'), path);
      if (data.status !== 'ratified') continue;
      pages.push({ path, sha: sha256(raw), ...parsePage(raw.toString('utf8'), path, section, slug) });
    }
  }
  return pages.sort((a, b) => byText(a.section, b.section) || byText(a.slug, b.slug));
}

// sha256 over the sorted `<path> <sha256 of raw bytes>` lines, the per-file hash the manifest uses.
export const sourceHash = (pages) =>
  sha256(pages.map((p) => `${p.path} ${p.sha}\n`).sort(byText).join(''));

function renderPart(part, url) {
  const out = [`- ${part.label} ([#${part.anchor}](${url}#${part.anchor})):`];
  for (const item of part.items) for (const line of item) out.push(`  ${absolute(line)}`);
  return out;
}

function renderPage(page, keys) {
  const out = [`### [${page.title}](${page.url})`, '', absolute(page.description), ''];
  for (const key of keys) out.push(...renderPart(page.parts[key], page.url));
  out.push('');
  return out;
}

export function render(pages) {
  const north = pages.filter((p) => p.section === 'principles' && p.slug === NORTH_STAR);
  const principles = pages.filter((p) => p.section === 'principles' && p.slug !== NORTH_STAR);
  const patterns = pages.filter((p) => p.section === 'patterns');
  const lines = [
    '---',
    'name: agentic-power-user',
    'description: Use when advising how to work well with coding agents, reviewing an agent session, a post-mortem, or a retro; when a correction repeats, a rule does not bind, work was "done" but unverified, context bloats, delegation or subagents go wrong, cost or attention is wasted, or a team asks for agent best practices, prompting, AGENTS.md or other instruction files, hooks, skills, gates, verification, review.',
    'source: stablekernel/SHRINE',
    `source-hash: ${sourceHash(pages)}`,
    '---',
    '<!-- GENERATED by docs/scripts/gen-skill.mjs. Do not edit. -->',
    '',
    '# Agentic power user',
    '',
    '## How to use',
    '',
    '- Match the symptom to a Signal of Violation or Anti-pattern below; follow its anchor.',
    '- Fix the input, not the output: name the page that owns the cause.',
    '- Prefer a check or gate over stronger wording.',
    '- Cite every claim as `[Title#anchor](url)` plus the source commit you fetched.',
    '- No match: say "model judgment"; never invent a SHRINE citation.',
    '- Advise on the system (harness, repo, checks), not on the person.',
    '',
  ];
  if (north.length) lines.push('## North Star', '', ...north.flatMap((p) => renderPage(p, ['principle', 'signals'])));
  if (principles.length) lines.push('## Principles', '', ...principles.flatMap((p) => renderPage(p, ['principle', 'signals'])));
  if (patterns.length) lines.push('## Patterns', '', ...patterns.flatMap((p) => renderPage(p, ['pattern', 'use', 'notUse', 'anti'])));
  return `${lines.join('\n').trimEnd()}\n`;
}

export const generate = (docsDir) => render(readPages(docsDir));

function diff(expectedPath, actual) {
  const dir = mkdtempSync(join(tmpdir(), 'gen-skill-'));
  try {
    const fresh = join(dir, 'SKILL.md');
    writeFileSync(fresh, actual);
    const target = existsSync(expectedPath) ? expectedPath : '/dev/null';
    const result = spawnSync('git', ['diff', '--no-index', '--no-color', '--', target, fresh], { encoding: 'utf8' });
    return result.stdout || result.stderr || '(no diff tool output)';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const docsDir = resolve(flag('--docs') ?? join(here, '..'));
  const out = resolve(flag('--out') ?? join(docsDir, '..', 'skills/agentic-power-user/SKILL.md'));
  let text;
  try {
    text = generate(docsDir);
  } catch (err) {
    if (err instanceof PageError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
  if (argv.includes('--check')) {
    if (existsSync(out) && readFileSync(out, 'utf8') === text) {
      console.log(`gen-skill: ${out} is current`);
      return 0;
    }
    console.error(diff(out, text));
    console.error(`gen-skill: ${out} is stale. Run: npm --prefix docs run gen:skill`);
    return 1;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`gen-skill: wrote ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
