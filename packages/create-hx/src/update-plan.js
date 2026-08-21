const SHA256 = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return (
    value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertRepositoryPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[a-zA-Z]:/.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Update plan path must be a normalized repository-relative path: ${value}`);
  }
}

function assertFingerprint(value, label, { nullable = false } = {}) {
  if (nullable && value === null) {
    return;
  }
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'sha256') ||
    !Object.hasOwn(value, 'executable') ||
    !SHA256.test(value.sha256) ||
    typeof value.executable !== 'boolean'
  ) {
    throw new Error(`Update plan fingerprint is invalid for ${label}.`);
  }
}

function validateFiles(files, label, options) {
  if (!isPlainObject(files)) {
    throw new Error(`Update plan ${label} must be a plain object.`);
  }
  for (const [repositoryPath, fingerprint] of Object.entries(files)) {
    assertRepositoryPath(repositoryPath);
    assertFingerprint(fingerprint, repositoryPath, options);
  }
}

function fingerprintsEqual(left, right) {
  return (
    left !== null &&
    right !== null &&
    left.sha256 === right.sha256 &&
    left.executable === right.executable
  );
}

function freezePlan(plan) {
  for (const key of ['add', 'replace', 'delete', 'preserve', 'adopted']) {
    plan[key].sort((left, right) => left.localeCompare(right, 'en'));
    Object.freeze(plan[key]);
  }
  plan.conflicts.sort((left, right) => left.path.localeCompare(right.path, 'en'));
  for (const conflict of plan.conflicts) {
    Object.freeze(conflict);
  }
  Object.freeze(plan.conflicts);
  return Object.freeze(plan);
}

export function planTemplateUpdate({ baselineFiles, localFiles, incomingFiles, adopt = false }) {
  validateFiles(baselineFiles, 'baselineFiles');
  validateFiles(localFiles, 'localFiles', { nullable: true });
  validateFiles(incomingFiles, 'incomingFiles');
  if (typeof adopt !== 'boolean') {
    throw new Error('Update plan adopt flag must be a boolean.');
  }
  if (adopt && Object.keys(baselineFiles).length !== 0) {
    throw new Error('Update plan adoption mode cannot have a baseline.');
  }

  const plan = {
    add: [],
    replace: [],
    delete: [],
    preserve: [],
    conflicts: [],
    adopted: [],
  };
  const controlledPaths = new Set([...Object.keys(baselineFiles), ...Object.keys(incomingFiles)]);

  for (const repositoryPath of controlledPaths) {
    const baseline = baselineFiles[repositoryPath] ?? null;
    const local = localFiles[repositoryPath] ?? null;
    const incoming = incomingFiles[repositoryPath] ?? null;

    if (baseline === null && incoming !== null) {
      if (local === null) {
        plan.add.push(repositoryPath);
      } else if (fingerprintsEqual(local, incoming)) {
        plan.adopted.push(repositoryPath);
      } else {
        plan.conflicts.push({ path: repositoryPath, reason: 'existing-file-differs' });
      }
      continue;
    }

    if (baseline !== null && incoming === null) {
      if (local !== null && fingerprintsEqual(local, baseline)) {
        plan.delete.push(repositoryPath);
      } else if (local !== null) {
        plan.preserve.push(repositoryPath);
      }
      continue;
    }

    if (baseline === null || incoming === null) {
      continue;
    }

    if (local === null) {
      if (fingerprintsEqual(incoming, baseline)) {
        plan.preserve.push(repositoryPath);
      } else {
        plan.conflicts.push({
          path: repositoryPath,
          reason: 'local-deleted-incoming-changed',
        });
      }
    } else if (fingerprintsEqual(local, baseline)) {
      if (!fingerprintsEqual(incoming, baseline)) {
        plan.replace.push(repositoryPath);
      }
    } else if (fingerprintsEqual(incoming, baseline)) {
      plan.preserve.push(repositoryPath);
    } else {
      plan.conflicts.push({
        path: repositoryPath,
        reason: 'local-and-incoming-changed',
      });
    }
  }

  return freezePlan(plan);
}
