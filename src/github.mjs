import { readFileSync } from 'node:fs';
import { MARKER } from './lib.mjs';

/** PR number from the webhook payload of a pull_request-style event, or null. */
export function pullRequestNumber(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const n = event?.pull_request?.number;
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Creates the Action's PR comment, or edits it when one with the marker already
 * exists, so repeated pushes never stack comments. Only comments written by a
 * bot count: a human pasting the marker cannot make us edit their comment.
 */
export async function upsertComment({ token, repository, number, body, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const base = `${apiUrl}/repos/${repository}/issues`;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
    'user-agent': 'dep-cooldown-action',
  };

  let existing = null;
  for (let page = 1; page <= 10 && !existing; page++) {
    const res = await fetchImpl(`${base}/${number}/comments?per_page=100&page=${page}`, { headers });
    if (!res.ok) throw new Error(`listing comments failed: HTTP ${res.status}`);
    const comments = await res.json();
    existing = comments.find((c) => c.user?.type === 'Bot' && typeof c.body === 'string' && c.body.startsWith(MARKER)) ?? null;
    if (comments.length < 100) break;
  }

  const res = existing
    ? await fetchImpl(`${base}/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetchImpl(`${base}/${number}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`${existing ? 'updating' : 'creating'} comment failed: HTTP ${res.status}`);
  return existing ? 'updated' : 'created';
}
