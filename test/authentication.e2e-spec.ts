import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../apps/api/src/app.module';
import { configureApplication } from '../apps/api/src/configure-application';
import { DatabaseService } from '../libs/platform/src/database';

const authSecret = 'e2e-auth-secret-that-is-long-enough-for-validation';
const webOrigin = 'http://localhost:5173';
const emailPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string(),
  text: z.string(),
});

describe('browser authentication (e2e)', () => {
  let app: INestApplication;
  let database: DatabaseService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??=
      'postgresql://scaffold:scaffold@localhost:5432/scaffold?schema=public';
    process.env.AUTH_SECRET = authSecret;
    process.env.SMTP_URL = 'smtp://localhost:1025';
    process.env.EMAIL_FROM = 'no-reply@example.test';
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000000000';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_FROM = '+14155550100';
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
      'TRUNCATE TABLE nickname_changes, outbox_events, oauth_profile_transactions, oidc_transactions, password_reset_intents, phone_registration_intents, registration_intents, audit_events, projects, memberships, organizations, sessions, password_credentials, user_contacts, external_identities, users CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function latestMessage(subject: string) {
    const event = await database.outboxEvent.findFirstOrThrow({
      where: { type: 'email.send', payload: { path: ['subject'], equals: subject } },
      orderBy: { createdAt: 'desc' },
    });
    return emailPayloadSchema.parse(event.payload);
  }

  function messageLink(text: string): URL {
    const link = text.split(' ').at(-1);
    if (!link) throw new Error('Email message did not contain a link.');
    return new URL(link);
  }

  it('registers a verified email and creates a protected server session', async () => {
    const browser = request.agent(app.getHttpServer());

    await browser
      .post('/api/auth/registrations/email')
      .set('Origin', webOrigin)
      .send({ email: 'Sam@example.test' })
      .expect(202, { status: 'accepted' });

    const message = await latestMessage('Verify your account');
    expect(message.to).toBe('sam@example.test');
    const verificationUrl = messageLink(message.text);
    await browser.get(`${verificationUrl.pathname}${verificationUrl.search}`).expect(302);

    const csrfResponse = await browser.get('/api/auth/registration-session').expect(200);
    await browser
      .post('/api/auth/registrations/complete')
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfResponse.body.csrfToken as string)
      .send({ displayName: 'Sam', password: 'correct horse battery staple' })
      .expect(201)
      .expect(({ body }) => expect(body).toEqual(expect.objectContaining({ displayName: 'Sam' })));

    const sessionResponse = await browser.get('/api/auth/session').expect(200);
    expect(sessionResponse.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({ displayName: 'Sam' }),
        csrfToken: expect.any(String),
      }),
    );
    await expect(database.user.count()).resolves.toBe(1);

    const sessionsResponse = await browser.get('/api/auth/sessions').expect(200);
    expect(sessionsResponse.body).toEqual([
      expect.objectContaining({ id: expect.any(String), current: true }),
    ]);
    await browser
      .delete(`/api/auth/sessions/${sessionsResponse.body[0].id as string}`)
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', sessionResponse.body.csrfToken as string)
      .expect(200, { status: 'ok' });
    await browser.get('/api/auth/session').expect(401);
  });

  it('returns stable request errors and rejects login CSRF attempts', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login/password')
      .set('Origin', webOrigin)
      .send({ email: 'not-an-email', password: '' })
      .expect('Content-Type', /application\/problem\+json/)
      .expect(400)
      .expect(({ body }) =>
        expect(body).toEqual(
          expect.objectContaining({ title: 'Invalid request', errors: expect.any(Array) }),
        ),
      );

    await request(app.getHttpServer())
      .post('/api/auth/login/password')
      .send({ email: 'sam@example.test', password: 'irrelevant' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/auth/login/password')
      .set('Origin', 'https://evil.example')
      .send({ email: 'sam@example.test', password: 'irrelevant' })
      .expect(403);
  });

  it('verifies an E.164 phone OTP and permits password login by phone', async () => {
    const registrationBrowser = request.agent(app.getHttpServer());
    const startResponse = await registrationBrowser
      .post('/api/auth/registrations/phone')
      .set('Origin', webOrigin)
      .send({ phone: '+1 415 555 2671' })
      .expect(202);
    expect(startResponse.body).toEqual({
      status: 'accepted',
      challengeId: expect.any(String),
    });
    const event = await database.outboxEvent.findFirstOrThrow({
      where: { type: 'sms.send' },
      orderBy: { createdAt: 'desc' },
    });
    const payload = z.object({ to: z.string(), body: z.string() }).parse(event.payload);
    expect(payload.to).toBe('+14155552671');
    const code = payload.body.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeDefined();

    await registrationBrowser
      .post('/api/auth/registrations/phone/verify')
      .set('Origin', webOrigin)
      .send({ challengeId: startResponse.body.challengeId, code })
      .expect(200, { status: 'verified' });
    const csrfResponse = await registrationBrowser
      .get('/api/auth/registration-session')
      .expect(200);
    await registrationBrowser
      .post('/api/auth/registrations/complete')
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfResponse.body.csrfToken as string)
      .send({ displayName: 'Phone user', password: 'correct horse battery staple' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/login/password')
      .set('Origin', webOrigin)
      .send({ identifier: '+14155552671', password: 'correct horse battery staple' })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual(expect.objectContaining({ displayName: 'Phone user' })),
      );
  });

  it('uses a one-time reset link and revokes existing sessions', async () => {
    const user = await database.user.create({
      data: {
        displayName: 'Reset user',
        contacts: {
          create: {
            type: 'EMAIL',
            normalizedValue: 'reset@example.test',
            verifiedAt: new Date(),
          },
        },
        credential: {
          create: {
            passwordHash:
              '$argon2id$v=19$m=19456,t=2,p=1$6fUZOwSW4xfSOavGimStNg$rgN8e8bVzCzSseZP34a5TPrkSV70OKhIXgRTU5MrHso',
          },
        },
      },
    });
    await database.session.create({
      data: {
        userId: user.id,
        secretHash: 'existing-session-hash',
        csrfSecretHash: 'existing-csrf-hash',
        absoluteExpiresAt: new Date(Date.now() + 60_000),
        idleExpiresAt: new Date(Date.now() + 60_000),
      },
    });
    const browser = request.agent(app.getHttpServer());

    await browser
      .post('/api/auth/password/reset/request')
      .set('Origin', webOrigin)
      .send({ email: 'reset@example.test' })
      .expect(202, { status: 'accepted' });
    const resetUrl = messageLink((await latestMessage('Reset your password')).text);
    await browser.get(`${resetUrl.pathname}${resetUrl.search}`).expect(302);
    const csrfResponse = await browser.get('/api/auth/password/reset/session').expect(200);
    await browser
      .post('/api/auth/password/reset/confirm')
      .set('Origin', webOrigin)
      .set('X-CSRF-Token', csrfResponse.body.csrfToken as string)
      .send({ password: 'a newly reset secure password' })
      .expect(200, { status: 'ok' });

    await expect(
      database.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).resolves.toBe(0);
    await browser.get(`${resetUrl.pathname}${resetUrl.search}`).expect(401);
  });
});
