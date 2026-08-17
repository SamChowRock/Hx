import { type MessageEvent, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

import { DatabaseService } from '../../../../libs/platform/src/database';
import {
  type Notification,
  type Prisma,
} from '../../../../libs/platform/src/database/generated/client';

import { presentNotification } from './notification-view';

type RoutedEvent = {
  userId: string;
  event: MessageEvent;
  notificationId?: string;
  unreadCount?: number;
};

const reconcileIntervalMs = 5_000;
const heartbeatIntervalMs = 20_000;
const maximumReplaySize = 100;

@Injectable()
export class NotificationRealtimeService implements OnApplicationShutdown {
  private readonly events = new Subject<RoutedEvent>();
  private readonly countPublishes = new Map<string, Promise<number>>();

  constructor(private readonly database: DatabaseService) {}

  announceCreated(notification: Notification): void {
    this.events.next({
      userId: notification.userId,
      notificationId: notification.id,
      event: {
        id: notification.id,
        type: 'notification',
        data: presentNotification(notification),
      },
    });
    void this.publishUnreadCount(notification.userId).catch(() => {
      this.events.next({
        userId: notification.userId,
        event: { type: 'resync-required', data: { reason: 'unread-count' } },
      });
    });
  }

  publishUnreadCount(userId: string): Promise<number> {
    const previous = this.countPublishes.get(userId);
    const publish = (
      previous
        ? previous.then(
            () => undefined,
            () => undefined,
          )
        : Promise.resolve()
    ).then(async () => {
      const unreadCount = await this.countUnread(userId);
      this.events.next({
        userId,
        unreadCount,
        event: { type: 'unread-count', data: { unreadCount } },
      });
      return unreadCount;
    });
    this.countPublishes.set(userId, publish);
    const clear = () => {
      if (this.countPublishes.get(userId) === publish) this.countPublishes.delete(userId);
    };
    void publish.then(clear, clear);
    return publish;
  }

  stream(userId: string, lastEventId?: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let reconciling = false;
      let watermark = new Date();
      let lastUnreadCount: number | undefined;
      const seen = new Set<string>();
      const seenOrder: string[] = [];

      const remember = (id: string) => {
        if (seen.has(id)) return false;
        seen.add(id);
        seenOrder.push(id);
        if (seenOrder.length > 500) {
          const oldest = seenOrder.shift();
          if (oldest) seen.delete(oldest);
        }
        return true;
      };

      const emitNotification = (notification: Notification) => {
        if (!remember(notification.id) || closed) return;
        subscriber.next({
          id: notification.id,
          type: 'notification',
          data: presentNotification(notification),
        });
      };

      const localSubscription = this.events.subscribe((routed) => {
        if (routed.userId !== userId || closed) return;
        if (routed.notificationId && !remember(routed.notificationId)) return;
        if (routed.unreadCount !== undefined) lastUnreadCount = routed.unreadCount;
        subscriber.next(routed.event);
      });

      const initialize = async () => {
        if (lastEventId) {
          const cursor = await this.database.notification.findFirst({
            where: { id: lastEventId, userId },
            select: { id: true, createdAt: true },
          });
          if (!cursor) {
            subscriber.next({ type: 'resync-required', data: { reason: 'cursor-unavailable' } });
          } else {
            remember(cursor.id);
            const replay = await this.database.notification.findMany({
              where: {
                userId,
                AND: [
                  {
                    OR: [
                      { createdAt: { gt: cursor.createdAt } },
                      { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                    ],
                  },
                  this.activeFilter(),
                ],
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              take: maximumReplaySize + 1,
            });
            if (replay.length > maximumReplaySize) {
              subscriber.next({ type: 'resync-required', data: { reason: 'replay-limit' } });
            } else {
              replay.forEach(emitNotification);
            }
          }
        }
        if (!closed) {
          const unreadCount = await this.countUnread(userId);
          if (!closed) {
            lastUnreadCount = unreadCount;
            subscriber.next({ type: 'snapshot', data: { unreadCount } });
          }
        }
      };

      const reconcile = async () => {
        if (closed || reconciling) return;
        reconciling = true;
        const startedAt = new Date();
        try {
          const notifications = await this.database.notification.findMany({
            where: {
              userId,
              createdAt: { gte: watermark },
              ...this.activeFilter(),
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: maximumReplaySize + 1,
          });
          if (notifications.length > maximumReplaySize) {
            subscriber.next({ type: 'resync-required', data: { reason: 'reconcile-limit' } });
          } else {
            notifications.forEach(emitNotification);
          }
          const unreadCount = await this.countUnread(userId);
          if (!closed && unreadCount !== lastUnreadCount) {
            lastUnreadCount = unreadCount;
            subscriber.next({ type: 'unread-count', data: { unreadCount } });
          }
          watermark = startedAt;
        } catch {
          if (!closed) {
            subscriber.next({ type: 'resync-required', data: { reason: 'reconcile-failed' } });
          }
        } finally {
          reconciling = false;
        }
      };

      void initialize().catch(() => {
        if (!closed)
          subscriber.next({ type: 'resync-required', data: { reason: 'initialization' } });
      });
      const reconcileHandle = setInterval(() => void reconcile(), reconcileIntervalMs);
      const heartbeatHandle = setInterval(() => {
        if (!closed) subscriber.next({ type: 'heartbeat', data: { at: new Date().toISOString() } });
      }, heartbeatIntervalMs);

      return () => {
        closed = true;
        clearInterval(reconcileHandle);
        clearInterval(heartbeatHandle);
        localSubscription.unsubscribe();
      };
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.countPublishes.values());
    this.events.complete();
  }

  private countUnread(userId: string) {
    return this.database.notification.count({
      where: { userId, readAt: null, ...this.activeFilter() },
    });
  }

  private activeFilter(): Prisma.NotificationWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
  }
}
