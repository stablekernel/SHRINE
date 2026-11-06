// facts.json v1 (spec 5). Session and episode fields are filled from SP2 on;
// T0 without history writes them as empty arrays.
import { any, arr, bool, dict, int, literal, nullable, num, obj, oneOf, str, validate } from './validate.mjs';

export const CONFIG_KINDS = ['instruction', 'settings', 'hook', 'skill', 'agent', 'command', 'server', 'permission', 'memory'];
export const LAYERS = ['org', 'user', 'project', 'local'];

export const runSchema = obj({
  id: str,
  started_at: str,
  tool_version: str,
  harness: obj({ name: str, version: nullable(str) }),
  scope: obj({ projects: arr(str), from: nullable(str), to: nullable(str), history_consented: bool }),
  win_definition: nullable(str),
  seed: nullable(int),
});

export const shrineSchema = obj({ commit: str, manifest_sha: nullable(str), fetched_at: nullable(str) });

const configItem = obj(
  {
    path_scrubbed: str,
    kind: oneOf(CONFIG_KINDS),
    layer: oneOf(LAYERS),
    bytes: int,
    mtime: nullable(str),
    sha256: nullable(str),
    loaded_by: str,
  },
  { source: oneOf(['user', 'project', 'local', 'plugin', 'managed']), id: str },
);

const repo = obj({
  id: str,
  commits_in_window: int,
  commits_before_window: int,
  reverts: arr(any),
  fixups: arr(any),
  test_command_present: nullable(bool),
  work_left_open: arr(any),
});

const session = obj({
  id: str,
  project: str,
  start: str,
  end: str,
  turns: int,
  tokens: obj({ in: int, out: int, cache_read: int }),
  models: arr(str),
  subagent_share: num,
  compactions: int,
});

const episode = obj({
  id: str,
  session_id: str,
  root_turn_id: str,
  start: str,
  end: str,
  terminal: oneOf(['commit', 'pr', 'new_task', 'session_end', 'interrupt_switch']),
  human_turns: int,
  assistant_turns: int,
  interrupts: int,
  permission_answers: int,
  tokens: int,
  subagents: int,
  compactions: int,
  touched_files: arr(str),
  commits: arr(str),
  stratum: obj({ recency: str, project: str, size: str, outcome: str }),
  downstream: arr(obj({ kind: oneOf(['commit', 'revert', 'fixup', 'episode']), ref: str, delta_hours: num, link: oneOf(['hard', 'soft']) }), { max: 5 }),
  live_config_refs: arr(str),
  timeline: arr(obj({ t: str, label_scrubbed: str, kind: oneOf(['neutral', 'warn', 'resolve']) })),
  excerpts: obj({ root_prompt_scrubbed: nullable(str), corrections_scrubbed: arr(str) }),
});

export const factsSchema = obj(
  {
    schema_version: literal(1),
    run: runSchema,
    shrine: shrineSchema,
    config: arr(configItem),
    repos: arr(repo),
    sessions: arr(session),
    episodes: arr(episode),
    metrics: dict(any),
  },
  { setup: dict(any) },
);

export const validateFacts = (f) => validate(factsSchema, f);
