// Builds catalogue.json from a SHRINE docs checkout (spec 6). Reads through the
// read-only IO layer; the caller decides where the result is written.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { list, readBytes, readJson, exists } from '../io/fsread.mjs';
import { gitOut } from '../io/git.mjs';
import { harvestSection, links, normalize, parsePage } from './harvest.mjs';

export const SITE = 'https://stablekernel.github.io/SHRINE/';
export const REPO = 'stablekernel/SHRINE';
const DEFAULT_IDS = new URL('./entry-ids.json', import.meta.url);

const hash10 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);
const SECTION = { principles: 'principle', patterns: 'pattern', stack: 'stack', reference: 'reference' };

function loadPages(docsDir, folder) {
  return list(join(docsDir, folder))
    .filter((e) => !e.dir && /\.mdx?$/.test(e.name))
    .map((e) => ({ file: `${folder}/${e.name}`, id: `${folder}/${e.name.replace(/\.mdx?$/, '')}` }));
}

export function buildCatalogue({ docsDir, entryIds, commit } = {}) {
  const ids = entryIds ?? JSON.parse(readBytes(DEFAULT_IDS).toString('utf8'));
  const sha = commit ?? gitOut(['log', '-1', '--format=%H', '--', '.'], docsDir) ?? 'unknown';
  const files = {};
  const pages = {};
  const read = ({ file, id }) => {
    const buf = readBytes(join(docsDir, file));
    files[file] = createHash('sha256').update(buf).digest('hex');
    const page = parsePage(buf.toString('utf8'), id);
    pages[id] = { file, page };
    return page;
  };
  const meta = (page) => ({
    id: page.pageId,
    title: page.front.title ?? page.pageId,
    status: page.front.status === 'draft' ? 'draft' : 'ratified',
    url: `${SITE}${page.pageId}/`,
  });
  const withIds = (page, entries) =>
    entries.map((e) => ({ entry_id: `${page.pageId}#${hash10(normalize(e.text))}`, text: e.text, anchor: e.anchor, line: e.line }));

  const principles = loadPages(docsDir, 'principles')
    .filter((p) => p.id !== 'principles/index')
    .map((p) => {
      const page = read(p);
      return { ...meta(page), signals_of_violation: withIds(page, harvestSection(page, 'Signal of Violation', { shape: 'bullets' })) };
    });
  const bulletPages = (folder) =>
    loadPages(docsDir, folder)
      .filter((p) => p.id !== `${folder}/overview`)
      .map((p) => {
        const page = read(p);
        return { ...meta(page), anti_patterns: withIds(page, harvestSection(page, 'Anti-patterns', { shape: 'bullets' })) };
      });
  const patterns = bulletPages('patterns');
  const stack = bulletPages('stack');

  const anti_patterns = [];
  const indexFile = { file: 'reference/anti-patterns.md', id: 'reference/anti-patterns' };
  if (exists(join(docsDir, indexFile.file))) {
    const page = read(indexFile);
    for (const s of page.sections) {
      for (const row of harvestSection(page, s.heading, { shape: 'table', cells: 3 })) {
        anti_patterns.push({
          entry_id: `${page.pageId}#${hash10(normalize(row.cells.join(' | ')))}`,
          group: s.heading,
          symptom: row.cells[0],
          anti_pattern: row.cells[1],
          fix_links: links(row.raw[2]),
          anchor: row.anchor,
          line: row.line,
        });
      }
    }
  }

  const symptoms = [];
  const overview = { file: 'patterns/overview.md', id: 'patterns/overview' };
  if (exists(join(docsDir, overview.file))) {
    const page = read(overview);
    for (const row of harvestSection(page, 'If You See X, Read Y', { shape: 'table', cells: 2, allowProse: true })) {
      symptoms.push({
        entry_id: `${page.pageId}#${hash10(normalize(row.cells.join(' | ')))}`,
        symptom: row.cells[0],
        links: links(row.raw[1]),
        anchor: row.anchor,
        line: row.line,
      });
    }
  }

  const glossary = [];
  const glossFile = { file: 'reference/glossary.md', id: 'reference/glossary' };
  if (exists(join(docsDir, glossFile.file))) {
    const page = read(glossFile);
    for (const s of page.sections) {
      glossary.push({ term: s.heading, definition: harvestSection(page, s.heading, { shape: 'paragraph' })[0].text });
    }
  }

  // Resolve hand-assigned stable ids (spec 4, 6).
  const pool = [
    ...principles.flatMap((p) => p.signals_of_violation.map((e) => ({ page: p, e }))),
    ...patterns.flatMap((p) => p.anti_patterns.map((e) => ({ page: p, e }))),
    ...stack.flatMap((p) => p.anti_patterns.map((e) => ({ page: p, e }))),
  ];
  const entries = {};
  const seen = new Set();
  for (const [entryId, spec] of Object.entries(ids)) {
    const hits = pool.filter(
      ({ page, e }) => page.id === spec.page_id && e.anchor === spec.anchor && normalize(e.text).startsWith(spec.match),
    );
    if (hits.length !== 1) {
      throw new Error(`entry id ${entryId} resolves to ${hits.length} entries (${spec.page_id}#${spec.anchor} "${spec.match}")`);
    }
    const { page, e } = hits[0];
    // Several stable ids may name one entry (one per probe kind); the first wins the list slot.
    if (seen.has(e)) (e.also_ids ??= []).push(entryId);
    else {
      e.entry_id = entryId;
      seen.add(e);
    }
    entries[entryId] = {
      entry_id: entryId,
      page_id: page.id,
      anchor: e.anchor,
      title: page.title,
      section: SECTION[page.id.split('/')[0]],
      status: page.status,
      url: `${page.url}#${e.anchor}`,
      url_pinned: `https://github.com/${REPO}/blob/${sha}/docs/src/content/docs/${pages[page.id].file}#L${e.line}`,
      quote: e.text,
    };
  }

  return {
    schema_version: 1,
    shrine: { commit: sha, site: SITE, files },
    principles,
    patterns,
    stack,
    anti_patterns,
    symptoms,
    glossary,
    entries,
  };
}

export function loadBundledCatalogue() {
  return readJson(fileURLToPath(new URL('./catalogue.json', import.meta.url)));
}
