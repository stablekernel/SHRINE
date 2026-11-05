// Shell commands at command position (E5 amendment to T2.8): heredoc bodies and
// quoted strings are removed, the line is split at && || ; | and newlines, and
// leading wrappers (env assignments, env, time, do, then, uv run, python -m) are
// stripped. A pattern list then matches the start of each segment only, so a
// tool name inside a commit message, a grep argument, or prose never matches.
// Commands are agent-written text, so both scanners below run in linear time. A
// quote with no end runs to the end of the command, as in a shell. A `<<` with no
// closing line is kept as text: it is more often a shift or prose than a heredoc.

const WORD = /\w/;
const LINE_SPACE = /[^\S\n]/;

// Each line's leading word (after spaces) -> the start offsets of those lines, in
// order. One pass, so closing-line lookups need no rescan of the command.
function lineWords(s) {
  const map = new Map();
  for (let k = s.indexOf('\n'); k !== -1; k = s.indexOf('\n', k + 1)) {
    let m = k + 1;
    while (m < s.length && LINE_SPACE.test(s[m])) m++;
    let e = m;
    while (e < s.length && WORD.test(s[e])) e++;
    if (e === m) continue;
    const word = s.slice(m, e);
    const entry = map.get(word);
    if (entry) entry.at.push(m);
    else map.set(word, { at: [m], next: 0 });
  }
  return map;
}

// Each heredoc (`<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"`; rest of that line; body;
// the first later line that starts with TAG) becomes one space. Here-strings
// (`<<<`) and shifts inside arithmetic (`((...))`, `$((...))`) are not heredocs.
function dropHeredocs(s) {
  if (!s.includes('<<')) return s;
  let out = '';
  let from = 0;
  // Starts only move forward, so one newline lookup serves every start before it,
  // and each tag's pointer into its closing lines only moves forward too.
  let nlAt = -2;
  const nextNl = (j) => (nlAt === -1 || nlAt >= j ? nlAt : (nlAt = s.indexOf('\n', j)));
  let lines = null;
  const closerEnd = (tag, nl) => {
    lines ??= lineWords(s);
    const entry = lines.get(tag);
    if (!entry) return -1;
    while (entry.next < entry.at.length && entry.at[entry.next] <= nl) entry.next++;
    return entry.next < entry.at.length ? entry.at[entry.next] + tag.length : -1;
  };
  // Open parentheses inside an arithmetic `((`; 0 outside one. A newline ends it.
  let arith = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (arith) {
      if (c === '(') arith++;
      else if (c === ')') arith--;
      else if (c === '\n') arith = 0;
      continue;
    }
    if (c === '(' && s[i + 1] === '(') {
      arith = 2;
      i++;
      continue;
    }
    if (c !== '<' || s[i + 1] !== '<') continue;
    if (s[i + 2] === '<') {
      while (s[i + 1] === '<') i++;
      continue;
    }
    let j = i + 2;
    if (s[j] === '-') j++;
    while (j < s.length && LINE_SPACE.test(s[j])) j++;
    const q = s[j] === "'" || s[j] === '"' ? s[j++] : '';
    const tagStart = j;
    while (j < s.length && WORD.test(s[j])) j++;
    const tag = s.slice(tagStart, j);
    const nl = tag && (!q || s[j] === q) ? nextNl(j) : -1;
    const end = nl === -1 ? -1 : closerEnd(tag, nl);
    if (end === -1) {
      i++;
      continue;
    }
    out += `${s.slice(from, i)} `;
    from = end;
    i = end - 1;
  }
  return out + s.slice(from);
}

// Each quoted string becomes '' ('...' literal; "..." with backslash escapes).
function blankQuotes(s) {
  let out = '';
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "'" && c !== '"') continue;
    let j = i + 1;
    if (c === "'") {
      j = s.indexOf("'", j);
      if (j === -1) j = s.length;
    } else {
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
    }
    out += `${s.slice(from, i)}''`;
    i = Math.min(j, s.length);
    from = i + 1;
  }
  return out + s.slice(from);
}

const WRAPPERS = [
  /^\(+\s*/,
  /^(do|then|else|time|exec|command|nohup)\s+/,
  /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/,
  /^env(\s+-\S+)*\s+/,
  /^uv\s+run(\s+--?\S+)*\s+/,
  /^python3?\s+-m\s+/,
];

export function commandSegments(command) {
  if (typeof command !== 'string' || command === '') return [];
  const flat = blankQuotes(dropHeredocs(command));
  return flat
    .split(/&&|\|\||;|\||\n/)
    .map((seg) => {
      let s = seg.trim();
      for (let changed = true; changed; ) {
        changed = false;
        for (const w of WRAPPERS) {
          const next = s.replace(w, '');
          if (next !== s) {
            s = next.trim();
            changed = true;
          }
        }
      }
      return s;
    })
    .filter(Boolean);
}

// patterns: regex sources anchored by this function at the segment start; case-sensitive.
export function matchesAtCommand(command, patterns) {
  const res = patterns.map((p) => new RegExp(`^(?:${p})`));
  return commandSegments(command).some((seg) => res.some((r) => r.test(seg)));
}
