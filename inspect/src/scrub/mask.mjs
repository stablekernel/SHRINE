// Share-safe masking (spec 7): a known-identifier list built from facts (OS user,
// git authors and emails, home segments, project, repo, and org names) replaced by
// stable placeholders; then emails, hostnames, IPs, and paths (absolute, UNC, relative, remote). No
// free-text name detection. Ticket IDs are left as they are.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// vocabulary: words of the tool's own copy. A name equal to one (a project called
// "skills") is masked only where it stands alone as a whole value, so the report's
// own labels and sentences stay readable.
export function buildIdentifiers({ osUser = null, home = null, authors = [], projects = [], repos = [], orgs = [], vocabulary = [] } = {}) {
  const ids = [];
  const vocab = new Set(vocabulary.map((w) => w.toLowerCase()));
  // Each value in both Unicode forms: "Zoë" typed as one code point (NFC) or as
  // "e" plus a combining mark (NFD) is the same name.
  const add = (value, placeholder) => {
    if (typeof value !== 'string' || value.length < 2) return;
    for (const v of new Set([value, value.normalize('NFC'), value.normalize('NFD')])) {
      if (!ids.some((i) => i.value === v)) ids.push({ value: v, placeholder, exact: vocab.has(v.toLowerCase()) });
    }
  };
  const numbered = (values, prefix) =>
    [...new Set(values.filter((v) => typeof v === 'string' && v).map((v) => v.normalize('NFC')))].sort().forEach((v, i) => add(v, `<${prefix}-${i + 1}>`));

  numbered(authors.map((a) => a.email), 'author-email');
  numbered(authors.map((a) => a.name), 'author');
  numbered(projects, 'project');
  numbered(repos.filter((r) => !projects.includes(r)), 'repo');
  numbered(orgs, 'org');
  if (osUser) add(osUser, '<user>');
  for (const seg of (home ?? '').split(/[\\/]/).filter((s) => s && !['Users', 'home', 'root'].includes(s))) {
    add(seg, '<user>');
    add(seg.replace(/[^A-Za-z0-9-]/g, '-'), '<user>');
  }
  // Longest first, so "shop-api-v2" is masked before "shop-api".
  ids.sort((a, b) => b.value.length - a.value.length);
  return { home, ids };
}

// Linear time on untrusted text: an email starts only where its run of local-part
// characters starts, and both parts are bounded (64 and 253, the address limits),
// so a long "a.a.a." run is scanned once, not once per start position.
// Letters in any script ("zoë@exämple.de").
const EMAIL = /(?<![\p{L}\p{N}\p{M}._%+-])[\p{L}\p{N}\p{M}._%+-]{1,64}@[\p{L}\p{N}\p{M}.-]{1,253}\.\p{L}{2,63}(?![\p{L}\p{N}\p{M}_])/gu;
// A bracketed IPv6 host ("http://[fe80::1]:8080/x"), with an optional zone.
const IPV6 = /\[(?=[0-9A-Fa-f.]{0,45}:)[0-9A-Fa-f:.]{2,45}(?:%[\w.-]{1,32})?\]/g;
// A URL's user and host ("ssh://deploy@buildbox:22/x", "s3://initech-bucket/x"): a
// host with no TLD or a user name can name a client. Placeholders stay.
const URL_AUTH = /(?<![\p{L}\p{N}+.-])([A-Za-z][A-Za-z0-9+.-]{0,15}:\/\/)(?:(<[\w-]{1,32}>|[^\s/?#@[\]<>]{1,64})@)?(<[\w-]{1,32}>|[^\s/?#:@[\]<>]{1,253})/gu;
// An scp remote on a host alias with no TLD ("git@github-work:acme/app.git",
// "deploy@buildbox:22/srv/x"): user@alias then a colon and a path (not a port alone).
// It reads as an email, so REMOTE_PATH masks the path after it. Not after "://",
// where URL_AUTH has already masked user and host.
const SCP_ALIAS = /(?<![\p{L}\p{N}\p{M}._%+/-])(?:<[\w-]{1,32}>|[A-Za-z0-9._%+-]{1,64})@(?:<[\w-]{1,32}>|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252}))(?=:(?:\d{1,5}\/|[^\s\d\\/:]))/gu;
const urlAuth = (_m, scheme, user, host) => `${scheme}${user ? `${user.startsWith('<') ? user : '<user>'}@` : ''}${host.startsWith('<') ? host : '<host>'}`;
// A query or fragment after a masked host and its path: values name clients
// ("?client=Initech"). The run ends at whitespace, plus capitalized words after it
// ("?client=Initech Corp").
const QUERY = /(<(?:host|ip|email)>(?::\d{1,5})?(?:[\\/](?:<[\w-]{1,32}>|[^\s?#<>\\/])*)*)([?#])\S*(?:[  ][\p{Lu}\p{N}&(]\S*){0,15}/gu;
const query = (_m, pre, mark) => `${pre}${mark === '?' ? '?<query>' : '#<fragment>'}`;
// A fixed number of bounded parts: constant work per start.
const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const TLDS = 'com|net|org|io|dev|ai|app|co|us|uk|de|fr|cloud|internal|local|lan|corp|edu|gov|info|biz|xyz|sh|me|tech|example';
// A host starts only where its run of labels starts (not after a letter, digit,
// hyphen, or a label's dot), so a long "x-x.x-x." run is tried once and backtracks
// one label at a time.
const HOST = new RegExp(`(?<![A-Za-z0-9-])(?<![A-Za-z0-9-]\\.)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+(?:${TLDS})\\b`, 'g');
// Home paths keep only .claude and the file name; other folders name clients and repos.
// A folder runs to the next separator: any character but a separator (emoji, tabs,
// newlines, runs of spaces, ;|*"^`:? and the like), and whitespace only where no
// new path starts after it, so "see /a or /b" stays two paths. A folder ends at a
// character it cannot hold, so each folder is scanned once and matching is linear.
// The file name is stricter: in prose, spaces and closing punctuation end it.
// Punctuation counts inside a name only when a name character follows it
// ("Initech;plan.md", "O'Brien"), so quotes and parentheses around a path stay. A
// file name with no extension takes on further words that start with a capital, a
// digit, "&", or "(" ("Acme Corp"), since a folder named last in prose has no
// slash to show where it ends.
const WORD = String.raw`(?:[\p{L}\p{N}\p{M}_.@+&(),#%=!$\[\]{}<>-]|(?<=\p{L})['’](?=\p{L}))`;
const PATH_START = String.raw`["'(\[<\x60]?(?:[\\/~$%]|[A-Za-z]:[\\/])`;
const FOLDER = String.raw`[^\\/\s](?:[^\\/\s]|\s(?!${PATH_START}))*`;
// The first folder at the root starts with a name character, so code ("/[a-z]/",
// a closing "/>") is not read as a path.
const ROOT_FOLDER = String.raw`[\p{L}\p{N}\p{M}_.@#$&+=~-](?:[^\\/\s]|\s(?!${PATH_START}))*`;
// A name with no extension also takes on lowercase words when a later word in the
// same run ends in an extension ("q3 globex merger.md"): the shortest such run, up
// to 8 words. An extension needs a letter, so "v1.2" does not end the run.
const NAME_CH = String.raw`[\p{L}\p{N}\p{M}_.@+&#%=~<>-]`;
const INNER = String.raw`(?:${NAME_CH}|[,;'()\[\]](?=[\p{L}\p{N}_(\[]|\.[\p{L}\p{N}])|:(?=[\p{L}_]))`;
const EXT_END = String.raw`\.(?=[A-Za-z0-9]{0,7}[A-Za-z])[A-Za-z0-9]{1,8}(?=\.*(?!${NAME_CH}))`;
const EXT_RUN = String.raw`(?:[  ]${INNER}{1,255}){0,7}?[  ]${INNER}{0,255}?${EXT_END}`;
const BASE = String.raw`(${INNER}*)(${EXT_RUN}|(?:[  ][\p{Lu}\p{Lt}\p{N}&(]${WORD}{0,254}){0,15})`;
const HOME_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_.~<>-])~[\\/]((?:${FOLDER}[\\/])*)${BASE}`, 'gu');
const collapse = (dirs) => {
  const kept = [];
  for (const seg of dirs) {
    if (seg === '.claude') kept.push(seg);
    else if (kept.at(-1) !== '<path>') kept.push('<path>');
  }
  return kept.map((k) => `${k}/`).join('');
};
// File names the harness itself defines (adapters/claude-code) stay; any other
// name may name a client ("acme-contract.md"), so only its extension survives.
const TOOL_FILES = new Set(['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'MEMORY.md', 'SKILL.md', 'settings.json', 'settings.local.json', '.mcp.json', 'installed_plugins.json']);
const TOOL_NAMES = [...TOOL_FILES];
const LONG_EXTS = new Set(['jsonl', 'jsonc', 'markdown', 'numbers', 'pages', 'ipynb', 'swift', 'scala', 'xhtml', 'local', 'example', 'sample', 'backup', 'patch', 'plist', 'proto', 'graphql', 'vue', 'svelte', 'astro']);
const SHORT_EXTS = new Set(['md', 'mdx', 'txt', 'rtf', 'doc', 'docx', 'odt', 'pdf', 'xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'ppt', 'pptx', 'odp', 'key', 'eml', 'msg', 'json', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tif', 'tiff', 'heic', 'mp3', 'mp4', 'mov', 'wav', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'dmg', 'pkg', 'log', 'env', 'lock', 'tmp', 'bak', 'lua', 'pl', 'r', 'm']);
const keepsExt = (e) => SHORT_EXTS.has(e.toLowerCase()) || LONG_EXTS.has(e.toLowerCase()) || /^[a-z0-9]{1,4}$/.test(e);
const SESSION_FILE =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;
export function maskBase(base) {
  // A sentence's closing period is not part of the name. A loop, not /(\.*)$/,
  // which rescans every dot run to its end: quadratic on a long run of dots.
  const s = base ?? '';
  let end = s.length;
  while (end > 0 && s[end - 1] === '.') end--;
  const name = s.slice(0, end);
  const tail = s.slice(end);
  if (!name || TOOL_FILES.has(name) || SESSION_FILE.test(name) || /^<[\w-]+>$/.test(name)) return base;
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name.slice(1));
  // An extension can be part of a name (".env.initech", "Initech.Corp"): only known
  // ones stay, and short all-lowercase ones, as file extensions are written.
  if (ext && !keepsExt(ext[1])) ext[1] = null;
  return `${ext?.[1] ? `<file>.${ext[1]}` : '<file>'}${tail}`;
}
// The words after a file name are part of it only when it has no extension; a run
// that ends in an extension is masked as one name with that extension.
const fileName = (base, more) => {
  if (!base || /\.[A-Za-z0-9]{1,8}\.*$/.test(base)) return `${maskBase(base)}${more}`;
  return /\.[A-Za-z0-9]{1,8}$/.test(more) ? maskBase(`${base}${more}`) : maskBase(base);
};
const dirList = (dirs) => (dirs ?? '').split(/[\\/]/).filter(Boolean);
const homePath = (_m, dirs, base, more) => `~/${collapse(dirList(dirs))}${fileName(base, more)}`;
const ABS_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_~.<>-])\/${ROOT_FOLDER}[\\/](?:${FOLDER}[\\/])*${BASE}`, 'gu');
// Windows drive paths, with either separator.
const WIN_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_])[A-Za-z]:(?:[\\/](?:${FOLDER}[\\/])+|[^\\/\s:]+[\\/](?:${FOLDER}[\\/])*)${BASE}`, 'gu');
const otherPath = (_m, base, more) => `<path>/${fileName(base, more)}`;
const PROJECT_FOLDER = /(\.claude\/projects\/)[^/\s"'<>]+/g;
// A path that starts where a word can: after whitespace, a quote, or a bracket.
const AT_START = String.raw`(?<![^\s"'(\[\x60=])`;
// UNC shares (\\server\share\x) and their forward-slash form (//server/share/x).
const UNC_PATH = new RegExp(String.raw`${AT_START}[\\/]{2}(?=[^\\/\s])(?:${FOLDER}[\\/])+${BASE}`, 'gu');
// Paths under an environment variable ($HOME/x, ${HOME}/x, %USERPROFILE%\x): the
// variable stays, the folders do not.
const ENV_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}_$%])(\$\{?[A-Za-z_]\w{0,63}\}?|%[A-Za-z_]\w{0,63}%)[\\/]((?:${FOLDER}[\\/])*)${BASE}`, 'gu');
const envPath = (_m, v, dirs, base, more) => `${v}/${collapse(dirList(dirs))}${fileName(base, more)}`;
// Another user's home (~initech/x) names that user.
const USER_HOME = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_.~<>-])~[\p{L}\p{N}_][\p{L}\p{N}\p{M}_.-]*[\\/](?:${FOLDER}[\\/])*${BASE}`, 'gu');
// The path after a host, an IP and port, or an scp remote (git@host:org/repo.git).
// An scp colon needs a non-digit after it, so "host:8080" stays a port.
const REMOTE_PATH = new RegExp(String.raw`(<(?:email|host|ip)>)((?::\d{1,5})?\/|:(?=[^\s\d\\/]))((?:(?:[^\\/\s<>:]|<[\w-]{1,32}>)+[\\/])*)${BASE}`, 'gu');
const remotePath = (_m, at, sep, dirs, base, more) => `${at}${sep}${collapse(dirList(dirs))}${fileName(base, more)}`;
// A folder alone at the root ("/initech"). Built-in slash commands stay.
const SLASH_COMMANDS = new Set(['add-dir', 'agents', 'approve', 'bug', 'clear', 'compact', 'config', 'context', 'cost', 'doctor', 'exit', 'export', 'help', 'hooks', 'ide', 'init', 'login', 'logout', 'mcp', 'memory', 'model', 'permissions', 'plugin', 'pr-comments', 'release-notes', 'resume', 'review', 'rewind', 'security-review', 'status', 'statusline', 'terminal-setup', 'todos', 'usage', 'vim']);
const ROOT_DIR = new RegExp(String.raw`${AT_START}\/([\p{L}\p{N}_][\p{L}\p{N}\p{M}_.-]*)(?![\\/\p{L}\p{N}\p{M}_.-])`, 'gu');
// Relative paths (../x/y, ./x, a/b/c.md, Hooli Plans/CLAUDE.md). A slash between
// two words is prose ("A/B", "and/or", "3/5"), so a relative path needs a leading
// ./ or ../, two separators, or a file extension, and a letter. Up to two
// capitalized words before the first folder belong to it ("Hooli Plans/").
const REL_PATH = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_.~<>@:$%+&#=\\/-])(?:(\.{1,2}[\\/])|((?:[\p{Lu}\p{N}][\p{L}\p{N}\p{M}_&'’-]{0,63}[  ]){0,2})([\p{L}\p{N}\p{M}_.][\p{L}\p{N}\p{M}_.@+&#%=-]*[\\/]))((?:${FOLDER}[\\/])*)${BASE}`, 'gu');
const relPath = (m, dots, prefix, first, dirs, base, more) => {
  const segs = dirList(`${first ?? ''}${dirs}`);
  const seps = (first ? 1 : 0) + (dirs.match(/[\\/]/g) ?? []).length;
  const ext = /\.[A-Za-z][A-Za-z0-9]{0,7}\.*$/.test(base) || /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(more);
  if (!dots && ((!ext && seps < 2) || !/\p{L}/u.test(`${first}${dirs}${base}`))) return m;
  return `${first?.startsWith('.') ? prefix : ''}${segs.length ? collapse(segs) : dots}${fileName(base, more)}`;
};
// Document names in prose ("Initech Merger (draft).docx", "q3 globex plan.md").
// Where such a name starts is unknowable, so every word before it back to a
// separator (start, sentence end, comma, quote, and the like) goes with it: masking
// prose beats leaking a name. A run starts only right after a separator, never
// inside a run of words, so each run is scanned once. Tool and generic repo file
// names stay.
const DOC_EXT = 'md|mdx|markdown|txt|rtf|docx?|odt|pdf|pages|xlsx?|xlsm|ods|csv|tsv|numbers|pptx?|odp|key|eml|msg';
const GENERIC_FILES = new Set(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE.md', 'LICENSE.txt', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'llms.txt', 'requirements.txt', 'robots.txt']);
const DOC_SEP = String.raw`[ \t  ]{1,8}`;
const DOC_WORD = String.raw`[\p{L}\p{N}\p{M}_&'’()-]`;
// A run never starts with "(", and starts after "(" only where that "(" opens a
// run itself ("[x](<file>.md)"), not inside one ("see (a b.md)"): each run is then
// scanned from one start. The name before the extension takes at most one
// parenthesized part ("Merger (draft)"), so it never spans "(a).(a)." runs.
const DOC_NAME = String.raw`(?:[\p{L}\p{N}\p{M}_][\p{L}\p{N}\p{M}_.@+&#%=-]*?)?(?:\([\p{L}\p{N}\p{M}_.&'’ -]{0,64}\))?`;
const BARE_NAME = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_.~<>@:$%+&#=\\/'’)-]|[\p{L}\p{N}\p{M}_~<>@$%+&#=\\/'’()-]${DOC_SEP}|[\p{L}\p{N}\p{M}_ \t  ]\()(?!\()(?:${DOC_WORD}{1,255}${DOC_SEP})*(?=[\p{L}\p{N}\p{M}_(])(${DOC_NAME})\.(${DOC_EXT})(?![\p{L}\p{N}\p{M}_-])`, 'giu');
const bareName = (m, name, ext) => (TOOL_FILES.has(`${name}.${ext}`) || GENERIC_FILES.has(`${name}.${ext}`) ? m : `<file>.${ext}`);

// Home prefix to "~" only at a path boundary: home /Users/bob must not turn
// /Users/bobby/x into "~by/x".
export function underHome(path, home) {
  if (!home || typeof path !== 'string') return null;
  const h = home.replace(/[\\/]+$/, '');
  if (path === h) return '';
  return path.startsWith(h) && /^[\\/]/.test(path.slice(h.length)) ? path.slice(h.length) : null;
}

// Locator words the scorer writes itself (the stack-gap kinds and the setup row).
const LOCATOR_WORDS = new Set(['setup', 'hooks', 'skills', 'memory']);
const LINE_ANCHOR = /#L\d+(?:-L?\d+)?/;

// Masks a value known to be a path, segment by segment, so folder names with spaces
// or any other characters never survive. Every value is split on separators, so a
// relative path or a free-form value never falls back to the looser free-text
// rules; a value with no separator is a file name. An anchor keeps only its #Lnn.
export function maskPath(value, known) {
  if (typeof value !== 'string' || value === '') return value;
  const anchor = LINE_ANCHOR.exec(value);
  if (anchor) {
    const before = value.slice(0, anchor.index).trimEnd();
    return `${before ? maskPath(before, known) : ''}${anchor[0]}`;
  }
  // A known identifier (a project named "skills") is masked even when it is also a
  // locator word or tool name: the whole value is that name.
  const id = known?.ids?.find((i) => i.value === value);
  if (id) return id.placeholder;
  if (!/[\\/]/.test(value)) return LOCATOR_WORDS.has(value) || TOOL_FILES.has(value) ? value : maskBase(mask(value, known));
  let p = value.replace(PROJECT_FOLDER, '$1<project-folder>');
  const rest = underHome(p, known?.home);
  if (rest != null) p = `~${rest}`;
  const segs = p.split(/[\\/]/);
  const last = segs.pop();
  // Tool names first: the host rule would read "CLAUDE.local.md" as a hostname.
  const base = TOOL_FILES.has(last) ? last : maskBase(mask(last, known));
  const head = segs[0];
  const lead = head === '~' ? '~/' : head === '' || /^[A-Za-z]:$/.test(head) ? '/' : '';
  const dirs = lead ? segs.slice(1) : segs;
  const kept = collapse(dirs.filter(Boolean));
  if (lead === '/' && kept.startsWith('<path>')) return `${kept}${base}`;
  return `${lead}${kept}${base}`;
}

export function mask(text, known) {
  if (typeof text !== 'string' || text === '') return text;
  // Claude Code project folders encode the full cwd (home, org, and repo names).
  let out = text.replace(PROJECT_FOLDER, '$1<project-folder>');
  // The home only where a path starts (not inside /Volumes/x/Users/bob) and only up
  // to a separator or the end (not /Users/bob-acme), the underHome rule in free text.
  if (known?.home) out = out.replace(new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_.~<>\\/-])${esc(known.home.replace(/[\\/]+$/, ''))}(?=[\\/]|$)`, 'gu'), '~');
  out = out.replace(EMAIL, (m) => known?.ids.find((i) => i.value === m)?.placeholder ?? '<email>');
  for (const { value, placeholder, exact } of known?.ids ?? []) {
    if (exact) {
      if (out === value) out = placeholder;
      continue;
    }
    out = out.replace(new RegExp(`(?<![\\w-])${esc(value)}(?![\\w-])`, 'g'), placeholder);
  }
  out = out.replace(IPV4, '<ip>');
  // "CLAUDE.local.md" and "settings.local.json" are file names, not hosts.
  out = out.replace(HOST, (m, at, s) => (TOOL_NAMES.some((n) => s.startsWith(n, at)) ? m : '<host>'));
  out = out.replace(IPV6, '<ip>');
  out = out.replace(URL_AUTH, urlAuth);
  out = out.replace(SCP_ALIAS, '<email>');
  out = out.replace(REMOTE_PATH, remotePath);
  out = out.replace(QUERY, query);
  out = out.replace(UNC_PATH, otherPath);
  out = out.replace(ENV_PATH, envPath);
  out = out.replace(USER_HOME, otherPath);
  out = out.replace(WIN_PATH, otherPath);
  out = out.replace(HOME_PATH, homePath);
  out = out.replace(ABS_PATH, otherPath);
  out = out.replace(ROOT_DIR, (m, name) => (SLASH_COMMANDS.has(name) ? m : '<path>'));
  out = out.replace(REL_PATH, relPath);
  out = out.replace(BARE_NAME, bareName);
  return out;
}

// Keys whose values are file paths (or, for project, cwds, and the like, may be):
// masked segment by segment. A value that does not look like a path falls back to mask().
const PATH_KEYS = new Set(['path', 'paths', 'path_scrubbed', 'locator', 'anchor', 'changed_paths', 'cwd', 'cwds', 'touched_files', 'root', 'roots', 'project', 'projects', 'repo', 'file', 'files', 'dir']);
const KEEP = new Set(['shrine_refs', 'shrine_ref', 'shrine', 'url', 'url_pinned', 'entry_id', 'page_id', 'id', 'finding_id', 'item']);

export function maskDeep(value, known, key = '') {
  if (KEEP.has(key)) return value;
  if (typeof value === 'string') return PATH_KEYS.has(key) ? maskPath(value, known) : mask(value, known);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, known, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, known, k)]));
  return value;
}
