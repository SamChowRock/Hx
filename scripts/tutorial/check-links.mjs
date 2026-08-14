import { findBrokenTutorialLinks } from './validators.mjs';

const result = findBrokenTutorialLinks();

if (result.problems.length) {
  console.error('Broken tutorial links:');
  for (const problem of result.problems) {
    console.error(`- ${problem.file}:${problem.line} -> ${problem.target} (${problem.reason})`);
  }
  process.exitCode = 1;
} else {
  console.log(`Checked ${result.filesChecked} tutorial Markdown files: all local links resolve.`);
}
