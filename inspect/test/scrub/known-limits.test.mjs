// Pins the masking edge cases listed under "Known limits" in README.md. They are
// recorded, not fixed: a change here must be deliberate and update the README too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentifiers, mask, maskBase } from '../../src/scrub/mask.mjs';

const known = buildIdentifiers({ repos: ['acme.corp-api'] });

test('known limit: share-safe may over-mask words near a path', () => {
  assert.equal(mask('Read ~/work/api Then Stop', known), 'Read ~/<path>/<file>');
});

test('known limit: a path followed by a parenthesis can swallow the next word', () => {
  assert.equal(mask('~/work/api (git timed out)', known), '~/<path>/<file> timed out)');
});

test('known limit: a short lowercase name part after a dot is kept as an extension', () => {
  assert.equal(maskBase('acme.corp'), '<file>.corp');
});

test('known limit: an OS user named like a common word over-masks joined words', () => {
  assert.equal(mask('the test-runner ran', buildIdentifiers({ osUser: 'runner' })), 'the test-<user> ran');
});
