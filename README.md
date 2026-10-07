# dep-cooldown-action

**Fail a pull request when its lockfile resolves a dependency published less than N days ago.**

A dependency *cooldown* (npm's `min-release-age`, pnpm's `minimumReleaseAge`…) keeps you out of the
window in which most malicious npm releases are live. Setting it in your package manager is half the
job; this Action is the other half: a CI check that a lockfile still respects it, whoever or whatever
changed it. It wraps [`dep-cooldown`](https://www.npmjs.com/package/dep-cooldown) and adds a job
summary, accepted exceptions, and one PR comment that is updated instead of repeated.

Works with `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock` and `bun.lock`.
It reads the lockfile and never installs anything, so no dependency lifecycle script runs in this job.

## Usage

```yaml
name: Dependency cooldown
on: [pull_request]

permissions:
  contents: read

jobs:
  cooldown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: OrtaMarco/dep-cooldown-action@v0   # pin to a full commit SHA in security-sensitive repos
        with:
          min-age-days: 7
```

### With a PR comment and an accepted exception

```yaml
permissions:
  contents: read
  pull-requests: write      # only because of `comment: true`

jobs:
  cooldown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: OrtaMarco/dep-cooldown-action@v0
        with:
          min-age-days: 7
          comment: true
          ignore: |
            lodash@4.17.21   # CVE patch, reviewed
            @scope/pkg@1.2.3
```

### Monorepo subfolder, report only

```yaml
- uses: OrtaMarco/dep-cooldown-action@v0
  with:
    working-directory: apps/web
    lockfile: pnpm-lock.yaml
    fail-on: never
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `min-age-days` | `7` | Minimum age in days (decimal allowed, `0.5`). |
| `lockfile` | auto | Lockfile name inside `working-directory`. |
| `working-directory` | `.` | Project to audit. |
| `fail-on` | `young` | `young`: fail on too-new versions. `unknown`: also fail when a version's age could not be determined. `never`: only report. |
| `comment` | `false` | Post one comment on the PR and edit it on later pushes. Needs `pull-requests: write`. |
| `ignore` | | `name@version` list (newlines or commas, `#` comments). Exact version match. |
| `version` | `0.1.0` | Exact `dep-cooldown` version. Ranges and `latest` are rejected. |
| `github-token` | `github.token` | Used only to post the comment. |

## Outputs

`result` (`pass`/`fail`), `young-count`, `ignored-count`, `unknown-count`.

## Behaviour worth knowing

- **Exceptions stay visible.** Ignored versions are listed in the report; an `ignore` entry that
  matches nothing produces a warning so stale exceptions get removed.
- **Unknown is not a pass.** A version whose date the registry could not provide is listed under
  "Could not be checked". By default it does not fail the job; use `fail-on: unknown` for strict mode.
- **Comments never break the verdict.** On fork PRs the token is read-only; the comment is skipped
  with a warning and the check still decides pass/fail.
- **Registry.** The check queries the npm registry (honouring your `.npmrc`). It never sends tokens,
  so private registries that require auth yield unknown rows.
- **Runner.** Linux or macOS runners with Node ≥ 20 (all GitHub-hosted ones). Windows runners are untested.

## Supply-chain posture

- The Action is composite and dependency-free: the `.mjs` files in `src/` are what runs. No bundle to audit.
- `dep-cooldown` is fetched at an **exact** version (default pinned); `latest` is refused.
- Inputs reach the code via environment variables and child processes get argument arrays, never a shell string.
- Minimum permissions: `contents: read`; `pull-requests: write` only with `comment: true`.

See [DESIGN.md](DESIGN.md) for the rationale. A cooldown protects against a compromised *publish*, not
against a compromised build runner or malicious install scripts — read the
[dep-cooldown README](https://github.com/OrtaMarco/dep-cooldown#what-this-does-not-protect-you-from).

## Development

```bash
npm test      # node --test, no dependencies to install
```

`.github/workflows/test.yml` exercises the Action itself against `test/fixtures/ms`: a clean run, a
forced failure (threshold of 100 years), an `ignore` exception and a rejected `version: latest`.

## License

MIT © [Marco Orta](https://ortamarco.me)

---

## En español

**Falla un pull request cuando su lockfile resuelve una dependencia publicada hace menos de N días.**

Un *cooldown* de dependencias (`min-release-age` en npm, `minimumReleaseAge` en pnpm…) te saca de la
ventana en la que viven la mayoría de las versiones maliciosas de npm. Activarlo en el gestor es la
mitad del trabajo; esta Action es la otra mitad: una verificación en CI de que el lockfile lo sigue
respetando. Envuelve [`dep-cooldown`](https://www.npmjs.com/package/dep-cooldown) y añade resumen del
job, excepciones aceptadas y un único comentario en el PR que se actualiza en lugar de repetirse.

```yaml
permissions:
  contents: read
  pull-requests: write   # solo si comment: true

steps:
  - uses: actions/checkout@v5
  - uses: OrtaMarco/dep-cooldown-action@v0
    with:
      min-age-days: 7
      comment: true
      ignore: |
        lodash@4.17.21   # parche de seguridad revisado
```

- `ignore` acepta `nombre@versión` exactos; las excepciones aparecen en el informe.
- Lo que no se pudo comprobar nunca se presenta como aprobado; `fail-on: unknown` lo hace fallar.
- `dep-cooldown` se ejecuta con versión exacta fijada (por defecto `0.1.0`); `latest` se rechaza.
- Permisos mínimos: `contents: read`, y `pull-requests: write` solo con `comment: true`.
