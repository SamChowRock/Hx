import { findBrokenTutorialLinks, findProjectFactDrift } from './validators.mjs';

let failed = false;
const drift = findProjectFactDrift();
if (drift.length) {
  failed = true;
  console.error('Tutorial project facts have drifted:');
  for (const problem of drift) console.error(`- ${problem.path}: ${problem.reason}`);
  console.error('Run `pnpm tutorial:generate` and review the generated changes.\n');
} else {
  console.log('Tutorial project facts match the current repository.');
}

const links = findBrokenTutorialLinks();
if (links.problems.length) {
  failed = true;
  console.error('Broken tutorial links:');
  for (const problem of links.problems) {
    console.error(`- ${problem.file}:${problem.line} -> ${problem.target} (${problem.reason})`);
  }
} else {
  console.log(`Checked ${links.filesChecked} tutorial Markdown files: all local links resolve.`);
}

if (failed) process.exitCode = 1;
