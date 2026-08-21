import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArguments } from './arguments.js';
import { createProject } from './scaffold.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const HELP = `Usage: create-hx [directory]

Create a new Hx project in a missing or completely empty directory.

Arguments:
  directory      Target directory (default: current directory)

Options:
  -h, --help     Show this help
  -v, --version  Show the installed create-hx version
`;

function shellQuote(value) {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

function successMessage(cwd, targetPath) {
  const relativeTarget = path.relative(cwd, targetPath) || '.';
  const commands = [];
  if (relativeTarget !== '.') {
    commands.push(`cd ${shellQuote(relativeTarget)}`);
  }
  commands.push('git init', 'pnpm install', 'cp .env.example .env', 'docker compose up --build -d');
  return `Hx scaffold created at ${targetPath}.\n\n${commands.join('\n')}\n`;
}

export async function runCli(
  argv,
  {
    cwd = process.cwd(),
    stdout = process.stdout,
    stderr = process.stderr,
    env = process.env,
    processObject = process,
    createProjectImpl = createProject,
  } = {},
) {
  const controller = new AbortController();
  let signalExitCode = null;
  const onSigint = () => {
    signalExitCode = 130;
    controller.abort();
  };
  const onSigterm = () => {
    signalExitCode = 143;
    controller.abort();
  };
  processObject.once('SIGINT', onSigint);
  processObject.once('SIGTERM', onSigterm);

  try {
    const command = parseArguments(argv, { cwd, version });
    if (command.mode === 'help') {
      stdout.write(HELP);
      return 0;
    }
    if (command.mode === 'version') {
      stdout.write(`${command.version}\n`);
      return 0;
    }

    await createProjectImpl({
      targetPath: command.targetPath,
      projectName: command.projectName,
      signal: controller.signal,
    });
    if (signalExitCode !== null) {
      return signalExitCode;
    }
    stdout.write(successMessage(cwd, command.targetPath));
    return 0;
  } catch (error) {
    if (signalExitCode !== null) {
      return signalExitCode;
    }
    const message =
      env.CREATE_HX_DEBUG === '1' && error?.stack ? error.stack : `Error: ${error.message}`;
    stderr.write(`${message}\n`);
    return 1;
  } finally {
    processObject.removeListener('SIGINT', onSigint);
    processObject.removeListener('SIGTERM', onSigterm);
  }
}
