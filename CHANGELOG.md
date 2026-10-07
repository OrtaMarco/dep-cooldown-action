# Changelog

## 0.1.0 — unreleased

- First version: composite action running a pinned `dep-cooldown` (default `0.1.0`).
- Inputs: `min-age-days`, `lockfile`, `working-directory`, `fail-on`, `comment`, `ignore`, `version`, `github-token`.
- Outputs: `result`, `young-count`, `ignored-count`, `unknown-count`.
- Markdown report in the job summary; optional PR comment that is updated in place.
