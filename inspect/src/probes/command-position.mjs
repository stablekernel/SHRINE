// Shell commands at command position (E5 amendment to T2.8): heredoc bodies and
// quoted strings are removed, the line is split at && || ; | and newlines, and
// leading wrappers (env assignments, env, time, do, then, uv run, python -m) are
// stripped. A pattern list then matches the start of each segment only, so a
// tool name inside a commit message, a grep argument, or prose never matches.
// Commands are agent-written text, so both scanners below run in linear time: a
// heredoc or quote with no end runs to the end of the command, as in a shell.

const WORD = /\w/;
const SPACE = /\s/;

// Each heredoc (`<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"`; rest of that line; body;
// the first later line that starts with TAG) becomes one space.
function dropHeredocs(s) {
  let out = '';
  let from = 0;
  // Starts only move forward, so one newline lookup serves every start before it.
  let nlAt = -2;
  const nextNl = (j) => (nlAt === -1 || nlAt >= j ? nlAt : (nlAt = s.indexOf('\n', j)));
  let i = s.indexOf('<<');
  while (i !== -1) {
    let j = i + 2;
    if (s[j] === '-') j++;
    while (j < s.length && SPACE.test(s[j])) j++;
    const q = s[j] === "'" || s[j] === '"' ? s[j++] : '';
    const tagStart = j;
    while (j < s.length && WORD.test(s[j])) j++;
    const tag = s.slice(tagStart, j);
    const nl = tag && (!q || s[j] === q) ? nextNl(j) : -1;
    if (nl === -1) {
      i = s.indexOf('<<', i + 1);
      continue;
    }
    let end = s.length;
    for (let k = s.indexOf('\n', nl + 1); k !== -1; ) {
      let m = k + 1;
      while (m < s.length && SPACE.test(s[m])) m++;
      if (s.startsWith(tag, m) && !WORD.test(s[m + tag.length] ?? '')) {
        end = m + tag.length;
        break;
      }
      k = s.indexOf('\n', m);
    }
    out += `${s.slice(from, i)} `;
    from = end;
    i = s.indexOf('<<', end);
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
