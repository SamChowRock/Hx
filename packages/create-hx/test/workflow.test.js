import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('publish workflow enforces trusted-publishing prerequisites without a token', async () => {
  const workflow = await readFile(
    path.join(repositoryPath, '.github/workflows/publish-create-hx.yml'),
    'utf8',
  );

  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /minor === 5 && patch < 1/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|--provenance/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /create-hx-v\$\{PACKAGE_VERSION\}/);

  const packageJson = JSON.parse(
    await readFile(path.join(repositoryPath, 'packages/create-hx/package.json'), 'utf8'),
  );
  assert.equal(packageJson.version, '0.2.0');
});
