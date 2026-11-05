// Renderer (spec 8): findings.json to one self-contained HTML file. CSS, JS,
// icons, and data are inline; the page makes zero external requests and reads
// fully with scripts off. shareSafeFindings() builds the masked, excerpt-free copy.
import { fileURLToPath } from 'node:url';
import { readText } from '../io/fsread.mjs';
import { emptyStates } from '../copy/templates.mjs';
import { maskDeep } from '../scrub/mask.mjs';

const asset = (name) => readText(fileURLToPath(new URL(`./assets/${name}`, import.meta.url)));

export const TIER_NAMES = { T0: 'Scan only', T1: 'Pulse', T2: 'Standard', T3: 'Deep' };
export const PREVIEW_LABEL = 'Preview only. To share, use the share-safe file.';
const FOOTER_NOTE = 'Generated on your machine by your own AI tool. Secrets scrubbed.';
const EVENT_LABEL = { Prompt: 'Prompt', Correction: 'Correction', 'Done claim': 'Done claim', Commit: 'Commit' };

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="#i-${esc(name)}"/></svg>`;
const pl = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---- share-safe ------------------------------------------------------------

// Strips every excerpt (evidence excerpts, user-prompt before/after, timeline
// labels, counter readings) and masks known identifiers. SHRINE refs are kept.
export function shareSafeFindings(findings, known, genericPivots = {}) {
  const strip = (f) => {
    const out = structuredClone(f);
    out.evidence = (out.evidence ?? []).map((e) => ({ ...e, excerpt_scrubbed: null }));
    if (out.pivot?.source === 'user_prompt') {
      const g = genericPivots[out.entry_id ?? out.shrine_refs?.[0]?.entry_id];
      out.pivot = { ...out.pivot, source: 'shrine_generic', before_scrubbed: g?.before ?? null, after_scrubbed: g?.after ?? null, after_marks: [] };
    }
    if (out.episode_ref?.timeline) {
      out.episode_ref.timeline = out.episode_ref.timeline.map((e) => ({ ...e, label_scrubbed: EVENT_LABEL[e.event_kind] ?? 'Event' }));
    }
    if (out.counter_reading) out.counter_reading = null;
    return out;
  };
  const data = structuredClone(findings);
  data.findings = data.findings.map(strip);
  data.worth_a_look = data.worth_a_look.map(strip);
  data.share_safe = true;
  return maskDeep(data, known);
}

// ---- sections ----------------------------------------------------------------

function header(d) {
  const chips = [`<span class="chip">${icon('scan')}${esc(d.run.harness?.name ?? 'Unknown harness')}</span>`, `<span class="chip">${esc(formatDate(d.run.started_at))}</span>`];
  if (d.history?.read) chips.push(`<span class="chip">${pl(d.history.sessions ?? 0, 'session')} reviewed</span>`);
  else chips.push('<span class="chip">History not read</span>');
  if (d.headline.counts?.correction_candidates != null && d.history?.read) chips.push(`<span class="chip">${pl(d.headline.counts.correction_candidates, 'correction candidate')}</span>`);
  if (d.diff) chips.push(`<span class="chip" data-slot="diff">Since last run: ${d.diff.new} new, ${d.diff.cleared} cleared, ${d.diff.unchanged} unchanged</span>`);
  return `<header class="head"><h1>Your agentic setup, measured against SHRINE</h1><div class="meta">${chips.join('')}</div></header>`;
}

// What this run could not read (a skipped or hung git read): a run limit, shown
// up top, not a tier limit in the appendix.
function runLimits(d) {
  const items = d.run_limits ?? [];
  return items.length ? `<section class="run-limits" role="note" aria-label="Run limits">${items.map((n) => `<p>${esc(n)}</p>`).join('')}</section>` : '';
}

function depth(d) {
  const n = Number(d.tier.slice(1));
  const meter = [1, 2, 3].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('');
  const label = d.tier === 'T0' ? 'Scan only, no model calls' : `Tier ${n}, ${TIER_NAMES[d.tier]}`;
  const parts = [];
  if (d.tier !== 'T0') parts.push(`${pl(d.reviewers, 'reviewer')}, ${pl(Math.round(d.minutes_elapsed), 'minute')}`);
  if (!d.history?.consented) parts.push('history not read');
  else if (d.tier === 'T0') parts.push('setup, repos, and local session logs parsed by code');
  return `<div class="depth" role="note"><span class="meter" role="img" aria-label="Depth: ${esc(label)}">${meter}</span><span><b>${esc(label)}</b></span>${parts.map((p) => `<span>${esc(p)}</span>`).join('')}</div>`;
}

function tldr(d, empty) {
  const byId = new Map([...d.findings, ...d.worth_a_look].map((f) => [f.id, f]));
  let items;
  if (d.headline.tldr.length === 0) {
    const keep = d.checked_clear[0];
    // The next step prints once, in the start box below.
    items = `<p class="empty"><b>${esc(empty.tldr)}</b>${keep ? ` ${esc(`Keep: ${keep.check}.`)}` : ''}</p>${empty.not_passed ? `<p class="empty">${esc(empty.not_passed)}</p>` : ''}`;
  } else {
    items = `<ul>${d.headline.tldr
      .map((t) => {
        const good = t.status === 'working';
        return `<li>${icon(good ? 'check' : 'up', `i ${good ? 'good-c' : 'warn-c'}`)}<span><span class="status ${good ? 'good' : 'warn'}">${good ? 'Working' : 'Room to amplify'}:</span> <b>${esc(/[.!?]$/.test(t.headline) ? t.headline : `${t.headline}.`)}</b> ${esc(t.sentence)}</span></li>`;
      })
      .join('')}</ul>`;
  }
  let start = '';
  const sw = d.headline.start_with;
  if (sw) {
    const f = byId.get(sw.finding_id);
    const h = sw.framed === false ? 'Top finding' : 'Start with one change';
    start = `<div class="start"><h3>${h}</h3><p>${esc(sw.action)} About ${pl(sw.minutes_to_apply, 'minute')}.</p><a class="btn" id="goto" href="#${esc(sw.finding_id)}" data-target="${esc(sw.finding_id)}">See the finding ${icon('arrow')}</a>${f ? `<span class="sr-only">${esc(f.title)}</span>` : ''}</div>`;
  } else {
    start = `<div class="start"><h3>Next step</h3><p>${esc(empty.tldr_next)}</p></div>`;
  }
  return `<section aria-labelledby="tldr-h"><h2 id="tldr-h">The short version</h2><div class="tldr"><div>${items}</div>${start}</div></section>`;
}

const AREA_GROUPS = [
  ['principles', 'Principles'],
  ['patterns', 'Patterns'],
  ['stack', 'Stack'],
];

// Only areas with a finding get a row, grouped under their SHRINE area; the rest
// collapse into one quiet line.
function coverage(d, empty) {
  const tripped = d.coverage.filter((c) => c.working + c.amplify > 0);
  // Areas with no check at this tier are counted apart, never as "no findings".
  const checked = d.coverage.filter((c) => c.checked).length;
  // An area whose only check failed with no finding is checked but not quiet: the
  // not_passed line reports it.
  const quiet = d.coverage.filter((c) => c.checked && c.working + c.amplify === 0 && !c.not_passed).length;
  const unchecked = d.coverage.length - checked;
  const max = Math.max(3, ...tripped.map((c) => Math.max(c.working, c.amplify)));
  const row = (c) =>
    `<tr role="row"><th scope="row" role="rowheader">${icon(c.icon)} ${esc(c.title)}</th><td role="cell"><div class="half left"><span>${c.working || ''}</span><i class="bar-g" style="width:${(c.working / max) * 100}%"></i></div></td><td role="cell"><div class="half"><i class="bar-w" style="width:${(c.amplify / max) * 100}%"></i><span>${c.amplify || ''}</span></div></td></tr>`;
  const bodies = AREA_GROUPS.map(([g, label]) => {
    const rows = tripped.filter((c) => (c.group ?? 'principles') === g);
    return rows.length ? `<tbody role="rowgroup"><tr class="grp" role="row"><th scope="rowgroup" colspan="3" role="rowheader">${label}</th></tr>${rows.map(row).join('')}</tbody>` : '';
  }).join('');
  const clear = !quiet ? '' : tripped.length ? `${pl(quiet, 'other checked area')} showed no findings.` : `No SHRINE area showed a finding (${pl(quiet, 'area')} checked).`;
  const gap = unchecked ? `${pl(unchecked, 'area')} ${unchecked === 1 ? 'has' : 'have'} no Tier ${String(d.tier).slice(1)} check yet.` : '';
  const note = clear || gap || empty.not_passed ? `<p class="quiet">${[clear, empty.not_passed, gap].filter(Boolean).join(' ')}</p>` : '';
  const table = tripped.length
    ? `<table class="cov" role="table"><caption class="sr-only">Findings per SHRINE area: working for you and room to amplify</caption><thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader"><span class="sr-only">SHRINE area</span></th><th scope="col" role="columnheader">Working for you</th><th scope="col" role="columnheader">Room to amplify</th></tr></thead>${bodies}</table>`
    : '';
  let attr;
  const a = d.attribution_stack;
  if (!a) {
    attr = `<div class="attr"><h3>Who owned the corrections</h3><div class="box"><b>${esc(empty.attribution)}</b><p>${esc(empty.attribution_body)}</p></div></div>`;
  } else {
    const total = a.setup + a.prompt + a.model + a.unknown || 1;
    const seg = [
      ['a-setup', 'Setup, no gate or hook', a.setup],
      ['a-you', 'Prompt, constraint arrived late', a.prompt],
      ['a-model', 'Model, enforcement pivot', a.model],
      ['a-unk', 'Could not tell', a.unknown],
    ];
    attr = `<div class="attr"><h3>Who owned the ${pl(total, 'correction')}</h3><p>Only the prompt share is prompting advice. The rest points to setup and enforcement.</p><div class="stack" role="img" aria-label="${seg.map((s) => `${s[1]} ${s[2]}`).join(', ')}">${seg.map((s) => `<i class="${s[0]}" style="width:${(s[2] / total) * 100}%"></i>`).join('')}</div><ul class="legend">${seg.map((s) => `<li><i class="${s[0]}"></i><span>${esc(s[1])}</span><b>${s[2]}</b></li>`).join('')}</ul></div>`;
  }
  return `<section aria-labelledby="map-h"><h2 id="map-h">Where you stand across SHRINE</h2><div class="info"><div>${table}${note}</div>${attr}</div></section>`;
}

function marked(text, marks) {
  if (!text) return '';
  if (!marks?.length) return esc(text);
  let out = '';
  let pos = 0;
  for (const [a, b] of [...marks].sort((x, y) => x[0] - y[0])) {
    const s = Math.max(pos, Math.min(a, text.length));
    const e = Math.max(s, Math.min(b, text.length));
    out += `${esc(text.slice(pos, s))}<mark>${esc(text.slice(s, e))}</mark>`;
    pos = e;
  }
  return out + esc(text.slice(pos));
}

// Timeline drawn in a 520-unit box. styles.css keeps the box at least 460px wide (a
// scroll box below that), so 11.5px text never renders under 10px. Labels are
// centred on their dot and wrapped to the space between dots, so none overlap.
const TL_W = 520;
const TL_CHAR = 6.4; // generous average glyph width at 11.5px
function wrapLabel(text, max) {
  const lines = [];
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const last = lines.at(-1);
    if (last != null && `${last} ${word}`.length <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.length ? lines : [''];
}

function timeline(f) {
  const ev = f.episode_ref?.timeline;
  if (!ev?.length) return '';
  const w = TL_W;
  const n = ev.length;
  const slot = n > 1 ? (w - 16) / n : w - 16;
  const pad = 8 + slot / 2;
  const step = n > 1 ? (w - 2 * pad) / (n - 1) : 0;
  const max = Math.max(6, Math.floor((slot - 12) / TL_CHAR));
  const y = 34;
  const lh = 14;
  const gap = f.timeline_gap;
  const gi = gap ? ev.findIndex((e) => e.t === gap.from_t) : -1;
  const gj = gap ? ev.findIndex((e) => e.t === gap.to_t) : -1;
  const x0 = n > 1 ? pad : w / 2;
  let s = `<line class="ln" x1="${x0}" y1="${y}" x2="${n > 1 ? w - pad : w / 2}" y2="${y}"/>`;
  if (gi >= 0 && gj > gi) s += `<line class="dash" x1="${x0 + step * gi}" y1="${y}" x2="${x0 + step * gj}" y2="${y}"/>`;
  let lines = 1;
  ev.forEach((e, i) => {
    const x = x0 + step * i;
    const wrapped = wrapLabel(e.label_scrubbed, max);
    lines = Math.max(lines, wrapped.length);
    const tspans = wrapped.map((l, k) => `<tspan x="${x}" dy="${k ? lh : 0}">${esc(l)}</tspan>`).join('');
    s += `<circle class="dot ${e.kind === 'neutral' ? '' : esc(e.kind)}" cx="${x}" cy="${y}" r="6"/><text class="dim" x="${x}" y="${y - 16}" text-anchor="middle">${esc(e.t)}</text><text x="${x}" y="${y + 30}" text-anchor="middle">${tspans}</text>`;
  });
  const gy = y + 30 + (lines - 1) * lh + 22;
  if (gi >= 0 && gj > gi) s += `<text class="gap" x="${x0 + step * ((gi + gj) / 2)}" y="${gy}" text-anchor="middle">${esc(gap.label)}</text>`;
  const h = (gi >= 0 && gj > gi ? gy : gy - 22) + 10;
  const label = `Episode timeline: ${ev.map((e) => `${e.t} ${e.label_scrubbed}`).join('; ')}${gap ? `. Gap: ${gap.label}` : ''}`;
  return `<div class="blk"><h4>What happened</h4><div class="tl-scroll excerpt" tabindex="0" role="group" aria-label="Episode timeline"><svg class="tl" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${s}</svg></div><p class="excerpt-safe">Timeline labels are hidden in the share-safe file.</p></div>`;
}

function configStrip(f) {
  const c = f.config_strip;
  if (!c) return '';
  const parts = [];
  if (c.mtime) parts.push(`Last change ${formatDate(c.mtime)}`);
  if (c.last_git_change) parts.push(`last git commit ${formatDate(c.last_git_change)}`);
  parts.push(c.sessions_since == null ? 'sessions since: history not read' : `${pl(c.sessions_since, 'session')} since`);
  return `<p class="ev">${esc(parts.join('; '))}</p>`;
}

function detail(f, tab, empty) {
  const warn = tab !== 'working';
  const tags = [
    `<span class="tag">${icon('wrench')}${esc(f.owner_label)}</span>`,
    `<span class="tag">${esc(f.confidence.label === 'high' ? 'High confidence' : f.confidence.label === 'medium' ? 'Medium confidence' : 'Low confidence')}</span>`,
    `<span class="tag">${f.provenance === 'mechanical' ? 'Mechanical' : 'Judged'}</span>`,
    warn ? `<span class="tag">Severity: ${esc(f.severity.label)}</span>` : f.praise_class ? '<span class="tag">Structure</span>' : '',
  ].join('');
  const list = (xs) => `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const ev = f.evidence
    .map((e) => `<li><code class="mono">${esc(e.locator)}</code>${e.metric ? `: ${esc(e.metric)}` : ''}${e.excerpt_scrubbed ? ` <q class="excerpt">${esc(e.excerpt_scrubbed)}</q>` : ''}</li>`)
    .join('');
  const p = f.pivot;
  let pivot = `<div class="blk"><h4>Suggested pivot</h4><p><b>${esc(p.action)}</b> About ${pl(p.minutes_to_apply, 'minute')}.</p>`;
  if (p.before_scrubbed || p.after_scrubbed) {
    const generic = p.source === 'shrine_generic';
    const cls = generic ? '' : ' excerpt';
    pivot += `<div class="ba${cls}"><figure class="b"><figcaption>${icon('arrow')}${generic ? `${esc(empty.before_after)}: before` : 'From your sessions'}</figcaption><pre>${esc(p.before_scrubbed)}</pre></figure><figure class="a"><figcaption>${icon('check')}${generic ? `${esc(empty.before_after)}: after` : 'Try this'}</figcaption><pre>${marked(p.after_scrubbed, p.after_marks)}</pre></figure></div>`;
    if (!generic) pivot += '<p class="excerpt-safe">Your own prompt is replaced by the SHRINE example in the share-safe file.</p>';
  }
  if (p.setup_note) pivot += `<p>${esc(p.setup_note)}</p>`;
  pivot += '</div>';
  const benefit = f.benefit.length
    ? `<div class="blk"><h4>${warn ? 'What you gain' : 'What it gives you'}</h4><div class="benefit">${f.benefit.map((b) => `<div><b>${esc(b.headline)}</b>${esc(b.sub)}</div>`).join('')}</div></div>`
    : '';
  const refs = `<div class="blk"><h4>In SHRINE</h4><div class="refs">${f.shrine_refs
    .map((r) => `<a class="ref" href="${esc(r.url ?? r.url_pinned)}">${icon('book')}${esc(r.title)} <small>${esc(r.section[0].toUpperCase() + r.section.slice(1))}${r.status === 'draft' ? ', Draft' : ''}</small></a>`)
    .join('')}</div>${f.shrine_refs.map((r) => `<blockquote class="quote">${esc(r.quote)}</blockquote>`).join('')}</div>`;
  return `<article class="detail" id="${esc(f.id)}" aria-labelledby="${esc(f.id)}-t"><div class="tags">${tags}</div><h3 class="title" id="${esc(f.id)}-t">${esc(f.title)}</h3><p class="lead">${esc(f.lead)}</p>${configStrip(f)}${timeline(f)}<div class="blk"><h4>${warn ? 'Why this is a finding' : 'Why this counts'}</h4>${list(f.why)}</div><div class="blk"><h4>${warn ? 'Why it is a problem' : 'What to watch'}</h4>${list(f.problem)}</div><div class="blk"><h4>Evidence</h4><ul class="ev">${ev}</ul></div>${pivot}${benefit}${refs}</article>`;
}

function explorer(d, empty) {
  const groups = [
    ['amplify', 'Room to amplify', 't-warn', d.findings.filter((f) => f.tab === 'amplify')],
    ['working', 'Working for you', 't-good', d.findings.filter((f) => f.tab === 'working')],
  ];
  const tabs = groups
    .map(([k, label, cls, fs], i) => `<button type="button" class="tab ${cls}" role="tab" id="tab-${k}" aria-controls="panel-${k}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label} <span class="n">${fs.length}</span></button>`)
    .join('');
  const panels = groups
    .map(([k, label, , fs]) => {
      const body = fs.length
        ? `<div class="explore"><ul class="list" aria-label="${label} findings">${fs
            .map((f) => `<li><a class="f-btn" href="#${esc(f.id)}" data-target="${esc(f.id)}"><span class="${k === 'working' ? 'good-c' : 'warn-c'}">${icon(f.icon)}</span><span><span class="t">${esc(f.title)}</span><span class="s">${esc(f.short)}</span></span></a></li>`)
            .join('')}</ul><div class="details">${fs.map((f) => detail(f, k, empty)).join('')}</div></div>`
        : `<p class="empty"><b>${esc(empty.tab[k].title)}</b> ${esc(empty.tab[k].body)}</p>`;
      return `<div role="tabpanel" id="panel-${k}" aria-labelledby="tab-${k}" tabindex="0"><h3 class="panel-h">${label} (${fs.length})</h3>${body}</div>`;
    })
    .join('');
  return `<section aria-labelledby="explore-h" id="explorer"><h2 id="explore-h">Findings</h2><div class="tabs" role="tablist" aria-label="Finding groups" hidden>${tabs}</div>${panels}</section>`;
}

function checkedClear(d) {
  if (!d.checked_clear.length) return '';
  const items = d.checked_clear
    .map(
      (c) =>
        `<li id="${esc(c.id ?? '')}">${icon('check')}<span><span class="status good">Clear:</span> <b>${esc(c.check)}.</b> Guards against: ${esc(c.guards_against)}.${c.shrine_ref ? ` <a href="${esc(c.shrine_ref.url ?? c.shrine_ref.url_pinned)}">${esc(c.shrine_ref.title)}</a>` : ''}</span></li>`,
    )
    .join('');
  return `<section aria-labelledby="clear-h"><h2 id="clear-h">Checked and clear</h2><p class="ev">Checks that ran and passed. Not praise: presence alone earns nothing.</p><ul class="clear">${items}</ul></section>`;
}

function appendix(d) {
  const blk = (title, body) => (body ? `<details><summary>${esc(title)}</summary>${body}</details>` : '');
  const ul = (xs) => (xs.length ? `<ul>${xs.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
  return `<section aria-labelledby="app-h" class="appendix"><h2 id="app-h">Appendix</h2>${[
    blk(`Worth a look (${d.worth_a_look.length})`, ul(d.worth_a_look.map((f) => `<span id="${esc(f.id)}">${esc(f.title)}: ${esc(f.short)} (${esc(f.confidence.basis)})</span>`))),
    blk(`Configured, not praised (${d.configured.length})`, ul(d.configured.map((c) => `${esc(c.item)}: ${c.count}${c.detail ? `, ${esc(c.detail)}` : ''}`))),
    blk(`Dropped (${d.dropped.length})`, ul(d.dropped.map((x) => `${esc(x.id)}: ${esc(x.reason)}`))),
    blk('What this tier cannot tell', ul(d.unknowable.map(esc))),
    blk(`Skipped files (${d.skipped_files.length})`, ul(d.skipped_files.map((s) => `<code class="mono">${esc(s.path_scrubbed)}</code>: ${esc(s.reason)}`))),
    blk('Thresholds', ul(Object.entries(d.thresholds ?? {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`))),
  ].join('')}</section>`;
}

function footer(d) {
  const bar = d.tier === 'T0' ? 'Findings need a deterministic check plus a cited SHRINE entry.' : 'Findings need 3 episodes or 20% of a stratum, plus one mechanical anchor.';
  const seed = d.run.seed != null ? `<span>Seed ${esc(d.run.seed)}</span>` : '';
  const claim = d.integrity?.ok === false ? 'Integrity check failed: see the alert at the top.' : 'Read-only review. Nothing in your setup was changed.';
  return `<footer class="foot"><span>${claim}</span><span>${bar}</span><span>SHRINE commit <code class="mono">${esc(d.shrine.commit.slice(0, 12))}</code></span>${seed}<span>${FOOTER_NOTE}</span></footer>`;
}

// ---- page --------------------------------------------------------------------

export function renderReport(findings, { shareSafe = false } = {}) {
  const d = findings;
  const empty = emptyStates({ checks: d.headline.counts?.checks ?? d.checked_clear.length, notPassed: d.headline.counts?.not_passed ?? 0, tier: d.tier, historyRead: d.history?.read === true });
  const integrity = d.integrity?.ok === false
    ? `<div class="integrity" role="alert"><b>Integrity check failed.</b> These files changed while inspect had them open for writing: ${d.integrity.changed_paths.map((p) => `<code class="mono">${esc(p)}</code>`).join(', ')}</div>`
    : '';
  const skipped = d.git_history_skipped ?? 0;
  const caveat = skipped ? ` Git history was not read in ${pl(skipped, 'repo')}, so other commit authors' names there are not masked.` : '';
  const banner = shareSafe ? `<p class="safe-banner">Share-safe copy: names, paths, and hosts are masked; session excerpts are removed.${caveat}</p>` : '';
  const previewBtn = shareSafe ? '' : `<button type="button" id="preview-safe" aria-pressed="false">${PREVIEW_LABEL}</button>`;
  const chrome = `<div class="chrome"><span>shrine-inspect ${esc(d.run.tool_version)}</span><div class="controls"><div class="toggle" role="group" aria-label="Theme"><button type="button" data-theme-choice="system" aria-pressed="true">System</button><button type="button" data-theme-choice="light" aria-pressed="false">Light</button><button type="button" data-theme-choice="dark" aria-pressed="false">Dark</button></div>${previewBtn ? `<div class="toggle">${previewBtn}</div>` : ''}</div></div>`;
  const data = JSON.stringify(d).replace(/</g, '\\u003c');
  const body = `${integrity}${banner}${chrome}<article class="report">${header(d)}${runLimits(d)}${depth(d)}${tldr(d, empty)}${coverage(d, empty)}${explorer(d, empty)}${checkedClear(d)}${appendix(d)}${footer(d)}</article>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>SHRINE inspect report${shareSafe ? ' (share-safe)' : ''}</title>
<style>${asset('styles.css')}</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${asset('icons.svg')}</defs></svg>
<main class="page">${body}</main>
<script type="application/json" id="findings-data">${data}</script>
<script>${asset('app.js')}</script>
</body>
</html>
`;
}
