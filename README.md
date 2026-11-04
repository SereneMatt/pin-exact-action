# pin-exact-action

Keeps the Node version in your version file, `@types/node` and `engines.node` in sync, and fails CI when `package.json` dependencies are not pinned to exact versions.

It is for apps, not libraries. Libraries should usually publish ranges so their users can dedupe.

It complements `save-exact=true` in `.npmrc`, Renovate's `rangeStrategy: "pin"` and syncpack. Those write exact pins. This checks them in CI, together with the Node versions.

## What it checks

In the target directory:

1. **Node version sync.** If a Node version source is found (see below):
   - `@types/node` (in `dependencies` or `devDependencies`) has the same major as that Node version. No `@types/node` means no check.
   - `engines.node` is required and must be exactly `>=<node version>`, for example `>=24.11.1`. Whitespace is ignored, so `>= 24.11.1` is fine. This is strict on purpose: the engines floor should be the version you actually run and test.
2. **Exact pins.** Every entry in `dependencies`, `devDependencies` and `optionalDependencies` is an exact version. Each field is checked on its own, so a loose entry can't hide behind the same name in another field. Values in `overrides` (npm, nested objects too), `resolutions` (yarn) and `pnpm.overrides` are checked as well.

What counts as exact:

- A full semver version, using the [semver.org regex](https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string): `1.2.3`, `1.2.3-beta.1`, `1.0.0+b1`. Leading zeros like `01.2.3` fail.
- An alias to an exact version: `npm:other@1.2.3`.
- Local and monorepo protocols, which are not registry ranges: `workspace:`, `file:`, `link:`, `catalog:`.
- In `overrides`, a `$name` reference to a direct dependency (that dependency is checked itself).

Everything else fails: `^`, `~`, ranges, `*`, tags like `latest`, git and http URLs.

`peerDependencies` are not checked. Ranges are correct there.

All problems are printed, then it exits 1 once.

## Node version sources

Checked in this order. The first one that names a Node version wins, and the output names it:

1. `.tool-versions` (`node` or `nodejs`)
2. `mise.toml`, then `.mise.toml` (`[tools]` `node` or `nodejs`, a string or the first entry of an array)
3. `.nvmrc`
4. `.node-version`
5. `package.json` `volta.node`
6. `package.json` `devEngines.runtime` (object or array, the entry named `node`)

A leading `v` is stripped. The version must be an exact `X.Y.Z`. Values like `lts/*`, `system` or `24` fail with an error naming the file.

If there is no source, the Node checks are skipped with a note, and only pins are checked.

## Output

Locally, each problem is an `error: <file>: <message>` line. In GitHub Actions (`GITHUB_ACTIONS=true`), each one is an `::error file=<path>::<message>` annotation, with the path relative to the repository root.

## GitHub Action

```yaml
- uses: actions/checkout@v6
- uses: SereneMatt/pin-exact-action@v0
  with:
    working-directory: cloudflare
```

`working-directory` defaults to `.`. The action runs on the runner's built-in Node 24, so you don't need `actions/setup-node`.

`@v0` works after the first release. You can also pin `@v0.1.0` or a commit SHA.

## CLI

```sh
npx @serenematt/pin-exact-action --cwd cloudflare
```

`--cwd` defaults to `.`. Requires Node 20 or newer. No dependencies.
