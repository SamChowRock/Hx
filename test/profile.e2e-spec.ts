import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../apps/api/src/app.module';
import { configureApplication } from '../apps/api/src/configure-application';
import { csrfToken, hashAuthSecret } from '../apps/api/src/identity/identity.service';
import { DatabaseService } from '../libs/platform/src/database';

const authSecret = 'profile-e2e-auth-secret-that-is-long-enough';
const webOrigin = 'http://localhost:5173';
const sessionSecret = 'profile-browser-session-secret';
const avatarPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWPQqLjznxLMMGrA/9EwuDMaBhXDIgwAswh7H8STHfwAAAAASUVORK5CYII=',
  'base64',
);

describe('user profile (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let userId: string;
  const cookie = `dev-session=${sessionSecret}`;
  const csrf = csrfToken(authSecret, sessionSecret);

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
    await database.$connect();
  });

  beforeEach(async () => {
    await database.$executeRawUnsafe(
      'TRUNCATE TABLE nickname_changes, outbox_events, oauth_profile_transactions, oidc_transactions, password_reset_intents, phone_registration_intents, registration_intents, audit_events, projects, memberships, organizations, sessions, password_credentials, user_contacts, external_identities, users CASCADE',
    );
    const user = await database.user.create({
      data: { displayName: 'Initial nickname' },
    });
    userId = user.id;
    await database.session.create({
      data: {
        userId,
        secretHash: hashAuthSecret(authSecret, sessionSecret),
        csrfSecretHash: hashAuthSecret(authSecret, csrf),
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads and updates nickname and bio without exposing internal storage keys', async () => {
    await request(app.getHttpServer())
      .get('/api/profile')
      .set('Cookie', cookie)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.objectContaining({
            id: userId,
            nickname: 'Initial nickname',
            bio: null,
            email: null,
            phone: null,
            avatarUrl: null,
            visibility: {
              bio: 'PRIVATE',
              avatar: 'PRIVATE',
              email: 'PRIVATE',
              phone: 'PRIVATE',
            },
            nicknameChangeQuota: {
              limit: 3,
              windowDays: 30,
              used: 0,
              remaining: 3,
              nextChangeAllowedAt: null,
            },
          }),
        ),
      );

    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ nickname: '  New   nickname  ', bio: 'Backend learner\r\nBuilding carefully.' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.nickname).toBe('New nickname');
        expect(body.bio).toBe('Backend learner\nBuilding carefully.');
        expect(body.nicknameChangeQuota).toEqual(
          expect.objectContaining({ used: 1, remaining: 2 }),
        );
        expect(body).not.toHaveProperty('avatarObjectKey');
      });

    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .send({ bio: 'Missing CSRF' })
      .expect(403);

    await expect(database.auditEvent.count({ where: { actorUserId: userId } })).resolves.toBe(2);
  });

  it('limits normalized nicknames to 16 Unicode code points', async () => {
    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ nickname: '一'.repeat(17) })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ nickname: '一'.repeat(16) })
      .expect(200)
      .expect(({ body }) => expect(body.nickname).toBe('一'.repeat(16)));
  });

  it('allows authenticated reads of active users but keeps writes actor-bound', async () => {
    await request(app.getHttpServer()).get('/api/profile').expect(401);

    await database.user.update({
      where: { id: userId },
      data: { bio: 'Share only when I opt in.' },
    });
    await database.userContact.createMany({
      data: [
        {
          userId,
          type: 'EMAIL',
          normalizedValue: 'profile@example.com',
          verifiedAt: new Date(),
        },
        {
          userId,
          type: 'PHONE',
          normalizedValue: '+8613800138000',
          verifiedAt: new Date(),
        },
      ],
    });

    const otherSecret = 'other-profile-browser-session-secret';
    const otherCsrf = csrfToken(authSecret, otherSecret);
    const otherCookie = `dev-session=${otherSecret}`;
    const otherUser = await database.user.create({ data: { displayName: 'Other user' } });
    await database.session.create({
      data: {
        userId: otherUser.id,
        secretHash: hashAuthSecret(authSecret, otherSecret),
        csrfSecretHash: hashAuthSecret(authSecret, otherCsrf),
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await request(app.getHttpServer())
      .get(`/api/profile?userId=${userId}`)
      .set('Cookie', otherCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.id).toBe(otherUser.id);
        expect(body.nickname).toBe('Other user');
      });

    await request(app.getHttpServer())
      .get(`/api/profiles/${userId}`)
      .set('Cookie', otherCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          id: userId,
          nickname: 'Initial nickname',
          bio: null,
          avatarUrl: null,
          email: null,
          phone: null,
        });
        expect(body).not.toHaveProperty('nicknameChangeQuota');
        expect(body).not.toHaveProperty('visibility');
      });

    await request(app.getHttpServer())
      .patch('/api/profile/visibility')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ bio: 'AUTHENTICATED', email: 'AUTHENTICATED' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.visibility).toEqual({
          bio: 'AUTHENTICATED',
          avatar: 'PRIVATE',
          email: 'AUTHENTICATED',
          phone: 'PRIVATE',
        });
        expect(body.email).toBe('profile@example.com');
        expect(body.phone).toBe('+8613800138000');
      });

    await request(app.getHttpServer())
      .get(`/api/profiles/${userId}`)
      .set('Cookie', otherCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.bio).toBe('Share only when I opt in.');
        expect(body.email).toBe('profile@example.com');
        expect(body.phone).toBeNull();
      });

    await request(app.getHttpServer())
      .patch('/api/profile/visibility')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'PRIVATE' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/profiles/${userId}`)
      .set('Cookie', otherCookie)
      .expect(200)
      .expect(({ body }) => {
        expect(body.bio).toBe('Share only when I opt in.');
        expect(body.email).toBeNull();
      });

    await request(app.getHttpServer()).get(`/api/profiles/${userId}`).expect(401);

    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', otherCookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', otherCsrf)
      .send({ userId, nickname: 'Unauthorized edit' })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/profile/visibility')
      .set('Cookie', otherCookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', otherCsrf)
      .send({ userId, phone: 'AUTHENTICATED' })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/profiles/${userId}`)
      .set('Cookie', otherCookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', otherCsrf)
      .send({ nickname: 'Unauthorized edit' })
      .expect(404);

    await expect(database.user.findUniqueOrThrow({ where: { id: userId } })).resolves.toEqual(
      expect.objectContaining({ displayName: 'Initial nickname' }),
    );
  });

  it('enforces three nickname changes per rolling 30 days under concurrency', async () => {
    const responses = await Promise.all(
      ['One', 'Two', 'Three', 'Four'].map((nickname) =>
        request(app.getHttpServer())
          .patch('/api/profile')
          .set('Cookie', cookie)
          .set('Origin', webOrigin)
          .set('X-CSRF-Token', csrf)
          .send({ nickname }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(3);
    const limited = responses.filter((response) => response.status === 429);
    expect(limited).toHaveLength(1);
    expect(limited[0].body).toEqual(
      expect.objectContaining({
        code: 'NICKNAME_CHANGE_LIMIT',
        retryAt: expect.any(String),
      }),
    );
    expect(limited[0].headers['retry-after']).toEqual(expect.any(String));
    await expect(database.nicknameChange.count({ where: { userId } })).resolves.toBe(3);
  });

  it('does not count nickname changes older than the rolling window', async () => {
    await database.nicknameChange.createMany({
      data: [31, 32, 33].map((daysAgo) => ({
        userId,
        changedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      })),
    });

    await request(app.getHttpServer())
      .patch('/api/profile')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ nickname: 'Allowed again' })
      .expect(200)
      .expect(({ body }) =>
        expect(body.nicknameChangeQuota).toEqual(
          expect.objectContaining({ used: 1, remaining: 2 }),
        ),
      );
  });

  it('normalizes a verified avatar into private WebP storage and supports removal', async () => {
    const upload = await request(app.getHttpServer())
      .put('/api/profile/avatar')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .attach('file', avatarPng, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);
    expect(upload.body.avatarUrl).toMatch(/^\/api\/profile\/avatar\?v=\d+$/);

    const storedUser = await database.user.findUniqueOrThrow({ where: { id: userId } });
    expect(storedUser.avatarObjectKey).toMatch(new RegExp(`^avatars/${userId}/[0-9a-f-]+[.]webp$`));

    const viewerSecret = 'profile-avatar-viewer-session-secret';
    const viewer = await database.user.create({ data: { displayName: 'Avatar viewer' } });
    await database.session.create({
      data: {
        userId: viewer.id,
        secretHash: hashAuthSecret(authSecret, viewerSecret),
        csrfSecretHash: hashAuthSecret(authSecret, csrfToken(authSecret, viewerSecret)),
        absoluteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await request(app.getHttpServer())
      .get('/api/profile/avatar')
      .set('Cookie', cookie)
      .expect('Content-Type', /image\/webp/)
      .expect(200)
      .expect(({ body }) => {
        const bytes = body as Buffer;
        expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
        expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
      });

    await request(app.getHttpServer())
      .get(`/api/profiles/${userId}/avatar`)
      .set('Cookie', `dev-session=${viewerSecret}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch('/api/profile/visibility')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .send({ avatar: 'AUTHENTICATED' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/profiles/${userId}/avatar`)
      .set('Cookie', `dev-session=${viewerSecret}`)
      .expect('Content-Type', /image\/webp/)
      .expect(200);

    await request(app.getHttpServer())
      .put('/api/profile/avatar')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
        filename: 'avatar.png',
        contentType: 'image/png',
      })
      .expect(400);

    await request(app.getHttpServer())
      .delete('/api/profile/avatar')
      .set('Cookie', cookie)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrf)
      .expect(200)
      .expect(({ body }) => expect(body.avatarUrl).toBeNull());
    await request(app.getHttpServer()).get('/api/profile/avatar').set('Cookie', cookie).expect(404);
  });
});
