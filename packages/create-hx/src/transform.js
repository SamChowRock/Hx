import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const START = /^[ \t]*# hx-template:exclude-start ([a-z0-9-]+)$/;
const END = /^[ \t]*# hx-template:exclude-end ([a-z0-9-]+)$/;
const PROJECT_NAME_TOKEN = '{{PROJECT_NAME}}';

function resolveWithin(stagingPath, repositoryPath) {
  const resolved = path.resolve(stagingPath, repositoryPath);
  const relative = path.relative(stagingPath, resolved);

  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Template path escapes staging: ${repositoryPath}`);
  }

  return resolved;
}

export function stripNamedBlocks(source, names) {
  const required = new Set(names);
  const seen = new Set();
  const output = [];
  let open = null;

  for (const line of source.split(/(?<=\n)/)) {
    const bare = line.replace(/\r?\n$/, '');
    const start = bare.match(START);
    const end = bare.match(END);

    if (start) {
      const name = start[1];
      if (open) {
        throw new Error(`Nested template block: ${name}`);
      }
      if (!required.has(name)) {
        throw new Error(`Unknown template block: ${name}`);
      }
      if (seen.has(name)) {
        throw new Error(`Duplicate template block: ${name}`);
      }
      open = name;
      seen.add(name);
      continue;
    }

    if (end) {
      const name = end[1];
      if (open !== name) {
        throw new Error(`Unmatched template block end: ${name}`);
      }
      open = null;
      continue;
    }

    if (!open) {
      output.push(line);
    }
  }

  if (open) {
    throw new Error(`Unclosed template block: ${open}`);
  }

  for (const name of required) {
    if (!seen.has(name)) {
      throw new Error(`Missing template block: ${name}`);
    }
  }

  return output.join('');
}

export function transformPackageJson(source, projectName, prefixes) {
  const packageJson = JSON.parse(source);
  packageJson.name = projectName;
  packageJson.scripts = Object.fromEntries(
    Object.entries(packageJson.scripts ?? {}).filter(
      ([name]) => !prefixes.some((prefix) => name.startsWith(prefix)),
    ),
  );

  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function replaceProjectNameToken(source, projectName) {
  const parts = source.split(PROJECT_NAME_TOKEN);
  if (parts.length !== 2) {
    throw new Error('README overlay must contain exactly one {{PROJECT_NAME}} token.');
  }

  return `${parts[0]}${projectName}${parts[1]}`;
}

export async function applyTemplateTransforms({ stagingPath, projectName, manifest, overlays }) {
  for (const [destination, source] of Object.entries(manifest.overrides)) {
    if (!overlays.has(source)) {
      throw new Error(`Missing template overlay: ${source}`);
    }

    const overlay = overlays.get(source);
    const transformed =
      destination === 'README.md' ? replaceProjectNameToken(overlay, projectName) : overlay;
    await writeFile(resolveWithin(stagingPath, destination), transformed);
  }

  for (const [repositoryPath, names] of Object.entries(manifest.stripBlocks)) {
    const filePath = resolveWithin(stagingPath, repositoryPath);
    const source = await readFile(filePath, 'utf8');
    await writeFile(filePath, stripNamedBlocks(source, names));
  }

  const packageJsonPath = resolveWithin(stagingPath, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  await writeFile(
    packageJsonPath,
    transformPackageJson(packageJson, projectName, manifest.packageJson.removeScriptPrefixes),
  );
}
