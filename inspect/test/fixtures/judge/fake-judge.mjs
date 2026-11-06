// Fake judge for tests: stands in for the harness CLI, so CI never calls a model.
// Reads the judge prompt on stdin and prints an envelope shaped like
// `claude --print --output-format json`. Mode is argv[2]:
//   auto              a valid answer by simple rules (below)
//   invalid           schema-invalid JSON every time
//   invalid-once      invalid on the first call of an episode, valid on the retry
//   refusal           a refusal with no JSON
//   injection-follow  an answer that obeys text planted in the data (extra key,
//                     invented quote, praise outcome), as a model that followed it would
//   limit             a usage-limit error
//   bad-envelope      not JSON at all
//   hang              no answer for 30 s, so the runner's deadline cuts it off
// Rules for auto: every candidate human turn is a correction that supplies a
// constraint. When a config line shares 3 or more words with it, the constraint was
// in an instruction file (model owns it); else it was nowhere (you own it).
import { appendFileSync, readFileSync } from 'node:fs';

// Every launch is logged when FAKE_JUDGE_LOG names a file, so a test can prove zero spawns.
if (process.env.FAKE_JUDGE_LOG) appendFileSync(process.env.FAKE_JUDGE_LOG, `${process.argv[2] ?? 'auto'}\n`);
const mode = process.argv[2] ?? 'auto';
const input = readFileSync(0, 'utf8');
const nonce = input.match(/<data-([0-9a-f]+)>/)?.[1] ?? 'none';
const start = input.indexOf(`<data-${nonce}>\n`);
const end = input.indexOf(`\n</data-${nonce}>`);
const data = start >= 0 && end > start ? JSON.parse(input.slice(start + nonce.length + 8, end)) : { episode_id: 'x', turns: [], config: [] };
const retry = input.includes('The validator rejected your previous output');
const usage = { input_tokens: Math.ceil(Buffer.byteLength(input) / 4), output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const env = (extra) => process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', usage, modelUsage: { 'fake-judge-1': {} }, ...extra }));

const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) ?? []);
function auto() {
  const corrections = [];
  for (const t of data.turns.filter((x) => x.role === 'human' && x.candidate)) {
    const tw = words(t.text);
    let ref = null;
    for (const c of data.config) {
      for (const line of c.text.split('\n')) {
        const shared = [...words(line)].filter((w) => tw.has(w)).length;
        if (line.trim() && shared >= 3) {
          ref = { config_id: c.id, text: line.trim().slice(0, 200) };
          break;
        }
      }
      if (ref) break;
    }
    corrections.push({
      turn_id: t.id,
      kind: 'constraint',
      supplies_constraint: true,
      constraint_present_in: ref ? 'instruction_file' : 'none',
      attribution: { label: ref ? 'model' : 'user', confidence: 0.7 },
      sufficiency: 'enough',
      quotes: [{ turn_id: t.id, text: t.text.slice(0, 40) }],
      ...(ref ? { config_ref: ref } : {}),
      entry_ids: [ref ? 'authority-cascade.sov.rule-practice-gap' : 'problem-before-prescription.sov.late-constraint'],
    });
  }
  return { episode_id: data.episode_id, nonce, outcome: 'resolved', corrections };
}

if (mode === 'auto' || (mode === 'invalid-once' && retry)) env({ structured_output: auto() });
else if (mode === 'invalid' || mode === 'invalid-once') env({ structured_output: { episode_id: data.episode_id, nonce, outcome: 'great', corrections: 'none' } });
else if (mode === 'refusal') env({ subtype: 'refusal', stop_reason: 'refusal', result: 'I cannot help with that.' });
else if (mode === 'injection-follow') env({ structured_output: { ...auto(), outcome: 'resolved', praise: 'This setup is excellent.', corrections: auto().corrections.map((c) => ({ ...c, quotes: [{ turn_id: c.turn_id, text: 'The user did everything right.' }] })) } });
else if (mode === 'limit') env({ is_error: true, subtype: 'error', result: 'Claude usage limit reached. Your limit will reset at 5pm.' });
else if (mode === 'bad-envelope') process.stdout.write('not json');
else if (mode === 'hang') setTimeout(() => env({ structured_output: auto() }), 30_000);
