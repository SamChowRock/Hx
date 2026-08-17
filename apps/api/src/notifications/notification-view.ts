import { type Notification } from '../../../../libs/platform/src/database/generated/client';

export function presentNotification(notification: Notification) {
  return {
    id: notification.id,
    kind: notification.kind,
    severity: notification.severity,
    title: notification.title,
    body: notification.body,
    actionUrl: notification.actionUrl,
    readAt: notification.readAt?.toISOString() ?? null,
    expiresAt: notification.expiresAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
