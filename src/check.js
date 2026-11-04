import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
const EXACT =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// Not registry ranges: they point inside the repo or at a pnpm catalog.
const LOCAL = /^(workspace|file|link|catalog):/;

export const isExact = (version) => typeof version === 'string' && EXACT.test(version);

export function isPinned(spec) {
  if (typeof spec !== 'string') return false;
  if (LOCAL.test(spec)) return true;
  if (spec.startsWith('npm:')) return isExact(spec.slice(spec.lastIndexOf('@') + 1));
  return isExact(spec);
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readText = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);
const lines = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);

function fromToolVersions(text) {
  for (const line of lines(text)) {
    const [tool, version] = line.split(/\s+/);
    if (tool === 'node' || tool === 'nodejs') return version ?? '';
  }
}

function fromMise(text) {
  let inTools = false;
  for (const line of lines(text)) {
    if (line.startsWith('[')) inTools = line === '[tools]';
    const match = inTools && line.match(/^["']?(node|nodejs)["']?\s*=\s*(.*)$/);
    if (match) return match[2].match(/^\[?\s*["']([^"']*)["']/)?.[1] ?? match[2];
  }
}

function fromDevEngines(runtime) {
  const entries = Array.isArray(runtime) ? runtime : [runtime];
  const node = entries.find((entry) => entry?.name === 'node');
  if (node) return String(node.version ?? '');
}

// Fixed order. The first source that names a Node version wins.
function findNodeVersion(dir, pkg) {
  const sources = [
    ['.tool-versions', () => fromToolVersions(readText(join(dir, '.tool-versions')) ?? '')],
    ['mise.toml', () => fromMise(readText(join(dir, 'mise.toml')) ?? '')],
    ['.mise.toml', () => fromMise(readText(join(dir, '.mise.toml')) ?? '')],
    ['.nvmrc', () => lines(readText(join(dir, '.nvmrc')) ?? '')[0]],
    ['.node-version', () => lines(readText(join(dir, '.node-version')) ?? '')[0]],
    ['package.json', () => pkg.volta?.node, 'volta.node'],
    ['package.json', () => pkg.devEngines?.runtime && fromDevEngines(pkg.devEngines.runtime), 'devEngines.runtime'],
  ];
  for (const [file, read, label = file] of sources) {
    const version = read();
    if (version !== undefined) return { file, label, version: String(version).replace(/^v/, '') };
  }
}

function overrideFindings(value, path, add) {
  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      overrideFindings(nested, key === '.' ? path : `${path}.${key}`, add);
    }
  } else if (!(typeof value === 'string' && value.startsWith('$')) && !isPinned(value)) {
    // `$name` points at the direct dependency's spec, which is checked on its own.
    add(`${path}@${value}`);
  }
}

// Returns { errors: [{ file, message }], notes: [string], node: { version, label } | null }.
export function check(dir) {
  const errors = [];
  const notes = [];
  const pkgFile = join(dir, 'package.json');
  const error = (file, message) => errors.push({ file: join(dir, file), message });

  let pkg;
  try {
    pkg = readJson(pkgFile);
  } catch (err) {
    errors.push({ file: pkgFile, message: `cannot read package.json: ${err.message}` });
    return { errors, notes, node: null };
  }

  const loose = (entry) => error('package.json', `${entry} is not an exact version`);
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!isPinned(spec)) loose(`${field}.${name}@${spec}`);
    }
  }
  overrideFindings(pkg.overrides ?? {}, 'overrides', loose);
  overrideFindings(pkg.resolutions ?? {}, 'resolutions', loose);
  overrideFindings(pkg.pnpm?.overrides ?? {}, 'pnpm.overrides', loose);

  const source = findNodeVersion(dir, pkg);
  if (!source) {
    notes.push('no Node version source found; skipped the @types/node and engines.node checks');
    return { errors, notes, node: null };
  }
  const { file, label, version } = source;
  if (!isExact(version)) {
    error(file, `Node version "${version}" from ${label} is not exact; the Node checks need an exact X.Y.Z version`);
    return { errors, notes, node: null };
  }

  const from = `(node ${version} from ${label})`;
  const major = version.split('.')[0];
  for (const field of ['dependencies', 'devDependencies']) {
    const types = pkg[field]?.['@types/node'];
    if (types === undefined) continue;
    const typesMajor = String(types).slice(String(types).lastIndexOf('@') + 1).match(/\d+/)?.[0];
    if (typesMajor !== major) {
      error('package.json', `${field}.@types/node@${types} must have the same major as Node ${from}`);
    }
  }

  const engines = pkg.engines?.node;
  if (typeof engines !== 'string' || engines.replace(/\s+/g, '') !== `>=${version}`) {
    error('package.json', `engines.node must be ">=${version}" ${from}, found ${JSON.stringify(engines ?? null)}`);
  }

  return { errors, notes, node: { version, label } };
}

const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

// Prints every finding, then returns the exit code.
export function run(dir, { env = process.env, log = console.log } = {}) {
  const { errors, notes, node } = check(dir);
  const actions = env.GITHUB_ACTIONS === 'true';
  const base = env.GITHUB_WORKSPACE || process.cwd();
  const shown = (file) => relative(base, file).split('\\').join('/') || file;

  for (const note of notes) log(actions ? `::notice::${escapeData(note)}` : `note: ${note}`);
  for (const { file, message } of errors) {
    log(actions ? `::error file=${escapeProperty(shown(file))}::${escapeData(message)}` : `error: ${shown(file)}: ${message}`);
  }
  if (errors.length) return 1;
  log(`OK: ${shown(join(dir, 'package.json'))}${node ? ` (node ${node.version} from ${node.label})` : ''}`);
  return 0;
}
