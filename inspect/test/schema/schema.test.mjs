import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateFacts, factsSchema } from '../../src/schema/facts.mjs';
import { validateFindings, findingsSchema, findingSchema } from '../../src/schema/findings.mjs';
import { validateCatalogue, catalogueSchema } from '../../src/schema/catalogue.mjs';
import * as min from './minimal.mjs';

const load = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

test('minimal valid objects pass', () => {
  assert.deepEqual(validateFacts(min.facts()).errors, []);
  assert.deepEqual(validateFindings(min.findings()).errors, []);
  assert.deepEqual(validateCatalogue(load('../../src/catalogue/catalogue.json')).errors, []);
});

function eachRequiredMissing(schema, make, prefix, validate) {
  for (const key of schema.required) {
    const obj = make();
    const target = prefix ? prefix(obj) : obj;
    delete target[key];
    const { errors } = validate(obj);
    const path = prefix ? `$.findings[0].${key}` : `$.${key}`;
    assert.ok(errors.some((e) => e.path === path && e.message === 'required'), `missing ${path} not reported`);
  }
}

test('each required facts field missing fails with its path', () => {
  eachRequiredMissing(factsSchema, min.facts, null, validateFacts);
});

test('each required findings field missing fails with its path', () => {
  eachRequiredMissing(findingsSchema, min.findings, null, validateFindings);
});

test('each required finding field missing fails with its path', () => {
  eachRequiredMissing(findingSchema, min.findings, (o) => o.findings[0], validateFindings);
});

test('each required catalogue field missing fails with its path', () => {
  eachRequiredMissing(catalogueSchema, () => load('../../src/catalogue/catalogue.json'), null, validateCatalogue);
});

test('schema_version must equal 1', () => {
  for (const [make, v] of [[min.facts, validateFacts], [min.findings, validateFindings]]) {
    const o = make();
    o.schema_version = 2;
    assert.ok(v(o).errors.some((e) => e.path === '$.schema_version'));
  }
});

test('findings need at least one shrine_ref', () => {
  const o = min.findings();
  o.findings[0].shrine_refs = [];
  assert.ok(validateFindings(o).errors.some((e) => e.path === '$.findings[0].shrine_refs'));
});

test('attribution and tab are enums', () => {
  const o = min.findings();
  o.findings[0].attribution = 'agent';
  o.findings[0].tab = 'leaking';
  const paths = validateFindings(o).errors.map((e) => e.path);
  assert.ok(paths.includes('$.findings[0].attribution'));
  assert.ok(paths.includes('$.findings[0].tab'));
});

test('T0 judgment-only fields may be empty', () => {
  const o = min.findings();
  Object.assign(o.findings[0], { counter_reading: null, adversarial: null, episode_ref: null, benefit: [] });
  o.findings[0].pivot.before_scrubbed = null;
  o.findings[0].pivot.after_scrubbed = null;
  assert.deepEqual(validateFindings(o).errors, []);
});

test('mock-density fixture is spec legal and matches the mock layout density', () => {
  const f = load('../fixtures/findings/mock-density.json');
  assert.deepEqual(validateFindings(f).errors, []);
  assert.equal(f.findings.filter((x) => x.tab === 'amplify').length, 4);
  assert.equal(f.findings.filter((x) => x.tab === 'working').length, 3);
  assert.equal(f.coverage.filter((c) => c.working + c.amplify > 0).length, 7);
  assert.equal(f.headline.tldr.length, 3);
  for (const x of f.findings.filter((y) => y.tab === 'working')) assert.equal(x.praise_class, 'structure');
  for (const x of f.findings.filter((y) => y.praise_class === 'structure')) assert.notEqual(x.confidence.label, 'high');
  const timelines = f.findings.filter((x) => x.episode_ref?.timeline?.length);
  assert.ok(timelines.length > 0, 'the mock carries timelines');
  assert.ok(timelines.every((x) => x.episode_ref.timeline.every((e) => !/\bCI\b/.test(e.label_scrubbed))), 'no CI events');
});
