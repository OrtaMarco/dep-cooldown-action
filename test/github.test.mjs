import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pullRequestNumber, upsertComment } from '../src/github.mjs';
import { MARKER } from '../src/lib.mjs';

/** A fake GitHub: records calls and serves the given existing comments. */
function fakeGithub(comments) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => comments };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

const base = { token: 't', repository: 'o/r', number: 7, body: `${MARKER}\nhi` };

test('creates a comment when none carries the marker', async () => {
  const gh = fakeGithub([{ id: 1, user: { type: 'User' }, body: 'unrelated' }]);
  assert.equal(await upsertComment({ ...base, fetchImpl: gh.fetchImpl }), 'created');
  assert.equal(gh.calls.at(-1).method, 'POST');
  assert.match(gh.calls.at(-1).url, /issues\/7\/comments$/);
});

test('updates the existing bot comment instead of adding another', async () => {
  const gh = fakeGithub([{ id: 42, user: { type: 'Bot' }, body: `${MARKER}\nold` }]);
  assert.equal(await upsertComment({ ...base, fetchImpl: gh.fetchImpl }), 'updated');
  assert.equal(gh.calls.at(-1).method, 'PATCH');
  assert.match(gh.calls.at(-1).url, /issues\/comments\/42$/);
});

test('ignores a human comment that pastes the marker', async () => {
  const gh = fakeGithub([{ id: 5, user: { type: 'User' }, body: `${MARKER}\nspoof` }]);
  assert.equal(await upsertComment({ ...base, fetchImpl: gh.fetchImpl }), 'created');
});

test('surfaces HTTP failures', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => [] });
  await assert.rejects(upsertComment({ ...base, fetchImpl }), /HTTP 403/);
});

test('pullRequestNumber reads the event payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dca-'));
  const pr = join(dir, 'pr.json');
  const push = join(dir, 'push.json');
  writeFileSync(pr, JSON.stringify({ pull_request: { number: 12 } }));
  writeFileSync(push, JSON.stringify({ ref: 'refs/heads/main' }));
  assert.equal(pullRequestNumber(pr), 12);
  assert.equal(pullRequestNumber(push), null);
  assert.equal(pullRequestNumber(join(dir, 'missing.json')), null);
  assert.equal(pullRequestNumber(undefined), null);
});
