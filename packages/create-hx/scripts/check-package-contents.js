import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const requiredFiles = Object.freeze([
  'package.json',
  'README.md',
  'bin/create-hx.js',
  'src/arguments.js',
  'src/archive.js',
  'src/cli.js',
  'src/download.js',
  'src/errors.js',
  'src/manifest.js',
  'src/scaffold.js',
  'src/target.js',
  'src/transform.js',
]);

export function checkPackageContents(files) {
  const actualFiles = new Set(files);
  if (actualFiles.size !== files.length) {
    throw new Error('Unexpected package file: duplicate path.');
  }

  for (const requiredFile of requiredFiles) {
    if (!actualFiles.has(requiredFile)) {
      throw new Error(`Missing package file: ${requiredFile}`);
    }
  }

  const allowedFiles = new Set(requiredFiles);
  for (const file of actualFiles) {
    if (!allowedFiles.has(file)) {
      throw new Error(`Unexpected package file: ${file}`);
    }
  }
}

async function main() {
  const npmCache = await mkdtemp(path.join(os.tmpdir(), 'create-hx-npm-cache-'));
  try {
    const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json'], {
      cwd: packagePath,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: npmCache },
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result) || result.length !== 1 || !Array.isArray(result[0]?.files)) {
      throw new Error('npm pack returned an unexpected JSON result.');
    }
    checkPackageContents(result[0].files.map((file) => file.path));
  } finally {
    await rm(npmCache, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
