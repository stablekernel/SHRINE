// Judge output validation (plan T1 task 3). Strict schema (unknown keys and
// wrong types rejected), then checks against the bundle the judge was given:
// episode id and nonce echoed, every turn id real, corrections only on human
// turns, every quote an exact copy from its turn, config refs an exact copy from
// their block, entry ids in the catalogue. Error messages name paths and codes
// only, never a value from the output, so a retry prompt carries no judge text.
import { fileURLToPath } from 'node:url';
import { readJson } from '../io/fsread.mjs';

export const CLASSIFIER_SCHEMA = readJson(fileURLToPath(new URL('./classifier.schema.json', import.meta.url)));
export const JUDGED_ENTRY_IDS = CLASSIFIER_SCHEMA.properties.corrections.items.properties.entry_ids.items.enum;

// The subset of JSON Schema the classifier schema uses.
export function checkSchema(schema, v, path = '$', errors = []) {
  const err = (code) => errors.push(`${path}: ${code}`);
  const t = schema.type;
  if (t === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return err('expected object'), errors;
    for (const k of schema.required ?? []) if (!(k in v)) err(`missing ${k}`);
    for (const k of Object.keys(v)) {
      const s = schema.properties && Object.hasOwn(schema.properties, k) ? schema.properties[k] : null;
      if (!s) {
        if (schema.additionalProperties === false) errors.push(`${path}: unexpected key`);
        continue;
      }
      checkSchema(s, v[k], `${path}.${k}`, errors);
    }
  } else if (t === 'array') {
    if (!Array.isArray(v)) return err('expected array'), errors;
    if (schema.maxItems != null && v.length > schema.maxItems) err('too many items');
    v.forEach((x, i) => checkSchema(schema.items, x, `${path}[${i}]`, errors));
  } else if (t === 'string') {
    if (typeof v !== 'string') return err('expected string'), errors;
    if (schema.enum && !schema.enum.includes(v)) err('not an allowed value');
    if (schema.maxLength != null && v.length > schema.maxLength) err('too long');
    if (schema.minLength != null && v.length < schema.minLength) err('too short');
  } else if (t === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v)) return err('expected number'), errors;
    if (schema.minimum != null && v < schema.minimum) err('below minimum');
    if (schema.maximum != null && v > schema.maximum) err('above maximum');
  } else if (t === 'boolean') {
    if (typeof v !== 'boolean') err('expected boolean');
  }
  return errors;
}

// output: parsed judge JSON (or null). bundle: the bundle sent. catalogueIds: a
// Set of entry ids in the bundled catalogue. Returns {ok, errors, output} where
// output is a clean copy holding only schema fields, with each quote resolved to
// its offsets in the turn ({turn_id, start, end, text}).
export function validateJudgment(output, bundle, { catalogueIds = new Set(JUDGED_ENTRY_IDS) } = {}) {
  if (output == null) return { ok: false, errors: ['$: no JSON object'], output: null };
  const errors = checkSchema(CLASSIFIER_SCHEMA, output);
  if (errors.length) return { ok: false, errors, output: null };
  if (output.episode_id !== bundle.episode_id) errors.push('$.episode_id: does not match the bundle');
  if (output.nonce !== bundle.nonce) errors.push('$.nonce: does not match the bundle');
  const turns = new Map(bundle.turns.map((t) => [t.id, t]));
  const configs = new Map(bundle.config.map((c) => [c.id, c]));
  const seen = new Set();
  const corrections = output.corrections.map((c, i) => {
    const p = `$.corrections[${i}]`;
    const turn = turns.get(c.turn_id);
    if (!turn) errors.push(`${p}.turn_id: no such turn`);
    else if (turn.role !== 'human') errors.push(`${p}.turn_id: not a human turn`);
    if (seen.has(c.turn_id)) errors.push(`${p}.turn_id: repeated`);
    seen.add(c.turn_id);
    const quotes = c.quotes.map((q, j) => {
      const qt = turns.get(q.turn_id);
      const at = qt ? qt.text.indexOf(q.text) : -1;
      if (!qt) errors.push(`${p}.quotes[${j}].turn_id: no such turn`);
      else if (at < 0) errors.push(`${p}.quotes[${j}].text: not an exact copy from that turn`);
      return { turn_id: q.turn_id, start: at, end: at + q.text.length, text: q.text };
    });
    let configRef = null;
    if (c.config_ref) {
      const cfg = configs.get(c.config_ref.config_id);
      const at = cfg ? cfg.text.indexOf(c.config_ref.text) : -1;
      if (!cfg) errors.push(`${p}.config_ref.config_id: no such config block`);
      else if (at < 0) errors.push(`${p}.config_ref.text: not an exact copy from that block`);
      configRef = { config_id: c.config_ref.config_id, start: at, end: at + c.config_ref.text.length };
    }
    for (const [j, e] of c.entry_ids.entries()) if (!catalogueIds.has(e)) errors.push(`${p}.entry_ids[${j}]: not in the catalogue`);
    return {
      turn_id: c.turn_id,
      kind: c.kind,
      supplies_constraint: c.supplies_constraint,
      constraint_present_in: c.constraint_present_in,
      attribution: { label: c.attribution.label, confidence: c.attribution.confidence },
      sufficiency: c.sufficiency,
      quotes,
      config_ref: configRef,
      entry_ids: [...c.entry_ids],
    };
  });
  if (errors.length) return { ok: false, errors, output: null };
  return { ok: true, errors: [], output: { episode_id: output.episode_id, nonce: output.nonce, outcome: output.outcome, corrections } };
}
