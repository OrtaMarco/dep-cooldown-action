import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { pullRequestNumber, upsertComment } from './github.mjs';
import {
  evaluate,
  parseBool,
  parseFailOn,
  parseIgnore,
  parseMinAge,
  parseVersion,
  renderMarkdown,
} from './lib.mjs';

const run = promisify(execFile);
const env = process.env;

const escapeCmd = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const error = (msg) => process.stdout.write(`::error::${escapeCmd(msg)}\n`);
const warning = (msg) => process.stdout.write(`::warning::${escapeCmd(msg)}\n`);

function setOutputs(values) {
  if (!env.GITHUB_OUTPUT) return;
  for (const [key, value] of Object.entries(values)) appendFileSync(env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** Runs the pinned CLI. Exit 0, 1 and 3 all carry a JSON report; anything else is a tool error. */
async function audit({ version, minAge, directory, lockfile }) {
  const args = ['--yes', `dep-cooldown@${version}`, '--json', '--no-color', '--min-age', minAge, '--cwd', directory];
  if (lockfile) args.push('--lockfile', lockfile);

  let stdout;
  try {
    ({ stdout } = await run('npx', args, { maxBuffer: 256 * 1024 * 1024, env }));
  } catch (err) {
    if (![1, 3].includes(err.code) || !err.stdout) {
      throw new Error(`dep-cooldown failed (exit ${err.code ?? 'unknown'}): ${String(err.stderr || err.message).trim().slice(0, 2000)}`);
    }
    stdout = err.stdout;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('dep-cooldown did not produce valid JSON');
  }
}

async function main() {
  const version = parseVersion(env.INPUT_VERSION);
  const minAge = parseMinAge(env['INPUT_MIN-AGE-DAYS']);
  const failOn = parseFailOn(env['INPUT_FAIL-ON']);
  const comment = parseBool(env.INPUT_COMMENT, 'comment');
  const ignore = parseIgnore(env.INPUT_IGNORE);
  const directory = env['INPUT_WORKING-DIRECTORY'] || '.';
  const lockfile = (env.INPUT_LOCKFILE || '').trim();

  const result = await audit({ version, minAge, directory, lockfile });
  const verdict = evaluate(result, { ignore, failOn });
  const markdown = renderMarkdown(result, verdict, { minAgeDays: minAge, failOn, version });

  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  else process.stdout.write(`${markdown}\n`);

  for (const entry of verdict.unusedIgnores) warning(`ignore entry matched nothing: ${entry}`);

  if (comment) {
    const number = pullRequestNumber();
    if (number === null) {
      warning('comment: true, but this run is not a pull request event; no comment posted.');
    } else {
      try {
        const action = await upsertComment({
          token: env['INPUT_GITHUB-TOKEN'],
          repository: env.GITHUB_REPOSITORY,
          number,
          body: markdown,
          apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
        });
        process.stdout.write(`PR comment ${action}.\n`);
      } catch (err) {
        // Fork PRs get a read-only token: reporting is best effort, the verdict is not.
        warning(`could not post the PR comment (${err.message}). Needs pull-requests: write.`);
      }
    }
  }

  setOutputs({
    result: verdict.failed ? 'fail' : 'pass',
    'young-count': verdict.young.length,
    'ignored-count': verdict.ignored.length,
    'unknown-count': verdict.unknown.length,
  });

  if (verdict.failed) {
    error(`${verdict.young.length} package version(s) are younger than ${minAge} days.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  error(err.message);
  process.exitCode = 2;
});
