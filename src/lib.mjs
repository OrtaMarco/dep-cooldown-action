// Pure logic: input parsing, exception filtering, verdict and markdown. No I/O,
// so everything here is unit-tested with sample `dep-cooldown --json` output.

/** Hidden marker that identifies the comment this Action owns on a PR. */
export const MARKER = '<!-- dep-cooldown-action -->';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DECIMAL_RE = /^\d+(?:\.\d+)?$/;
const IGNORE_RE = /^(?:@[^@/\s]+\/)?[^@/\s]+@[^@\s]+$/;
const MAX_ROWS = 50;

export const FAIL_ON = ['young', 'unknown', 'never'];

/** An exact version only: `latest`, ranges and dist-tags would defeat the pin. */
export function parseVersion(raw) {
  const value = String(raw ?? '').trim();
  if (!SEMVER_RE.test(value)) {
    throw new Error(`input "version" must be an exact version such as 0.1.0, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseMinAge(raw) {
  const value = String(raw ?? '').trim();
  if (!DECIMAL_RE.test(value)) {
    throw new Error(`input "min-age-days" must be a non-negative number such as 7 or 0.5, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseFailOn(raw) {
  const value = String(raw ?? '').trim() || 'young';
  if (!FAIL_ON.includes(value)) {
    throw new Error(`input "fail-on" must be one of ${FAIL_ON.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseBool(raw, name) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`input "${name}" must be true or false, got ${JSON.stringify(value)}`);
}

/** `name@version` entries separated by newlines or commas; `#` starts a comment. */
export function parseIgnore(raw) {
  const entries = [];
  for (const line of String(raw ?? '').split('\n')) {
    for (const part of line.split('#')[0].split(',')) {
      const entry = part.trim();
      if (!entry) continue;
      if (!IGNORE_RE.test(entry)) {
        throw new Error(`input "ignore": ${JSON.stringify(entry)} is not name@version (e.g. lodash@4.17.21 or @scope/pkg@1.2.3)`);
      }
      if (!entries.includes(entry)) entries.push(entry);
    }
  }
  return entries;
}

/**
 * Applies the exceptions and computes the verdict from the rows themselves:
 * the CLI has no `--ignore`, so its exit code cannot be trusted for this.
 *
 * @param {object} result parsed `dep-cooldown --json` output
 * @param {{ignore: string[], failOn: string}} options
 */
export function evaluate(result, { ignore, failOn }) {
  const ignoreSet = new Set(ignore);
  const matched = new Set();
  const young = [];
  const unknown = [];
  const ignored = [];

  for (const row of result.rows ?? []) {
    const isYoung = row.young === true;
    const isUnknown = !isYoung && row.ageDays === null;
    if (!isYoung && !isUnknown) continue;
    const key = `${row.name}@${row.version}`;
    if (ignoreSet.has(key)) {
      matched.add(key);
      ignored.push(row);
    } else if (isYoung) {
      young.push(row);
    } else {
      unknown.push(row);
    }
  }

  const unusedIgnores = ignore.filter((entry) => !matched.has(entry));
  const failed = failOn !== 'never' && (young.length > 0 || (failOn === 'unknown' && unknown.length > 0));

  return { failed, young, unknown, ignored, unusedIgnores };
}

/** Neutralise anything that could break a table cell or inject markdown. */
export function cell(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\`*_{}[\]<>()#+!|~&]/g, (ch) => `\\${ch}`)
    .slice(0, 200);
}

function age(row) {
  if (row.ageDays === null || row.ageDays === undefined) return 'unknown';
  return `${row.ageDays} d`;
}

function table(rows, columns) {
  const head = `| ${columns.map((c) => c.title).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n`;
  const shown = rows.slice(0, MAX_ROWS);
  const body = shown.map((row) => `| ${columns.map((c) => c.value(row)).join(' | ')} |`).join('\n');
  const more = rows.length > shown.length ? `\n\n…and ${rows.length - shown.length} more.` : '';
  return `${head}${body}${more}\n`;
}

const YOUNG_COLUMNS = [
  { title: 'Package', value: (r) => cell(r.name) },
  { title: 'Version', value: (r) => cell(r.version) },
  { title: 'Published', value: (r) => cell(r.published ? r.published.slice(0, 10) : '-') },
  { title: 'Age', value: age },
  { title: 'Direct', value: (r) => (r.direct ? 'yes' : 'no') },
];

const UNKNOWN_COLUMNS = [
  { title: 'Package', value: (r) => cell(r.name) },
  { title: 'Version', value: (r) => cell(r.version) },
  { title: 'Why it could not be checked', value: (r) => cell(r.error ?? 'no data') },
];

/**
 * Markdown report, used for both the step summary and the PR comment.
 *
 * @param {object} result parsed `dep-cooldown --json` output
 * @param {ReturnType<typeof evaluate>} verdict
 * @param {{minAgeDays: string, failOn: string, version: string}} meta
 */
export function renderMarkdown(result, verdict, meta) {
  const { failed, young, unknown, ignored, unusedIgnores } = verdict;
  const totals = result.totals ?? {};
  const icon = failed ? '❌' : '✅';
  const headline = failed
    ? `${young.length} package version(s) are younger than ${meta.minAgeDays} days`
    : `No package version is younger than ${meta.minAgeDays} days`;

  const parts = [`${MARKER}\n## ${icon} Dependency cooldown: ${headline}\n`];
  parts.push(
    `Audited **${totals.packages ?? 0}** versions from \`${cell(result.format)}\` ` +
      `(ages measured at ${cell(result.asOf)}). ` +
      `${ignored.length} accepted exception(s), ${unknown.length} that could not be checked.\n`,
  );

  if (young.length > 0) parts.push(`### Too new\n\n${table(young, YOUNG_COLUMNS)}`);
  if (unknown.length > 0) {
    const note = meta.failOn === 'unknown' ? '' : ' These do not fail the check (`fail-on: young`).';
    parts.push(`### Could not be checked\n\nUnknown is never reported as passing.${note}\n\n${table(unknown, UNKNOWN_COLUMNS)}`);
  }
  if (ignored.length > 0) {
    parts.push(`### Accepted exceptions\n\n${table(ignored, YOUNG_COLUMNS)}`);
  }
  if (unusedIgnores.length > 0) {
    parts.push(
      `> ⚠️ \`ignore\` entries that matched nothing (remove them): ${unusedIgnores.map((e) => `\`${cell(e)}\``).join(', ')}\n`,
    );
  }
  if (meta.failOn === 'never') parts.push('_`fail-on: never` — this check only reports._\n');
  parts.push(`<sub>dep-cooldown ${cell(meta.version)} · threshold ${cell(meta.minAgeDays)} d</sub>\n`);
  return parts.join('\n');
}
