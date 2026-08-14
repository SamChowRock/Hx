# Tasks 真实数据库 E2E

> [返回教程首页](../README.md) · [本模块目录](README.md)

## 11.10 第十步：给 Tasks 写 E2E

新建 `test/tasks.e2e-spec.ts`。以下模板展示完整应用启动、数据准备、Session Cookie、CSRF 和数据库结果断言：

```ts
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../apps/api/src/app.module';
import { configureApplication } from '../apps/api/src/configure-application';
import { csrfToken, hashAuthSecret } from '../apps/api/src/identity/identity.service';
import { DatabaseService } from '../libs/platform/src/database';

const authSecret = 'e2e-auth-secret-that-is-long-enough-for-validation';
const webOrigin = 'http://localhost:5173';
const organizationA = '00000000-0000-0000-0000-000000000001';
const organizationB = '00000000-0000-0000-0000-000000000002';
const projectA = '00000000-0000-0000-0000-000000000101';
const projectB = '00000000-0000-0000-0000-000000000102';
const ownerId = '00000000-0000-0000-0000-000000000011';
const viewerId = '00000000-0000-0000-0000-000000000012';
const ownerSecret = 'owner-session-secret';
const viewerSecret = 'viewer-session-secret';

describe('tasks (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??=
      'postgresql://scaffold:scaffold@localhost:5432/scaffold?schema=public';
    process.env.AUTH_SECRET = authSecret;
    process.env.WEB_APP_ORIGIN = webOrigin;
    process.env.API_PUBLIC_ORIGIN = 'http://localhost:3000';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    await database.$connect();
  });

  beforeEach(async () => {
    await database.$executeRawUnsafe(
      'TRUNCATE TABLE tasks, outbox_events, oidc_transactions, password_reset_intents, phone_registration_intents, registration_intents, audit_events, projects, memberships, organizations, sessions, password_credentials, user_contacts, external_identities, users CASCADE',
    );

    await database.organization.createMany({
      data: [
        { id: organizationA, name: 'Organization A' },
        { id: organizationB, name: 'Organization B' },
      ],
    });
    await database.user.createMany({
      data: [
        { id: ownerId, displayName: 'Owner' },
        { id: viewerId, displayName: 'Viewer' },
      ],
    });
    await database.membership.createMany({
      data: [
        { userId: ownerId, organizationId: organizationA, role: 'OWNER' },
        { userId: viewerId, organizationId: organizationA, role: 'VIEWER' },
      ],
    });
    await database.project.createMany({
      data: [
        { id: projectA, organizationId: organizationA, name: 'Project A' },
        { id: projectB, organizationId: organizationB, name: 'Project B' },
      ],
    });

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await database.session.createMany({
      data: [
        { userId: ownerId, secret: ownerSecret },
        { userId: viewerId, secret: viewerSecret },
      ].map(({ userId, secret }) => ({
        userId,
        secretHash: hashAuthSecret(authSecret, secret),
        csrfSecretHash: hashAuthSecret(authSecret, csrfToken(authSecret, secret)),
        absoluteExpiresAt: expiresAt,
        idleExpiresAt: expiresAt,
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function cookie(secret: string): string {
    return `dev-session=${secret}`;
  }

  it('allows an owner to create and list a task', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/organizations/${organizationA}/projects/${projectA}/tasks`)
      .set('Cookie', cookie(ownerSecret))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, ownerSecret))
      .send({ title: 'Learn NestJS deeply' })
      .expect(201);

    expect(created.body).toEqual(
      expect.objectContaining({ id: expect.any(String), title: 'Learn NestJS deeply' }),
    );
    await expect(
      database.auditEvent.count({
        where: { action: 'task.created', targetId: created.body.id as string },
      }),
    ).resolves.toBe(1);

    await request(app.getHttpServer())
      .get(`/api/organizations/${organizationA}/projects/${projectA}/tasks`)
      .set('Cookie', cookie(ownerSecret))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual([
          expect.objectContaining({ id: created.body.id, title: 'Learn NestJS deeply' }),
        ]),
      );
  });

  it('blocks a viewer from creating a task', async () => {
    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationA}/projects/${projectA}/tasks`)
      .set('Cookie', cookie(viewerSecret))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, viewerSecret))
      .send({ title: 'Forbidden task' })
      .expect(403);

    await expect(database.task.count()).resolves.toBe(0);
  });

  it('does not reveal a project from another organization', async () => {
    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationA}/projects/${projectB}/tasks`)
      .set('Cookie', cookie(ownerSecret))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, ownerSecret))
      .send({ title: 'Cross-tenant task' })
      .expect(404);

    await expect(database.task.count()).resolves.toBe(0);
  });

  it('returns Problem Details for an invalid title', async () => {
    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationA}/projects/${projectA}/tasks`)
      .set('Cookie', cookie(ownerSecret))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, ownerSecret))
      .send({ title: '   ' })
      .expect('Content-Type', /application\/problem\+json/)
      .expect(400)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.objectContaining({ title: 'Invalid request', errors: expect.any(Array) }),
        ),
      );
  });
});
```

运行前确保 Tasks Migration 已执行。然后：

```bash
docker compose up --detach --wait postgres
pnpm prisma:migrate:deploy
pnpm exec jest --config jest.e2e.config.cjs --runInBand test/tasks.e2e-spec.ts
```

运行全部 E2E 时仍使用 `pnpm test:e2e`。当前 Script 已经固定 `--runInBand`，不要再追加第二个同名参数。
