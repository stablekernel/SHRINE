// Shell commands at command position (E5 amendment to T2.8): heredoc bodies and
// quoted strings are removed, the line is split at && || ; | and newlines, and
// leading wrappers (env assignments, env, time, do, then, uv run, python -m) are
// stripped. A pattern list then matches the start of each segment only, so a
// tool name inside a commit message, a grep argument, or prose never matches.

const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
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
  const flat = command.replace(HEREDOC, ' ').replace(QUOTED, "''");
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
