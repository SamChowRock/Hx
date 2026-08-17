import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { filter, firstValueFrom, share, timeout } from 'rxjs';
import request from 'supertest';

import { AppModule } from '../apps/api/src/app.module';
import { configureApplication } from '../apps/api/src/configure-application';
import { csrfToken, hashAuthSecret } from '../apps/api/src/identity/identity.service';
import { NotificationsService } from '../apps/api/src/notifications/notifications.service';
import { DatabaseService } from '../libs/platform/src/database';

const authSecret = 'notification-e2e-auth-secret-that-is-long-enough';
const webOrigin = 'http://localhost:5173';
const firstUserId = '00000000-0000-0000-0000-000000000101';
const secondUserId = '00000000-0000-0000-0000-000000000102';
const organizationId = '00000000-0000-0000-0000-000000000103';
const firstSession = 'notification-first-session-secret';
const secondSession = 'notification-second-session-secret';

describe('user notifications (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let notifications: NotificationsService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??=
      'postgresql://scaffold:scaffold@localhost:5432/scaffold?schema=public';
    process.env.AUTH_SECRET = authSecret;
    process.env.WEB_APP_ORIGIN = webOrigin;
    process.env.API_PUBLIC_ORIGIN = 'http://localhost:3000';
    process.env.OBJECT_STORAGE_ENDPOINT = 'http://localhost:9000';
    process.env.OBJECT_STORAGE_REGION = 'us-east-1';
    process.env.OBJECT_STORAGE_ACCESS_KEY = 'minioadmin';
    process.env.OBJECT_STORAGE_SECRET_KEY = 'minioadmin';
    process.env.OBJECT_STORAGE_BUCKET = 'user-content';
    process.env.OBJECT_STORAGE_FORCE_PATH_STYLE = 'true';

    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    notifications = app.get(NotificationsService);
    await database.$connect();
  });

  beforeEach(async () => {
    await database.$executeRawUnsafe(
      'TRUNCATE TABLE nickname_changes, notifications, outbox_events, oauth_profile_transactions, oidc_transactions, password_reset_intents, phone_registration_intents, registration_intents, audit_events, projects, memberships, organizations, sessions, password_credentials, user_contacts, external_identities, users CASCADE',
    );
    await database.user.createMany({
      data: [
        { id: firstUserId, displayName: 'First user' },
        { id: secondUserId, displayName: 'Second user' },
      ],
    });
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await database.session.createMany({
      data: [
        {
          userId: firstUserId,
          secretHash: hashAuthSecret(authSecret, firstSession),
          csrfSecretHash: hashAuthSecret(authSecret, csrfToken(authSecret, firstSession)),
          absoluteExpiresAt: expiry,
          idleExpiresAt: expiry,
        },
        {
          userId: secondUserId,
          secretHash: hashAuthSecret(authSecret, secondSession),
          csrfSecretHash: hashAuthSecret(authSecret, csrfToken(authSecret, secondSession)),
          absoluteExpiresAt: expiry,
          idleExpiresAt: expiry,
        },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const cookie = (secret: string) => `dev-session=${secret}`;

  it('lists active notifications with cursor pagination, unread count, and deduplication', async () => {
    await notifications.create({
      userId: firstUserId,
      kind: 'account.security',
      severity: 'WARNING',
      title: 'Security reminder',
      body: 'Review your active sessions.',
      actionUrl: '/settings/security',
      dedupeKey: 'security-reminder:1',
    });
    await notifications.create({
      userId: firstUserId,
      kind: 'organization.member.added',
      severity: 'SUCCESS',
      title: 'Organization access granted',
      body: 'You can now access the organization.',
      dedupeKey: 'membership:1',
    });
    await notifications.create({
      userId: firstUserId,
      kind: 'account.security',
      severity: 'WARNING',
      title: 'Duplicate security reminder',
      body: 'This payload must not create a second record.',
      dedupeKey: 'security-reminder:1',
    });
    await database.notification.create({
      data: {
        userId: firstUserId,
        kind: 'temporary.notice',
        title: 'Expired notice',
        body: 'This notification is no longer active.',
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    await request(app.getHttpServer())
      .get('/api/notifications/unread-count')
      .set('Cookie', cookie(firstSession))
      .expect(200)
      .expect({ unreadCount: 2 });

    const firstPage = await request(app.getHttpServer())
      .get('/api/notifications?limit=1&unreadOnly=true')
      .set('Cookie', cookie(firstSession))
      .expect(200);
    expect(firstPage.body.data).toHaveLength(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));
    expect(firstPage.body.meta).toEqual({ unreadCount: 2 });
    expect(firstPage.body.data[0]).not.toHaveProperty('userId');
    expect(firstPage.body.data[0]).not.toHaveProperty('dedupeKey');

    const secondPage = await request(app.getHttpServer())
      .get(
        `/api/notifications?limit=1&unreadOnly=true&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`,
      )
      .set('Cookie', cookie(firstSession))
      .expect(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.data[0].id).not.toBe(firstPage.body.data[0].id);
    expect(secondPage.body.nextCursor).toBeNull();
    await expect(database.notification.count({ where: { userId: firstUserId } })).resolves.toBe(3);
  });

  it('binds reads and mutations to the authenticated user and supports read and clear flows', async () => {
    const own = await notifications.create({
      userId: firstUserId,
      kind: 'account.notice',
      title: 'First notice',
      body: 'Owned by the first user.',
    });
    const other = await notifications.create({
      userId: secondUserId,
      kind: 'account.notice',
      title: 'Second notice',
      body: 'Owned by the second user.',
    });

    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer()).get('/api/notifications/stream').expect(401);
    await request(app.getHttpServer())
      .patch(`/api/notifications/${other.id}/read`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/api/notifications/${own.id}/read`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/notifications/${own.id}/read`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(200)
      .expect(({ body }) => {
        expect(body.notification.readAt).toEqual(expect.any(String));
        expect(body.unreadCount).toBe(0);
      });
    await request(app.getHttpServer())
      .patch(`/api/notifications/${own.id}/read`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(200)
      .expect(({ body }) => expect(body.unreadCount).toBe(0));

    await notifications.create({
      userId: firstUserId,
      kind: 'account.notice',
      title: 'Another notice',
      body: 'Mark all should consume this notice.',
    });
    await request(app.getHttpServer())
      .patch('/api/notifications/read-all')
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(200)
      .expect(({ body }) => {
        expect(body.updatedCount).toBe(1);
        expect(body.unreadCount).toBe(0);
      });

    await request(app.getHttpServer())
      .delete('/api/notifications/read')
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(200)
      .expect({ deletedCount: 2, unreadCount: 0 });
    await expect(database.notification.count({ where: { userId: firstUserId } })).resolves.toBe(0);
    await expect(database.notification.count({ where: { userId: secondUserId } })).resolves.toBe(1);

    const dismissible = await notifications.create({
      userId: firstUserId,
      kind: 'account.notice',
      title: 'Dismissible notice',
      body: 'The user can remove this without reading it.',
    });
    await request(app.getHttpServer())
      .delete(`/api/notifications/${dismissible.id}`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .expect(200)
      .expect({ deleted: true, unreadCount: 0 });
  });

  it('pushes newly created notifications to the recipient SSE stream', async () => {
    const eventPromise = firstValueFrom(
      notifications.stream(firstUserId).pipe(
        filter((event) => event.type === 'notification'),
        timeout(2_000),
      ),
    );
    const created = await notifications.create({
      userId: firstUserId,
      kind: 'realtime.notice',
      title: 'Live update',
      body: 'This notification should arrive without polling.',
    });

    const event = await eventPromise;
    expect(event.id).toBe(created.id);
    expect(event.data).toEqual(expect.objectContaining({ title: 'Live update' }));

    const reconciledStream = notifications.stream(firstUserId).pipe(share());
    const snapshotPromise = firstValueFrom(
      reconciledStream.pipe(
        filter((streamEvent) => streamEvent.type === 'snapshot'),
        timeout(2_000),
      ),
    );
    const reconciledNotificationPromise = firstValueFrom(
      reconciledStream.pipe(
        filter((streamEvent) => streamEvent.type === 'notification'),
        timeout(7_000),
      ),
    );
    const reconciledCountPromise = firstValueFrom(
      reconciledStream.pipe(
        filter(
          (streamEvent) =>
            streamEvent.type === 'unread-count' &&
            (streamEvent.data as { unreadCount?: number }).unreadCount === 2,
        ),
        timeout(7_000),
      ),
    );
    await snapshotPromise;
    const externallyCreated = await database.notification.create({
      data: {
        userId: firstUserId,
        kind: 'worker.notice',
        severity: 'INFO',
        title: 'Worker update',
        body: 'This simulates an insert from another process.',
      },
    });

    const [reconciledNotification, reconciledCount] = await Promise.all([
      reconciledNotificationPromise,
      reconciledCountPromise,
    ]);
    expect(reconciledNotification.id).toBe(externallyCreated.id);
    expect(reconciledCount.data).toEqual({ unreadCount: 2 });
  }, 10_000);

  it('writes an idempotent notification outbox event when an owner adds a member', async () => {
    await database.organization.create({
      data: {
        id: organizationId,
        name: 'Production learning group',
        memberships: { create: { userId: firstUserId, role: 'OWNER' } },
      },
    });
    await database.userContact.create({
      data: {
        userId: secondUserId,
        type: 'EMAIL',
        normalizedValue: 'second@example.test',
        verifiedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/members`)
      .set('Cookie', cookie(firstSession))
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfToken(authSecret, firstSession))
      .send({ email: 'SECOND@example.test', role: 'MEMBER' })
      .expect(201);

    const event = await database.outboxEvent.findFirstOrThrow({
      where: { type: 'notification.create' },
    });
    expect(event.payload).toEqual(
      expect.objectContaining({
        userId: secondUserId,
        kind: 'organization.member.added',
        severity: 'SUCCESS',
        actionUrl: `/organizations/${organizationId}`,
        dedupeKey: expect.stringMatching(/^organization\.member\.added:/u),
      }),
    );
    await expect(database.membership.count({ where: { userId: secondUserId } })).resolves.toBe(1);
  });
});
