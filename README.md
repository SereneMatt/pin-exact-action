# pin-exact-action

Catches drift and enforces Node-version conventions in CI.

Keep a lockfile and use your package manager's frozen or immutable install mode to enforce the resolved dependency tree.

It is for apps, not libraries.

It complements `save-exact=true` in `.npmrc`, Renovate's `rangeStrategy: "pin"` and syncpack. This checks them in CI, together with the Node versions.

## What it checks

Each invocation checks one `package.json` in the target directory. In a monorepo, run it separately for each package you want checked; especially useful if you are rewriting large workspaces with agents.

1. **Node version sync.** If a Node version source is found:

2. **Exact pins.** Every entry in `dependencies`, `devDependencies` and `optionalDependencies` is an exact version.

What counts as exact:

- A full semver version, using the [semver.org regex](https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string): `1.2.3`, `1.2.3-beta.1`, `1.0.0+b1`. Leading zeros like `01.2.3` fail.
- An alias to an exact version: `npm:other@1.2.3`.
- Local and monorepo protocols, which are not registry ranges: `workspace:`, `file:`, `link:`, `catalog:`. These are accepted as references; their targets are not resolved or checked for exact pins.
- In `overrides`, a `$name` reference to a direct dependency (that dependency is checked itself).

Everything else fails: `^`, `~`, ranges, `*`, tags like `latest`, git and http URLs.

All problems are printed, then it exits 1 once.

## Output

Locally, each problem is an `error: <file>: <message>` line. In GitHub Actions (`GITHUB_ACTIONS=true`), each one is an `::error file=<path>::<message>` annotation, with the path relative to the repository root.

## GitHub Action

```yaml
- uses: actions/checkout@v6
- uses: SereneMatt/pin-exact-action@v0
  with:
    working-directory: my-working-directory
```

## CLI

```sh
npx @serenematt/pin-exact-action --cwd my-working-directory
```
