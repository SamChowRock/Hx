import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

import {
  renderProjectFacts,
  repositoryPath,
  repositoryRoot,
  toPosix,
  tutorialRoot,
  walkFiles,
} from './project-facts.mjs';

export function findProjectFactDrift() {
  const expected = renderProjectFacts();
  const problems = [];

  for (const [path, content] of expected) {
    const absolutePath = repositoryPath(path);
    if (!existsSync(absolutePath)) {
      problems.push({ path, reason: 'missing' });
      continue;
    }
    if (readFileSync(absolutePath, 'utf8') !== content) {
      problems.push({ path, reason: 'outdated' });
    }
  }

  const generatedRoot = repositoryPath('tutorials/nestjs-backend/generated');
  if (existsSync(generatedRoot)) {
    const expectedPaths = new Set(expected.keys());
    for (const file of walkFiles(generatedRoot, (path) => extname(path) === '.md')) {
      const path = toPosix(relative(repositoryRoot, file));
      if (!expectedPaths.has(path)) problems.push({ path, reason: 'unexpected generated file' });
    }
  }

  return problems;
}

function markdownWithoutFencedCode(source) {
  return source.replace(/^```[\s\S]*?^```\s*$/gm, (block) => block.replace(/[^\n]/g, ' '));
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function findBrokenTutorialLinks() {
  const problems = [];
  const markdownFiles = walkFiles(tutorialRoot, (path) => extname(path) === '.md');

  for (const file of markdownFiles) {
    const original = readFileSync(file, 'utf8');
    const source = markdownWithoutFencedCode(original);
    const expression = /\[[^\]]*\]\(([^)]+)\)/g;

    for (const match of source.matchAll(expression)) {
      let target = match[1].trim().replace(/^<|>$/g, '');
      if (/^(https?:|mailto:|tel:|data:|#)/.test(target)) continue;

      target = target.split('#')[0];
      if (!target) continue;

      try {
        target = decodeURIComponent(target);
      } catch {
        problems.push({
          file: toPosix(relative(repositoryRoot, file)),
          line: lineNumber(source, match.index),
          target: match[1],
          reason: 'invalid URL encoding',
        });
        continue;
      }

      const absoluteTarget = target.startsWith('/') ? target : resolve(dirname(file), target);
      if (!existsSync(absoluteTarget)) {
        problems.push({
          file: toPosix(relative(repositoryRoot, file)),
          line: lineNumber(source, match.index),
          target: match[1],
          reason: 'target does not exist',
        });
      }
    }
  }

  return { filesChecked: markdownFiles.length, problems };
}

export function unexpectedGeneratedEntries() {
  const directory = repositoryPath('tutorials/nestjs-backend/generated');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter((name) => !name.endsWith('.md'));
}
