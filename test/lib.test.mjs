import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MARKER,
  cell,
  evaluate,
  parseBool,
  parseFailOn,
  parseIgnore,
  parseMinAge,
  parseVersion,
  renderMarkdown,
} from '../src/lib.mjs';

const row = (name, version, extra = {}) => ({
  name,
  version,
  direct: true,
  dev: false,
  published: '2026-10-05T00:00:00.000Z',
  ageDays: 1.2,
  provenance: false,
  deprecated: null,
  young: true,
  ...extra,
});

const sample = {
  format: 'package-lock.json v3',
  asOf: '2026-10-06T12:00:00.000Z',
  totals: { packages: 4 },
  rows: [
    row('left-pad', '2.0.0'),
    row('@scope/fix', '1.0.1'),
    row('mystery', '1.0.0', { young: false, ageDays: null, published: null, error: 'version not listed in registry' }),
    row('ms', '2.1.3', { young: false, ageDays: 900, published: '2024-04-01T00:00:00.000Z' }),
  ],
};

test('parseVersion accepts exact versions only', () => {
  assert.equal(parseVersion('0.1.0'), '0.1.0');
  assert.equal(parseVersion(' 1.2.3-rc.1 '), '1.2.3-rc.1');
  for (const bad of ['latest', '^0.1.0', '0.1', '', undefined, '0.1.0 && id']) {
    assert.throws(() => parseVersion(bad), /exact version/);
  }
});

test('parseMinAge, parseFailOn and parseBool reject junk', () => {
  assert.equal(parseMinAge('0.5'), '0.5');
  for (const bad of ['', '-1', '1e3', '7d', ' ']) assert.throws(() => parseMinAge(bad));
  assert.equal(parseFailOn(''), 'young');
  assert.equal(parseFailOn('unknown'), 'unknown');
  assert.throws(() => parseFailOn('always'));
  assert.equal(parseBool('TRUE', 'comment'), true);
  assert.equal(parseBool('', 'comment'), false);
  assert.throws(() => parseBool('yes', 'comment'));
});

test('parseIgnore splits lines and commas, strips comments, dedupes', () => {
  const list = parseIgnore('lodash@4.17.21, @scope/fix@1.0.1\n# security patch\nlodash@4.17.21 # again\n\n');
  assert.deepEqual(list, ['lodash@4.17.21', '@scope/fix@1.0.1']);
  assert.deepEqual(parseIgnore(''), []);
  assert.throws(() => parseIgnore('lodash'), /not name@version/);
  assert.throws(() => parseIgnore('a@1 b@2'), /not name@version/);
});

test('evaluate: young rows fail unless ignored', () => {
  const v = evaluate(sample, { ignore: [], failOn: 'young' });
  assert.equal(v.failed, true);
  assert.deepEqual(v.young.map((r) => r.name), ['left-pad', '@scope/fix']);
  assert.deepEqual(v.unknown.map((r) => r.name), ['mystery']);
});

test('evaluate: ignore removes a row and a fully ignored set passes', () => {
  const v = evaluate(sample, { ignore: ['left-pad@2.0.0', '@scope/fix@1.0.1'], failOn: 'young' });
  assert.equal(v.failed, false);
  assert.equal(v.ignored.length, 2);
  assert.equal(v.young.length, 0);
});

test('evaluate: ignore is exact on version and reports unused entries', () => {
  const v = evaluate(sample, { ignore: ['left-pad@2.0.1', 'ms@2.1.3'], failOn: 'young' });
  assert.equal(v.failed, true);
  assert.deepEqual(v.unusedIgnores, ['left-pad@2.0.1', 'ms@2.1.3']);
});

test('evaluate: fail-on unknown fails on unchecked rows; never never fails', () => {
  const onlyUnknown = { ...sample, rows: [sample.rows[2], sample.rows[3]] };
  assert.equal(evaluate(onlyUnknown, { ignore: [], failOn: 'young' }).failed, false);
  assert.equal(evaluate(onlyUnknown, { ignore: [], failOn: 'unknown' }).failed, true);
  assert.equal(evaluate(onlyUnknown, { ignore: ['mystery@1.0.0'], failOn: 'unknown' }).failed, false);
  assert.equal(evaluate(sample, { ignore: [], failOn: 'never' }).failed, false);
});

test('cell escapes markdown and table breakers', () => {
  assert.equal(cell('a|b\n`c`'), 'a\\|b \\`c\\`');
  assert.equal(cell('x'.repeat(500)).length, 200);
});

test('renderMarkdown: failing report', () => {
  const verdict = evaluate(sample, { ignore: ['@scope/fix@1.0.1'], failOn: 'young' });
  const md = renderMarkdown(sample, verdict, { minAgeDays: '7', failOn: 'young', version: '0.1.0' });
  assert.ok(md.startsWith(MARKER));
  assert.match(md, /❌ Dependency cooldown: 1 package version\(s\) are younger than 7 days/);
  assert.match(md, /\| left-pad \| 2\.0\.0 \|/);
  assert.match(md, /\| 2026-10-05 \| 1\.2 d \| yes \|/);
  assert.match(md, /### Accepted exceptions/);
  assert.match(md, /### Could not be checked/);
  assert.match(md, /version not listed in registry/);
});

test('renderMarkdown: passing report is short and flags unused ignores', () => {
  const clean = { ...sample, rows: [sample.rows[3]] };
  const verdict = evaluate(clean, { ignore: ['gone@1.0.0'], failOn: 'young' });
  const md = renderMarkdown(clean, verdict, { minAgeDays: '7', failOn: 'young', version: '0.1.0' });
  assert.match(md, /✅ Dependency cooldown: No package version is younger than 7 days/);
  assert.doesNotMatch(md, /### Too new/);
  assert.match(md, /matched nothing/);
});

test('renderMarkdown truncates long tables', () => {
  const many = { ...sample, rows: Array.from({ length: 80 }, (_, i) => row(`p${i}`, '1.0.0')) };
  const verdict = evaluate(many, { ignore: [], failOn: 'young' });
  const md = renderMarkdown(many, verdict, { minAgeDays: '7', failOn: 'young', version: '0.1.0' });
  assert.match(md, /…and 30 more\./);
});
