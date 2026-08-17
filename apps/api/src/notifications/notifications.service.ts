import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import { DatabaseService } from '../../../../libs/platform/src/database';
import {
  type Notification,
  type Prisma,
} from '../../../../libs/platform/src/database/generated/client';
import {
  notificationInputSchema,
  type NotificationInput,
} from '../../../../libs/platform/src/notifications';

import { NotificationRealtimeService } from './notification-realtime.service';
import { presentNotification } from './notification-view';

const cursorSchema = z
  .object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
  .strict();

export type NotificationListInput = {
  limit: number;
  cursor?: string;
  unreadOnly: boolean;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly realtime: NotificationRealtimeService,
  ) {}

  async create(input: NotificationInput) {
    const parsed = notificationInputSchema.parse(input);
    if (
      (await this.database.user.count({ where: { id: parsed.userId, status: 'ACTIVE' } })) !== 1
    ) {
      throw new NotFoundException('Notification recipient was not found.');
    }
    if (parsed.expiresAt && new Date(parsed.expiresAt) <= new Date()) {
      throw new BadRequestException('Notification expiry must be in the future.');
    }
    const data = {
      userId: parsed.userId,
      kind: parsed.kind,
      severity: parsed.severity,
      title: parsed.title,
      body: parsed.body,
      actionUrl: parsed.actionUrl ?? null,
      dedupeKey: parsed.dedupeKey ?? null,
      expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
    };

    let created = true;
    let notification: Notification;
    if (parsed.dedupeKey) {
      const result = await this.database.notification.createMany({ data, skipDuplicates: true });
      created = result.count === 1;
      notification = await this.database.notification.findUniqueOrThrow({
        where: {
          userId_dedupeKey: { userId: parsed.userId, dedupeKey: parsed.dedupeKey },
        },
      });
    } else {
      notification = await this.database.notification.create({ data });
    }
    if (created) this.realtime.announceCreated(notification);
    return notification;
  }

  async list(userId: string, input: NotificationListInput) {
    const cursor = input.cursor ? this.decodeCursor(input.cursor) : undefined;
    const cursorFilter = cursor
      ? {
          OR: [
            { createdAt: { lt: new Date(cursor.createdAt) } },
            { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
          ],
        }
      : undefined;
    const notifications = await this.database.notification.findMany({
      where: {
        userId,
        ...(input.unreadOnly ? { readAt: null } : {}),
        AND: [...(cursorFilter ? [cursorFilter] : []), this.activeFilter()],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const hasMore = notifications.length > input.limit;
    const page = notifications.slice(0, input.limit);
    return {
      data: page.map(presentNotification),
      nextCursor:
        hasMore && page.length > 0
          ? this.encodeCursor(page[page.length - 1].createdAt, page[page.length - 1].id)
          : null,
      meta: { unreadCount: await this.unreadCount(userId) },
    };
  }

  async unreadCount(userId: string) {
    return this.database.notification.count({
      where: { userId, readAt: null, ...this.activeFilter() },
    });
  }

  async markRead(userId: string, notificationId: string) {
    const exists = await this.database.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!exists) throw new NotFoundException('Notification was not found.');
    if (!exists.readAt) {
      await this.database.notification.updateMany({
        where: { id: notificationId, userId, readAt: null },
        data: { readAt: new Date() },
      });
    }
    const notification = await this.database.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) throw new NotFoundException('Notification was not found.');
    const unreadCount = await this.realtime.publishUnreadCount(userId);
    return { notification: presentNotification(notification), unreadCount };
  }

  async markAllRead(userId: string) {
    const result = await this.database.notification.updateMany({
      where: { userId, readAt: null, ...this.activeFilter() },
      data: { readAt: new Date() },
    });
    const unreadCount = await this.realtime.publishUnreadCount(userId);
    return { updatedCount: result.count, unreadCount };
  }

  async clearRead(userId: string) {
    const result = await this.database.notification.deleteMany({
      where: { userId, readAt: { not: null } },
    });
    const unreadCount = await this.realtime.publishUnreadCount(userId);
    return { deletedCount: result.count, unreadCount };
  }

  async dismiss(userId: string, notificationId: string) {
    const result = await this.database.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    if (result.count !== 1) throw new NotFoundException('Notification was not found.');
    const unreadCount = await this.realtime.publishUnreadCount(userId);
    return { deleted: true, unreadCount };
  }

  stream(userId: string, lastEventId?: string) {
    return this.realtime.stream(userId, lastEventId);
  }

  private activeFilter(): Prisma.NotificationWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString(
      'base64url',
    );
  }

  private decodeCursor(value: string) {
    if (value.length > 512) throw new BadRequestException('Notification cursor is invalid.');
    try {
      return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    } catch {
      throw new BadRequestException('Notification cursor is invalid.');
    }
  }
}
