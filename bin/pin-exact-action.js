#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { run } from '../src/check.js';

let cwd;
try {
  ({ values: { cwd } } = parseArgs({ options: { cwd: { type: 'string', default: '.' } } }));
} catch (error) {
  console.log(`error: ${error.message}`);
  process.exit(1);
}

process.exitCode = run(resolve(cwd));
