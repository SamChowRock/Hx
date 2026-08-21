import path from 'node:path';
import { UsageError } from './errors.js';

const MAX_PACKAGE_NAME_LENGTH = 214;
const SAFE_UNSCOPED_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_NAMES = new Set(['node_modules', 'favicon.ico']);

export function validateProjectName(name) {
  if (
    name.length === 0 ||
    name.length > MAX_PACKAGE_NAME_LENGTH ||
    !SAFE_UNSCOPED_NAME.test(name) ||
    RESERVED_NAMES.has(name)
  ) {
    throw new UsageError(
      `Invalid project name "${name}". Use a lowercase directory name such as "my-app".`,
    );
  }

  return name;
}

export function parseArguments(argv, { cwd, version }) {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return { mode: 'help' };
  }

  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) {
    return { mode: 'version', version };
  }

  const updateCount = argv.filter((argument) => argument === '--update').length;
  if (updateCount > 1) {
    throw new UsageError('The --update option may be used only once.');
  }
  if (updateCount === 1) {
    const positional = argv.filter((argument) => argument !== '--update');
    const incompatible = positional.find((argument) => argument.startsWith('-'));
    if (incompatible) {
      throw new UsageError(`The --update option cannot be combined with ${incompatible}.`);
    }
    if (positional.length > 1) {
      throw new UsageError('Expected at most one directory argument with --update.');
    }
    return {
      mode: 'update',
      targetPath: path.resolve(cwd, positional[0] ?? '.'),
    };
  }

  const unknown = argv.find((argument) => argument.startsWith('-'));
  if (unknown) {
    throw new UsageError(`Unknown option: ${unknown}`);
  }

  if (argv.length > 1) {
    throw new UsageError('Expected at most one directory argument.');
  }

  const targetPath = path.resolve(cwd, argv[0] ?? '.');
  const projectName = validateProjectName(path.basename(targetPath));

  return { mode: 'scaffold', targetPath, projectName };
}
