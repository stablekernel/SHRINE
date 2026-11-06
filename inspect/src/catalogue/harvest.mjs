// Harvests catalogue entries from SHRINE markdown pages (brainstorm 6 shapes):
// bullets under an H2 until the next H2, or table rows with a fixed cell count.
// Any other shape under a harvested heading throws with page and line.

export function parsePage(markdown, pageId) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const front = {};
  let i = 0;
  if (lines[0] === '---') {
    for (i = 1; i < lines.length && lines[i] !== '---'; i++) {
      const m = lines[i].match(/^([\w-]+):\s*(.*)$/);
      if (m) front[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
    i++;
  }
  const sections = [];
  let current = null;
  let inFence = false;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) inFence = !inFence;
    const h2 = !inFence && line.match(/^## (.+?)\s*$/);
    if (h2) {
      current = { heading: h2[1], line: i + 1, body: [] };
      sections.push(current);
    } else if (current) {
      current.body.push({ text: line, line: i + 1 });
    }
  }
  return { pageId, front, sections };
}

export function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

// Plain text from inline markdown: links keep their label; code and emphasis marks go.
export function plain(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*]/g, '')
    .replace(/(^|\s)_([^_]+)_(?=\s|$|[.,;:])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalize(text) {
  return plain(text).toLowerCase();
}

// Every [label](/SHRINE/<page>/#anchor) in a cell, as {page_id, anchor}.
export function links(text) {
  return [...text.matchAll(/\]\(\/SHRINE\/([^)#]*?)\/?(?:#([^)]*))?\)/g)].map((m) => ({
    page_id: m[1].replace(/\/$/, ''),
    anchor: m[2] ?? '',
  }));
}

function splitRow(text) {
  const t = text.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

const SKIP = (t) => t.trim() === '' || /^\s*<!--.*-->\s*$/.test(t);

export function harvestSection(page, heading, { shape, cells = 3, allowProse = false }) {
  const section = page.sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`${page.pageId}: no "${heading}" section`);
  const anchor = slug(heading);
  const fail = (ln) => {
    throw new Error(`${page.pageId}:${ln.line}: unexpected shape under "${heading}": ${ln.text.slice(0, 60)}`);
  };
  const out = [];
  if (shape === 'bullets') {
    for (const ln of section.body) {
      if (SKIP(ln.text)) continue;
      const m = ln.text.match(/^- (.+)$/);
      if (!m) fail(ln);
      out.push({ text: plain(m[1]), anchor, line: ln.line });
    }
  } else if (shape === 'table') {
    let row = 0;
    for (const ln of section.body) {
      if (SKIP(ln.text)) continue;
      const parts = splitRow(ln.text);
      if (!parts) {
        if (allowProse && row > 0) continue;
        fail(ln);
      }
      row++;
      if (parts.length !== cells) {
        throw new Error(`${page.pageId}:${ln.line}: table row has ${parts.length} cells, expected ${cells}`);
      }
      if (row === 1) continue; // header
      if (row === 2) {
        if (!parts.every((c) => /^:?-+:?$/.test(c))) fail(ln);
        continue;
      }
      out.push({ cells: parts.map(plain), raw: parts, anchor, line: ln.line });
    }
  } else if (shape === 'paragraph') {
    const text = section.body
      .filter((ln) => !SKIP(ln.text))
      .map((ln) => ln.text)
      .join(' ');
    if (!text) fail({ line: section.line, text: heading });
    out.push({ text: plain(text), anchor, line: section.line });
  } else {
    throw new Error(`unknown shape ${shape}`);
  }
  return out;
}
