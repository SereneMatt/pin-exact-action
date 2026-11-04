import { resolve } from 'node:path';
import { run } from '../src/check.js';

const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
process.exitCode = run(resolve(workspace, process.env['INPUT_WORKING-DIRECTORY'] || '.'));
