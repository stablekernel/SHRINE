// findings.json v1 (spec 5). T0-only fields that need judgment may be empty.
import { any, arr, bool, dict, int, literal, nullable, num, obj, oneOf, range, str, validate } from './validate.mjs';
import { runSchema, shrineSchema } from './facts.mjs';

export const TABS = ['amplify', 'working', 'worth_a_look'];
export const ATTRIBUTION = ['user', 'harness', 'model', 'unknown'];
export const PIVOT_KINDS = ['habit', 'instruction', 'skill', 'hook', 'gate', 'config'];
export const ICONS = ['check', 'up', 'layers', 'loop', 'hand', 'compass', 'grid', 'clock', 'repeat', 'bolt', 'book', 'wrench', 'arrow', 'scan'];

const shrineRef = obj(
  {
    entry_id: str,
    page_id: str,
    anchor: str,
    title: str,
    section: oneOf(['principle', 'pattern', 'stack', 'reference']),
    status: oneOf(['ratified', 'draft']),
    url_pinned: str,
    quote: str,
  },
  { url: str },
);

const timelineEvent = obj({ t: str, label_scrubbed: str, kind: oneOf(['neutral', 'warn', 'resolve']) }, { event_kind: str });

export const findingSchema = obj(
  {
    id: str,
    lens: oneOf(['config', 'usage', 'repo']),
    tab: oneOf(TABS),
    title: str,
    short: str,
    lead: str,
    icon: oneOf(ICONS),
    provenance: oneOf(['mechanical', 'judged']),
    attribution: oneOf(ATTRIBUTION),
    confidence: obj({ value: range(0, 1), label: oneOf(['high', 'medium', 'low']), basis: str }),
    severity: obj({
      tokens_attributable: nullable(num),
      human_turns_attributable: nullable(num),
      delay_minutes: nullable(num),
      label: oneOf(['high', 'medium', 'low']),
    }),
    recurrence: obj({ hits: nullable(int), sample: nullable(int), stratum: nullable(str), control_rate: nullable(num) }),
    evidence: arr(
      obj({ kind: oneOf(['mechanical', 'judge']), locator: str, metric: nullable(str) }, {
        verdict: nullable(str),
        judge_confidence: nullable(num),
        excerpt_scrubbed: nullable(str),
      }),
      { min: 1 },
    ),
    anchor: str,
    counter_reading: nullable(obj({ text: str, rejected_because: str })),
    adversarial: nullable(obj({ verdict: oneOf(['keep', 'downgrade']), reason: str })),
    episode_ref: nullable(obj({ episode_id: str, timeline: arr(timelineEvent) })),
    why: arr(str, { min: 2, max: 3 }),
    problem: arr(str, { min: 2, max: 3 }),
    pivot: obj({
      kind: oneOf(PIVOT_KINDS),
      action: str,
      before_scrubbed: nullable(str),
      after_scrubbed: nullable(str),
      after_marks: arr(arr(int, { min: 2, max: 2 })),
      setup_note: str,
      source: oneOf(['user_prompt', 'shrine_generic']),
      minutes_to_apply: int,
    }),
    praise_class: nullable(oneOf(['outcome', 'structure'])),
    benefit: arr(obj({ headline: str, sub: str }), { max: 3 }),
    shrine_refs: arr(shrineRef, { min: 1 }),
    owner_label: str,
    timeline_gap: nullable(obj({ from_t: str, to_t: str, label: str })),
    coverage_key: str,
  },
  {
    entry_id: str,
    kind: str,
    items: arr(any),
    config_strip: nullable(obj({ mtime: nullable(str), last_git_change: nullable(str), sessions_since: nullable(int) })),
  },
);

const tldrItem = obj({ status: oneOf(['amplify', 'working']), headline: str, sentence: str, finding_id: str });

export const findingsSchema = obj(
  {
    schema_version: literal(1),
    run: runSchema,
    shrine: shrineSchema,
    tier: oneOf(['T0', 'T1', 'T2', 'T3']),
    reviewers: int,
    minutes_elapsed: num,
    tokens_used: int,
    headline: obj({
      counts: dict(int),
      tldr: arr(tldrItem, { max: 3 }),
      start_with: nullable(obj({ finding_id: str, action: str, minutes_to_apply: int }, { framed: bool })),
    }),
    coverage: arr(obj({ key: str, title: str, icon: oneOf(ICONS), group: oneOf(['principles', 'patterns', 'stack']), checked: bool, working: int, amplify: int, not_passed: int })),
    attribution_stack: nullable(obj({ setup: int, prompt: int, model: int, unknown: int })),
    findings: arr(findingSchema),
    worth_a_look: arr(findingSchema),
    checked_clear: arr(obj({ check: str, entry_id: str, guards_against: str }, { id: str, title: str, shrine_ref: shrineRef })),
    dropped: arr(obj({ id: str, reason: str })),
    configured: arr(obj({ item: str, count: int }, { detail: str })),
    control_slice: nullable(dict(any)),
    unknowable: arr(str),
    skipped_files: arr(obj({ path_scrubbed: str, reason: str })),
    integrity: obj({ ok: bool, changed_paths: arr(str) }),
  },
  {
    diff: nullable(obj({ new: int, cleared: int, unchanged: int })),
    notes: arr(str),
    run_limits: arr(str),
    git_history_skipped: int,
    thresholds: dict(any),
    history: obj({ consented: bool, read: bool, sessions: nullable(int) }),
    usage: obj({ counts: dict(num), kinds: arr(obj({ kind: str, ship: oneOf(['appendix', 'candidates']), hit: bool, metric: dict(any) }, { control: nullable(dict(any)) })), lines: arr(str) }, { automation: nullable(obj({ count: int, total: int, share: num })), limited: bool, excluded_own: bool }),
  },
);

export const validateFindings = (f) => validate(findingsSchema, f);
export const validateFinding = (f) => validate(findingSchema, f);
