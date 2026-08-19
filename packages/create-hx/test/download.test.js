import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { downloadToFile } from '../src/download.js';

const fixturesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function startHttpsFixtureServer() {
  const [key, cert] = await Promise.all([
    readFile(path.join(fixturesPath, 'localhost-key.pem')),
    readFile(path.join(fixturesPath, 'localhost-cert.pem')),
  ]);
  const server = https.createServer({ key, cert }, (request, response) => {
    switch (request.url) {
      case '/archive':
        response.end('archive-bytes');
        return;
      case '/redirect':
        response.writeHead(302, { location: '/archive' });
        response.end();
        return;
      case '/loop':
        response.writeHead(302, { location: '/loop' });
        response.end();
        return;
      case '/large':
        response.end('12345');
        return;
      case '/stall':
        response.writeHead(200);
        response.write('a');
        return;
      default:
        response.writeHead(404);
        response.end('not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', resolve);
  });
  const address = server.address();

  return {
    origin: `https://localhost:${address.port}`,
    ca: cert,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function createDestination(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'create-hx-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, 'archive.tgz');
}

test('downloads bytes and follows a bounded HTTPS redirect', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);

  const result = await downloadToFile({
    url: `${fixture.origin}/redirect`,
    destination,
    ca: fixture.ca,
    timeoutMs: 1_000,
    maxBytes: 64,
    maxRedirects: 2,
  });

  assert.equal(await readFile(destination, 'utf8'), 'archive-bytes');
  assert.deepEqual(result, { bytes: 13, finalUrl: `${fixture.origin}/archive` });
});

test('rejects non-HTTPS and terminal non-2xx responses', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);

  await assert.rejects(
    () => downloadToFile({ url: 'http://localhost/archive', destination }),
    /HTTPS/,
  );
  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/missing`,
        destination,
        ca: fixture.ca,
      }),
    /404/,
  );
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});

test('rejects oversized and over-redirected responses', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);

  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/large`,
        destination,
        ca: fixture.ca,
        maxBytes: 4,
      }),
    /size limit/,
  );
  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/loop`,
        destination,
        ca: fixture.ca,
        maxRedirects: 1,
      }),
    /redirect limit/,
  );
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});

test('times out stalled downloads and removes partial output', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);

  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/stall`,
        destination,
        ca: fixture.ca,
        timeoutMs: 25,
      }),
    /timed out/,
  );
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});

test('aborts active downloads and removes partial output', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/stall`,
        destination,
        ca: fixture.ca,
        signal: controller.signal,
        timeoutMs: 1_000,
      }),
    /abort/i,
  );
  await assert.rejects(() => readFile(destination), { code: 'ENOENT' });
});

test('does not overwrite an existing destination', async (t) => {
  const fixture = await startHttpsFixtureServer();
  t.after(fixture.close);
  const destination = await createDestination(t);
  await writeFile(destination, 'keep');

  await assert.rejects(
    () =>
      downloadToFile({
        url: `${fixture.origin}/archive`,
        destination,
        ca: fixture.ca,
      }),
    /exist/i,
  );
  assert.equal(await readFile(destination, 'utf8'), 'keep');
});
