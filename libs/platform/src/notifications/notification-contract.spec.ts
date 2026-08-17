import { notificationInputSchema, notificationOutboxPayloadSchema } from './notification-contract';

const baseNotification = {
  userId: '00000000-0000-4000-8000-000000000001',
  kind: 'organization.member.added',
  title: 'Organization access granted',
  body: 'You can now access the organization.',
};

describe('notification contract', () => {
  it('normalizes bounded plain text and accepts a relative application action', () => {
    expect(
      notificationInputSchema.parse({
        ...baseNotification,
        title: '  Access granted  ',
        body: '  Open the organization.  ',
        actionUrl: '/organizations/example',
      }),
    ).toEqual(
      expect.objectContaining({
        severity: 'INFO',
        title: 'Access granted',
        body: 'Open the organization.',
        actionUrl: '/organizations/example',
      }),
    );
  });

  it.each(['https://attacker.example/path', '//attacker.example/path', '/safe\\redirect'])(
    'rejects unsafe action URL %s',
    (actionUrl) => {
      expect(() => notificationInputSchema.parse({ ...baseNotification, actionUrl })).toThrow();
    },
  );

  it('requires durable outbox producers to supply a deduplication key', () => {
    expect(() => notificationOutboxPayloadSchema.parse(baseNotification)).toThrow();
    expect(
      notificationOutboxPayloadSchema.parse({
        ...baseNotification,
        dedupeKey: 'organization.member.added:membership-id',
      }).dedupeKey,
    ).toBe('organization.member.added:membership-id');
  });
});
