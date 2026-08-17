import { z } from 'zod';

const kindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u);
const titleSchema = z
  .string()
  .min(1)
  .max(120)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0 && !/\p{Cc}/u.test(value));
const bodySchema = z
  .string()
  .min(1)
  .max(1_000)
  .transform((value) => value.trim())
  .refine((value) => value.length > 0 && !/\p{Cc}/u.test(value.replace(/[\n\t]/gu, '')));
const actionUrlSchema = z
  .string()
  .max(500)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
    'Action URL must be a safe relative application path.',
  );
const dedupeKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w.:/-]+$/u);

export const notificationInputSchema = z
  .object({
    userId: z.string().uuid(),
    kind: kindSchema,
    severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'ERROR']).default('INFO'),
    title: titleSchema,
    body: bodySchema,
    actionUrl: actionUrlSchema.nullish(),
    dedupeKey: dedupeKeySchema.optional(),
    expiresAt: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();

export const notificationOutboxPayloadSchema = notificationInputSchema.required({
  dedupeKey: true,
});

export type NotificationInput = z.input<typeof notificationInputSchema>;
export type NotificationOutboxPayload = z.infer<typeof notificationOutboxPayloadSchema>;
