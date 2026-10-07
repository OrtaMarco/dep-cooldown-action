# Design

## Problem
Package managers can refuse versions younger than N days (a *cooldown*), but nothing stops a PR
from landing a lockfile that violates it (bots, hand edits, a different manager on a laptop).
`dep-cooldown` audits a lockfile from the CLI; this Action makes that a PR check with a readable
verdict, accepted exceptions, and one comment that is updated rather than repeated.

## User
Maintainers of JavaScript repos (npm, pnpm, Yarn, Bun) who want a cooldown gate in CI.

## Scope v0.1
- Run `dep-cooldown` at a **pinned** version against a lockfile.
- Fail when any version is younger than `min-age-days` (and, per `fail-on`, when unverifiable).
- `ignore`: accepted exceptions (`pkg@version`, e.g. a security patch).
- Markdown report in `$GITHUB_STEP_SUMMARY`; optional PR comment, updated in place.

## Non-goals
Installing dependencies, fixing lockfiles, enabling the cooldown in the package manager
(use `dep-cooldown --config`), diffing against the base branch, non-npm ecosystems.

## Inputs
| Input | Default | Meaning |
|---|---|---|
| `min-age-days` | `7` | Threshold, decimal days |
| `lockfile` | auto | Lockfile name inside `working-directory` |
| `working-directory` | `.` | Project directory |
| `fail-on` | `young` | `young` fails on young only; `unknown` also on unchecked; `never` only reports |
| `comment` | `false` | Post/update a PR comment (needs `pull-requests: write`) |
| `ignore` | empty | Newline/comma list of `name@version` |
| `version` | pinned default | `dep-cooldown` version; must be an exact semver, `latest` is rejected |
Outputs: `result` (`pass`/`fail`), `young-count`, `ignored-count`, `unknown-count`.

## Decision: composite vs. bundled JavaScript action
**Composite**, running dependency-free `.mjs` files from the action checkout.
- A `ncc` bundle commits generated, unreadable code to the repo; reviewers of a security tool
  cannot audit what runs. Plain source here *is* what runs, with zero runtime dependencies.
- No build step to forget, no dist drift check in CI.
- The only third-party code is `dep-cooldown`, fetched at an exact version, never `@latest`.
- Cost: needs Node ≥ 20 on the runner (present on GitHub-hosted runners) and npm registry access.
- Inputs reach scripts through `env:`, never interpolated into shell, and children are spawned
  with argument arrays (no shell), so an input cannot inject commands.
- Permissions: the Action itself asks for `contents: read`; `pull-requests: write` only when `comment: true`.

## Exceptions and exit codes
The CLI has no `--ignore`, so the Action runs `--json`, drops ignored rows, and recomputes the
verdict from the rows. The CLI exit code is used only to detect tool errors (2). Ignored entries
are listed in the report so exceptions stay visible. An `ignore` entry that matches nothing is warned about.

## Competitors
No Marketplace Action found that audits a lockfile against a cooldown (search 2026-10-06).
Adjacent: Dependabot/Renovate cooldown (update-time, not a verifier), `pinact --min-age`
(Actions pins), `npm-lockfile-changes`, `provenance-action`. Differentiator: audits what is
*already resolved*, all four lockfile formats, exceptions with visibility.
