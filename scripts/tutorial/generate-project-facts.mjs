import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { renderProjectFacts, repositoryPath } from './project-facts.mjs';

let changed = 0;
let unchanged = 0;

for (const [path, content] of renderProjectFacts()) {
  const absolutePath = repositoryPath(path);
  let current;
  try {
    current = readFileSync(absolutePath, 'utf8');
  } catch {
    current = undefined;
  }

  if (current === content) {
    unchanged += 1;
    console.log(`unchanged ${path}`);
    continue;
  }

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  changed += 1;
  console.log(`generated ${path}`);
}

console.log(`Project facts complete: ${changed} changed, ${unchanged} unchanged.`);
