import { Inject, Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { ENVIRONMENT, type Environment } from '../../../libs/platform/src/config';
import { DatabaseService } from '../../../libs/platform/src/database';
import { notificationOutboxPayloadSchema } from '../../../libs/platform/src/notifications';

const emailPayloadSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  text: z.string().min(1).max(10_000),
});
const smsPayloadSchema = z.object({
  to: z.string().min(8).max(32),
  body: z.string().min(1).max(1_000),
});

const pollIntervalMs = 1_000;
const staleLockMs = 5 * 60 * 1_000;
const maxAttempts = 10;

@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private pollHandle?: NodeJS.Timeout;
  private pollPromise?: Promise<void>;
  private shuttingDown = false;

  constructor(
    private readonly database: DatabaseService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
    private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    this.pollHandle = setInterval(() => void this.poll(), pollIntervalMs);
    void this.poll();
    this.logger.log('Worker started; transactional outbox processing is active');
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.shuttingDown = true;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = undefined;
    }
    await this.pollPromise;
    this.logger.log({ signal }, 'Worker shutting down');
  }

  private poll(): Promise<void> {
    if (this.pollPromise || this.shuttingDown) return this.pollPromise ?? Promise.resolve();
    this.pollPromise = this.drainAvailableEvents().finally(() => {
      this.pollPromise = undefined;
    });
    return this.pollPromise;
  }

  private async drainAvailableEvents(): Promise<void> {
    for (let processed = 0; processed < 20 && !this.shuttingDown; processed += 1) {
      const event = await this.claimNextEvent();
      if (!event) return;
      await this.deliver(event);
    }
  }

  private async claimNextEvent() {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleLockMs);
    const claimable = {
      OR: [
        { status: 'PENDING' as const, availableAt: { lte: now } },
        { status: 'PROCESSING' as const, lockedAt: { lte: staleBefore } },
      ],
    };
    const candidate = await this.database.outboxEvent.findFirst({
      where: claimable,
      orderBy: { availableAt: 'asc' },
    });
    if (!candidate) return undefined;

    const claimed = await this.database.outboxEvent.updateMany({
      where: { id: candidate.id, ...claimable },
      data: { status: 'PROCESSING', lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return undefined;
    return { ...candidate, attempts: candidate.attempts + 1 };
  }

  private async deliver(event: NonNullable<Awaited<ReturnType<WorkerService['claimNextEvent']>>>) {
    try {
      if (event.type === 'email.send') {
        const message = emailPayloadSchema.parse(event.payload);
        await nodemailer.createTransport(this.environment.SMTP_URL).sendMail({
          from: this.environment.EMAIL_FROM,
          messageId: `<${event.id}@${new URL(this.environment.API_PUBLIC_ORIGIN).hostname}>`,
          ...message,
        });
      } else if (event.type === 'sms.send') {
        await this.sendSms(smsPayloadSchema.parse(event.payload));
      } else if (event.type === 'notification.create') {
        const notification = notificationOutboxPayloadSchema.parse(event.payload);
        const expiresAt = notification.expiresAt ? new Date(notification.expiresAt) : null;
        const recipientIsActive =
          (await this.database.user.count({
            where: { id: notification.userId, status: 'ACTIVE' },
          })) === 1;
        if (recipientIsActive && (!expiresAt || expiresAt > new Date())) {
          await this.database.notification.createMany({
            data: {
              userId: notification.userId,
              kind: notification.kind,
              severity: notification.severity,
              title: notification.title,
              body: notification.body,
              actionUrl: notification.actionUrl ?? null,
              dedupeKey: notification.dedupeKey,
              expiresAt,
            },
            skipDuplicates: true,
          });
        }
      } else {
        throw new Error(`Unsupported event type: ${event.type}`);
      }
      await this.database.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          lockedAt: null,
          lastError: null,
          payload: { redacted: true },
        },
      });
      this.logger.log({ eventId: event.id, eventType: event.type }, 'Outbox event delivered');
    } catch {
      const dead = event.attempts >= maxAttempts;
      const retryDelayMs = Math.min(60 * 60 * 1_000, 2 ** event.attempts * 1_000);
      await this.database.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: dead ? 'DEAD' : 'PENDING',
          availableAt: dead ? event.availableAt : new Date(Date.now() + retryDelayMs),
          lockedAt: null,
          lastError: 'Delivery failed',
          ...(dead ? { payload: { redacted: true } } : {}),
        },
      });
      this.logger.error(
        { eventId: event.id, eventType: event.type, attempt: event.attempts, dead },
        'Outbox event delivery failed',
      );
    }
  }

  private async sendSms(message: z.infer<typeof smsPayloadSchema>): Promise<void> {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM } = this.environment;
    if (
      this.environment.SMS_PROVIDER !== 'twilio' ||
      !TWILIO_ACCOUNT_SID ||
      !TWILIO_AUTH_TOKEN ||
      !TWILIO_FROM
    ) {
      throw new Error('SMS provider is not configured.');
    }
    const form = new URLSearchParams({
      To: message.to,
      From: TWILIO_FROM,
      Body: message.body,
    });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`SMS provider returned ${response.status}.`);
  }
}
