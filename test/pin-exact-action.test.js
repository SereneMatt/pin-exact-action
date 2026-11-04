import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/pin-exact-action.js', import.meta.url));
const actionEntry = fileURLToPath(new URL('../action/index.js', import.meta.url));

const basePkg = {
  name: 'fixture',
  engines: { node: '>=24.11.1' },
  dependencies: { hono: '4.10.4' },
  devDependencies: { '@types/node': '24.10.0' },
};

// files: { name: contents }. package.json is written from pkg unless files overrides it.
function fixture(pkg = basePkg, files = { '.tool-versions': 'node 24.11.1\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'pin-exact-action-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const cleanEnv = () => {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  delete env.GITHUB_WORKSPACE;
  return env;
};

function run(dir, env = cleanEnv()) {
  const result = spawnSync(process.execPath, [bin, '--cwd', dir], { cwd: dir, encoding: 'utf8', env });
  return { ...result, lines: result.stdout.trim().split('\n') };
}

const passes = (dir) => {
  const result = run(dir);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
};
const fails = (dir) => {
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  return result;
};

test('passes with exact pins and matching Node versions', () => {
  const result = passes(fixture());
  assert.equal(result.stdout.trim(), 'OK: package.json (node 24.11.1 from .tool-versions)');
});

test('accepts an exact prerelease pin and build metadata', () => {
  passes(fixture({ ...basePkg, dependencies: { a: '4.45.0-beta.1', b: '1.0.0+b1' } }));
});

test('rejects leading zeros', () => {
  const result = fails(fixture({ ...basePkg, dependencies: { a: '01.2.3' } }));
  assert.deepEqual(result.lines, ['error: package.json: dependencies.a@01.2.3 is not an exact version']);
});

test('reports every problem together and exits once', () => {
  const result = fails(
    fixture({
      ...basePkg,
      engines: { node: '>=24' },
      dependencies: { hono: '^1.2.3', zod: '~3.0.0' },
      devDependencies: { '@types/node': '22.18.0', vitest: 'latest', x: 'github:a/b', y: 'https://x.test/y.tgz' },
    }),
  );
  assert.deepEqual(result.lines, [
    'error: package.json: dependencies.hono@^1.2.3 is not an exact version',
    'error: package.json: dependencies.zod@~3.0.0 is not an exact version',
    'error: package.json: devDependencies.vitest@latest is not an exact version',
    'error: package.json: devDependencies.x@github:a/b is not an exact version',
    'error: package.json: devDependencies.y@https://x.test/y.tgz is not an exact version',
    'error: package.json: devDependencies.@types/node@22.18.0 must have the same major as Node (node 24.11.1 from .tool-versions)',
    'error: package.json: engines.node must be ">=24.11.1" (node 24.11.1 from .tool-versions), found ">=24"',
  ]);
});

test('passes without @types/node', () => {
  passes(fixture({ ...basePkg, devDependencies: {} }));
});

test('checks @types/node in dependencies too', () => {
  const result = fails(fixture({ ...basePkg, dependencies: { '@types/node': '22.18.0' }, devDependencies: {} }));
  assert.match(result.stdout, /dependencies\.@types\/node@22\.18\.0 must have the same major/);
});

test('a loose dependency is not hidden by an exact devDependency', () => {
  const result = fails(fixture({ ...basePkg, dependencies: { hono: '^4.0.0' }, devDependencies: { hono: '4.10.4' } }));
  assert.deepEqual(result.lines, ['error: package.json: dependencies.hono@^4.0.0 is not an exact version']);
});

test('fails a loose optionalDependency', () => {
  const result = fails(fixture({ ...basePkg, optionalDependencies: { fsevents: '^2.3.0' } }));
  assert.deepEqual(result.lines, ['error: package.json: optionalDependencies.fsevents@^2.3.0 is not an exact version']);
});

test('ignores peerDependencies ranges', () => {
  passes(fixture({ ...basePkg, peerDependencies: { react: '^19.0.0' } }));
});

test('accepts an exact npm: alias', () => {
  passes(fixture({ ...basePkg, dependencies: { a: 'npm:@scope/real@1.2.3', b: 'npm:real@1.2.3' } }));
});

test('fails a loose npm: alias', () => {
  const result = fails(fixture({ ...basePkg, dependencies: { a: 'npm:@scope/real@^1.2.3' } }));
  assert.deepEqual(result.lines, ['error: package.json: dependencies.a@npm:@scope/real@^1.2.3 is not an exact version']);
});

test('accepts local and workspace protocols', () => {
  passes(fixture({ ...basePkg, dependencies: { a: 'workspace:*', b: 'file:../b', c: 'link:../c', d: 'catalog:' } }));
});

test('checks overrides, resolutions and pnpm.overrides', () => {
  const result = fails(
    fixture({
      ...basePkg,
      overrides: { ok: '1.0.0', hono: '$hono', foo: '^1.0.0', parent: { '.': '2.0.0', child: '~3.0.0' } },
      resolutions: { '**/bar': '1.x' },
      pnpm: { overrides: { baz: '>=1.0.0', fine: '1.0.0' } },
    }),
  );
  assert.deepEqual(result.lines, [
    'error: package.json: overrides.foo@^1.0.0 is not an exact version',
    'error: package.json: overrides.parent.child@~3.0.0 is not an exact version',
    'error: package.json: resolutions.**/bar@1.x is not an exact version',
    'error: package.json: pnpm.overrides.baz@>=1.0.0 is not an exact version',
  ]);
});

test('accepts whitespace in engines.node', () => {
  passes(fixture({ ...basePkg, engines: { node: '>= 24.11.1' } }));
});

test('requires engines.node when a Node version source exists', () => {
  const result = fails(fixture({ ...basePkg, engines: undefined }));
  assert.deepEqual(result.lines, [
    'error: package.json: engines.node must be ">=24.11.1" (node 24.11.1 from .tool-versions), found null',
  ]);
});

const sources = {
  'nodejs in .tool-versions': [{ '.tool-versions': 'python 3.13.0\nnodejs 24.11.1\n' }, '.tool-versions'],
  'mise.toml': [{ 'mise.toml': '[env]\nnode = "1.0.0"\n\n[tools]\npython = "3.13"\nnode = "24.11.1"\n' }, 'mise.toml'],
  '.mise.toml array': [{ '.mise.toml': '[tools]\nnodejs = ["24.11.1", "22.0.0"]\n' }, '.mise.toml'],
  '.nvmrc with v prefix': [{ '.nvmrc': 'v24.11.1\n' }, '.nvmrc'],
  '.node-version': [{ '.node-version': '24.11.1\n' }, '.node-version'],
};
for (const [name, [files, label]] of Object.entries(sources)) {
  test(`reads the Node version from ${name}`, () => {
    const result = passes(fixture(basePkg, files));
    assert.equal(result.stdout.trim(), `OK: package.json (node 24.11.1 from ${label})`);
  });
}

test('reads volta.node', () => {
  const result = passes(fixture({ ...basePkg, volta: { node: '24.11.1' } }, {}));
  assert.match(result.stdout, /from volta\.node/);
});

test('reads devEngines.runtime as an object or array', () => {
  for (const runtime of [{ name: 'node', version: '24.11.1' }, [{ name: 'bun', version: '1.0.0' }, { name: 'node', version: '24.11.1' }]]) {
    const result = passes(fixture({ ...basePkg, devEngines: { runtime } }, {}));
    assert.match(result.stdout, /from devEngines\.runtime/);
  }
});

test('uses the first source in the fixed order', () => {
  const result = passes(fixture(basePkg, { '.nvmrc': '22.0.0\n', 'mise.toml': '[tools]\nnode = "24.11.1"\n' }));
  assert.match(result.stdout, /from mise\.toml/);
});

test('fails clearly on a non-exact Node version', () => {
  const cases = [
    ['.nvmrc', 'lts/*\n', 'lts/*'],
    ['.nvmrc', 'lts\n', 'lts'],
    ['.tool-versions', 'node 24\n', '24'],
    ['.tool-versions', 'node ref:v24.1.0\n', 'ref:v24.1.0'],
    ['.tool-versions', 'node path:/opt/node\n', 'path:/opt/node'],
    ['.node-version', 'system\n', 'system'],
  ];
  for (const [file, text, version] of cases) {
    const result = fails(fixture(basePkg, { [file]: text }));
    assert.deepEqual(result.lines, [
      `error: ${file}: Node version "${version}" from ${file} is not exact; the Node checks need an exact X.Y.Z version`,
    ]);
  }
});

test('skips the Node checks without a version source', () => {
  const result = passes(fixture({ ...basePkg, engines: undefined, devDependencies: { '@types/node': '1.0.0' } }, {}));
  assert.deepEqual(result.lines, [
    'note: no Node version source found; skipped the @types/node and engines.node checks',
    'OK: package.json',
  ]);
});

test('prints GitHub annotations with file= relative to the workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-exact-action-ws-'));
  const dir = join(root, 'app');
  mkdirSync(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...basePkg, dependencies: { hono: '^4.0.0' } }));
  writeFileSync(join(dir, '.nvmrc'), 'lts/*\n');
  const env = { ...cleanEnv(), GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: root };
  const result = run(dir, env);
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines, [
    '::error file=app/package.json::dependencies.hono@^4.0.0 is not an exact version',
    '::error file=app/.nvmrc::Node version "lts/*" from .nvmrc is not exact; the Node checks need an exact X.Y.Z version',
  ]);
});

test('action entry reads INPUT_WORKING-DIRECTORY against GITHUB_WORKSPACE', () => {
  const root = mkdtempSync(join(tmpdir(), 'pin-exact-action-ws-'));
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app', 'package.json'), JSON.stringify(basePkg));
  writeFileSync(join(root, 'app', '.tool-versions'), 'node 24.11.1\n');
  const env = { ...cleanEnv(), GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: root, 'INPUT_WORKING-DIRECTORY': 'app' };
  const result = spawnSync(process.execPath, [actionEntry], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), 'OK: app/package.json (node 24.11.1 from .tool-versions)');
});

test('fails clearly when package.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pin-exact-action-'));
  const result = fails(dir);
  assert.match(result.stdout, /^error: package\.json: cannot read package\.json: ENOENT/);
});

test('defaults --cwd to the current directory', () => {
  const dir = fixture();
  const result = spawnSync(process.execPath, [bin], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), 'OK: package.json (node 24.11.1 from .tool-versions)');
});
