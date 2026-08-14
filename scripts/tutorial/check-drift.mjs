import { findProjectFactDrift } from './validators.mjs';

const problems = findProjectFactDrift();

if (problems.length) {
  console.error('Tutorial project facts have drifted:');
  for (const problem of problems) {
    console.error(`- ${problem.path}: ${problem.reason}`);
  }
  console.error('\nRun `pnpm tutorial:generate`, review the result, and commit it.');
  process.exitCode = 1;
} else {
  console.log('Tutorial project facts match the current repository.');
}
