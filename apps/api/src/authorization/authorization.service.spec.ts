import { ForbiddenException } from '@nestjs/common';

import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  const actor = {
    userId: 'user-1',
    sessionId: 'session-1',
    sessionSecret: 'secret',
    csrfSecretHash: 'csrf-hash',
  };

  function createService(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | undefined) {
    const database = {
      membership: {
        findUnique: jest.fn().mockResolvedValue(role ? { role } : null),
      },
    };
    return {
      service: new AuthorizationService({} as never, database as never),
      database,
    };
  }

  it.each(['OWNER', 'ADMIN', 'MEMBER'] as const)('allows %s to create a project', async (role) => {
    const { service } = createService(role);
    await expect(
      service.requireOrganizationAction(actor, 'organization-1', 'create_project'),
    ).resolves.toEqual({ role });
  });

  it('prevents a viewer from creating a project', async () => {
    const { service } = createService('VIEWER');
    await expect(
      service.requireOrganizationAction(actor, 'organization-1', 'create_project'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents a non-member from reading organization projects', async () => {
    const { service } = createService(undefined);
    await expect(
      service.requireOrganizationAction(actor, 'organization-1', 'read'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
