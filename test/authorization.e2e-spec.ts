import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../apps/api/src/app.module';
import { configureApplication } from '../apps/api/src/configure-application';
import { csrfToken, hashAuthSecret } from '../apps/api/src/identity/identity.service';
import { DatabaseService } from '../libs/platform/src/database';

const authSecret = 'e2e-auth-secret-that-is-long-enough-for-validation';
const organizationId = '00000000-0000-0000-0000-000000000001';
const ownerId = '00000000-0000-0000-0000-000000000011';
const viewerId = '00000000-0000-0000-0000-000000000012';
const outsiderId = '00000000-0000-0000-0000-000000000013';
const ownerSession = 'owner-session-secret';
const viewerSession = 'viewer-session-secret';
const outsiderSession = 'outsider-session-secret';

describe('tenant authorization (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??=
      'postgresql://scaffold:scaffold@localhost:5432/scaffold?schema=public';
    process.env.AUTH_SECRET = authSecret;
    process.env.SMTP_URL = 'smtp://localhost:1025';
    process.env.EMAIL_FROM = 'no-reply@example.test';
    process.env.WEB_APP_ORIGIN = 'http://localhost:5173';
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
      'TRUNCATE TABLE outbox_events, oauth_profile_transactions, oidc_transactions, password_reset_intents, phone_registration_intents, registration_intents, audit_events, projects, memberships, organizations, sessions, password_credentials, user_contacts, external_identities, users CASCADE',
    );
    const expiry = new Date(Date.now() + 60 * 60 * 1000);
    await database.organization.create({
      data: { id: organizationId, name: 'Owner organization' },
    });
    await database.user.createMany({
      data: [
        { id: ownerId, displayName: 'Owner' },
        { id: viewerId, displayName: 'Viewer' },
        { id: outsiderId, displayName: 'Outsider' },
      ],
    });
    await database.membership.createMany({
      data: [
        { userId: ownerId, organizationId, role: 'OWNER' },
        { userId: viewerId, organizationId, role: 'VIEWER' },
      ],
    });
    await database.project.create({ data: { organizationId, name: 'Private project' } });
    await database.session.createMany({
      data: [ownerSession, viewerSession, outsiderSession].map((secret, index) => ({
        userId: [ownerId, viewerId, outsiderId][index],
        secretHash: hashAuthSecret(authSecret, secret),
        csrfSecretHash: hashAuthSecret(authSecret, csrfToken(authSecret, secret)),
        absoluteExpiresAt: expiry,
        idleExpiresAt: expiry,
      })),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  function sessionCookie(secret: string): string {
    return `dev-session=${secret}`;
  }

  it('allows an owner to read and create projects in their organization', async () => {
    await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}/projects`)
      .set('Cookie', sessionCookie(ownerSession))
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual([expect.objectContaining({ name: 'Private project' })]),
      );

    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/projects`)
      .set('Cookie', sessionCookie(ownerSession))
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrfToken(authSecret, ownerSession))
      .send({ name: 'Owner-created project' })
      .expect(201)
      .expect(({ body }) =>
        expect(body).toEqual(expect.objectContaining({ name: 'Owner-created project' })),
      );
  });

  it('blocks a non-member from reading or writing another organization', async () => {
    await request(app.getHttpServer())
      .get(`/api/organizations/${organizationId}/projects`)
      .set('Cookie', sessionCookie(outsiderSession))
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/projects`)
      .set('Cookie', sessionCookie(outsiderSession))
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrfToken(authSecret, outsiderSession))
      .send({ name: 'Cross-tenant attempt' })
      .expect(403);

    await expect(database.project.count({ where: { organizationId } })).resolves.toBe(1);
  });

  it('blocks a viewer from creating a project', async () => {
    await request(app.getHttpServer())
      .post(`/api/organizations/${organizationId}/projects`)
      .set('Cookie', sessionCookie(viewerSession))
      .set('Origin', 'http://localhost:5173')
      .set('X-CSRF-Token', csrfToken(authSecret, viewerSession))
      .send({ name: 'Viewer-created project' })
      .expect(403);
  });
});
