import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import { repositoryPath, repositoryRoot } from './project-facts.mjs';

function argumentValue(name) {
  const direct = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(arguments_) {
  return execFileSync('git', arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function localChangedFiles() {
  const output = git(['status', '--short', '--untracked-files=all']);
  if (!output) return [];

  return output
    .split('\n')
    .map((line) => line.slice(3).trim())
    .map((path) => (path.includes(' -> ') ? path.split(' -> ').at(-1) : path))
    .map((path) => path.replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function diffChangedFiles(base, head) {
  const ranges = [`${base}...${head}`, `${base}..${head}`];
  for (const range of ranges) {
    try {
      const output = git(['diff', '--name-only', '--no-renames', '--diff-filter=ACMRD', range]);
      return output ? output.split('\n').filter(Boolean) : [];
    } catch {
      // Try a direct diff if a merge-base diff is unavailable.
    }
  }
  throw new Error(`Cannot calculate Git diff from ${base} to ${head}.`);
}

function globExpression(pattern) {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        expression += '(?:.*/)?';
      } else {
        expression += '.*';
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[\\^$+.()|{}[\]]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

function matches(path, patterns) {
  return patterns.some((pattern) => globExpression(pattern).test(path));
}

function loadImpactMap() {
  const path = repositoryPath('tutorials/nestjs-backend/maintenance/impact-map.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (config.version !== 1 || !Array.isArray(config.rules)) {
    throw new Error('Unsupported tutorial impact-map.json format.');
  }

  for (const rule of config.rules) {
    if (!rule.id || !rule.description || !rule.sources?.length || !rule.reviewPaths?.length) {
      throw new Error(`Invalid tutorial impact rule: ${JSON.stringify(rule)}`);
    }
    for (const reviewPath of rule.reviewPaths.filter((path_) => !path_.includes('*'))) {
      if (!existsSync(repositoryPath(reviewPath))) {
        throw new Error(`Impact rule ${rule.id} references missing review path ${reviewPath}.`);
      }
    }
  }
  return config;
}

const check = process.argv.includes('--check');
const head = argumentValue('--head') ?? 'HEAD';
const base = argumentValue('--base') ?? process.env.TUTORIAL_BASE_REF;

if (base && /^0+$/.test(base)) {
  console.log('Tutorial impact check skipped: the Git event has no previous revision.');
  process.exit(0);
}

let changedFiles;
try {
  changedFiles = base ? diffChangedFiles(base, head) : localChangedFiles();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const config = loadImpactMap();
const affected = config.rules
  .map((rule) => ({
    ...rule,
    changedSources: changedFiles.filter((path) => matches(path, rule.sources)),
    changedReviewPaths: changedFiles.filter((path) => matches(path, rule.reviewPaths)),
  }))
  .filter((rule) => rule.changedSources.length);

console.log(
  base
    ? `Tutorial impact range: ${base}...${head}`
    : 'Tutorial impact source: local staged, unstaged, and untracked changes',
);
console.log(`Changed files: ${changedFiles.length}`);

if (!affected.length) {
  console.log('No tutorial impact rule was triggered.');
  process.exit(0);
}

let missingReview = false;
for (const rule of affected) {
  const reviewed = rule.changedReviewPaths.length > 0;
  if (!reviewed) missingReview = true;
  console.log(`\n[${reviewed ? 'reviewed' : 'needs-review'}] ${rule.id}: ${rule.description}`);
  console.log(`  changed source: ${rule.changedSources.join(', ')}`);
  if (reviewed) {
    console.log(`  changed review path: ${rule.changedReviewPaths.join(', ')}`);
  } else {
    console.log('  review one of:');
    for (const path of rule.reviewPaths) console.log(`    - ${path}`);
  }
}

if (check && missingReview) {
  console.error(
    '\nTutorial review is required. Update an affected chapter, or add a justified entry to maintenance/review-acknowledgements.md.',
  );
  process.exitCode = 1;
} else if (missingReview) {
  console.log('\nReport only. Run `pnpm tutorial:impact:check` to enforce review locally.');
} else {
  console.log('\nAll triggered tutorial areas have a changed review path.');
}
